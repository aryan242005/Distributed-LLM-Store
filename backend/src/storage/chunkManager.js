const config = require('../config/config');

const ChunkManager = {
  CHUNK_SIZE: config.storage.chunkSize,

  createChunkPayload({ modelId, filename, chunkIndex, totalChunks = -1, data, totalSize = 0, checksum = '' }) {
    return {
      modelId,
      filename,
      chunkIndex,
      totalChunks,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      checksum,
      totalSize,
    };
  },

  calculateTotalChunks(fileSizeBytes, chunkSize = config.storage.chunkSize) {
    return Math.ceil(fileSizeBytes / chunkSize);
  }
};

module.exports = ChunkManager;
