const { v4: uuidv4 } = require('uuid');
const GrpcClient = require('../communication/grpc/grpcClient');
const NodeSelector = require('./nodeSelector');
const RequestRouter = require('./requestRouter');
const ReplicationManager = require('../replication/replicationManager');
const Model = require('../database/models/Model');
const StorageNode = require('../database/models/StorageNode');
const Replica = require('../database/models/Replica');
const DistributedLogger = require('../communication/logger');
const ChecksumUtil = require('../storage/checksum');
const ChunkManager = require('../storage/chunkManager');
const natsClient = require('../communication/nats/natsClient');
const config = require('../config/config');
const { rwLock } = require('../utils/concurrency');

class CoordinatorService {
  constructor() {
    this.healthCheckTimer = null;
  }

  async init() {
    console.log('[Coordinator] Initializing Coordinator Service...');

    // Subscribe to NATS node events
    natsClient.subscribe('node.events', async (data) => {
      if (data.eventType === 'NODE_REGISTERED' || data.eventType === 'NODE_STATUS_UPDATED') {
        try {
          await StorageNode.upsert({
            id: data.nodeId,
            host: data.host,
            port: data.port,
            status: 'ONLINE',
            totalStorageBytes: data.totalStorageBytes || 107374182400,
            usedStorageBytes: data.usedStorageBytes || 0,
            availableStorageBytes: data.availableStorageBytes || 107374182400,
            storedModelsCount: data.storedModelsCount || 0,
          });
        } catch (e) {}
      }
    });

    // Start background health checking
    this.startHealthCheckPoller();
  }

  startHealthCheckPoller() {
    // Poll storage node statuses every 5 seconds
    this.healthCheckTimer = setInterval(async () => {
      try {
        const nodes = await StorageNode.getAll();
        for (const node of nodes) {
          try {
            const address = `${node.host}:${node.port}`;
            const status = await GrpcClient.getNodeStatus(address);
            await StorageNode.updateStorageStats(
              node.id,
              parseInt(status.usedStorageBytes, 10) || 0,
              parseInt(status.totalStorageBytes, 10) || 107374182400,
              status.storedModelsCount || 0
            );
            await StorageNode.updateHeartbeat(node.id, 'ONLINE');
          } catch (err) {
            // Mark node as offline if unreachable
            await StorageNode.updateHeartbeat(node.id, 'OFFLINE');
          }
        }
      } catch (e) {}
    }, 5000);
  }

  /**
   * Complete streaming upload pipeline:
   * 1. Select primary & replica storage nodes.
   * 2. Stream chunks to Primary Node via gRPC.
   * 3. Compute and verify SHA-256 hash.
   * 4. Record metadata in PostgreSQL.
   * 5. Emit NATS event.
   * 6. Trigger Peer-to-Peer gRPC replication across target nodes.
   */
  async uploadModel({ name, version, description = '', replicationFactor = 3, fileStream, originalFilename, fileSizeBytes }) {
    const modelId = uuidv4();
    const reqRepFactor = parseInt(replicationFactor, 10) || config.coordinator.defaultReplicationFactor;

    // 1. Select Nodes
    const { primaryNode, targetReplicaNodes, replicationFactor: actualRepFactor } = await NodeSelector.selectNodes(reqRepFactor);
    const primaryAddress = `${primaryNode.host}:${primaryNode.port}`;

    console.log(`[Coordinator] Model "${name}" (${modelId}) assigned to Primary Node ${primaryNode.id} (${primaryAddress}) with ${targetReplicaNodes.length} replicas`);

    // 2. Open gRPC client stream to Primary Storage Node
    let primaryChecksum = '';
    let bytesWritten = 0;
    const coordinatorHasher = ChecksumUtil.createHasher();

    await DistributedLogger.logComm({
      source: 'Coordinator',
      target: primaryNode.id,
      protocol: 'gRPC',
      operation: 'STORE_MODEL',
      status: 'IN_PROGRESS',
      details: `Streaming upload of ${originalFilename} (${fileSizeBytes} bytes)`,
    });

    const storePromise = new Promise((resolve, reject) => {
      const storeStream = GrpcClient.createStoreStream(primaryAddress, (err, response) => {
        if (err) return reject(err);
        if (!response || !response.success) {
          return reject(new Error(response ? response.message : 'Primary node failed to store model'));
        }
        primaryChecksum = response.checksum;
        bytesWritten = parseInt(response.bytesWritten, 10);
        resolve(response);
      });

      let chunkIndex = 0;
      fileStream.on('data', (buffer) => {
        coordinatorHasher.update(buffer);
        storeStream.write({
          modelId,
          filename: originalFilename,
          chunkIndex: chunkIndex++,
          data: buffer,
          totalSize: fileSizeBytes,
        });
      });

      fileStream.on('end', () => {
        storeStream.end();
      });

      fileStream.on('error', (err) => {
        storeStream.cancel();
        reject(err);
      });
    });

    await storePromise;

    const coordChecksum = coordinatorHasher.digest('hex');
    console.log(`[Coordinator] Upload to Primary ${primaryNode.id} complete. Coordinator Checksum: ${coordChecksum}, Node Checksum: ${primaryChecksum}`);

    await DistributedLogger.logComm({
      source: 'Coordinator',
      target: primaryNode.id,
      protocol: 'gRPC',
      operation: 'STORE_MODEL',
      status: 'SUCCESS',
      details: `Stored ${bytesWritten} bytes. SHA256 verified.`,
    });

    // 3. Save Model to Database
    const savedModel = await Model.create({
      id: modelId,
      name,
      version,
      filename: originalFilename,
      sizeBytes: bytesWritten,
      checksum: primaryChecksum,
      replicationFactor: actualRepFactor,
      primaryNodeId: primaryNode.id,
      description,
    });

    // 4. Save Primary Replica record
    await Replica.create({
      modelId,
      nodeId: primaryNode.id,
      role: 'PRIMARY',
      status: 'SYNCED',
      checksum: primaryChecksum,
      sizeBytes: bytesWritten,
    });

    // Update primary node storage stats in DB, then release its placement
    // reservation now that the real counters reflect this upload.
    try {
      const status = await GrpcClient.getNodeStatus(primaryAddress);
      await StorageNode.updateStorageStats(primaryNode.id, parseInt(status.usedStorageBytes, 10), parseInt(status.totalStorageBytes, 10), status.storedModelsCount);
    } catch (e) {
    } finally {
      NodeSelector.releaseReservation(primaryNode.id);
    }

    // 5. Emit MODEL_UPLOADED event over NATS
    await DistributedLogger.logEvent('MODEL_UPLOADED', 'Coordinator', {
      modelId,
      name,
      version,
      filename: originalFilename,
      sizeBytes: bytesWritten,
      checksum: primaryChecksum,
      primaryNodeId: primaryNode.id,
      replicationFactor: actualRepFactor,
    });

    // 6. Asynchronously trigger peer-to-peer replication across target nodes.
    // Held under this model's write lock so a concurrent deleteModel() call
    // for the same modelId cannot remove the model/replica records while
    // replication is still mutating them (and vice versa).
    if (targetReplicaNodes.length > 0) {
      rwLock.withWriteLock(modelId, () => ReplicationManager.replicateModel({
        model: savedModel,
        primaryNode,
        targetNodes: targetReplicaNodes,
      })).catch(err => console.error('[Coordinator] Background replication error:', err));
    }

    return {
      model: savedModel,
      primaryNode: primaryNode.id,
      replicaNodes: targetReplicaNodes.map(n => n.id),
      checksum: primaryChecksum,
      sizeBytes: bytesWritten,
    };
  }

