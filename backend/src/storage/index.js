const path = require('path');
const http = require('http');
const StorageNodeServer = require('./storageNode');
const config = require('../config/config');
const natsClient = require('../communication/nats/natsClient');
const SyncAgent = require('../sync/syncAgent');

async function main() {
  const nodeId = process.env.NODE_ID || config.node.id;
  const port = parseInt(process.env.NODE_PORT || config.node.port, 10);
  const host = process.env.NODE_HOST || '0.0.0.0';
  const address = process.env.NODE_ADDRESS || 'localhost';
  const storagePath = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '../../../storage', nodeId));

  console.log(`====================================================`);
  console.log(`Starting Generic Storage Node: ${nodeId}`);
  console.log(`Port: ${port} | Host: ${host} | Storage: ${storagePath}`);
  console.log(`====================================================`);

  const nodeServer = new StorageNodeServer({
    nodeId,
    port,
    host,
    storagePath,
  });

  await nodeServer.start();

  // Try connecting to NATS
  await natsClient.connect();

  // Announce node registration over NATS
  natsClient.publish('node.events', {
    eventType: 'NODE_REGISTERED',
    nodeId,
    host: address,
    port,
    storagePath,
  });

  // Periodically emit heartbeat status
  const heartbeatInterval = setInterval(async () => {
    try {
      const stats = await nodeServer.fileManager.getStorageStats();
      natsClient.publish('node.events', {
        eventType: 'NODE_STATUS_UPDATED',
        nodeId,
        host: address,
        port,
        status: 'ONLINE',
        ...stats,
      });
    } catch (e) {}
  }, config.node.heartbeatIntervalMs || 5000);

  // Unit 3 synchronization layer: beacons, Bully election, Berkeley clock sync,
  // Lamport/vector clocks, Ricart-Agrawala mutual exclusion, Chandy-Lamport snapshots
  const syncAgent = new SyncAgent({
    nodeId,
    transport: natsClient,
    fileManager: nodeServer.fileManager,
    clockSkewMs: parseInt(process.env.CLOCK_SKEW_MS || '0', 10),
    clockDriftPpm: parseInt(process.env.CLOCK_DRIFT_PPM || '0', 10),
  });
  await syncAgent.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`\nShutting down Storage Node ${nodeId}...`);
    clearInterval(heartbeatInterval);
    syncAgent.stop();
    await nodeServer.stop();
    await natsClient.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal Storage Node Error:', err);
    process.exit(1);
  });
}

module.exports = main;
