const StorageNode = require('../database/models/StorageNode');

const NodeSelector = {
  /**
   * Selects a primary node and (replicationFactor - 1) replica nodes for storing a new model.
   * Prioritizes online nodes with lower storage usage and fewer stored models.
   */
  async selectNodes(requestedReplicationFactor = 3) {
    const allNodes = await StorageNode.getAll();
    const onlineNodes = allNodes.filter(n => n.status === 'ONLINE' || !n.status);

    if (onlineNodes.length === 0) {
      throw new Error('No online storage nodes available in the cluster!');
    }

    // Sort by stored_models_count ASC, then used_storage_bytes ASC (least loaded first)
    const sorted = [...onlineNodes].sort((a, b) => {
      const countDiff = (a.stored_models_count || 0) - (b.stored_models_count || 0);
      if (countDiff !== 0) return countDiff;
      return (Number(a.used_storage_bytes) || 0) - (Number(b.used_storage_bytes) || 0);
    });

    const primaryNode = sorted[0];

    // Number of replica nodes needed
    const actualReplicationFactor = Math.min(requestedReplicationFactor, onlineNodes.length);
    const replicaNodesNeeded = actualReplicationFactor - 1;

    // Pick target replica nodes from remaining available nodes
    const targetReplicaNodes = sorted.slice(1, 1 + replicaNodesNeeded);

    return {
      primaryNode,
      targetReplicaNodes,
      allSelectedNodes: [primaryNode, ...targetReplicaNodes],
      replicationFactor: actualReplicationFactor,
    };
  }
};

module.exports = NodeSelector;
