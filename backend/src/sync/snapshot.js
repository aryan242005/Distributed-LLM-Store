const EventEmitter = require('events');

/**
 * Chandy-Lamport global snapshot (assumes FIFO channels, see peerBus.js).
 *
 *  - The initiator records its local state, then sends a MARKER on every outgoing
 *    channel and starts recording every incoming channel.
 *  - On its first MARKER (from peer j), a node records its local state, marks the
 *    channel from j as empty, sends MARKERs, and records its other incoming channels.
 *  - On a later MARKER from peer k, it stops recording the channel from k. The
 *    messages captured on that channel are the ones "in flight" in the snapshot.
 *  - When markers have arrived on every incoming channel, the node's part is done.
 *
 * captureLocalState must be synchronous so that no message is processed between
 * recording the state and sending the markers.
 *
 * Emits 'complete' with this node's part: local state + recorded channel states.
 */
class ChandyLamportSnapshot extends EventEmitter {
  constructor({ bus, nodeId, beacon, captureLocalState, timeoutMs = 10000 }) {
    super();
    this.bus = bus;
    this.nodeId = nodeId;
    this.beacon = beacon;
    this.captureLocalState = captureLocalState;
    this.timeoutMs = timeoutMs;
    this.active = new Map();
    this.finished = new Set();
  }

  start() {
    this.bus.on('MARKER', (msg) => this._onMarker(msg));
    this.bus.on('message', (msg) => {
      if (msg.type === 'MARKER') return;
      for (const snap of this.active.values()) {
        if (snap.recording.has(msg.from)) {
          snap.channels[msg.from].push({ type: msg.type, lamport: msg.lamport, clocked: msg.clocked });
        }
      }
    });
    this.beacon.on('peer-down', (id) => {
      for (const snap of this.active.values()) {
        if (snap.recording.delete(id)) {
          snap.lostPeers.push(id);
          this._maybeComplete(snap);
        }
      }
    });
  }

  initiate(snapshotId) {
    if (this.active.has(snapshotId) || this.finished.has(snapshotId)) return;
    this._recordAndSendMarkers(snapshotId, this.nodeId, null);
  }

  _onMarker(msg) {
    const { snapshotId, initiator } = msg.body;
    if (this.finished.has(snapshotId)) return;
    const snap = this.active.get(snapshotId);
    if (!snap) {
      this._recordAndSendMarkers(snapshotId, initiator, msg.from);
      return;
    }
    snap.recording.delete(msg.from);
    this._maybeComplete(snap);
  }

  _recordAndSendMarkers(snapshotId, initiator, markerFrom) {
    const peers = this.beacon.alivePeers();
    const snap = {
      snapshotId,
      initiator,
      local: this.captureLocalState(),
      channels: {},
      recording: new Set(peers.filter((p) => p !== markerFrom)),
      lostPeers: [],
      timer: null,
    };
    for (const p of peers) snap.channels[p] = [];
    this.active.set(snapshotId, snap);

    this.bus.internal('SNAPSHOT_RECORDED', markerFrom ? `first MARKER from ${markerFrom}` : 'initiator');
    this.bus.send('*', 'MARKER', { snapshotId, initiator });

    snap.timer = setTimeout(() => this._finish(snap, true), this.timeoutMs);
    this._maybeComplete(snap);
  }

  _maybeComplete(snap) {
    if (snap.recording.size === 0) this._finish(snap, false);
  }

  _finish(snap, timedOut) {
    if (!this.active.has(snap.snapshotId)) return;
    clearTimeout(snap.timer);
    this.active.delete(snap.snapshotId);
    this.finished.add(snap.snapshotId);
    this.emit('complete', {
      snapshotId: snap.snapshotId,
      initiator: snap.initiator,
      nodeId: this.nodeId,
      local: snap.local,
      channels: snap.channels,
      lostPeers: snap.lostPeers,
      timedOut,
    });
  }
}

module.exports = ChandyLamportSnapshot;
