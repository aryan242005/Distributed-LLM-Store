const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

let pool = null;
let isPgConnected = false;

const metaFile = path.resolve(__dirname, '../../../storage/metadata.json');

// In-memory fallback database for local zero-dependency development/testing
const memoryStore = {
  models: new Map(),
  storage_nodes: new Map(),
  replicas: new Map(),
  system_events: [],
  communication_logs: []
};

// Seed default known storage nodes into memory store
config.knownNodes.forEach(node => {
  memoryStore.storage_nodes.set(node.id, {
    id: node.id,
    host: node.host,
    port: node.port,
    status: 'ONLINE',
    total_storage_bytes: 107374182400,
    used_storage_bytes: 0,
    available_storage_bytes: 107374182400,
    stored_models_count: 0,
    last_heartbeat: new Date().toISOString(),
    created_at: new Date().toISOString()
  });
});

// Save memory store to metadata.json
function persistMemoryStore() {
  try {
    const dataDir = path.dirname(metaFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const serialized = {
      models: Array.from(memoryStore.models.entries()),
      storage_nodes: Array.from(memoryStore.storage_nodes.entries()),
      replicas: Array.from(memoryStore.replicas.entries()),
      system_events: memoryStore.system_events.slice(-100),
      communication_logs: memoryStore.communication_logs.slice(-100),
    };
    fs.writeFileSync(metaFile, JSON.stringify(serialized, null, 2));
  } catch (e) {}
}

// Load metadata.json if available
function loadPersistedStore() {
  try {
    if (fs.existsSync(metaFile)) {
      const content = fs.readFileSync(metaFile, 'utf8');
      const data = JSON.parse(content);
      if (data.models) data.models.forEach(([k, v]) => memoryStore.models.set(k, v));
      if (data.storage_nodes) data.storage_nodes.forEach(([k, v]) => memoryStore.storage_nodes.set(k, v));
      if (data.replicas) data.replicas.forEach(([k, v]) => memoryStore.replicas.set(k, v));
      if (data.system_events) memoryStore.system_events = data.system_events;
      if (data.communication_logs) memoryStore.communication_logs = data.communication_logs;
      console.log(`[DB] Restored ${memoryStore.models.size} models and ${memoryStore.replicas.size} replicas from metadata.json`);
    }
  } catch (e) {
    console.warn('[DB] Could not load persisted metadata:', e.message);
  }
}

// Auto-sync physical disk files on startup
async function scanAndSyncPhysicalModels() {
  const rootDir = path.resolve(__dirname, '../../../storage');
  const nodes = ['node-1', 'node-2', 'node-3'];

  for (const nodeId of nodes) {
    const modelsDir = path.join(rootDir, nodeId, 'models');
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);
      for (const file of files) {
        const filePath = path.join(modelsDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            const firstUnderscore = file.indexOf('_');
            if (firstUnderscore > 0) {
              const modelId = file.substring(0, firstUnderscore);
              const filename = file.substring(firstUnderscore + 1);

              if (!memoryStore.models.has(modelId)) {
                // Read hash
                const buffer = fs.readFileSync(filePath);
                const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
                const modelName = filename.replace(/\.[^/.]+$/, "");

                const modelObj = {
                  id: modelId,
                  name: modelName,
                  version: '1.0.0',
                  filename,
                  size_bytes: stat.size,
                  checksum,
                  replication_factor: 3,
                  primary_node_id: 'node-1',
                  description: 'Discovered from local storage nodes',
                  status: 'READY',
                  created_at: stat.birthtime ? stat.birthtime.toISOString() : new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                memoryStore.models.set(modelId, modelObj);
              }

              // Add replica entry
              const repKey = `${modelId}_${nodeId}`;
              if (!memoryStore.replicas.has(repKey)) {
                memoryStore.replicas.set(repKey, {
                  id: `${modelId}_${nodeId}`,
                  model_id: modelId,
                  node_id: nodeId,
                  role: nodeId === 'node-1' ? 'PRIMARY' : 'REPLICA',
                  status: 'SYNCED',
                  checksum: memoryStore.models.get(modelId)?.checksum || '',
                  size_bytes: stat.size,
                  synced_at: new Date().toISOString(),
                  created_at: new Date().toISOString()
                });
              }
            }
          }
        } catch (err) {}
      }
    }
  }

  // Update node storage stats
  for (const nodeId of nodes) {
    const modelsDir = path.join(rootDir, nodeId, 'models');
    let usedBytes = 0;
    let count = 0;
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(modelsDir, file));
          if (stat.isFile()) {
            usedBytes += stat.size;
            count++;
          }
        } catch (e) {}
      }
    }
    const nodeObj = memoryStore.storage_nodes.get(nodeId);
    if (nodeObj) {
      nodeObj.used_storage_bytes = usedBytes;
      nodeObj.stored_models_count = count;
      nodeObj.available_storage_bytes = Math.max(0, nodeObj.total_storage_bytes - usedBytes);
      nodeObj.status = 'ONLINE';
    }
  }

  persistMemoryStore();
}

