const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const FileManager = require('./fileManager');
const ChecksumUtil = require('./checksum');
const ChunkManager = require('./chunkManager');
const config = require('../config/config');
const GrpcClient = require('../communication/grpc/grpcClient');
const DistributedLogger = require('../communication/logger');

class StorageNodeServer {
  constructor({ nodeId, port, host = '0.0.0.0', storagePath }) {
    this.nodeId = nodeId;
    this.port = port;
    this.host = host;
    this.storagePath = storagePath;
    this.fileManager = new FileManager(storagePath);
    this.startTime = Date.now();
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const packageDefinition = protoLoader.loadSync(config.proto.storagePath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const storageProto = grpc.loadPackageDefinition(packageDefinition).storage;

      this.server = new grpc.Server({
        'grpc.max_receive_message_length': 100 * 1024 * 1024,
        'grpc.max_send_message_length': 100 * 1024 * 1024,
      });

      this.server.addService(storageProto.StorageService.service, {
        StoreChunkStream: this.handleStoreChunkStream.bind(this),
        RetrieveChunkStream: this.handleRetrieveChunkStream.bind(this),
        ReplicateToNode: this.handleReplicateToNode.bind(this),
        GetStatus: this.handleGetStatus.bind(this),
        DeleteModelFile: this.handleDeleteModelFile.bind(this),
        HealthCheck: this.handleHealthCheck.bind(this),
      });

      const bindAddress = `${this.host}:${this.port}`;
      this.server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
        if (err) {
          console.error(`[StorageNode:${this.nodeId}] Failed to bind gRPC server to ${bindAddress}:`, err.message);
          return reject(err);
        }
        console.log(`[StorageNode:${this.nodeId}] gRPC server running at ${bindAddress} (Storage: ${this.storagePath})`);
        resolve(boundPort);
      });
    });
  }

  // Client streaming: Receive file chunks and write to disk
  handleStoreChunkStream(call, callback) {
    let modelId = '';
    let filename = '';
    let writeStream = null;
    let hasher = ChecksumUtil.createHasher();
    let bytesWritten = 0;
    let chunkCount = 0;

    call.on('data', (chunk) => {
      if (!writeStream) {
        modelId = chunk.modelId;
        filename = chunk.filename;
        writeStream = this.fileManager.createWriteStream(modelId, filename);
      }

      const chunkBuffer = Buffer.from(chunk.data);
      writeStream.write(chunkBuffer);
      hasher.update(chunkBuffer);
      bytesWritten += chunkBuffer.length;
      chunkCount++;
    });

    call.on('end', () => {
      if (!writeStream) {
        return callback(null, {
          success: false,
          message: 'No chunk data received',
          modelId: '',
          filename: '',
          checksum: '',
          bytesWritten: 0,
        });
      }

      writeStream.end(async () => {
        const finalChecksum = hasher.digest('hex');
        console.log(`[StorageNode:${this.nodeId}] Stored model ${modelId} (${filename}): ${bytesWritten} bytes in ${chunkCount} chunks, SHA256: ${finalChecksum}`);

        callback(null, {
          success: true,
          message: 'Model chunks stored successfully',
          modelId,
          filename,
          checksum: finalChecksum,
          bytesWritten,
        });
      });
    });

    call.on('error', (err) => {
      console.error(`[StorageNode:${this.nodeId}] StoreChunkStream error:`, err);
      if (writeStream) writeStream.end();
      callback(err);
    });
  }

  // Server streaming: Read local model file and stream chunks back to requester
  handleRetrieveChunkStream(call) {
    const { modelId, filename } = call.request;
    console.log(`[StorageNode:${this.nodeId}] Serving download stream for model ${modelId} (${filename})`);

    try {
      const readStream = this.fileManager.createReadStream(modelId, filename, {
        highWaterMark: ChunkManager.CHUNK_SIZE,
      });

      let chunkIndex = 0;
      readStream.on('data', (chunkBuffer) => {
        const chunk = ChunkManager.createChunkPayload({
          modelId,
          filename,
          chunkIndex: chunkIndex++,
          data: chunkBuffer,
        });
        call.write(chunk);
      });

      readStream.on('end', () => {
        console.log(`[StorageNode:${this.nodeId}] Finished streaming model ${modelId} (${chunkIndex} chunks sent)`);
        call.end();
      });

      readStream.on('error', (err) => {
        console.error(`[StorageNode:${this.nodeId}] ReadStream error for model ${modelId}:`, err.message);
        call.destroy(err);
      });
    } catch (err) {
      console.error(`[StorageNode:${this.nodeId}] File read error:`, err.message);
      call.destroy(err);
    }
  }

  // Peer-to-Peer Replication: Node A streams model directly to Node B via gRPC
  async handleReplicateToNode(call, callback) {
    const { modelId, filename, targetNodeId, targetNodeAddress, targetNodePort } = call.request;
    const targetEndpoint = `${targetNodeAddress}:${targetNodePort}`;

    console.log(`[StorageNode:${this.nodeId}] Initiating P2P replication of model ${modelId} to ${targetNodeId} (${targetEndpoint})...`);

    try {
      // 1. Verify source file exists locally
      if (!this.fileManager.fileExists(modelId, filename)) {
        throw new Error(`Source file for model ${modelId} not found on node ${this.nodeId}`);
      }

      // 2. Open gRPC client connection to target storage node
      const targetClient = GrpcClient.getRawClient(targetEndpoint);

      // 3. Initiate StoreChunkStream on target node
      let bytesReplicated = 0;
      let targetChecksum = '';

      const replicationPromise = new Promise((resolve, reject) => {
        const storeStream = targetClient.StoreChunkStream((err, response) => {
          if (err) return reject(err);
          if (!response || !response.success) {
            return reject(new Error(response ? response.message : 'Replication failed at target node'));
          }
          targetChecksum = response.checksum;
          bytesReplicated = parseInt(response.bytesWritten, 10);
          resolve(response);
        });

        // 4. Stream local file chunks into target node's gRPC stream
        const readStream = this.fileManager.createReadStream(modelId, filename, {
          highWaterMark: ChunkManager.CHUNK_SIZE,
        });

        let chunkIndex = 0;
        readStream.on('data', (buffer) => {
          storeStream.write({
            modelId,
            filename,
            chunkIndex: chunkIndex++,
            data: buffer,
          });
        });

        readStream.on('end', () => {
          storeStream.end();
        });

        readStream.on('error', (err) => {
          storeStream.cancel();
          reject(err);
        });
      });

      await replicationPromise;

      console.log(`[StorageNode:${this.nodeId}] P2P Replication of model ${modelId} to ${targetNodeId} SUCCESS (${bytesReplicated} bytes)`);

      // Log communication operation
      DistributedLogger.logComm({
        source: this.nodeId,
        target: targetNodeId,
        protocol: 'gRPC (P2P)',
        operation: 'REPLICATE_MODEL',
        status: 'SUCCESS',
        details: `Replicated ${filename} (${bytesReplicated} bytes)`,
      });

      callback(null, {
        success: true,
        message: `Successfully replicated model ${modelId} to ${targetNodeId}`,
        bytesReplicated,
        checksum: targetChecksum,
        sourceNodeId: this.nodeId,
        targetNodeId,
      });
    } catch (err) {
      console.error(`[StorageNode:${this.nodeId}] P2P Replication failed:`, err.message);

      DistributedLogger.logComm({
        source: this.nodeId,
        target: targetNodeId,
        protocol: 'gRPC (P2P)',
        operation: 'REPLICATE_MODEL',
        status: 'FAILED',
        details: err.message,
      });

      callback(null, {
        success: false,
        message: `P2P replication failed: ${err.message}`,
        bytesReplicated: 0,
        checksum: '',
        sourceNodeId: this.nodeId,
        targetNodeId,
      });
    }
  }

  // Node status reporting
  async handleGetStatus(call, callback) {
    try {
      const stats = await this.fileManager.getStorageStats();
      const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

      callback(null, {
        nodeId: this.nodeId,
        status: 'ONLINE',
        totalStorageBytes: stats.totalStorageBytes,
        usedStorageBytes: stats.usedStorageBytes,
        availableStorageBytes: stats.availableStorageBytes,
        storedModelsCount: stats.storedModelsCount,
        uptimeSeconds,
        storedModelIds: stats.storedModelIds,
      });
    } catch (err) {
      console.error(`[StorageNode:${this.nodeId}] GetStatus error:`, err);
      callback(err);
    }
  }

  // Delete model file
  async handleDeleteModelFile(call, callback) {
    const { modelId, filename } = call.request;
    try {
      const deleted = await this.fileManager.deleteFile(modelId, filename);
      console.log(`[StorageNode:${this.nodeId}] Deleted file for model ${modelId}: ${deleted ? 'YES' : 'NOT FOUND'}`);

      callback(null, {
        success: true,
        message: deleted ? 'File deleted successfully' : 'File was not present on this node',
      });
    } catch (err) {
      console.error(`[StorageNode:${this.nodeId}] Delete error:`, err);
      callback(err);
    }
  }

  // Ping health check
  handleHealthCheck(call, callback) {
    callback(null, {
      timestamp: new Date().toISOString(),
      nodeId: this.nodeId,
      status: 'ONLINE',
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.tryShutdown(() => {
          console.log(`[StorageNode:${this.nodeId}] gRPC server stopped.`);
          resolve();
        });
      });
    }
  }
}

module.exports = StorageNodeServer;
