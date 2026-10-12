/**
 * Runs the Unit 3 synchronization layer of 3 storage nodes in one process over an
 * in-memory FIFO transport (standing in for NATS) and checks each algorithm:
 *
 *   Bully election, Berkeley clock sync, Ricart-Agrawala mutual exclusion,
 *   Chandy-Lamport snapshot consistency, beacon failure detection + re-election,
 *   and a recovered node bullying its way back to leadership.
 *
 * Usage: node scripts/test-sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const backend = path.join(__dirname, '..', 'backend', 'src');
const SyncAgent = require(path.join(backend, 'sync', 'syncAgent'));
const FileManager = require(path.join(backend, 'storage', 'fileManager'));
const syncMonitor = require(path.join(backend, 'coordinator', 'syncMonitor'));

const BEACON_MS = 300;
const NETWORK_DELAY_MS = 5; // constant delay keeps per-channel FIFO order

class InMemoryTransport {
  constructor(hub) {
    this.hub = hub;
  }

  publish(subject, data) {
    const copy = JSON.parse(JSON.stringify(data));
    setTimeout(() => this.hub.emit(subject, copy), NETWORK_DELAY_MS);
  }

  subscribe(subject, cb) {
    this.hub.on(subject, cb);
  }
}

const hub = new EventEmitter();
hub.setMaxListeners(100);
const observer = new InMemoryTransport(hub);
const statuses = {};
const trace = [];
const snapshotParts = {};
observer.subscribe('sync.status', (s) => { statuses[s.nodeId] = s; });
observer.subscribe('sync.trace', (e) => trace.push(e));
observer.subscribe('sync.snapshot', (p) => { snapshotParts[p.nodeId] = p; });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-sync-'));
const agents = {};

function startNode(id) {
  const fileManager = new FileManager(path.join(tmpRoot, id));
  fs.writeFileSync(path.join(fileManager.modelsDir, `m-${id}_weights.bin`), Buffer.alloc(64 * 1024, id));
  const agent = new SyncAgent({
    nodeId: id,
    transport: new InMemoryTransport(hub),
    fileManager,
    beaconIntervalMs: BEACON_MS,
    clockSyncIntervalMs: 60 * 60 * 1000, // only on demand in this test
    minCriticalSectionMs: 300,
  });
  agent.start();
  agents[id] = agent;
  return agent;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = () => Object.values(agents).filter((a) => !a.bus.stopped);
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? '\x1b[32m[PASS]' : '\x1b[31m[FAIL]'}\x1b[0m ${name}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures += 1;
}

async function waitFor(fn, timeoutMs, stepMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(stepMs);
  }
  return fn();
}

const leaders = () => live().map((a) => a.election.leader);
const command = (cmd) => observer.publish('sync.cmd', cmd);

async function main() {
  ['node-1', 'node-2', 'node-3'].forEach(startNode);

  // 1. Bully election at startup
  await waitFor(() => leaders().every((l) => l === 'node-3'), 6000);
  check('Bully: all nodes elect the highest-ranked node-3', leaders().every((l) => l === 'node-3'), leaders().join(','));

  // 2. Berkeley clock synchronization after injecting skew
  command({ cmd: 'INJECT_SKEW', target: 'node-2', deltaMs: 5000 });
  await sleep(100);
  const errorsBefore = live().map((a) => a.clock.errorMs());
  const round = await agents['node-3'].berkeley.runRound();
  await sleep(100);
  const errorsAfter = live().map((a) => a.clock.errorMs());
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  check('Berkeley: injected 5000 ms skew is visible before sync', spread(errorsBefore) >= 4900, `spread ${spread(errorsBefore)} ms`);
  check('Berkeley: clocks agree after one round', spread(errorsAfter) <= 50, `spread ${spread(errorsAfter)} ms`);
  check('Berkeley: clocks converge on the average (~+1667 ms), not on the leader', Math.abs(round.averageOffsetMs - 1667) <= 50,
    `average offset ${round.averageOffsetMs} ms`);

  // 3. Ricart-Agrawala: all three request at once
  let maxHolders = 0;
  const watcher = setInterval(() => {
    maxHolders = Math.max(maxHolders, live().filter((a) => a.mutex.state === 'HELD').length);
  }, 5);
  const traceStart = trace.length;
  command({ cmd: 'MUTEX_SCRUB' });
  await sleep(100);
  await waitFor(() => live().every((a) => a.mutex.entries === 1 && a.mutex.state === 'RELEASED'), 8000);
  clearInterval(watcher);
  const mutexEvents = trace.slice(traceStart);
  const requests = mutexEvents.filter((e) => e.type === 'MUTEX_REQUEST' && e.kind === 'SEND');
  const enters = mutexEvents.filter((e) => e.type === 'MUTEX_ENTER').map((e) => e.node);
  const expectedOrder = requests
    .sort((a, b) => a.lamport - b.lamport || a.node.localeCompare(b.node, undefined, { numeric: true }))
    .map((e) => e.node);
  check('Ricart-Agrawala: every node entered the critical section', live().every((a) => a.mutex.entries === 1));
  check('Ricart-Agrawala: never more than one node in the critical section', maxHolders === 1, `max holders ${maxHolders}`);
  check('Ricart-Agrawala: entries follow Lamport (timestamp, id) order', enters.join() === expectedOrder.join(),
    `entered ${enters.join(' -> ')}`);

  // 4. Chandy-Lamport snapshot, taken while beacons are in flight
  command({ cmd: 'SNAPSHOT', target: 'node-1', snapshotId: 'test-1' });
  await waitFor(() => Object.keys(snapshotParts).length === 3, 3000);
  const parts = Object.values(snapshotParts);
  const consistency = syncMonitor._checkConsistency(parts);
  check('Chandy-Lamport: every node recorded its part', parts.length === 3 && parts.every((p) => !p.timedOut));
  check('Chandy-Lamport: recorded cut is consistent (V_i[j] <= V_j[j])', consistency.consistent,
    consistency.violations.join('; ') || `${consistency.inFlightMessages} in-flight messages captured`);
  // A cut where node-2 recorded receiving node-1's 9th event but node-1 recorded at its 5th
  const badCut = syncMonitor._checkConsistency([
    { nodeId: 'node-1', local: { vector: { 'node-1': 5 } }, channels: {} },
    { nodeId: 'node-2', local: { vector: { 'node-1': 9, 'node-2': 4 } }, channels: {} },
  ]);
  check('Chandy-Lamport: consistency check rejects an inconsistent cut', !badCut.consistent, badCut.violations[0]);

  // 5. Leader crash -> beacon timeout -> re-election
  agents['node-3'].stop();
  const crashAt = Date.now();
  await waitFor(() => leaders().every((l) => l === 'node-2'), 6000);
  check('Beacon + Bully: node-2 takes over after leader node-3 crashes', leaders().every((l) => l === 'node-2'),
    `${Date.now() - crashAt} ms after crash`);

  // 6. Mutual exclusion still works with a crashed peer
  agents['node-1'].mutex.entries = 0;
  agents['node-2'].mutex.entries = 0;
  command({ cmd: 'MUTEX_SCRUB' });
  const ok = await waitFor(() => live().every((a) => a.mutex.entries === 1 && a.mutex.state === 'RELEASED'), 8000);
  check('Ricart-Agrawala: survivors do not wait forever on the crashed node', ok);

  // 7. Recovered higher-ranked node bullies its way back
  startNode('node-3');
  await waitFor(() => leaders().every((l) => l === 'node-3'), 8000);
  check('Bully: recovered node-3 reclaims leadership', leaders().every((l) => l === 'node-3'), leaders().join(','));

  // Vector clocks: causality between a send and its receive
  const send = trace.find((e) => e.kind === 'SEND' && e.type === 'COORDINATOR');
  const recv = trace.find((e) => e.kind === 'RECV' && e.type === 'COORDINATOR' && e.node !== send.node);
  const { VectorClock } = require(path.join(backend, 'sync', 'clocks'));
  check('Vector clocks: SEND happened-before its RECV', VectorClock.compare(send.vector, recv.vector) === 'before');

  live().forEach((a) => a.stop());
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll synchronization checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
