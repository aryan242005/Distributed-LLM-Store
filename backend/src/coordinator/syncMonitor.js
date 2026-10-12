const { v4: uuidv4 } = require('uuid');
const natsClient = require('../communication/nats/natsClient');
const { compareIds } = require('../sync/clocks');

const STALE_AFTER_MS = 7000;
const MAX_TRACE = 600;
const MAX_ROUNDS = 20;
const MAX_SNAPSHOTS = 10;

/**
 * Coordinator-side observer of the storage nodes' synchronization layer.
 * Collects the status, event trace, clock-sync rounds and snapshot parts that nodes
 * publish, and relays operator commands. It is deliberately not a participant: the
 * election, clock sync, mutual exclusion and snapshot algorithms run peer-to-peer.
 * State is in-memory only, since it describes the live cluster.
 */
class SyncMonitor {
  constructor() {
    this.nodes = new Map();
    this.trace = [];
    this.traceSeq = 0;
    this.clockRounds = [];
    this.snapshots = new Map();
  }

  init() {
    natsClient.subscribe('sync.status', (status) => {
      // Coordinator's clock is the reference for displaying skew (includes ~ms of NATS latency)
      const receivedAt = Date.now();
      this.nodes.set(status.nodeId, { ...status, receivedAt, skewVsCoordinatorMs: status.clockTime - receivedAt });
    });
    natsClient.subscribe('sync.trace', (event) => {
      this.trace.push({ seq: ++this.traceSeq, ...event });
      if (this.trace.length > MAX_TRACE) this.trace.shift();
    });
    natsClient.subscribe('sync.clock.round', (round) => {
      this.clockRounds.unshift(round);
      this.clockRounds.length = Math.min(this.clockRounds.length, MAX_ROUNDS);
    });
    natsClient.subscribe('sync.snapshot', (part) => {
      const snap = this.snapshots.get(part.snapshotId);
      if (snap) snap.parts[part.nodeId] = part;
    });
  }

  freshNodes() {
    const now = Date.now();
    return [...this.nodes.values()]
      .filter((n) => now - n.receivedAt <= STALE_AFTER_MS)
      .sort((a, b) => compareIds(a.nodeId, b.nodeId));
  }

  getStatus() {
    const now = Date.now();
    const nodes = [...this.nodes.values()]
      .sort((a, b) => compareIds(a.nodeId, b.nodeId))
      .map((n) => ({ ...n, reachable: now - n.receivedAt <= STALE_AFTER_MS, statusAgeMs: now - n.receivedAt }));
    const fresh = nodes.filter((n) => n.reachable);

    // Leader as agreed by the live nodes
    const votes = {};
    fresh.forEach((n) => { if (n.leader) votes[n.leader] = (votes[n.leader] || 0) + 1; });
    const [leader = null, leaderVotes = 0] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [];

    // Mutual exclusion safety check: never more than one holder
    const holders = fresh.filter((n) => n.mutex && n.mutex.state === 'HELD').map((n) => n.nodeId);

    const skews = fresh.map((n) => n.skewVsCoordinatorMs);
    return {
      coordinatorTime: now,
      nodes,
      leader,
      leaderAgreement: `${leaderVotes}/${fresh.length}`,
      mutex: { holders, safe: holders.length <= 1 },
      maxClockSpreadMs: skews.length ? Math.max(...skews) - Math.min(...skews) : 0,
    };
  }

  getTrace({ limit = 200, sinceSeq = 0 } = {}) {
    return this.trace.filter((e) => e.seq > sinceSeq).slice(-limit);
  }

  getClockRounds() {
    return this.clockRounds;
  }

  command(cmd, args = {}) {
    natsClient.publish('sync.cmd', { cmd, ...args });
  }

  startSnapshot(initiator) {
    const fresh = this.freshNodes();
    if (fresh.length === 0) throw new Error('No storage nodes are reporting');
    const target = initiator || fresh[0].nodeId;
    const snapshotId = uuidv4().slice(0, 8);
    this.snapshots.set(snapshotId, {
      snapshotId,
      initiator: target,
      expected: fresh.map((n) => n.nodeId),
      startedAt: new Date().toISOString(),
      parts: {},
    });
    if (this.snapshots.size > MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value);
    this.command('SNAPSHOT', { target, snapshotId });
    return snapshotId;
  }

  getSnapshot(snapshotId) {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return null;
    const parts = Object.values(snap.parts).sort((a, b) => compareIds(a.nodeId, b.nodeId));
    const complete = snap.expected.every((id) => snap.parts[id]);
    return { ...snap, parts, complete, consistency: complete ? this._checkConsistency(parts) : null };
  }

  listSnapshots() {
    return [...this.snapshots.keys()].reverse().map((id) => this.getSnapshot(id));
  }

  /**
   * A cut is consistent iff no process has recorded receiving a message that its
   * sender had not yet sent when it recorded: for all i, j: V_i[j] <= V_j[j].
   */
  _checkConsistency(parts) {
    const violations = [];
    for (const pi of parts) {
      for (const pj of parts) {
        if (pi.nodeId === pj.nodeId) continue;
        const seen = pi.local.vector[pj.nodeId] || 0;
        const own = pj.local.vector[pj.nodeId] || 0;
        if (seen > own) violations.push(`${pi.nodeId} saw ${pj.nodeId}@${seen} but ${pj.nodeId} recorded at ${own}`);
      }
    }
    const inFlight = parts.reduce(
      (sum, p) => sum + Object.values(p.channels).reduce((s, msgs) => s + msgs.length, 0),
      0,
    );
    return { consistent: violations.length === 0, violations, inFlightMessages: inFlight };
  }
}

module.exports = new SyncMonitor();
