const { query } = require('../connection');
const { v4: uuidv4 } = require('uuid');

const Replica = {
  async create({ modelId, nodeId, role = 'REPLICA', status = 'SYNCED', checksum = '', sizeBytes = 0 }) {
    const id = uuidv4();
    const sql = `
      INSERT INTO replicas (id, model_id, node_id, role, status, checksum, size_bytes, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (model_id, node_id) DO UPDATE SET
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        checksum = EXCLUDED.checksum,
        size_bytes = EXCLUDED.size_bytes,
        synced_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await query(sql, [id, modelId, nodeId, role, status, checksum, sizeBytes]);
    return res.rows[0];
  },

  async getAll() {
    const sql = `
      SELECT r.*, m.name as model_name, m.version as model_version, n.host as node_host, n.port as node_port
      FROM replicas r
      JOIN models m ON r.model_id = m.id
      JOIN storage_nodes n ON r.node_id = n.id
      ORDER BY r.created_at DESC;
    `;
    try {
      const res = await query(sql);
      return res.rows;
    } catch (err) {
      const { rows } = await query('SELECT * FROM replicas;');
      return rows;
    }
  },

  async getByModelId(modelId) {
    const sql = `
      SELECT r.*, n.host, n.port, n.status as node_status
      FROM replicas r
      JOIN storage_nodes n ON r.node_id = n.id
      WHERE r.model_id = $1;
    `;
    try {
      const res = await query(sql, [modelId]);
      return res.rows;
    } catch (err) {
      const { rows } = await query('SELECT * FROM replicas WHERE model_id = $1;', [modelId]);
      return rows;
    }
  },

  async getByNodeId(nodeId) {
    const sql = `
      SELECT r.*, m.name as model_name, m.version as model_version, m.filename
      FROM replicas r
      JOIN models m ON r.model_id = m.id
      WHERE r.node_id = $1;
    `;
    try {
      const res = await query(sql, [nodeId]);
      return res.rows;
    } catch (err) {
      const { rows } = await query('SELECT * FROM replicas WHERE node_id = $1;', [nodeId]);
      return rows;
    }
  },

  async deleteByModelId(modelId) {
    const sql = `DELETE FROM replicas WHERE model_id = $1;`;
    const res = await query(sql, [modelId]);
    return res.rowCount;
  }
};

module.exports = Replica;
