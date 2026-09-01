const StorageNode = require('../database/models/StorageNode');
const { mutex } = require('../utils/concurrency');

// Concurrency control: real load counters (stored_models_count / used_storage_bytes)
// only update in the DB once an upload/replication finishes, which can take
// seconds for large files. Without a reservation, N concurrent uploads would
// all read the same stale "least loaded" node and race onto it - a classic
// lost-update problem on shared state. pendingLoad tracks in-flight
// reservations so concurrent selectNodes() calls see each other's decisions
// immediately, and the whole read-decide-reserve sequence runs under a
// mutex so it is atomic with respect to other concurrent selections.
const pendingLoad = new Map();

const NodeSelector = {
  /**
   * Selects a primary node and (replicationFactor - 1) replica nodes for storing a new model.
   * Prioritizes online nodes with lower storage usage and fewer stored models.
   */
  async selectNodes(requestedReplicationFactor = 3) {
    return mutex.runExclusive('node-placement', async () => {
      const allNodes = await StorageNode.getAll();
      const onlineNodes = allNodes.filter(n => n.status === 'ONLINE' || !n.status);

      if (onlineNodes.length === 0) {
        throw new Error('No online storage nodes available in the cluster!');
      }

      // Sort by (stored_models_count + pending reservations) ASC, then used_storage_bytes ASC
      const sorted = [...onlineNodes].sort((a, b) => {
        const loadA = (a.stored_models_count || 0) + (pendingLoad.get(a.id) || 0);
        const loadB = (b.stored_models_count || 0) + (pendingLoad.get(b.id) || 0);
        if (loadA !== loadB) return loadA - loadB;
        return (Number(a.used_storage_bytes) || 0) - (Number(b.used_storage_bytes) || 0);
      });

      const primaryNode = sorted[0];

      // Number of replica nodes needed
      const actualReplicationFactor = Math.min(requestedReplicationFactor, onlineNodes.length);
      const replicaNodesNeeded = actualReplicationFactor - 1;

      // Pick target replica nodes from remaining available nodes
      const targetReplicaNodes = sorted.slice(1, 1 + replicaNodesNeeded);

      // Reserve capacity on every selected node before releasing the lock,
      // so the next queued selectNodes() call sees this decision.
      for (const node of [primaryNode, ...targetReplicaNodes]) {
        pendingLoad.set(node.id, (pendingLoad.get(node.id) || 0) + 1);
      }

      return {
        primaryNode,
        targetReplicaNodes,
        allSelectedNodes: [primaryNode, ...targetReplicaNodes],
        replicationFactor: actualReplicationFactor,
      };
    });
  },

  /**
   * Releases a previously reserved placement slot once the node's real
   * storage stats have been refreshed (or the placement failed/was
   * abandoned), so future selections stop accounting for it.
   */
  releaseReservation(nodeId) {
    const current = pendingLoad.get(nodeId) || 0;
    if (current <= 1) {
      pendingLoad.delete(nodeId);
    } else {
      pendingLoad.set(nodeId, current - 1);
    }
  },
};

module.exports = NodeSelector;
