const express = require('express');
const router = express.Router();
const Model = require('../../database/models/Model');
const StorageNode = require('../../database/models/StorageNode');
const Replica = require('../../database/models/Replica');
const SystemEvent = require('../../database/models/SystemEvent');
const CommunicationLog = require('../../database/models/CommunicationLog');

// GET /api/dashboard/stats - Aggregate stats for frontend dashboard
router.get('/stats', async (req, res) => {
  try {
    const { scanAndSyncPhysicalModels } = require('../../database/connection');
    if (scanAndSyncPhysicalModels) {
      await scanAndSyncPhysicalModels();
    }

    const [models, nodes, replicas, recentEvents, recentLogs] = await Promise.all([
      Model.getAll(),
      StorageNode.getAll(),
      Replica.getAll(),
      SystemEvent.getRecent(10),
      CommunicationLog.getRecent(10),
    ]);

    const onlineNodes = nodes.filter(n => n.status === 'ONLINE');
    const totalStorageBytes = nodes.reduce((sum, n) => sum + (Number(n.total_storage_bytes) || 0), 0);
    const usedStorageBytes = nodes.reduce((sum, n) => sum + (Number(n.used_storage_bytes) || 0), 0);
    const syncedReplicas = replicas.filter(r => r.status === 'SYNCED');

    res.json({
      success: true,
      data: {
        totalModels: models.length,
        totalNodes: nodes.length,
        onlineNodes: onlineNodes.length,
        offlineNodes: nodes.length - onlineNodes.length,
        totalReplicas: replicas.length,
        syncedReplicas: syncedReplicas.length,
        totalStorageBytes,
        usedStorageBytes,
        availableStorageBytes: Math.max(0, totalStorageBytes - usedStorageBytes),
        nodes,
        recentEvents,
        recentLogs,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
