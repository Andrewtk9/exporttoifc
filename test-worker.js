const { fork } = require('child_process');
const path = require('path');

const workerPath = path.join(__dirname, 'out/main/parser-worker.js');
const filePath = path.join(__dirname, 'teste/2140-Maquete 3D-R34 - 020125 - Astral - Novos ZC Compatibilização_P01.fbx');

console.log('Worker:', workerPath);
console.log('File:', filePath);
console.log('File size: ~2.7 GB');
console.log('Starting worker with 12GB heap...\n');

const child = fork(workerPath, [filePath], {
  execArgv: ['--max-old-space-size=12288'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-old-space-size=12288' },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

child.stdout.on('data', (d) => process.stdout.write('[out] ' + d.toString()));
child.stderr.on('data', (d) => process.stderr.write('[err] ' + d.toString()));

child.on('message', (msg) => {
  if (msg.type === 'progress') {
    process.stdout.write('\r[PROGRESS] ' + msg.message + '                    ');
  } else if (msg.type === 'result') {
    console.log('\n\n=== SUCESSO ===');
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
  console.error('\n[CHILD ERROR]', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error('\n[EXIT] code:', code, 'signal:', signal);
  }
});
