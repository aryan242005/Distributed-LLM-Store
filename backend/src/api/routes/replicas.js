const express = require('express');
const router = express.Router();
const Replica = require('../../database/models/Replica');

// GET /api/replicas - List all replicas
router.get('/', async (req, res) => {
  try {
    const replicas = await Replica.getAll();
    res.json({ success: true, count: replicas.length, data: replicas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/replicas/model/:modelId - List replicas for a specific model
router.get('/model/:modelId', async (req, res) => {
  try {
    const replicas = await Replica.getByModelId(req.params.modelId);
    res.json({ success: true, count: replicas.length, data: replicas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
