const { spawn } = require('child_process');
const fs = require('fs');

const TOKEN = "eyJhIjoiYjNmODAxZjk0NTJkOGM4ODRhZmQ5MTIzMjhhZDQ5NDUiLCJ0IjoiNDVlZWU3ZTUtMWY3Ni00NDlmLWIwZGUtYzU2YmZmZTdhODY1IiwicyI6IllUTTBaamMzTW1JdFpqZzNOaTAwWW1ZMkxXSmtNakV0TVRsa01EYzNPRGM0WWpFeSJ9";

console.log("[Cloudflare] Starting Named Tunnel for gakon.dev with token...");

let cloudflaredCmd = 'cloudflared';
const defaultWinPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
if (fs.existsSync(defaultWinPath)) {
  cloudflaredCmd = `"${defaultWinPath}"`;
}

const cloudflaredProcess = spawn(cloudflaredCmd, ['tunnel', 'run', '--token', TOKEN], {
  shell: true,
  stdio: 'inherit'
});

cloudflaredProcess.on('close', (code) => {
  console.log(`[Cloudflare] Process exited with code ${code}`);
  process.exit(code || 0);
});
