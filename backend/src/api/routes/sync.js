const express = require('express');
const router = express.Router();
const syncMonitor = require('../../coordinator/syncMonitor');
const { VectorClock } = require('../../sync/clocks');

// GET /api/sync/status - Clocks, leader, membership and mutex state of every node
router.get('/status', (req, res) => {
  res.json({ success: true, data: syncMonitor.getStatus() });
});

// GET /api/sync/trace?limit=200&sinceSeq=0 - Send/receive/internal events with Lamport + vector timestamps
router.get('/trace', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 600);
  const sinceSeq = parseInt(req.query.sinceSeq || '0', 10);
  res.json({ success: true, data: syncMonitor.getTrace({ limit, sinceSeq }) });
});

// GET /api/sync/compare?a=<seq>&b=<seq> - Happened-before relation of two trace events
router.get('/compare', (req, res) => {
  const trace = syncMonitor.getTrace({ limit: 600 });
  const a = trace.find((e) => e.seq === parseInt(req.query.a, 10));
  const b = trace.find((e) => e.seq === parseInt(req.query.b, 10));
  if (!a || !b) return res.status(404).json({ success: false, error: 'Event not found in trace window' });
  res.json({ success: true, data: { a, b, relation: VectorClock.compare(a.vector, b.vector) } });
});

// GET /api/sync/clock-rounds - Recent Berkeley synchronization rounds
router.get('/clock-rounds', (req, res) => {
  res.json({ success: true, data: syncMonitor.getClockRounds() });
});

// POST /api/sync/election { nodeId? } - Start a Bully election (from nodeId, or every node)
router.post('/election', (req, res) => {
  syncMonitor.command('START_ELECTION', { target: req.body.nodeId });
  res.json({ success: true, message: `Election started${req.body.nodeId ? ` by ${req.body.nodeId}` : ''}` });
});

// POST /api/sync/clock-sync - Ask the leader to run a Berkeley round now
router.post('/clock-sync', (req, res) => {
  syncMonitor.command('CLOCK_SYNC');
  res.json({ success: true, message: 'Berkeley round requested from leader' });
});

// POST /api/sync/skew { nodeId, deltaMs } - Inject clock skew into a node
router.post('/skew', (req, res) => {
  const deltaMs = parseInt(req.body.deltaMs, 10);
  if (!req.body.nodeId || Number.isNaN(deltaMs)) {
    return res.status(400).json({ success: false, error: 'nodeId and deltaMs are required' });
  }
  syncMonitor.command('INJECT_SKEW', { target: req.body.nodeId, deltaMs });
  res.json({ success: true, message: `Injected ${deltaMs} ms skew into ${req.body.nodeId}` });
});

// POST /api/sync/mutex { nodeId? } - Nodes request the critical section (integrity scrub)
router.post('/mutex', (req, res) => {
  syncMonitor.command('MUTEX_SCRUB', { target: req.body.nodeId });
  res.json({ success: true, message: `Critical section requested by ${req.body.nodeId || 'all nodes'}` });
});

// POST /api/sync/snapshot { nodeId? } - Start a Chandy-Lamport snapshot
router.post('/snapshot', (req, res) => {
  try {
    const snapshotId = syncMonitor.startSnapshot(req.body.nodeId);
    res.json({ success: true, data: { snapshotId } });
  } catch (err) {
    res.status(409).json({ success: false, error: err.message });
  }
});

// GET /api/sync/snapshots - Recent snapshots (newest first)
router.get('/snapshots', (req, res) => {
  res.json({ success: true, data: syncMonitor.listSnapshots() });
});

// GET /api/sync/snapshot/:id
router.get('/snapshot/:id', (req, res) => {
  const snap = syncMonitor.getSnapshot(req.params.id);
  if (!snap) return res.status(404).json({ success: false, error: 'Snapshot not found' });
  res.json({ success: true, data: snap });
});

module.exports = router;
