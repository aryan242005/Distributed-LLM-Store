const path = require('path');
const fs = require('fs');

// Allow resolving dependencies from backend/node_modules
module.paths.push(path.resolve(__dirname, '../backend/node_modules'));

const http = require('http');
const crypto = require('crypto');

// Load backend modules directly for complete test runner
const StorageNodeServer = require('../backend/src/storage/storageNode');
const { initDatabase } = require('../backend/src/database/connection');
const coordinator = require('../backend/src/coordinator/coordinator');
const { app } = require('../backend/src/api/server');
const GrpcClient = require('../backend/src/communication/grpc/grpcClient');
const Model = require('../backend/src/database/models/Model');
const StorageNode = require('../backend/src/database/models/StorageNode');
const Replica = require('../backend/src/database/models/Replica');

const rootDir = path.resolve(__dirname, '..');

async function runFullSystemTest() {
  console.log('================================================================');
  console.log('     FULL DISTRIBUTED SYSTEM INTEGRATION & VERIFICATION TEST    ');
  console.log('================================================================\n');

  // 1. Ensure Storage Dirs
  ['node-1', 'node-2', 'node-3', 'temp'].forEach((dir) => {
    const p = path.join(rootDir, 'storage', dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });

  // 2. Start 3 Storage Node Servers
  console.log('[STEP 1] Starting 3 Storage Node instances (Generic Codebase)...');
  const node1 = new StorageNodeServer({
    nodeId: 'node-1',
    port: 5001,
    host: 'localhost',
    storagePath: path.join(rootDir, 'storage', 'node-1'),
  });
  await node1.start();

  const node2 = new StorageNodeServer({
    nodeId: 'node-2',
    port: 5002,
    host: 'localhost',
    storagePath: path.join(rootDir, 'storage', 'node-2'),
  });
  await node2.start();

  const node3 = new StorageNodeServer({
    nodeId: 'node-3',
    port: 5003,
    host: 'localhost',
    storagePath: path.join(rootDir, 'storage', 'node-3'),
  });
  await node3.start();

  console.log('✔ Node 1 (port 5001), Node 2 (port 5002), Node 3 (port 5003) running.\n');

  // 3. Initialize Coordinator Database & Service
  console.log('[STEP 2] Initializing Coordinator & Database Layer...');
  await initDatabase();
  await coordinator.init();

  // Register the 3 nodes in DB
  await StorageNode.upsert({ id: 'node-1', host: 'localhost', port: 5001, status: 'ONLINE' });
  await StorageNode.upsert({ id: 'node-2', host: 'localhost', port: 5002, status: 'ONLINE' });
  await StorageNode.upsert({ id: 'node-3', host: 'localhost', port: 5003, status: 'ONLINE' });

  // Start Express REST server
  const server = app.listen(4000, 'localhost');
  console.log('✔ Coordinator REST API listening at http://localhost:4000\n');

  // 4. Generate Synthetic LLM Weight File
  console.log('[STEP 3] Generating Synthetic LLM Model File (TinyLlama-v1.bin)...');
  const testFileName = 'TinyLlama-v1.bin';
  const testFilePath = path.join(rootDir, 'storage', 'temp', testFileName);
  const testFileBytes = 2 * 1024 * 1024; // 2 MB
  const fileData = crypto.randomBytes(testFileBytes);
  fs.writeFileSync(testFilePath, fileData);
  const originalChecksum = crypto.createHash('sha256').update(fileData).digest('hex');
  console.log(`✔ File generated: ${testFileBytes} bytes. SHA-256: ${originalChecksum}\n`);

  // 5. Test Model Upload via Coordinator
  console.log('[STEP 4] Testing Model Upload & Peer-to-Peer Replication via Coordinator...');
  const fileStream = fs.createReadStream(testFilePath);

  const uploadResult = await coordinator.uploadModel({
    name: 'TinyLlama-1.1B',
    version: '1.0.0',
    description: 'Test Quantized LLM Weights for Distributed Storage',
    replicationFactor: 3,
    fileStream,
    originalFilename: testFileName,
    fileSizeBytes: testFileBytes,
  });

  console.log('✔ Upload completed successfully!');
  console.log('  Model ID:', uploadResult.model.id);
  console.log('  Primary Node:', uploadResult.primaryNode);
  console.log('  Target Replica Nodes:', uploadResult.replicaNodes.join(', '));
  console.log('  Verified SHA256:', uploadResult.checksum);

  // Wait 1 second for P2P replication transfers to finalize
  await new Promise((r) => setTimeout(r, 1000));

  // 6. Verify Physical Storage on All 3 Nodes
  console.log('\n[STEP 5] Verifying Physical Storage & Checksums Across All 3 Node Directories...');
  const modelId = uploadResult.model.id;
  const nodePaths = [
    { node: 'node-1', path: path.join(rootDir, 'storage', 'node-1', 'models', `${modelId}_${testFileName}`) },
    { node: 'node-2', path: path.join(rootDir, 'storage', 'node-2', 'models', `${modelId}_${testFileName}`) },
    { node: 'node-3', path: path.join(rootDir, 'storage', 'node-3', 'models', `${modelId}_${testFileName}`) },
  ];

  for (const { node, path: p } of nodePaths) {
    if (!fs.existsSync(p)) {
      throw new Error(`File missing on ${node}: ${p}`);
    }
    const nodeFileContent = fs.readFileSync(p);
    const nodeChecksum = crypto.createHash('sha256').update(nodeFileContent).digest('hex');
    if (nodeChecksum !== originalChecksum) {
      throw new Error(`Checksum mismatch on ${node}! Expected: ${originalChecksum}, got: ${nodeChecksum}`);
    }
    console.log(`  ✔ [${node}] File exists (${nodeFileContent.length} bytes), SHA-256 match: ${nodeChecksum.substring(0, 16)}...`);
  }

  // 7. Verify Database Metadata
  console.log('\n[STEP 6] Verifying Metadata Records in Database...');
  const dbModel = await Model.getById(modelId);
  console.log(`  ✔ Model found in DB: "${dbModel.name}" v${dbModel.version} (Status: ${dbModel.status})`);
  const replicas = await Replica.getByModelId(modelId);
  console.log(`  ✔ Total Replicas in DB: ${replicas.length}`);
  replicas.forEach((r) => {
    console.log(`     - Node: ${r.node_id} | Role: ${r.role} | Status: ${r.status} | Checksum: ${r.checksum ? r.checksum.substring(0, 12) + '...' : '-'}`);
  });

  // 8. Test Stream Download from Replica Node
  console.log('\n[STEP 7] Testing Streamed Download from Serving Storage Node...');
  const downloadInfo = await coordinator.downloadModel(modelId);
  console.log(`  ✔ Coordinator routed download to Serving Node: ${downloadInfo.servingNode}`);

  const downloadedChunks = [];
  await new Promise((resolve, reject) => {
    downloadInfo.grpcStream.on('data', (chunk) => {
      downloadedChunks.push(chunk.data);
    });
    downloadInfo.grpcStream.on('end', resolve);
    downloadInfo.grpcStream.on('error', reject);
  });

  const downloadedBuffer = Buffer.concat(downloadedChunks);
  const downloadedChecksum = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
  console.log(`  ✔ Downloaded ${downloadedBuffer.length} bytes via gRPC stream.`);
  console.log(`  ✔ Downloaded Checksum: ${downloadedChecksum}`);
  if (downloadedChecksum !== originalChecksum) {
    throw new Error('Downloaded file checksum does not match original!');
  }
  console.log('  ✔ Cryptographic integrity 100% verified!\n');

  // Cleanup test services
  console.log('Cleaning up test cluster...');
  server.close();
  await node1.stop();
  await node2.stop();
  await node3.stop();

  console.log('================================================================');
  console.log('       ALL DISTRIBUTED SYSTEM TESTS PASSED SUCCESSFULLY!        ');
  console.log('================================================================');
  process.exit(0);
}

runFullSystemTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
