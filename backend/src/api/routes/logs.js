const express = require('express');
const router = express.Router();
const CommunicationLog = require('../../database/models/CommunicationLog');

// GET /api/logs - List communication logs
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const logs = await CommunicationLog.getRecent(limit);
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
