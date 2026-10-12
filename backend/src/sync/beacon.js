const EventEmitter = require('events');
const { performance } = require('perf_hooks');

/**
 * Beacon protocol: every node periodically broadcasts a beacon carrying a sequence
 * number. Each node independently builds a membership table from the beacons it
 * hears: a peer is ALIVE, SUSPECT after one missed beacon, and DEAD after
 * `missedLimit` missed beacons.
 *
 * Failure detection uses the local monotonic clock (performance.now), never the
 * adjustable physical clock, so injected skew or Berkeley corrections cannot make
 * a healthy peer look dead.
 *
 * Emits 'peer-up' and 'peer-down' with the peer id.
 */
class BeaconProtocol extends EventEmitter {
  constructor({ bus, intervalMs = 2000, missedLimit = 3, getPayload = () => ({}) }) {
    super();
    this.bus = bus;
    this.intervalMs = intervalMs;
    this.missedLimit = missedLimit;
    this.getPayload = getPayload;
    this.seq = 0;
    this.peers = new Map(); // id -> { lastSeen, seq, status, missed }
    this.timer = null;
  }

  start() {
    this.bus.on('BEACON', (msg) => this._onBeacon(msg));
    this._tick();
    this.timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  _tick() {
    this.seq += 1;
    this.bus.send('*', 'BEACON', { seq: this.seq, intervalMs: this.intervalMs, ...this.getPayload() });
    this._checkPeers();
  }

  _onBeacon(msg) {
    const prev = this.peers.get(msg.from);
    const wasDead = !prev || prev.status === 'DEAD';
    this.peers.set(msg.from, {
      lastSeen: performance.now(),
      seq: msg.body.seq,
      status: 'ALIVE',
      missed: 0,
    });
    if (wasDead) {
      this.bus.internal('PEER_UP', `${msg.from} beacon #${msg.body.seq} received`);
      this.emit('peer-up', msg.from);
    }
  }

  _checkPeers() {
    const now = performance.now();
    for (const [id, peer] of this.peers) {
      if (peer.status === 'DEAD') continue;
      peer.missed = Math.floor((now - peer.lastSeen) / this.intervalMs);
      if (peer.missed >= this.missedLimit) {
        peer.status = 'DEAD';
        this.bus.internal('PEER_DOWN', `${id} missed ${peer.missed} beacons`);
        this.emit('peer-down', id);
      } else if (peer.missed >= 1) {
        peer.status = 'SUSPECT';
      }
    }
  }

  alivePeers() {
    return [...this.peers].filter(([, p]) => p.status !== 'DEAD').map(([id]) => id);
  }

  knownPeers() {
    return [...this.peers.keys()];
  }

  table() {
    const now = performance.now();
    return [...this.peers].map(([id, p]) => ({
      id,
      status: p.status,
      lastSeq: p.seq,
      lastSeenMsAgo: Math.round(now - p.lastSeen),
    }));
  }
}

module.exports = BeaconProtocol;
