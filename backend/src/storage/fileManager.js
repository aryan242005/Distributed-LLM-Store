const fs = require('fs');
const path = require('path');

class FileManager {
  constructor(baseStorageDir) {
    this.baseDir = path.resolve(baseStorageDir);
    this.modelsDir = path.join(this.baseDir, 'models');
    this.tempDir = path.join(this.baseDir, 'temp');
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  getFilePath(modelId, filename) {
    // Sanitize filename to prevent path traversal
    const safeFilename = path.basename(filename);
    return path.join(this.modelsDir, `${modelId}_${safeFilename}`);
  }

  getTempFilePath(modelId, filename) {
    const safeFilename = path.basename(filename);
    return path.join(this.tempDir, `temp_${modelId}_${safeFilename}`);
  }

  fileExists(modelId, filename) {
    const target = this.getFilePath(modelId, filename);
    return fs.existsSync(target);
  }

  createWriteStream(modelId, filename) {
    const target = this.getFilePath(modelId, filename);
    return fs.createWriteStream(target);
  }

  createReadStream(modelId, filename, options = {}) {
    const target = this.getFilePath(modelId, filename);
    if (!fs.existsSync(target)) {
      throw new Error(`Model file not found on node: ${target}`);
    }
    return fs.createReadStream(target, options);
  }

  async deleteFile(modelId, filename) {
    const target = this.getFilePath(modelId, filename);
    if (fs.existsSync(target)) {
      await fs.promises.unlink(target);
      return true;
    }
    return false;
  }

  async getStorageStats() {
    let usedBytes = 0;
    let storedModelIds = [];

    if (fs.existsSync(this.modelsDir)) {
      const files = await fs.promises.readdir(this.modelsDir);
      for (const file of files) {
        const filePath = path.join(this.modelsDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile()) {
            usedBytes += stat.size;
            const modelId = file.split('_')[0];
            if (modelId && !storedModelIds.includes(modelId)) {
              storedModelIds.push(modelId);
            }
          }
        } catch (e) {}
      }
    }

    // Default 100 GB total capacity for mock/local visualization
    const totalBytes = 100 * 1024 * 1024 * 1024;
    const availableBytes = Math.max(0, totalBytes - usedBytes);

    return {
      usedStorageBytes: usedBytes,
      totalStorageBytes: totalBytes,
      availableStorageBytes: availableBytes,
      storedModelsCount: storedModelIds.length,
      storedModelIds,
    };
  }
}

module.exports = FileManager;
