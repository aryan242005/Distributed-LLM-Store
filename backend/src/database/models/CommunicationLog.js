const { query } = require('../connection');
const { v4: uuidv4 } = require('uuid');

const CommunicationLog = {
  async log({ source, target, protocol = 'gRPC', operation, status = 'SUCCESS', details = '' }) {
    const id = uuidv4();
    const sql = `
      INSERT INTO communication_logs (id, source, target, protocol, operation, status, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    try {
      const res = await query(sql, [id, source, target, protocol, operation, status, details]);
      return res.rows[0];
    } catch (err) {
      console.error('[CommunicationLog] Failed to log:', err.message);
      return null;
    }
  },

  async getRecent(limit = 100) {
    const sql = `
      SELECT * FROM communication_logs 
      ORDER BY timestamp DESC 
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  }
};

module.exports = CommunicationLog;
