const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const config = require('../../config/config');

const PROTO_PATH = config.proto.storagePath;

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const storageProto = grpc.loadPackageDefinition(packageDefinition).storage;

// Cache of active client instances: 'host:port' -> client
const clientPool = new Map();

function getStorageClient(address) {
  if (clientPool.has(address)) {
    return clientPool.get(address);
  }

  const client = new storageProto.StorageService(
    address,
    grpc.credentials.createInsecure(),
    {
      'grpc.max_receive_message_length': 100 * 1024 * 1024, // 100MB
      'grpc.max_send_message_length': 100 * 1024 * 1024,
    }
  );

  clientPool.set(address, client);
  return client;
}

// Promisified gRPC helper functions
const GrpcClient = {
  getRawClient: getStorageClient,

  // Stream upload chunks to a storage node
  createStoreStream(nodeAddress, callback) {
    const client = getStorageClient(nodeAddress);
    return client.StoreChunkStream(callback);
  },

  // Stream download chunks from a storage node
  createRetrieveStream(nodeAddress, modelId, filename) {
    const client = getStorageClient(nodeAddress);
    return client.RetrieveChunkStream({ modelId, filename });
  },

  // Replicate from source node to target node (Unary RPC triggers P2P streaming on node)
  async replicateToNode(sourceAddress, { modelId, filename, targetNodeId, targetNodeAddress, targetNodePort }) {
    const client = getStorageClient(sourceAddress);
    return new Promise((resolve, reject) => {
      client.ReplicateToNode(
        {
          modelId,
          filename,
          targetNodeId,
          targetNodeAddress,
          targetNodePort,
        },
        (err, response) => {
          if (err) return reject(err);
          resolve(response);
        }
      );
    });
  },

  // Query status of a storage node
  async getNodeStatus(nodeAddress) {
    const client = getStorageClient(nodeAddress);
    return new Promise((resolve, reject) => {
      client.GetStatus({ query: 'status' }, { deadline: Date.now() + 3000 }, (err, response) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  },

  // Delete model file on node
  async deleteModelFile(nodeAddress, modelId, filename) {
    const client = getStorageClient(nodeAddress);
    return new Promise((resolve, reject) => {
      client.DeleteModelFile({ modelId, filename }, (err, response) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  },

  // Ping node health
  async pingNode(nodeAddress, senderId = 'coordinator') {
    const client = getStorageClient(nodeAddress);
    return new Promise((resolve, reject) => {
      client.HealthCheck({ timestamp: new Date().toISOString(), senderId }, { deadline: Date.now() + 2500 }, (err, response) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  },
};

module.exports = GrpcClient;
