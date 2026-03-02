const koffi = require('koffi')
const path = require('path')

// Load assimp DLL
const dllPath = path.join(__dirname, 'bin', 'assimp-vc143-mt.dll')
console.log('Loading DLL:', dllPath)
const lib = koffi.load(dllPath)

// Define basic types
const aiVector3D = koffi.struct('aiVector3D', {
  x: 'float', y: 'float', z: 'float'
})

const aiColor4D = koffi.struct('aiColor4D', {
  r: 'float', g: 'float', b: 'float', a: 'float'
})

const aiFace = koffi.struct('aiFace', {
  mNumIndices: 'uint32',
  mIndices: 'uint32 *'
})

// aiString: size_t (8 bytes on x64) + char[1024]
const aiString = koffi.struct('aiString', {
  length: 'ulong',  // size_t on Windows x64 = unsigned long long, but koffi 'ulong' is 4 bytes... use uint64
})
// Actually, let's use opaque pointer for complex types and read fields manually

// Import functions
const aiImportFile = lib.func('const void *aiImportFile(const char *path, uint32 flags)')
const aiReleaseImport = lib.func('void aiReleaseImport(const void *scene)')
const aiGetErrorString = lib.func('const char *aiGetErrorString()')

// Post-processing flags
const aiProcess_Triangulate = 0x8
const aiProcess_JoinIdenticalVertices = 0x2
const aiProcess_GenNormals = 0x20
const aiProcess_SortByPType = 0x8000
const flags = aiProcess_Triangulate | aiProcess_JoinIdenticalVertices | aiProcess_GenNormals | aiProcess_SortByPType

// Test with the FBX file
const fbxFile = path.join(__dirname, 'teste', 'test.fbx')
console.log('Importing:', fbxFile)
console.log('File size: ~2.7 GB')
console.log('This uses native C++ Assimp library - no JS memory limits!')
console.log('')

const startTime = Date.now()
const scenePtr = aiImportFile(fbxFile, flags)

if (!scenePtr) {
  const err = aiGetErrorString()
  console.error('Failed to import:', err)
  process.exit(1)
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`Import succeeded in ${elapsed}s!`)
console.log('Scene pointer:', scenePtr)

// Read scene fields using koffi.decode
// aiScene layout (x64):
// offset 0:  mFlags (uint32)
// offset 4:  padding
// offset 8:  mRootNode (pointer)
// offset 16: mNumMeshes (uint32)
// offset 20: padding
// offset 24: mMeshes (pointer to array of mesh pointers)
// offset 32: mNumMaterials (uint32)

const mNumMeshes = koffi.decode(scenePtr, 16, 'uint32')
const mNumMaterials = koffi.decode(scenePtr, 32, 'uint32')
console.log('Num meshes:', mNumMeshes)
console.log('Num materials:', mNumMaterials)

if (mNumMeshes > 0) {
  // Read mMeshes pointer (offset 24)
  const meshesPtr = koffi.decode(scenePtr, 24, 'void *')

  // Read first mesh pointer
  const meshPtr = koffi.decode(meshesPtr, 0, 'void *')

  // aiMesh layout (x64):
  // offset 0:  mPrimitiveTypes (uint32)
  // offset 4:  mNumVertices (uint32)
  // offset 8:  mNumFaces (uint32)
  // offset 12: padding
  // offset 16: mVertices (aiVector3D*)
  // offset 24: mNormals (aiVector3D*)

  const mNumVertices = koffi.decode(meshPtr, 4, 'uint32')
  const mNumFaces = koffi.decode(meshPtr, 8, 'uint32')
  console.log('\nFirst mesh:')
  console.log('  Vertices:', mNumVertices)
  console.log('  Faces:', mNumFaces)

  if (mNumVertices > 0) {
    // Read mVertices pointer (offset 16)
    const verticesPtr = koffi.decode(meshPtr, 16, 'void *')
    // Read first vertex (3 floats at offset 0)
    const v0x = koffi.decode(verticesPtr, 0, 'float')
    const v0y = koffi.decode(verticesPtr, 4, 'float')
    const v0z = koffi.decode(verticesPtr, 8, 'float')
    console.log(`  First vertex: (${v0x.toFixed(3)}, ${v0y.toFixed(3)}, ${v0z.toFixed(3)})`)
  }
}

// Count total vertices/faces across all meshes
let totalVertices = 0
let totalFaces = 0
if (mNumMeshes > 0) {
  const meshesPtr = koffi.decode(scenePtr, 24, 'void *')
  for (let i = 0; i < Math.min(mNumMeshes, 10); i++) {
    const meshPtr = koffi.decode(meshesPtr, i * 8, 'void *')
    totalVertices += koffi.decode(meshPtr, 4, 'uint32')
    totalFaces += koffi.decode(meshPtr, 8, 'uint32')
  }
  if (mNumMeshes > 10) {
    console.log(`\n(Showing first 10 of ${mNumMeshes} meshes, totals are partial)`)
  }
}
console.log(`\nTotal vertices (sampled): ${totalVertices.toLocaleString()}`)
console.log(`Total faces (sampled): ${totalFaces.toLocaleString()}`)

aiReleaseImport(scenePtr)
console.log('\nDone! Scene released.')
