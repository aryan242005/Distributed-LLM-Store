const Replica = require('../database/models/Replica');
const StorageNode = require('../database/models/StorageNode');

let rrCounter = 0;

const RequestRouter = {
  /**
   * Selects an active storage node holding a synced replica of the requested model.
   * Uses round-robin among eligible online nodes.
   */
  async routeDownload(modelId) {
    const replicas = await Replica.getByModelId(modelId);
    const syncedReplicas = replicas.filter(r => r.status === 'SYNCED');

    if (syncedReplicas.length === 0) {
      throw new Error(`No synced replicas found for model ${modelId}`);
    }

    // Filter by online storage nodes
    const allNodes = await StorageNode.getAll();
    const onlineNodeMap = new Map(allNodes.filter(n => n.status === 'ONLINE').map(n => [n.id, n]));

    const availableCandidates = syncedReplicas.filter(r => onlineNodeMap.has(r.node_id));

    if (availableCandidates.length === 0) {
      // Fallback to first synced replica if node status hasn't updated yet
      const candidate = syncedReplicas[0];
      const node = allNodes.find(n => n.id === candidate.node_id);
      return { replica: candidate, node: node || { host: candidate.host || 'localhost', port: candidate.port || 5001 } };
    }

    // Round robin selection
    rrCounter = (rrCounter + 1) % availableCandidates.length;
    const selectedReplica = availableCandidates[rrCounter];
    const selectedNode = onlineNodeMap.get(selectedReplica.node_id);

    return {
      replica: selectedReplica,
      node: selectedNode,
    };
  }
};

module.exports = RequestRouter;
