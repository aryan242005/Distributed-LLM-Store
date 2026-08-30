const express = require('express');
const router = express.Router();
const SystemEvent = require('../../database/models/SystemEvent');

// GET /api/events - List recent system events
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const events = await SystemEvent.getRecent(limit);
    res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
