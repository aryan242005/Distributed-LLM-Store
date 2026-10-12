const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config/config');
const { initDatabase } = require('../database/connection');
const natsClient = require('../communication/nats/natsClient');
const coordinator = require('../coordinator/coordinator');
const syncMonitor = require('../coordinator/syncMonitor');

// Routes
const modelsRouter = require('./routes/models');
const nodesRouter = require('./routes/nodes');
const replicasRouter = require('./routes/replicas');
const logsRouter = require('./routes/logs');
const eventsRouter = require('./routes/events');
const dashboardRouter = require('./routes/dashboard');
const syncRouter = require('./routes/sync');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'X-Serving-Node', 'X-Model-Checksum']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logger
app.use((req, res, next) => {
  if (req.path !== '/api/health' && !req.path.startsWith('/api/dashboard')) {
    console.log(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Coordinator',
    timestamp: new Date().toISOString(),
    natsConnected: natsClient.isConnected,
  });
});

// Mount Routes
app.use('/api/models', modelsRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/replicas', replicasRouter);
app.use('/api/logs', logsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/sync', syncRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[HTTP Error]', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

async function startServer() {
  console.log('====================================================');
  console.log('Starting Distributed Model Repository Coordinator');
  console.log('====================================================');

  // 1. Initialize Database
  await initDatabase();

  // 2. Connect to NATS
  await natsClient.connect();

  // 3. Initialize Coordinator
  await coordinator.init();

  // 4. Observe the storage nodes' synchronization layer (Unit 3)
  syncMonitor.init();

  const port = config.coordinator.port;
  const host = config.coordinator.host;

  app.listen(port, host, () => {
    console.log(`[Coordinator] REST API server listening at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`[Coordinator] Open frontend or test API at http://localhost:${port}/api/health`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Coordinator Startup Error:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
