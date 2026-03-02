// Test the streaming FBX reader
// This reads directly from disk without loading the full file into memory

const path = require('path')

// We need to build first since this is TypeScript
// For now, let's write a JS version of the streaming reader inline

const fs = require('fs')
const zlib = require('zlib')

const FBX_MAGIC = 'Kaydara FBX Binary\x20\x20\x00\x1a\x00'

async function readBytes(fd, position, length) {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fd.read(buf, 0, length, position)
  if (bytesRead < length) throw new Error(`Expected ${length} bytes at ${position}, got ${bytesRead}`)
  return buf
}

async function readNodeHeader(fd, pos, is64) {
  const headerSize = is64 ? 25 : 13
  const buf = await readBytes(fd, pos, headerSize)
  let offset = 0
  let endOffset, numProperties, propertyListLen

  if (is64) {
    endOffset = Number(buf.readBigUInt64LE(offset)); offset += 8
    numProperties = Number(buf.readBigUInt64LE(offset)); offset += 8
    propertyListLen = Number(buf.readBigUInt64LE(offset)); offset += 8
  } else {
    endOffset = buf.readUInt32LE(offset); offset += 4
    numProperties = buf.readUInt32LE(offset); offset += 4
    propertyListLen = buf.readUInt32LE(offset); offset += 4
  }

  const nameLen = buf.readUInt8(offset)
  if (endOffset === 0) return null

  const nameBuf = await readBytes(fd, pos + headerSize, nameLen)
  const name = nameBuf.toString('ascii')

  return { endOffset, numProperties, propertyListLen, nameLen, name, dataStart: pos + headerSize + nameLen }
}

async function readProperty(fd, pos) {
  const typeBuf = await readBytes(fd, pos, 1)
  const type = String.fromCharCode(typeBuf[0])
  pos += 1

  switch (type) {
    case 'Y': { const buf = await readBytes(fd, pos, 2); return { value: buf.readInt16LE(0), nextPos: pos + 2 } }
    case 'C': { const buf = await readBytes(fd, pos, 1); return { value: buf[0] !== 0, nextPos: pos + 1 } }
    case 'I': { const buf = await readBytes(fd, pos, 4); return { value: buf.readInt32LE(0), nextPos: pos + 4 } }
    case 'F': { const buf = await readBytes(fd, pos, 4); return { value: buf.readFloatLE(0), nextPos: pos + 4 } }
    case 'D': { const buf = await readBytes(fd, pos, 8); return { value: buf.readDoubleLE(0), nextPos: pos + 8 } }
    case 'L': { const buf = await readBytes(fd, pos, 8); return { value: Number(buf.readBigInt64LE(0)), nextPos: pos + 8 } }
    case 'S': {
      const lenBuf = await readBytes(fd, pos, 4)
      const len = lenBuf.readUInt32LE(0)
      pos += 4
      if (len > 0) {
        const strBuf = await readBytes(fd, pos, len)
        let str = strBuf.toString('utf-8')
        if (str.includes('\x00\x01')) str = str.split('\x00\x01').reverse().join('::')
        return { value: str, nextPos: pos + len }
      }
      return { value: '', nextPos: pos }
    }
    case 'R': {
      const lenBuf = await readBytes(fd, pos, 4)
      const len = lenBuf.readUInt32LE(0)
      return { value: null, nextPos: pos + 4 + len }
    }
    case 'f': case 'd': case 'l': case 'i': case 'b': case 'c': {
      const hdr = await readBytes(fd, pos, 12)
      const arrayLength = hdr.readUInt32LE(0)
      const encoding = hdr.readUInt32LE(4)
      const compressedLength = hdr.readUInt32LE(8)
      pos += 12

      const rawBuf = await readBytes(fd, pos, compressedLength)
      const data = encoding === 1 ? zlib.inflateSync(rawBuf) : rawBuf

      const result = new Array(arrayLength)
      if (type === 'd') { for (let i = 0; i < arrayLength; i++) result[i] = data.readDoubleLE(i * 8) }
      else if (type === 'f') { for (let i = 0; i < arrayLength; i++) result[i] = data.readFloatLE(i * 4) }
      else if (type === 'i') { for (let i = 0; i < arrayLength; i++) result[i] = data.readInt32LE(i * 4) }
      else if (type === 'l') { for (let i = 0; i < arrayLength; i++) result[i] = Number(data.readBigInt64LE(i * 8)) }
      else { for (let i = 0; i < arrayLength; i++) result[i] = data[i] }

      return { value: result, nextPos: pos + compressedLength }
    }
    default: {
      throw new Error(`Unknown FBX property type: '${type}' (0x${typeBuf[0].toString(16)})`)
    }
  }
}

async function readAllProperties(fd, header) {
  const props = []
  let pos = header.dataStart
  for (let i = 0; i < header.numProperties; i++) {
    try {
      const { value, nextPos } = await readProperty(fd, pos)
      props.push(value)
      pos = nextPos
    } catch (e) {
      console.warn(`  [WARN] Skipping property ${i}: ${e.message}`)
      return props
    }
  }
  return props
}

function skipProperties(header) {
  return header.dataStart + header.propertyListLen
}

