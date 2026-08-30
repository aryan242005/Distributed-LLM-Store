const { query } = require('../connection');

const StorageNode = {
  async upsert({ id, host, port, status = 'ONLINE', totalStorageBytes = 107374182400, usedStorageBytes = 0, availableStorageBytes = 107374182400, storedModelsCount = 0 }) {
    const sql = `
      INSERT INTO storage_nodes (id, host, port, status, total_storage_bytes, used_storage_bytes, available_storage_bytes, stored_models_count, last_heartbeat)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        status = EXCLUDED.status,
        total_storage_bytes = EXCLUDED.total_storage_bytes,
        used_storage_bytes = EXCLUDED.used_storage_bytes,
        available_storage_bytes = EXCLUDED.available_storage_bytes,
        stored_models_count = EXCLUDED.stored_models_count,
        last_heartbeat = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await query(sql, [id, host, port, status, totalStorageBytes, usedStorageBytes, availableStorageBytes, storedModelsCount]);
    return res.rows[0];
  },

  async getAll() {
    const sql = `SELECT * FROM storage_nodes ORDER BY id ASC;`;
    const res = await query(sql);
    return res.rows;
  },

  async getById(id) {
    const sql = `SELECT * FROM storage_nodes WHERE id = $1;`;
    const res = await query(sql, [id]);
    return res.rows[0] || null;
  },

  async updateHeartbeat(id, status = 'ONLINE') {
    const sql = `
      UPDATE storage_nodes 
      SET last_heartbeat = CURRENT_TIMESTAMP, status = $2 
      WHERE id = $1 
      RETURNING *;
    `;
    const res = await query(sql, [id, status]);
    return res.rows[0];
  },

  async updateStorageStats(id, usedBytes, totalBytes, storedModelsCount) {
    const available = totalBytes - usedBytes;
    const sql = `
      UPDATE storage_nodes 
      SET used_storage_bytes = $2, 
          total_storage_bytes = $3, 
          available_storage_bytes = $4, 
          stored_models_count = $5,
          last_heartbeat = CURRENT_TIMESTAMP
      WHERE id = $1 
      RETURNING *;
    `;
    const res = await query(sql, [id, usedBytes, totalBytes, available, storedModelsCount]);
    return res.rows[0];
  }
};

module.exports = StorageNode;
