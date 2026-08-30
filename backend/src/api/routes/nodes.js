const express = require('express');
const router = express.Router();
const StorageNode = require('../../database/models/StorageNode');
const GrpcClient = require('../../communication/grpc/grpcClient');
const DistributedLogger = require('../../communication/logger');

// GET /api/nodes - List all storage nodes
router.get('/', async (req, res) => {
  try {
    const nodes = await StorageNode.getAll();
    res.json({ success: true, count: nodes.length, data: nodes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/nodes/register - Storage node registration / heartbeat
router.post('/register', async (req, res) => {
  try {
    const { id, host, port, totalStorageBytes, usedStorageBytes, storedModelsCount } = req.body;
    if (!id || !host || !port) {
      return res.status(400).json({ success: false, error: 'Missing required node parameters' });
    }

    const node = await StorageNode.upsert({
      id,
      host,
      port,
      status: 'ONLINE',
      totalStorageBytes: totalStorageBytes || 107374182400,
      usedStorageBytes: usedStorageBytes || 0,
      storedModelsCount: storedModelsCount || 0,
    });

    await DistributedLogger.logEvent('NODE_REGISTERED', 'StorageNode', {
      nodeId: id,
      host,
      port,
    });

    res.json({ success: true, message: 'Node registered successfully', data: node });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/nodes/:id/ping - Ping node health via gRPC
router.post('/:id/ping', async (req, res) => {
  try {
    const node = await StorageNode.getById(req.params.id);
    if (!node) {
      return res.status(404).json({ success: false, error: 'Node not found' });
    }

    const address = `${node.host}:${node.port}`;
    const pong = await GrpcClient.pingNode(address);
    const status = await GrpcClient.getNodeStatus(address);

    await StorageNode.updateHeartbeat(node.id, 'ONLINE');
    await StorageNode.updateStorageStats(node.id, parseInt(status.usedStorageBytes, 10), parseInt(status.totalStorageBytes, 10), status.storedModelsCount);

    res.json({
      success: true,
      message: 'Node is responsive',
      data: {
        pong,
        status,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Node ping failed: ${err.message}` });
  }
});

module.exports = router;