async function initDatabase() {
  loadPersistedStore();
  await scanAndSyncPhysicalModels();

  try {
    pool = new Pool({
      connectionString: config.database.connectionString,
      connectionTimeoutMillis: 3000,
    });

    const client = await pool.connect();
    console.log('[DB] Successfully connected to PostgreSQL.');
    isPgConnected = true;

    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('[DB] Database schema initialized/verified.');
    }

    for (const node of config.knownNodes) {
      await client.query(
        `INSERT INTO storage_nodes (id, host, port, status)
         VALUES ($1, $2, $3, 'ONLINE')
         ON CONFLICT (id) DO UPDATE 
         SET host = EXCLUDED.host, port = EXCLUDED.port;`,
        [node.id, node.host, node.port]
      );
    }

    client.release();
    return true;
  } catch (err) {
    console.warn(`[DB] PostgreSQL connection failed: ${err.message}`);
    console.warn('[DB] Falling back to persistent High-Fidelity In-Memory + Disk metadata store for offline development.');
    isPgConnected = false;
    return false;
  }
}

// Universal query runner supporting both PostgreSQL and in-memory store
async function query(text, params = []) {
  if (isPgConnected && pool) {
    try {
      const res = await pool.query(text, params);
      return res;
    } catch (err) {
      console.error('[DB Query Error]', err.message, 'SQL:', text);
      throw err;
    }
  }

  return executeMemoryQuery(text, params);
}

