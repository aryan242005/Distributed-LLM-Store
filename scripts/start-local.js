const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');

// Ensure storage directories exist
['node-1', 'node-2', 'node-3', 'temp'].forEach((dir) => {
  const p = path.join(rootDir, 'storage', dir);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
});

console.log('================================================================');
console.log('  Distributed Model Repository & LLM Weight Storage Cluster    ');
console.log('================================================================');
console.log('Launching 1 Coordinator Server + 3 Storage Nodes + Frontend UI');
console.log('----------------------------------------------------------------');

const processes = [];

function runProcess(name, cmd, args, env, cwd, colorCode) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.log(`\x1b[${colorCode}m[${name}]\x1b[0m ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.error(`\x1b[${colorCode}m[${name}:ERR]\x1b[0m ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`\x1b[${colorCode}m[${name}]\x1b[0m exited with code ${code}`);
  });

  processes.push({ name, child });
  return child;
}

// 1. Start Storage Node 1 (port 5001)
runProcess(
  'NODE-1',
  'node',
  ['src/storage/index.js'],
  {
    NODE_ID: 'node-1',
    NODE_PORT: '5001',
    NODE_HOST: '0.0.0.0',
    NODE_ADDRESS: 'localhost',
    STORAGE_PATH: path.join(rootDir, 'storage', 'node-1'),
    COORDINATOR_URL: 'http://localhost:4000',
  },
  backendDir,
  '32' // Green
);

// 2. Start Storage Node 2 (port 5002)
runProcess(
  'NODE-2',
  'node',
  ['src/storage/index.js'],
  {
    NODE_ID: 'node-2',
    NODE_PORT: '5002',
    NODE_HOST: '0.0.0.0',
    NODE_ADDRESS: 'localhost',
    STORAGE_PATH: path.join(rootDir, 'storage', 'node-2'),
    COORDINATOR_URL: 'http://localhost:4000',
  },
  backendDir,
  '36' // Cyan
);

// 3. Start Storage Node 3 (port 5003)
runProcess(
  'NODE-3',
  'node',
  ['src/storage/index.js'],
  {
    NODE_ID: 'node-3',
    NODE_PORT: '5003',
    NODE_HOST: '0.0.0.0',
    NODE_ADDRESS: 'localhost',
    STORAGE_PATH: path.join(rootDir, 'storage', 'node-3'),
    COORDINATOR_URL: 'http://localhost:4000',
  },
  backendDir,
  '35' // Magenta
);

// 4. Start Coordinator Server after slight delay to ensure storage nodes are ready
setTimeout(() => {
  runProcess(
    'COORD',
    'node',
    ['src/api/server.js'],
    {
      COORDINATOR_PORT: '4000',
      NODE_1_HOST: 'localhost',
      NODE_1_PORT: '5001',
      NODE_2_HOST: 'localhost',
      NODE_2_PORT: '5002',
      NODE_3_HOST: 'localhost',
      NODE_3_PORT: '5003',
    },
    backendDir,
    '33' // Yellow
  );
}, 1000);

// 5. Start Frontend Dev Server
setTimeout(() => {
  runProcess(
    'FRONT',
    'npm',
    ['run', 'dev'],
    {},
    frontendDir,
    '34' // Blue
  );
}, 1500);

// Graceful cleanup on Ctrl+C
function cleanup() {
  console.log('\nStopping all cluster processes...');
  processes.forEach(({ name, child }) => {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
      } else {
        child.kill('SIGINT');
      }
    } catch (e) {}
  });
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
