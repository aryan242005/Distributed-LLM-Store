const EventEmitter = require('events');
const { LamportClock, VectorClock } = require('./clocks');

// Every peer message travels on one subject. A NATS subscription delivers messages
// from one publisher in order, so this gives FIFO channels between every pair of
// nodes, which Chandy-Lamport snapshots rely on.
const PEER_SUBJECT = 'cluster.p2p';

// Control-plane messages that are not counted as events for the logical clocks,
// so the clocks reflect algorithm activity instead of growing with every beacon.
const UNCLOCKED = new Set(['BEACON', 'MARKER']);

/**
 * Node-to-node message layer for the synchronization algorithms.
 * Stamps every message with the sender's Lamport and vector timestamps, applies the
 * receive rules on delivery, and reports send/receive/internal events as a trace.
 */
class PeerBus extends EventEmitter {
  constructor({ nodeId, transport, physicalClock, onTrace = () => {} }) {
    super();
    this.setMaxListeners(50);
    this.nodeId = nodeId;
    this.transport = transport;
    this.physicalClock = physicalClock;
    this.onTrace = onTrace;
    this.lamport = new LamportClock();
    this.vector = new VectorClock(nodeId);
    this.stopped = false;
  }

  start() {
    this.transport.subscribe(PEER_SUBJECT, (msg) => this._receive(msg));
  }

  // Simulates a crash: the process neither sends nor receives anything further
  stop() {
    this.stopped = true;
  }

  /** Sends to one peer (`to` = node id) or to all peers (`to` = '*'). */
  send(to, type, body = {}, detail = '') {
    if (this.stopped) return null;
    const clocked = !UNCLOCKED.has(type);
    if (clocked) {
      this.lamport.tick();
      this.vector.tick();
    }
    const msg = {
      from: this.nodeId,
      to,
      type,
      body,
      clocked,
      lamport: this.lamport.time,
      vector: this.vector.snapshot(),
      sentAt: this.physicalClock.now(),
    };
    this.transport.publish(PEER_SUBJECT, msg);
    if (clocked) this._trace('SEND', type, to, detail);
    return msg;
  }

  /** Records a local event (e.g. entering a critical section). */
  internal(type, detail = '') {
    if (this.stopped) return;
    this.lamport.tick();
    this.vector.tick();
    this._trace('INTERNAL', type, null, detail);
  }

  _receive(msg) {
    if (this.stopped || !msg || msg.from === this.nodeId) return;
    if (msg.to !== '*' && msg.to !== this.nodeId) return;

    if (msg.clocked) {
      this.lamport.receive(msg.lamport);
      this.vector.receive(msg.vector);
      this._trace('RECV', msg.type, msg.from, `sent at L=${msg.lamport}`);
    }
    this.emit('message', msg);
    this.emit(msg.type, msg);
  }

  _trace(kind, type, peer, detail) {
    this.onTrace({
      node: this.nodeId,
      kind,
      type,
      peer,
      detail,
      lamport: this.lamport.time,
      vector: this.vector.snapshot(),
      physicalTime: this.physicalClock.now(),
    });
  }
}

module.exports = { PeerBus, PEER_SUBJECT };