function executeMemoryQuery(sql, params) {
  const sqlTrimmed = sql.trim().toUpperCase();

  // Handle SELECT storage_nodes
  if (sqlTrimmed.startsWith('SELECT') && sqlTrimmed.includes('FROM STORAGE_NODES')) {
    let rows = Array.from(memoryStore.storage_nodes.values());
    if (sqlTrimmed.includes('WHERE ID = $1')) {
      rows = rows.filter(r => r.id === params[0]);
    }
    return { rows, rowCount: rows.length };
  }

  // Handle SELECT models
  if (sqlTrimmed.startsWith('SELECT') && sqlTrimmed.includes('FROM MODELS')) {
    let rows = Array.from(memoryStore.models.values());
    if (sqlTrimmed.includes('WHERE ID = $1') || sqlTrimmed.includes('WHERE M.ID = $1')) {
      rows = rows.filter(r => r.id === params[0]);
    }
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows, rowCount: rows.length };
  }

  // Handle SELECT replicas
  if (sqlTrimmed.startsWith('SELECT') && sqlTrimmed.includes('FROM REPLICAS')) {
    let rows = Array.from(memoryStore.replicas.values());
    if (sqlTrimmed.includes('WHERE MODEL_ID = $1') || sqlTrimmed.includes('WHERE R.MODEL_ID = $1')) {
      rows = rows.filter(r => r.model_id === params[0]);
    } else if (sqlTrimmed.includes('WHERE NODE_ID = $1') || sqlTrimmed.includes('WHERE R.NODE_ID = $1')) {
      rows = rows.filter(r => r.node_id === params[0]);
    }
    return { rows, rowCount: rows.length };
  }

  // Handle SELECT system_events
  if (sqlTrimmed.startsWith('SELECT') && sqlTrimmed.includes('FROM SYSTEM_EVENTS')) {
    let rows = [...memoryStore.system_events].reverse();
    if (sqlTrimmed.includes('LIMIT $1') && params[0]) {
      rows = rows.slice(0, params[0]);
    } else if (sqlTrimmed.includes('LIMIT 50')) {
      rows = rows.slice(0, 50);
    }
    return { rows, rowCount: rows.length };
  }

  // Handle SELECT communication_logs
  if (sqlTrimmed.startsWith('SELECT') && sqlTrimmed.includes('FROM COMMUNICATION_LOGS')) {
    let rows = [...memoryStore.communication_logs].reverse();
    if (sqlTrimmed.includes('LIMIT $1') && params[0]) {
      rows = rows.slice(0, params[0]);
    } else if (sqlTrimmed.includes('LIMIT 100')) {
      rows = rows.slice(0, 100);
    }
    return { rows, rowCount: rows.length };
  }

  // Handle INSERT models
  if (sqlTrimmed.startsWith('INSERT INTO MODELS')) {
    const item = {
      id: params[0],
      name: params[1],
      version: params[2],
      filename: params[3],
      size_bytes: params[4],
      checksum: params[5],
      replication_factor: params[6],
      primary_node_id: params[7],
      description: params[8] || '',
      status: params[9] || 'READY',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryStore.models.set(item.id, item);
    persistMemoryStore();
    return { rows: [item], rowCount: 1 };
  }

  // Handle INSERT / UPDATE storage_nodes
  if (sqlTrimmed.startsWith('INSERT INTO STORAGE_NODES')) {
    const id = params[0];
    const existing = memoryStore.storage_nodes.get(id) || {};
    const item = {
      id,
      host: params[1] || existing.host || 'localhost',
      port: params[2] || existing.port || 5001,
      status: params[3] || 'ONLINE',
      total_storage_bytes: params[4] || existing.total_storage_bytes || 107374182400,
      used_storage_bytes: params[5] || existing.used_storage_bytes || 0,
      available_storage_bytes: params[6] || existing.available_storage_bytes || 107374182400,
      stored_models_count: params[7] || existing.stored_models_count || 0,
      last_heartbeat: new Date().toISOString(),
      created_at: existing.created_at || new Date().toISOString()
    };
    memoryStore.storage_nodes.set(id, item);
    persistMemoryStore();
    return { rows: [item], rowCount: 1 };
  }

  // Handle UPDATE storage_nodes
  if (sqlTrimmed.startsWith('UPDATE STORAGE_NODES')) {
    const id = params[0];
    const existing = memoryStore.storage_nodes.get(id);
    if (existing) {
      if (sqlTrimmed.includes('SET LAST_HEARTBEAT')) {
        existing.status = params[1] || 'ONLINE';
        existing.last_heartbeat = new Date().toISOString();
      } else if (sqlTrimmed.includes('SET USED_STORAGE_BYTES')) {
        existing.used_storage_bytes = params[1];
        existing.total_storage_bytes = params[2];
        existing.available_storage_bytes = params[3];
        existing.stored_models_count = params[4];
        existing.last_heartbeat = new Date().toISOString();
      }
      persistMemoryStore();
      return { rows: [existing], rowCount: 1 };
    }
  }

  // Handle INSERT replicas
  if (sqlTrimmed.startsWith('INSERT INTO REPLICAS')) {
    const model_id = params[1];
    const node_id = params[2];
    const key = `${model_id}_${node_id}`;
    const existing = memoryStore.replicas.get(key) || {};

    const item = {
      id: existing.id || params[0],
      model_id,
      node_id,
      role: params[3] || existing.role || 'REPLICA',
      status: params[4] || existing.status || 'SYNCED',
      checksum: params[5] || existing.checksum || '',
      size_bytes: params[6] || existing.size_bytes || 0,
      synced_at: new Date().toISOString(),
      created_at: existing.created_at || new Date().toISOString()
    };
    memoryStore.replicas.set(key, item);
    persistMemoryStore();
    return { rows: [item], rowCount: 1 };
  }

  // Handle INSERT system_events
  if (sqlTrimmed.startsWith('INSERT INTO SYSTEM_EVENTS')) {
    const item = {
      id: params[0],
      event_type: params[1],
      source: params[2],
      payload: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
      created_at: new Date().toISOString()
    };
    memoryStore.system_events.push(item);
    persistMemoryStore();
    return { rows: [item], rowCount: 1 };
  }

  // Handle INSERT communication_logs
  if (sqlTrimmed.startsWith('INSERT INTO COMMUNICATION_LOGS')) {
    const item = {
      id: params[0],
      source: params[1],
      target: params[2],
      protocol: params[3] || 'gRPC',
      operation: params[4],
      status: params[5] || 'SUCCESS',
      details: params[6] || '',
      timestamp: new Date().toISOString()
    };
    memoryStore.communication_logs.push(item);
    persistMemoryStore();
    return { rows: [item], rowCount: 1 };
  }

  // Handle DELETE FROM MODELS
  if (sqlTrimmed.startsWith('DELETE FROM MODELS')) {
    const modelId = params[0];
    memoryStore.models.delete(modelId);
    for (const [key, rep] of memoryStore.replicas.entries()) {
      if (rep.model_id === modelId) {
        memoryStore.replicas.delete(key);
      }
    }
    persistMemoryStore();
    return { rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

module.exports = {
  initDatabase,
  query,
  isPgConnected: () => isPgConnected,
  getMemoryStore: () => memoryStore,
  scanAndSyncPhysicalModels
};
