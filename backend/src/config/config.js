const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // Also check local directory

const config = {
  // Coordinator Server
  coordinator: {
    port: parseInt(process.env.COORDINATOR_PORT || '4000', 10),
    host: process.env.COORDINATOR_HOST || '0.0.0.0',
    defaultReplicationFactor: parseInt(process.env.DEFAULT_REPLICATION_FACTOR || '3', 10),
  },

  // Storage Node (when running as a storage node instance)
  node: {
    id: process.env.NODE_ID || 'node-1',
    port: parseInt(process.env.NODE_PORT || '5001', 10),
    host: process.env.NODE_HOST || '0.0.0.0',
    address: process.env.NODE_ADDRESS || 'localhost',
    storagePath: path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '../../../storage', process.env.NODE_ID || 'node-1')),
    coordinatorUrl: process.env.COORDINATOR_URL || 'http://localhost:4000',
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000', 10),
  },

  // Known initial storage nodes configuration for Coordinator
  knownNodes: [
    {
      id: 'node-1',
      host: process.env.NODE_1_HOST || 'localhost',
      port: parseInt(process.env.NODE_1_PORT || '5001', 10),
    },
    {
      id: 'node-2',
      host: process.env.NODE_2_HOST || 'localhost',
      port: parseInt(process.env.NODE_2_PORT || '5002', 10),
    },
    {
      id: 'node-3',
      host: process.env.NODE_3_HOST || 'localhost',
      port: parseInt(process.env.NODE_3_PORT || '5003', 10),
    },
  ],

  // PostgreSQL Database
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/model_repo',
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'model_repo',
  },

  // NATS Event Bus
  nats: {
    url: process.env.NATS_URL || 'nats://localhost:4222',
  },

  // Streaming & Storage Settings
  storage: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || (64 * 1024).toString(), 10), // 64 KB
    tempUploadDir: path.resolve(__dirname, '../../../storage/temp'),
  },

  // Protobuf Definitions Path
  proto: {
    storagePath: path.resolve(__dirname, '../../../proto/storage.proto'),
  },
};

module.exports = config;
