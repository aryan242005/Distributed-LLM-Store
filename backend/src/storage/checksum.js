const crypto = require('crypto');
const fs = require('fs');

const ChecksumUtil = {
  createHasher() {
    return crypto.createHash('sha256');
  },

  async calculateFileChecksum(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  },

  calculateBufferChecksum(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  },

  verify(actual, expected) {
    return actual.toLowerCase() === expected.toLowerCase();
  }
};

module.exports = ChecksumUtil;
