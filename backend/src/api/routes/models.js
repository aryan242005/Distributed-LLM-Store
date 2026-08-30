const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const coordinator = require('../../coordinator/coordinator');
const Model = require('../../database/models/Model');
const config = require('../../config/config');

// Setup multer temporary disk storage for file uploads
const tempUploadDir = config.storage.tempUploadDir;
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const upload = multer({
  dest: tempUploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10 GB limit
  },
});

// GET /api/models - List all models
router.get('/', async (req, res) => {
  try {
    const { scanAndSyncPhysicalModels } = require('../../database/connection');
    if (scanAndSyncPhysicalModels) {
      await scanAndSyncPhysicalModels();
    }
    const models = await Model.getAll();
    res.json({ success: true, count: models.length, data: models });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/models/:id - Get model details
router.get('/:id', async (req, res) => {
  try {
    const model = await Model.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ success: false, error: 'Model not found' });
    }
    res.json({ success: true, data: model });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/models/upload - Upload model file and stream to storage nodes
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No model file provided' });
    }

    const { name, version = '1.0', description = '', replicationFactor = '3' } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Model name is required' });
    }

    const originalFilename = req.file.originalname || 'model.bin';
    const tempFilePath = req.file.path;
    const fileSizeBytes = req.file.size;

    // Create a read stream from the uploaded temp file
    const fileStream = fs.createReadStream(tempFilePath);

    console.log(`[REST API] Upload received: "${name}" v${version} (${fileSizeBytes} bytes, file: ${originalFilename})`);

    const result = await coordinator.uploadModel({
      name,
      version,
      description,
      replicationFactor: parseInt(replicationFactor, 10),
      fileStream,
      originalFilename,
      fileSizeBytes,
    });

    // Clean up temporary upload file
    try {
      if (fs.existsSync(tempFilePath)) {
        await fs.promises.unlink(tempFilePath);
      }
    } catch (e) {}

    res.status(201).json({
      success: true,
      message: 'Model uploaded and replication initiated successfully',
      data: result,
    });
  } catch (err) {
    console.error('[REST API] Upload failed:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      try { await fs.promises.unlink(req.file.path); } catch (e) {}
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/models/:id/download - Stream download model from an active storage node
router.get('/:id/download', async (req, res) => {
  try {
    const { model, servingNode, grpcStream } = await coordinator.downloadModel(req.params.id);

    res.setHeader('Content-Disposition', `attachment; filename="${model.filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', model.size_bytes);
    res.setHeader('X-Serving-Node', servingNode);
    res.setHeader('X-Model-Checksum', model.checksum);

    grpcStream.on('data', (chunk) => {
      if (chunk.data && chunk.data.length > 0) {
        res.write(chunk.data);
      }
    });

    grpcStream.on('end', () => {
      res.end();
    });

    grpcStream.on('error', (err) => {
      console.error('[REST API] Download stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.end();
      }
    });

    req.on('close', () => {
      grpcStream.cancel();
    });
  } catch (err) {
    console.error('[REST API] Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/models/:id - Delete model and its replicas across all storage nodes
router.delete('/:id', async (req, res) => {
  try {
    await coordinator.deleteModel(req.params.id);
    res.json({ success: true, message: 'Model and replicas deleted successfully' });
  } catch (err) {
    console.error('[REST API] Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
