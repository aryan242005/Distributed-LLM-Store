const GrpcClient = require('../communication/grpc/grpcClient');
const Replica = require('../database/models/Replica');
const StorageNode = require('../database/models/StorageNode');
const DistributedLogger = require('../communication/logger');

class ReplicationManager {
  /**
   * Replicates a model from its primary storage node to replica target nodes using P2P gRPC.
   */
  async replicateModel({ model, primaryNode, targetNodes }) {
    console.log(`[ReplicationManager] Starting replication for model "${model.name}" (${model.id}) from primary ${primaryNode.id} to ${targetNodes.length} replica nodes...`);

    // 1. Emit REPLICATION_STARTED event
    await DistributedLogger.logEvent('REPLICATION_STARTED', 'ReplicationManager', {
      modelId: model.id,
      modelName: model.name,
      primaryNodeId: primaryNode.id,
      targetNodes: targetNodes.map(n => n.id),
      replicationFactor: model.replication_factor || (targetNodes.length + 1),
    });

    const primaryAddress = `${primaryNode.host}:${primaryNode.port}`;
    const replicationResults = [];

    // 2. Perform P2P gRPC replication in parallel across all target replica nodes
    for (const targetNode of targetNodes) {
      try {
        // Create initial SYNCING replica record in DB
        await Replica.create({
          modelId: model.id,
          nodeId: targetNode.id,
          role: 'REPLICA',
          status: 'SYNCING',
          checksum: '',
          sizeBytes: 0,
        });

        const targetAddress = targetNode.host; // host for gRPC
        const targetPort = targetNode.port;

        // Coordinator instructs Primary Node to stream to Target Node (P2P gRPC)
        await DistributedLogger.logComm({
          source: 'Coordinator',
          target: primaryNode.id,
          protocol: 'gRPC',
          operation: 'INSTRUCT_REPLICATION',
          status: 'SUCCESS',
          details: `Instruct ${primaryNode.id} to stream to ${targetNode.id} (${targetAddress}:${targetPort})`,
        });

        const response = await GrpcClient.replicateToNode(primaryAddress, {
          modelId: model.id,
          filename: model.filename,
          targetNodeId: targetNode.id,
          targetNodeAddress: targetAddress,
          targetNodePort: targetPort,
        });

        if (response.success) {
          // Update DB replica record to SYNCED
          await Replica.create({
            modelId: model.id,
            nodeId: targetNode.id,
            role: 'REPLICA',
            status: 'SYNCED',
            checksum: response.checksum || model.checksum,
            sizeBytes: response.bytesReplicated || model.size_bytes,
          });

          // Refresh target node storage metrics
          try {
            const status = await GrpcClient.getNodeStatus(`${targetNode.host}:${targetNode.port}`);
            await StorageNode.updateStorageStats(targetNode.id, parseInt(status.usedStorageBytes, 10), parseInt(status.totalStorageBytes, 10), status.storedModelsCount);
          } catch (e) {}

          replicationResults.push({
            nodeId: targetNode.id,
            status: 'SYNCED',
            bytesReplicated: response.bytesReplicated,
          });
        } else {
          throw new Error(response.message || 'Replication failed');
        }
      } catch (err) {
        console.error(`[ReplicationManager] Replication to ${targetNode.id} failed:`, err.message);
        await Replica.create({
          modelId: model.id,
          nodeId: targetNode.id,
          role: 'REPLICA',
          status: 'FAILED',
          checksum: '',
          sizeBytes: 0,
        });

        replicationResults.push({
          nodeId: targetNode.id,
          status: 'FAILED',
          error: err.message,
        });
      }
    }

    // 3. Emit REPLICATION_COMPLETED event
    const successCount = replicationResults.filter(r => r.status === 'SYNCED').length;
    await DistributedLogger.logEvent('REPLICATION_COMPLETED', 'ReplicationManager', {
      modelId: model.id,
      modelName: model.name,
      totalReplicasCreated: successCount + 1, // Including primary
      targetNodesCount: targetNodes.length,
      successCount,
      details: replicationResults,
    });

    return replicationResults;
  }
}

module.exports = new ReplicationManager();
