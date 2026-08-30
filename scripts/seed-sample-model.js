const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

async function seed() {
  console.log('================================================================');
  console.log('  Generating & Uploading Sample LLM Model File to Cluster      ');
  console.log('================================================================');

  const tempDir = path.resolve(__dirname, '../storage/temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const modelFilename = 'tiny-llama-q4.bin';
  const modelPath = path.join(tempDir, modelFilename);

  // Generate 5 MB of synthetic model weight data
  const fileSizeMB = 5;
  const targetBytes = fileSizeMB * 1024 * 1024;
  console.log(`Creating synthetic model file: ${modelFilename} (${fileSizeMB} MB)...`);

  const writeStream = fs.createWriteStream(modelPath);
  const hasher = crypto.createHash('sha256');

  // Header
  const header = Buffer.from('GGUF_MAGIC_WEIGHT_TENSORS_V1\n');
  writeStream.write(header);
  hasher.update(header);
  let bytesGenerated = header.length;

  while (bytesGenerated < targetBytes) {
    const chunk = crypto.randomBytes(64 * 1024);
    writeStream.write(chunk);
    hasher.update(chunk);
    bytesGenerated += chunk.length;
  }

  await new Promise((resolve) => writeStream.end(resolve));
  const expectedHash = hasher.digest('hex');

  console.log(`Generated ${bytesGenerated} bytes. Checksum: ${expectedHash}`);
  console.log('Uploading model to Coordinator at http://localhost:4000/api/models/upload ...');

  // Perform multipart upload using native Node http
  const boundary = '----ModelRepoBoundary' + Math.random().toString(36).substring(2);
  const fileData = fs.readFileSync(modelPath);

  const payloadHeader = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="name"\r\n\r\n` +
    `TinyLlama-1.1B-Q4\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: name="version"\r\n\r\n` +
    `1.0.0\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: name="description"\r\n\r\n` +
    `4-bit quantized synthetic LLM test weights for distributed replication validation\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: name="replicationFactor"\r\n\r\n` +
    `3\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${modelFilename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );

  const payloadFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fullBody = Buffer.concat([payloadHeader, fileData, payloadFooter]);

  const req = http.request(
    {
      hostname: 'localhost',
      port: 4000,
      path: '/api/models/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) {
            console.log('\n[SUCCESS] Model successfully uploaded and replicated!');
            console.log('Model ID:', json.data.model.id);
            console.log('Primary Node:', json.data.primaryNode);
            console.log('Replica Nodes:', json.data.replicaNodes.join(', '));
            console.log('Checksum Verified:', json.data.checksum);
            console.log('\nOpen http://localhost:3000 to view your distributed model repository!');
          } else {
            console.error('[ERROR] Upload failed:', json.error);
          }
        } catch (err) {
          console.error('[ERROR] Response parse error:', data);
        }
      });
    }
  );

  req.on('error', (err) => {
    console.error('[ERROR] Could not connect to coordinator at localhost:4000:', err.message);
    console.log('Please ensure cluster is running via: npm start');
  });

  req.write(fullBody);
  req.end();
}

seed();
