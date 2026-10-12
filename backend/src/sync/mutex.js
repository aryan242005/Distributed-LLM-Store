const EventEmitter = require('events');
const { lamportLess } = require('./clocks');

/**
 * Ricart-Agrawala distributed mutual exclusion (no central lock server).
 *
 *  - To enter, a node broadcasts REQUEST stamped with its Lamport time and waits for
 *    a REPLY from every live peer.
 *  - On REQUEST, a node replies immediately unless it is in the critical section, or
 *    it wants it and its own request is older in Lamport total order
 *    (timestamp, node id). In those cases the reply is deferred until it exits.
 *  - Requests are therefore granted in Lamport order. That is safe (one holder at a time),
 *    fair (first-come-first-served by logical time) and costs 2(N-1) messages per entry.
 *
 * A peer declared DEAD by the beacon protocol is no longer waited for, so a crashed
 * node cannot block the cluster forever.
 */
class RicartAgrawalaMutex extends EventEmitter {
  constructor({ bus, nodeId, beacon }) {
    super();
    this.bus = bus;
    this.nodeId = nodeId;
    this.beacon = beacon;
    this.state = 'RELEASED'; // RELEASED | WANTED | HELD
    this.requestTs = null;
    this.awaiting = new Set();
    this.deferred = new Set();
    this.entries = 0;
    this._onEnter = null;
  }

  start() {
    this.bus.on('MUTEX_REQUEST', (msg) => this._onRequest(msg));
    this.bus.on('MUTEX_REPLY', (msg) => this._onReply(msg));
    this.beacon.on('peer-down', (id) => {
      this.deferred.delete(id);
      if (this.awaiting.delete(id)) {
        this.bus.internal('MUTEX_PEER_FAILED', `stopped waiting for ${id}`);
        this._maybeEnter();
      }
    });
  }

  acquire() {
    if (this.state !== 'RELEASED') {
      return Promise.reject(new Error(`${this.nodeId} already ${this.state}`));
    }
    this.state = 'WANTED';
    this.awaiting = new Set(this.beacon.alivePeers());
    const msg = this.bus.send('*', 'MUTEX_REQUEST', {}, 'requesting critical section');
    this.requestTs = msg ? msg.lamport : 0;
    return new Promise((resolve) => {
      this._onEnter = resolve;
      this._maybeEnter();
    });
  }

  release() {
    if (this.state !== 'HELD') return;
    this.state = 'RELEASED';
    this.requestTs = null;
    this.bus.internal('MUTEX_EXIT', `releasing, replying to ${[...this.deferred].join(', ') || 'nobody'}`);
    for (const id of this.deferred) {
      this.bus.send(id, 'MUTEX_REPLY', {}, 'deferred reply after exit');
    }
    this.deferred.clear();
  }

  async withLock(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  _onRequest(msg) {
    const mineFirst = this.state === 'WANTED' && lamportLess(this.requestTs, this.nodeId, msg.lamport, msg.from);
    if (this.state === 'HELD' || mineFirst) {
      this.deferred.add(msg.from);
      const why = this.state === 'HELD' ? 'I hold the lock' : `my request (L=${this.requestTs}) is older`;
      this.bus.internal('MUTEX_DEFER', `deferred ${msg.from} (L=${msg.lamport}): ${why}`);
    } else {
      this.bus.send(msg.from, 'MUTEX_REPLY', {}, `granting ${msg.from} (L=${msg.lamport})`);
    }
  }

  _onReply(msg) {
    if (this.state !== 'WANTED') return;
    this.awaiting.delete(msg.from);
    this._maybeEnter();
  }

  _maybeEnter() {
    if (this.state !== 'WANTED' || this.awaiting.size > 0) return;
    this.state = 'HELD';
    this.entries += 1;
    this.bus.internal('MUTEX_ENTER', `entered critical section (request L=${this.requestTs})`);
    const resolve = this._onEnter;
    this._onEnter = null;
    if (resolve) resolve();
  }

  status() {
    return {
      state: this.state,
      requestTs: this.requestTs,
      awaiting: [...this.awaiting],
      deferred: [...this.deferred],
      entries: this.entries,
    };
  }
}

module.exports = RicartAgrawalaMutex;