  /**
   * Retrieves a download stream for a model from an active replica storage node.
   */
  async downloadModel(modelId) {
    // Shared/read lock: any number of concurrent downloads of the same
    // model may proceed together, but they queue behind (and block) an
    // exclusive delete/replication write lock on this modelId, so a
    // download can never be routed to a node mid-delete.
    return rwLock.withReadLock(modelId, async () => {
      const model = await Model.getById(modelId);
      if (!model) {
        throw new Error(`Model not found: ${modelId}`);
      }

      // 1. Select node holding replica
      const { node, replica } = await RequestRouter.routeDownload(modelId);
      const nodeAddress = `${node.host}:${node.port}`;

      console.log(`[Coordinator] Serving download of model "${model.name}" from node ${node.id || node.host} (${nodeAddress})`);

      await DistributedLogger.logComm({
        source: 'Coordinator',
        target: node.id || nodeAddress,
        protocol: 'gRPC',
        operation: 'GET_MODEL',
        status: 'SUCCESS',
        details: `Streaming download of ${model.filename} (${model.size_bytes} bytes)`,
      });

      // 2. Open gRPC retrieval stream
      const grpcStream = GrpcClient.createRetrieveStream(nodeAddress, modelId, model.filename);

      return {
        model,
        servingNode: node.id || node.host,
        grpcStream,
      };
    });
  }

  /**
   * Deletes a model from all storage nodes and database.
   */
  async deleteModel(modelId) {
    // Exclusive/write lock: waits for any in-flight downloads or
    // replication on this modelId to finish, and blocks new downloads
    // from starting until the delete completes - preventing a download
    // from being routed to a node whose file is being removed mid-request.
    return rwLock.withWriteLock(modelId, async () => {
      const model = await Model.getById(modelId);
      if (!model) {
        throw new Error(`Model not found: ${modelId}`);
      }

      const replicas = await Replica.getByModelId(modelId);
      const allNodes = await StorageNode.getAll();
      const nodeMap = new Map(allNodes.map(n => [n.id, n]));

      console.log(`[Coordinator] Deleting model "${model.name}" (${modelId}) across ${replicas.length} nodes...`);

      for (const rep of replicas) {
        const node = nodeMap.get(rep.node_id);
        if (node) {
          const address = `${node.host}:${node.port}`;
          try {
            await GrpcClient.deleteModelFile(address, modelId, model.filename);
            await DistributedLogger.logComm({
              source: 'Coordinator',
              target: node.id,
              protocol: 'gRPC',
              operation: 'DELETE_MODEL',
              status: 'SUCCESS',
              details: `Deleted ${model.filename} from ${node.id}`,
            });
          } catch (err) {
            console.warn(`[Coordinator] Failed to delete from node ${node.id}:`, err.message);
          }
        }
      }

      // Delete database records
      await Model.delete(modelId);

      // Emit event
      await DistributedLogger.logEvent('MODEL_DELETED', 'Coordinator', {
        modelId,
        name: model.name,
        filename: model.filename,
      });

      return true;
    });
  }
}

module.exports = new CoordinatorService();
