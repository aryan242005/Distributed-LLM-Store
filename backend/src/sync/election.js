const EventEmitter = require('events');
const { compareIds } = require('./clocks');

/**
 * Bully election algorithm. The highest-ranked live node becomes leader.
 *
 *  1. A node starting an election sends ELECTION to every higher-ranked peer.
 *  2. A higher-ranked peer replies ANSWER ("I'm alive, I'll take over") and starts
 *     its own election.
 *  3. If no ANSWER arrives in time, the node wins and broadcasts COORDINATOR.
 *     If an ANSWER arrives but no COORDINATOR follows, it starts again.
 *
 * Elections are triggered at startup, when the leader's beacons stop (via the
 * beacon protocol's 'peer-down'), and on operator request. A recovered higher-ranked
 * node runs an election at startup and "bullies" its way back to leadership.
 *
 * Emits 'leader' with the new leader id.
 */
class BullyElection extends EventEmitter {
  constructor({ bus, nodeId, beacon, answerTimeoutMs = 1500, coordinatorTimeoutMs = 5000 }) {
    super();
    this.bus = bus;
    this.nodeId = nodeId;
    this.beacon = beacon;
    this.answerTimeoutMs = answerTimeoutMs;
    this.coordinatorTimeoutMs = coordinatorTimeoutMs;
    this.leader = null;
    this.electing = false;
    this.gotAnswer = false;
    this.elections = 0;
    this.timers = [];
  }

  start() {
    this.bus.on('ELECTION', (msg) => this._onElection(msg));
    this.bus.on('ANSWER', (msg) => this._onAnswer(msg));
    this.bus.on('COORDINATOR', (msg) => this._onCoordinator(msg));
    this.beacon.on('peer-down', (id) => {
      if (id === this.leader) {
        this.leader = null;
        this.startElection(`leader ${id} stopped sending beacons`);
      }
    });
  }

  stop() {
    this._clearTimers();
  }

  isLeader() {
    return this.leader === this.nodeId;
  }

  _isHigher(a, b) {
    return compareIds(a, b) > 0;
  }

  startElection(reason) {
    if (this.electing) return;
    this.electing = true;
    this.gotAnswer = false;
    this.elections += 1;
    this._clearTimers();
    this.bus.internal('ELECTION_START', reason);

    const higher = this.beacon.knownPeers().filter((id) => this._isHigher(id, this.nodeId));
    if (higher.length === 0) {
      this._becomeLeader();
      return;
    }
    for (const id of higher) {
      this.bus.send(id, 'ELECTION', {}, `bully: ${id} outranks me`);
    }
    this._setTimer(() => {
      if (!this.gotAnswer) this._becomeLeader();
    }, this.answerTimeoutMs);
  }

  _onElection(msg) {
    if (!this._isHigher(this.nodeId, msg.from)) return;
    this.bus.send(msg.from, 'ANSWER', {}, 'I outrank you, taking over');
    this.startElection(`ELECTION received from lower-ranked ${msg.from}`);
  }

  _onAnswer() {
    if (!this.electing || this.gotAnswer) return;
    this.gotAnswer = true;
    this._clearTimers();
    // A higher node took over; it must announce itself or we retry
    this._setTimer(() => {
      this.electing = false;
      this.startElection('ANSWER received but no COORDINATOR followed');
    }, this.coordinatorTimeoutMs);
  }

  _onCoordinator(msg) {
    if (this._isHigher(this.nodeId, msg.from)) {
      // A lower-ranked node claimed leadership while we are alive: bully it
      this.electing = false;
      this.startElection(`lower-ranked ${msg.from} claimed leadership`);
      return;
    }
    this._clearTimers();
    this.electing = false;
    this._setLeader(msg.from);
  }

  _becomeLeader() {
    this._clearTimers();
    this.electing = false;
    this.bus.send('*', 'COORDINATOR', {}, 'no higher-ranked node answered');
    this._setLeader(this.nodeId);
  }

  _setLeader(id) {
    const changed = this.leader !== id;
    this.leader = id;
    if (changed) {
      this.bus.internal('LEADER_ELECTED', `${id} is leader`);
      this.emit('leader', id);
    }
  }

  _setTimer(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  _clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

module.exports = BullyElection;
