const fs = require('fs');
const path = require('path');
const { PhysicalClock } = require('./clocks');
const { PeerBus } = require('./peerBus');
const BeaconProtocol = require('./beacon');
const BullyElection = require('./election');
const BerkeleyClockSync = require('./berkeley');
const RicartAgrawalaMutex = require('./mutex');
const ChandyLamportSnapshot = require('./snapshot');
const ChecksumUtil = require('../storage/checksum');

/**
 * Runs the Unit 3 synchronization algorithms inside a storage node and reports to
 * the coordinator. Node-to-node traffic goes over PeerBus (NATS subject cluster.p2p).
 * The coordinator only observes (sync.status / sync.trace / ...) and sends operator
 * commands (sync.cmd). It takes no part in the algorithms themselves.
 */
class SyncAgent {
  constructor({
    nodeId,
    transport,
    fileManager,
    clockSkewMs = 0,
    clockDriftPpm = 0,
    beaconIntervalMs = 2000,
    clockSyncIntervalMs = 30000,
    minCriticalSectionMs = 3000,
  }) {
    this.nodeId = nodeId;
    this.transport = transport;
    this.fileManager = fileManager;
    this.minCriticalSectionMs = minCriticalSectionMs;
    this.storageStats = { storedModelsCount: 0, usedStorageBytes: 0, storedModelIds: [] };
    this.lastScrub = null;

    this.clock = new PhysicalClock({ skewMs: clockSkewMs, driftPpm: clockDriftPpm });
    this.bus = new PeerBus({
      nodeId,
      transport,
      physicalClock: this.clock,
      onTrace: (event) => transport.publish('sync.trace', event),
    });
    this.beacon = new BeaconProtocol({
      bus: this.bus,
      intervalMs: beaconIntervalMs,
      getPayload: () => ({ leader: this.election ? this.election.leader : null }),
    });
    this.election = new BullyElection({ bus: this.bus, nodeId, beacon: this.beacon });
    this.berkeley = new BerkeleyClockSync({
      bus: this.bus,
      nodeId,
      clock: this.clock,
      election: this.election,
      intervalMs: clockSyncIntervalMs,
    });
    this.mutex = new RicartAgrawalaMutex({ bus: this.bus, nodeId, beacon: this.beacon });
    this.snapshot = new ChandyLamportSnapshot({
      bus: this.bus,
      nodeId,
      beacon: this.beacon,
      captureLocalState: () => this._localState(),
    });
    this.timers = [];
  }

  async start() {
    this.bus.start();
    this.beacon.start();
    this.election.start();
    this.berkeley.start();
    this.mutex.start();
    this.snapshot.start();

    this.election.on('leader', () => this._publishStatus());
    this.berkeley.on('round', (round) => this.transport.publish('sync.clock.round', round));
    this.snapshot.on('complete', (part) => this.transport.publish('sync.snapshot', part));
    this.transport.subscribe('sync.cmd', (cmd) => this._onCommand(cmd));

    await this._refreshStorageStats();
    this.timers.push(setInterval(async () => {
      await this._refreshStorageStats();
      this._publishStatus();
    }, this.beacon.intervalMs));

    // Give beacons time to discover peers, then elect a leader
    this.timers.push(setTimeout(
      () => this.election.startElection('node startup'),
      this.beacon.intervalMs * 2.5,
    ));
  }

  // Simulates a crash: stops all timers and all communication
  stop() {
    this.timers.forEach((t) => clearInterval(t));
    this.beacon.stop();
    this.election.stop();
    this.berkeley.stop();
    this.bus.stop();
  }

  async _onCommand(cmd = {}) {
    if (this.bus.stopped) return;
    const forMe = !cmd.target || cmd.target === this.nodeId;
    try {
      switch (cmd.cmd) {
        case 'START_ELECTION':
          if (forMe) this.election.startElection('requested by operator');
          break;
        case 'CLOCK_SYNC':
          if (this.election.isLeader()) await this.berkeley.runRound();
          break;
        case 'INJECT_SKEW':
          if (forMe) {
            this.clock.adjust(cmd.deltaMs);
            this.bus.internal('CLOCK_SKEW_INJECTED', `${cmd.deltaMs >= 0 ? '+' : ''}${cmd.deltaMs} ms`);
            this._publishStatus();
          }
          break;
        case 'MUTEX_SCRUB':
          if (forMe && this.mutex.state === 'RELEASED') {
            await this.mutex.withLock(() => this._scrub());
            this._publishStatus();
          }
          break;
        case 'SNAPSHOT':
          if (forMe) this.snapshot.initiate(cmd.snapshotId);
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn(`[Sync ${this.nodeId}] ${cmd.cmd} failed: ${err.message}`);
    }
  }

  /**
   * The critical section: an integrity scrub that re-hashes every stored model file.
   * Running scrubs one node at a time keeps at least N-1 nodes at full disk throughput
   * for client downloads (a rolling maintenance window).
   */
  async _scrub() {
    const started = Date.now();
    const dir = this.fileManager.modelsDir;
    const files = fs.existsSync(dir) ? await fs.promises.readdir(dir) : [];
    let bytes = 0;
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      await ChecksumUtil.calculateFileChecksum(filePath);
      bytes += stat.size;
    }
    // Hold the lock for a visible minimum so overlapping requests can be observed
    const remaining = this.minCriticalSectionMs - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    this.lastScrub = { files: files.length, bytes, durationMs: Date.now() - started, at: new Date().toISOString() };
    this.bus.internal('SCRUB_DONE', `re-hashed ${files.length} files`);
  }

  async _refreshStorageStats() {
    try {
      this.storageStats = await this.fileManager.getStorageStats();
    } catch (e) {}
  }

  // Synchronous by design (see snapshot.js)
  _localState() {
    return {
      lamport: this.bus.lamport.time,
      vector: this.bus.vector.snapshot(),
      physicalTime: this.clock.now(),
      leader: this.election.leader,
      mutexState: this.mutex.state,
      storedModelsCount: this.storageStats.storedModelsCount,
      usedStorageBytes: this.storageStats.usedStorageBytes,
      storedModelIds: this.storageStats.storedModelIds || [],
      beaconSeq: this.beacon.seq,
    };
  }

  status() {
    return {
      nodeId: this.nodeId,
      clockTime: this.clock.now(),
      clockErrorMs: this.clock.errorMs(),
      lastAdjustment: this.berkeley.lastAdjustment,
      lamport: this.bus.lamport.time,
      vector: this.bus.vector.snapshot(),
      leader: this.election.leader,
      electing: this.election.electing,
      elections: this.election.elections,
      beaconSeq: this.beacon.seq,
      membership: this.beacon.table(),
      mutex: this.mutex.status(),
      lastScrub: this.lastScrub,
      storedModelsCount: this.storageStats.storedModelsCount,
    };
  }

  _publishStatus() {
    if (this.bus.stopped) return;
    this.transport.publish('sync.status', this.status());
  }
}

module.exports = SyncAgent;
