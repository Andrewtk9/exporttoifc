const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'teste', '2140-Maquete 3D-R34 - 020125 - Astral - Novos ZC Compatibilização_P01.fbx');

console.log('File exists:', fs.existsSync(filePath));
const size = fs.statSync(filePath).size;
console.log('File size:', size, 'bytes', (size / 1024 / 1024).toFixed(0), 'MB');

console.log('\n--- Test 1: ArrayBuffer allocation ---');
try {
  const ab = new ArrayBuffer(size);
  console.log('SUCCESS: ArrayBuffer allocated', ab.byteLength, 'bytes');
} catch(e) {
  console.error('FAILED:', e.message);
}

console.log('\n--- Test 2: Read file in chunks ---');
(async () => {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    const ab = new ArrayBuffer(size);
    const view = new Uint8Array(ab);
    const CHUNK = 128 * 1024 * 1024;
    let offset = 0;

    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const chunk = Buffer.alloc(len);
      const { bytesRead } = await fd.read(chunk, 0, len, offset);
      view.set(new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead), offset);
      offset += bytesRead;
      console.log('Read', Math.round(offset/size*100) + '%');
    }

    await fd.close();
    console.log('SUCCESS: File read completely into ArrayBuffer');

    console.log('\n--- Test 3: FBXLoader parse ---');
    const THREE = require('three');
    const { FBXLoader } = require('three/examples/jsm/loaders/FBXLoader.js');
    const loader = new FBXLoader();
    console.log('Parsing FBX...');
    const group = loader.parse(ab, '');
    let meshCount = 0;
    group.traverse(c => { if (c.isMesh) meshCount++; });
    console.log('SUCCESS: Parsed', meshCount, 'meshes');

  } catch(e) {
    console.error('FAILED:', e.message);
    console.error(e.stack);
  }
})();
