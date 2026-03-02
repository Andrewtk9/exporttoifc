// Test that replicates EXACTLY what parser.ts does in the Electron app
// Uses spawn('node', ...) with IPC, same as the app

const { spawn } = require('child_process');
const path = require('path');

const workerPath = path.join(__dirname, 'out/main/parser-worker.js');
const filePath = path.join(__dirname, 'teste/2140-Maquete 3D-R34 - 020125 - Astral - Novos ZC Compatibilização_P01.fbx');

console.log('=== TEST: spawn("node") com IPC (igual o app Electron) ===');
console.log('Worker:', workerPath);
console.log('File:', filePath);
console.log('');

const startTime = Date.now();

// This is EXACTLY what parser.ts does:
const child = spawn('node', [
  '--max-old-space-size=15360',
  '--expose-gc',
  workerPath,
  filePath
], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

child.stdout.on('data', (d) => {
  process.stdout.write('[stdout] ' + d.toString());
});

child.stderr.on('data', (d) => {
  process.stderr.write('[stderr] ' + d.toString());
});

child.on('message', (msg) => {
  if (msg.type === 'progress') {
    process.stdout.write('\r[PROGRESS] ' + msg.message + '                         ');
  } else if (msg.type === 'result') {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n\n=== SUCESSO em ' + elapsed + 's ===');
    console.log('Meshes:', msg.data.meshes.length);
    console.log('Total vertices:', msg.data.totalVertices);
    console.log('Total faces:', msg.data.totalFaces);
    if (msg.data.meshes.length > 0) {
      console.log('Primeiro mesh:', msg.data.meshes[0].name, '- vertices:', msg.data.meshes[0].vertices.length / 3);
    }
    child.kill();
    process.exit(0);
  } else if (msg.type === 'error') {
    console.error('\n\n=== ERRO ===');
    console.error(msg.error);
    child.kill();
    process.exit(1);
  }
});

child.on('error', (err) => {
  console.error('\n[SPAWN ERROR]', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (code !== 0) {
    console.error('\n[EXIT] code:', code, 'signal:', signal, '(' + elapsed + 's)');
    console.error('Se code=134: falta de memoria. Feche outros programas.');
  }
});
