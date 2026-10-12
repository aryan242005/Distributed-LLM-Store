const EventEmitter = require('events');

/**
 * Berkeley clock synchronization, run by the elected leader (the "time daemon").
 *
 *  1. Leader broadcasts TIME_REQUEST and notes its own send time t0.
 *  2. Each follower replies TIME_REPLY with its current clock reading.
 *  3. For each reply the leader estimates the follower's clock "now" Cristian-style,
 *     as reading + RTT/2, and computes its offset from the leader's clock.
 *  4. Offsets further than maxDeviationMs from the median are treated as faulty
 *     clocks and excluded (fault-tolerant average).
 *  5. The leader averages the remaining offsets (its own is 0) and sends each node the
 *     delta that moves it to that average (CLOCK_ADJUST), adjusting itself as well.
 *
 * Berkeley gives internal agreement, not accuracy: clocks converge on their average,
 * not on UTC.
 *
 * Emits 'round' with the full round result on the leader.
 */
class BerkeleyClockSync extends EventEmitter {
  constructor({ bus, nodeId, clock, election, intervalMs = 30000, replyWindowMs = 1000, maxDeviationMs = 60000 }) {
    super();
    this.bus = bus;
    this.nodeId = nodeId;
    this.clock = clock;
    this.election = election;
    this.intervalMs = intervalMs;
    this.replyWindowMs = replyWindowMs;
    this.maxDeviationMs = maxDeviationMs;
    this.round = 0;
    this.pending = null;
    this.lastAdjustment = null;
    this.timer = null;
  }

  start() {
    this.bus.on('TIME_REQUEST', (msg) => {
      this.bus.send(msg.from, 'TIME_REPLY', { round: msg.body.round, time: this.clock.now() });
    });
    this.bus.on('TIME_REPLY', (msg) => this._onReply(msg));
    this.bus.on('CLOCK_ADJUST', (msg) => this._apply(msg.body.round, msg.body.adjustMs, msg.from));
    this.timer = setInterval(() => {
      if (this.election.isLeader()) this.runRound().catch(() => {});
    }, this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  async runRound() {
    if (!this.election.isLeader()) throw new Error(`${this.nodeId} is not the leader`);
    if (this.pending) throw new Error('A clock sync round is already in progress');

    this.round += 1;
    const round = this.round;
    this.pending = { round, t0: this.clock.now(), samples: {} };
    this.bus.send('*', 'TIME_REQUEST', { round }, `Berkeley round ${round}`);

    await new Promise((resolve) => setTimeout(resolve, this.replyWindowMs));
    const { samples } = this.pending;
    this.pending = null;

    samples[this.nodeId] = { offsetMs: 0, rttMs: 0 };
    const offsets = Object.values(samples).map((s) => s.offsetMs).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];
    const included = Object.entries(samples).filter(([, s]) => Math.abs(s.offsetMs - median) <= this.maxDeviationMs);
    const excluded = Object.keys(samples).filter((id) => !included.some(([inc]) => inc === id));
    const averageMs = included.reduce((sum, [, s]) => sum + s.offsetMs, 0) / included.length;

    const adjustments = {};
    for (const [id, s] of included) {
      adjustments[id] = Math.round(averageMs - s.offsetMs);
      if (id !== this.nodeId) {
        this.bus.send(id, 'CLOCK_ADJUST', { round, adjustMs: adjustments[id] }, `adjust ${adjustments[id]} ms`);
      }
    }
    this._apply(round, adjustments[this.nodeId], this.nodeId);

    const result = {
      round,
      leader: this.nodeId,
      samples,
      averageOffsetMs: Math.round(averageMs),
      adjustments,
      excluded,
      completedAt: new Date().toISOString(),
    };
    this.emit('round', result);
    return result;
  }

  _onReply(msg) {
    if (!this.pending || msg.body.round !== this.pending.round) return;
    const now = this.clock.now();
    const rttMs = now - this.pending.t0;
    const estimate = msg.body.time + rttMs / 2;
    this.pending.samples[msg.from] = { offsetMs: Math.round(estimate - now), rttMs };
  }

  _apply(round, adjustMs, from) {
    this.clock.adjust(adjustMs);
    this.lastAdjustment = { round, adjustMs, from, at: new Date().toISOString() };
    this.bus.internal('CLOCK_ADJUSTED', `round ${round}: ${adjustMs >= 0 ? '+' : ''}${adjustMs} ms`);
  }
}

module.exports = BerkeleyClockSync;