async function findChildNodes(fd, header, is64) {
  const children = []
  let pos = skipProperties(header)
  const nullRecordSize = is64 ? 25 : 13
  while (pos + nullRecordSize < header.endOffset) {
    const child = await readNodeHeader(fd, pos, is64)
    if (child === null) break
    children.push(child)
    pos = child.endOffset
  }
  return children
}

function polygonIndicesToTriangles(polyIndices) {
  const triangles = []
  let polyStart = 0
  for (let i = 0; i < polyIndices.length; i++) {
    if (polyIndices[i] < 0) {
      const lastIdx = -(polyIndices[i] + 1)
      const polyVerts = []
      for (let j = polyStart; j < i; j++) polyVerts.push(polyIndices[j])
      polyVerts.push(lastIdx)
      for (let j = 1; j < polyVerts.length - 1; j++) {
        triangles.push(polyVerts[0], polyVerts[j], polyVerts[j + 1])
      }
      polyStart = i + 1
    }
  }
  return triangles
}

async function main() {
  const filePath = path.join(__dirname, 'teste', 'test.fbx')
  console.log('=== FBX Streaming Reader Test ===')
  console.log('File:', filePath)
  console.log('This reads from DISK - does NOT load 2.7GB into RAM!\n')

  const startTime = Date.now()

  const fd = await fs.promises.open(filePath, 'r')
  const stats = await fd.stat()
  console.log(`File size: ${(stats.size / (1024 * 1024)).toFixed(0)} MB`)

  // Verify magic
  const magicBuf = await readBytes(fd, 0, FBX_MAGIC.length)
  if (magicBuf.toString('binary') !== FBX_MAGIC) throw new Error('Not a binary FBX file')

  // Read version
  const versionBuf = await readBytes(fd, FBX_MAGIC.length, 4)
  const version = versionBuf.readUInt32LE(0)
  const is64 = version >= 7500
  console.log(`FBX version: ${version} (${is64 ? '64-bit' : '32-bit'} offsets)`)

  // Find top-level nodes
  let pos = FBX_MAGIC.length + 4
  const nullRecordSize = is64 ? 25 : 13
  let objectsNode = null

  console.log('\nScanning top-level nodes...')
  while (pos + nullRecordSize < stats.size) {
    const node = await readNodeHeader(fd, pos, is64)
    if (node === null) break
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`  [${elapsed}s] ${node.name} (ends at ${node.endOffset.toLocaleString()})`)
    if (node.name === 'Objects') objectsNode = node
    pos = node.endOffset
  }

  if (!objectsNode) throw new Error('Objects section not found')

  // Count geometry nodes
  console.log('\nScanning Objects for geometries...')
  let childPos = skipProperties(objectsNode)
  let geoCount = 0
  let modelCount = 0
  let matCount = 0
  const geoNodes = []

  while (childPos + nullRecordSize < objectsNode.endOffset) {
    const child = await readNodeHeader(fd, childPos, is64)
    if (child === null) break
    if (child.name === 'Geometry') { geoCount++; geoNodes.push(child) }
    else if (child.name === 'Model') modelCount++
    else if (child.name === 'Material') matCount++
    childPos = child.endOffset
  }

  console.log(`Found: ${geoCount} Geometries, ${modelCount} Models, ${matCount} Materials`)

  // Process first 5 geometries as a sample
  const maxSample = Math.min(5, geoNodes.length)
  let totalVertices = 0
  let totalFaces = 0
  let meshCount = 0

  console.log(`\nProcessing first ${maxSample} geometries...`)
  for (let gi = 0; gi < maxSample; gi++) {
    const geoNode = geoNodes[gi]
    const geoProps = await readAllProperties(fd, geoNode)
    const geoName = typeof geoProps[1] === 'string' ? geoProps[1].split('::').pop() : `Mesh_${gi}`

    // Find children
    const children = await findChildNodes(fd, geoNode, is64)
    let vertCount = 0
    let faceCount = 0

    for (const child of children) {
      if (child.name === 'Vertices') {
        const props = await readAllProperties(fd, child)
        if (props[0] && Array.isArray(props[0])) {
          vertCount = Math.floor(props[0].length / 3)
        }
      } else if (child.name === 'PolygonVertexIndex') {
        const props = await readAllProperties(fd, child)
        if (props[0] && Array.isArray(props[0])) {
          const triangles = polygonIndicesToTriangles(props[0])
          faceCount = Math.floor(triangles.length / 3)
        }
      }
    }

    totalVertices += vertCount
    totalFaces += faceCount
    if (vertCount > 0) meshCount++
    console.log(`  [${gi + 1}] "${geoName}" - ${vertCount.toLocaleString()} vertices, ${faceCount.toLocaleString()} faces`)
  }

  await fd.close()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n=== Results (${elapsed}s) ===`)
  console.log(`Valid meshes (sampled): ${meshCount}`)
  console.log(`Total vertices (sampled): ${totalVertices.toLocaleString()}`)
  console.log(`Total faces (sampled): ${totalFaces.toLocaleString()}`)
  console.log(`Total geometries in file: ${geoCount}`)
  console.log(`Memory used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB`)

  // Check RSS (total process memory)
  const rss = process.memoryUsage.rss ? process.memoryUsage.rss() : process.memoryUsage().rss
  console.log(`Process RSS: ${(rss / 1024 / 1024).toFixed(0)} MB`)
}

main().catch(err => {
  console.error('\nERRO:', err.message)
  process.exit(1)
})
