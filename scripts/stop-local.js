const { execSync } = require('child_process');

console.log('Stopping any lingering node services on ports 4000, 5001, 5002, 5003, 3000...');

const ports = [4000, 5001, 5002, 5003, 3000];

ports.forEach((port) => {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const lines = output.trim().split('\n');
      lines.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && !isNaN(pid)) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            console.log(`Terminated process on port ${port} (PID: ${pid})`);
          } catch (e) {}
        }
      });
    } else {
      execSync(`lsof -t -i:${port} | xargs kill -9`, { stdio: 'ignore' });
    }
  } catch (e) {}
});

console.log('Cluster stop complete.');
