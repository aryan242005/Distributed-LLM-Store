const { query } = require('../connection');
const { v4: uuidv4 } = require('uuid');

const SystemEvent = {
  async log(eventType, source, payload = {}) {
    const id = uuidv4();
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const sql = `
      INSERT INTO system_events (id, event_type, source, payload)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    try {
      const res = await query(sql, [id, eventType, source, payloadJson]);
      return res.rows[0];
    } catch (err) {
      console.error('[SystemEvent] Failed to save event:', err.message);
      return null;
    }
  },

  async getRecent(limit = 50) {
    const sql = `
      SELECT * FROM system_events 
      ORDER BY created_at DESC 
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows.map(row => ({
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    }));
  }
};

module.exports = SystemEvent;
