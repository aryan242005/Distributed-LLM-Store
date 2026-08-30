const { query } = require('../connection');
const { v4: uuidv4 } = require('uuid');

const Model = {
  async create({ id, name, version, filename, sizeBytes, checksum, replicationFactor, primaryNodeId, description = '' }) {
    const modelId = id || uuidv4();
    const sql = `
      INSERT INTO models (id, name, version, filename, size_bytes, checksum, replication_factor, primary_node_id, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'READY')
      RETURNING *;
    `;
    const res = await query(sql, [modelId, name, version, filename, sizeBytes, checksum, replicationFactor, primaryNodeId, description]);
    return res.rows[0];
  },

  async getAll() {
    const { isPgConnected } = require('../connection');
    if (isPgConnected()) {
      try {
        const sql = `
          SELECT m.*, 
                 COUNT(r.id) AS replica_count,
                 json_agg(json_build_object(
                   'id', r.id, 
                   'node_id', r.node_id, 
                   'role', r.role, 
                   'status', r.status, 
                   'synced_at', r.synced_at
                 )) FILTER (WHERE r.id IS NOT NULL) AS replicas
          FROM models m
          LEFT JOIN replicas r ON m.id = r.model_id
          GROUP BY m.id
          ORDER BY m.created_at DESC;
        `;
        const res = await query(sql);
        return res.rows;
      } catch (err) {}
    }

    // Memory database replica join
    const { rows } = await query('SELECT * FROM models;');
    const allReplicas = (await query('SELECT * FROM replicas;')).rows;
    return rows.map(m => {
      const reps = allReplicas.filter(r => r.model_id === m.id);
      return {
        ...m,
        replica_count: reps.length,
        replicas: reps
      };
    });
  },

  async getById(id) {
    const { isPgConnected } = require('../connection');
    if (isPgConnected()) {
      try {
        const sql = `
          SELECT m.*, 
                 json_agg(json_build_object(
                   'id', r.id, 
                   'node_id', r.node_id, 
                   'role', r.role, 
                   'status', r.status, 
                   'checksum', r.checksum,
                   'size_bytes', r.size_bytes,
                   'synced_at', r.synced_at
                 )) FILTER (WHERE r.id IS NOT NULL) AS replicas
          FROM models m
          LEFT JOIN replicas r ON m.id = r.model_id
          WHERE m.id = $1
          GROUP BY m.id;
        `;
        const res = await query(sql, [id]);
        if (res.rows && res.rows[0]) return res.rows[0];
      } catch (err) {}
    }

    const { rows } = await query('SELECT * FROM models WHERE id = $1;', [id]);
    if (!rows.length) return null;
    const m = rows[0];
    const allReplicas = (await query('SELECT * FROM replicas WHERE model_id = $1;', [id])).rows;
    return {
      ...m,
      replica_count: allReplicas.length,
      replicas: allReplicas
    };
  },

  async delete(id) {
    const sql = `DELETE FROM models WHERE id = $1;`;
    await query(sql, [id]);
    return true;
  }
};

module.exports = Model;
