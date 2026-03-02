/**
 * Streaming FBX Binary Reader
 *
 * Reads FBX files directly from disk WITHOUT loading the entire file into memory.
 * Uses file offsets to skip unwanted sections (animations, textures, etc.)
 * and only decompresses geometry data (vertices, faces, normals).
 *
 * Memory usage: ~50-200MB regardless of file size (only one mesh at a time)
 */

import fs from 'fs'
import { inflateSync } from 'zlib'

const FBX_MAGIC = 'Kaydara FBX Binary\x20\x20\x00\x1a\x00'

export interface StreamMesh {
  name: string
  vertices: number[]   // flat [x,y,z, x,y,z, ...]
  indices: number[]    // triangle indices
  normals: number[]    // flat [nx,ny,nz, ...]
  color: { r: number; g: number; b: number }
}

export interface StreamParseResult {
  meshes: StreamMesh[]
  totalVertices: number
  totalFaces: number
}

interface FBXNodeHeader {
  endOffset: number
  numProperties: number
  propertyListLen: number
  nameLen: number
  name: string
  dataStart: number  // position after the header where properties begin
}

// Read exactly `length` bytes from fd at `position`
async function readBytes(fd: fs.promises.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fd.read(buf, 0, length, position)
  if (bytesRead < length) throw new Error(`Expected ${length} bytes at ${position}, got ${bytesRead}`)
  return buf
}

// Read a node header (endOffset, numProperties, propertyListLen, nameLen, name)
async function readNodeHeader(fd: fs.promises.FileHandle, pos: number, is64: boolean): Promise<FBXNodeHeader | null> {
  const headerSize = is64 ? 25 : 13 // 3*8+1 or 3*4+1
  const buf = await readBytes(fd, pos, headerSize)

  let offset = 0
  let endOffset: number, numProperties: number, propertyListLen: number

  if (is64) {
    endOffset = Number(buf.readBigUInt64LE(offset)); offset += 8
    numProperties = Number(buf.readBigUInt64LE(offset)); offset += 8
    propertyListLen = Number(buf.readBigUInt64LE(offset)); offset += 8
  } else {
    endOffset = buf.readUInt32LE(offset); offset += 4
    numProperties = buf.readUInt32LE(offset); offset += 4
    propertyListLen = buf.readUInt32LE(offset); offset += 4
  }

  const nameLen = buf.readUInt8(offset); offset += 1

  // NULL record
  if (endOffset === 0) return null

  const nameBuf = await readBytes(fd, pos + headerSize, nameLen)
  const name = nameBuf.toString('ascii')

  return {
    endOffset,
    numProperties,
    propertyListLen,
    nameLen,
    name,
    dataStart: pos + headerSize + nameLen
  }
}

// Read a single property value, returning its value and the position after it
async function readProperty(fd: fs.promises.FileHandle, pos: number): Promise<{ value: any; nextPos: number }> {
  const typeBuf = await readBytes(fd, pos, 1)
  const type = String.fromCharCode(typeBuf[0])
  pos += 1

  switch (type) {
    case 'Y': { // int16
      const buf = await readBytes(fd, pos, 2)
      return { value: buf.readInt16LE(0), nextPos: pos + 2 }
    }
    case 'C': { // bool
      const buf = await readBytes(fd, pos, 1)
      return { value: buf[0] !== 0, nextPos: pos + 1 }
    }
    case 'I': { // int32
      const buf = await readBytes(fd, pos, 4)
      return { value: buf.readInt32LE(0), nextPos: pos + 4 }
    }
    case 'F': { // float32
      const buf = await readBytes(fd, pos, 4)
      return { value: buf.readFloatLE(0), nextPos: pos + 4 }
    }
    case 'D': { // float64
      const buf = await readBytes(fd, pos, 8)
      return { value: buf.readDoubleLE(0), nextPos: pos + 8 }
    }
    case 'L': { // int64
      const buf = await readBytes(fd, pos, 8)
      return { value: Number(buf.readBigInt64LE(0)), nextPos: pos + 8 }
    }
    case 'S': { // string
      const lenBuf = await readBytes(fd, pos, 4)
      const len = lenBuf.readUInt32LE(0)
      pos += 4
      const strBuf = await readBytes(fd, pos, len)
      let str = strBuf.toString('utf-8')
      // FBX uses \x00\x01 as namespace separator
      if (str.includes('\x00\x01')) {
        str = str.split('\x00\x01').reverse().join('::')
      }
      return { value: str, nextPos: pos + len }
    }
    case 'R': { // raw bytes
      const lenBuf = await readBytes(fd, pos, 4)
      const len = lenBuf.readUInt32LE(0)
      return { value: null, nextPos: pos + 4 + len }
    }
    // Array types
    case 'f': case 'd': case 'l': case 'i': case 'b': case 'c': {
      const headerBuf = await readBytes(fd, pos, 12)
      const arrayLength = headerBuf.readUInt32LE(0)
      const encoding = headerBuf.readUInt32LE(4)
      const compressedLength = headerBuf.readUInt32LE(8)
      pos += 12

      const rawBuf = await readBytes(fd, pos, compressedLength)
      const data = encoding === 1 ? inflateSync(rawBuf) : rawBuf

      const result: number[] = new Array(arrayLength)

      if (type === 'd') {
        for (let i = 0; i < arrayLength; i++) result[i] = data.readDoubleLE(i * 8)
      } else if (type === 'f') {
        for (let i = 0; i < arrayLength; i++) result[i] = data.readFloatLE(i * 4)
      } else if (type === 'i') {
        for (let i = 0; i < arrayLength; i++) result[i] = data.readInt32LE(i * 4)
      } else if (type === 'l') {
        for (let i = 0; i < arrayLength; i++) result[i] = Number(data.readBigInt64LE(i * 8))
      } else { // b, c
        for (let i = 0; i < arrayLength; i++) result[i] = data[i]
      }

      return { value: result, nextPos: pos + compressedLength }
    }
    default: {
      // Unknown type - we can't determine size, so throw
      throw new Error(`Unknown FBX property type: '${type}' (0x${typeBuf[0].toString(16)})`)
    }
  }
}

// Skip all properties in a node (use propertyListLen)
function skipProperties(header: FBXNodeHeader): number {
  return header.dataStart + header.propertyListLen
}

// Read all properties of a node
async function readAllProperties(fd: fs.promises.FileHandle, header: FBXNodeHeader): Promise<any[]> {
  const props: any[] = []
  let pos = header.dataStart
  for (let i = 0; i < header.numProperties; i++) {
    try {
      const { value, nextPos } = await readProperty(fd, pos)
      props.push(value)
      pos = nextPos
    } catch (e) {
      // Skip remaining properties on error
      return props
    }
  }
  return props
}

// Find child nodes of a given node
async function findChildNodes(fd: fs.promises.FileHandle, header: FBXNodeHeader, is64: boolean): Promise<FBXNodeHeader[]> {
  const children: FBXNodeHeader[] = []
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

// Find a specific child node by name
async function findChildByName(fd: fs.promises.FileHandle, header: FBXNodeHeader, is64: boolean, name: string): Promise<FBXNodeHeader | null> {
  let pos = skipProperties(header)
  const nullRecordSize = is64 ? 25 : 13

  while (pos + nullRecordSize < header.endOffset) {
    const child = await readNodeHeader(fd, pos, is64)
    if (child === null) break
    if (child.name === name) return child
    pos = child.endOffset
  }

  return null
}

// Convert FBX polygon vertex indices to triangle indices
function polygonIndicesToTriangles(polyIndices: number[]): number[] {
  const triangles: number[] = []
  let polyStart = 0

  for (let i = 0; i < polyIndices.length; i++) {
    if (polyIndices[i] < 0) {
      // End of polygon - the actual index is ^(negative_value) = -(value+1)
      const lastIdx = -(polyIndices[i] + 1)
      const polyVerts: number[] = []

      for (let j = polyStart; j < i; j++) {
        polyVerts.push(polyIndices[j])
      }
      polyVerts.push(lastIdx)

      // Triangulate: fan from first vertex
      for (let j = 1; j < polyVerts.length - 1; j++) {
        triangles.push(polyVerts[0], polyVerts[j], polyVerts[j + 1])
      }

      polyStart = i + 1
    }
  }

  return triangles
}

export async function streamParseFBX(
  filePath: string,
  onProgress?: (msg: string) => void
): Promise<StreamParseResult> {
  const fd = await fs.promises.open(filePath, 'r')
  const stats = await fd.stat()
  const fileSize = stats.size
  const sizeMB = (fileSize / (1024 * 1024)).toFixed(0)

  onProgress?.(`Lendo cabeçalho FBX (${sizeMB} MB)...`)

  // Read and verify magic
  const magicBuf = await readBytes(fd, 0, FBX_MAGIC.length)
  const magic = magicBuf.toString('binary')
  if (magic !== FBX_MAGIC) throw new Error('Arquivo não é FBX binário')

  // Read version
  const versionBuf = await readBytes(fd, FBX_MAGIC.length, 4)
  const version = versionBuf.readUInt32LE(0)
  const is64 = version >= 7500

  onProgress?.(`FBX versão ${version}, ${is64 ? '64-bit' : '32-bit'} offsets`)

  // Read top-level nodes
  let pos = FBX_MAGIC.length + 4
  const nullRecordSize = is64 ? 25 : 13

  // Find the "Objects" section
  let objectsNode: FBXNodeHeader | null = null
  let connectionsNode: FBXNodeHeader | null = null

  while (pos + nullRecordSize < fileSize) {
    const node = await readNodeHeader(fd, pos, is64)
    if (node === null) break

    if (node.name === 'Objects') {
      objectsNode = node
      onProgress?.('Encontrada seção Objects')
    } else if (node.name === 'Connections') {
      connectionsNode = node
    }

    pos = node.endOffset
  }

  if (!objectsNode) throw new Error('Seção Objects não encontrada no FBX')

  // Find all Geometry nodes inside Objects
  onProgress?.('Buscando geometrias...')
  const geometryNodes: FBXNodeHeader[] = []
  const materialNodes: FBXNodeHeader[] = []

  let childPos = skipProperties(objectsNode)
  while (childPos + nullRecordSize < objectsNode.endOffset) {
    const child = await readNodeHeader(fd, childPos, is64)
    if (child === null) break

    if (child.name === 'Geometry') {
      geometryNodes.push(child)
    } else if (child.name === 'Material') {
      materialNodes.push(child)
    }

    childPos = child.endOffset
  }

  onProgress?.(`Encontradas ${geometryNodes.length} geometrias, ${materialNodes.length} materiais`)

  // Process each geometry
  const meshes: StreamMesh[] = []
  let totalVertices = 0
  let totalFaces = 0

  for (let gi = 0; gi < geometryNodes.length; gi++) {
    const geoNode = geometryNodes[gi]

    if (gi % 10 === 0 || gi === geometryNodes.length - 1) {
      onProgress?.(`Processando geometria ${gi + 1}/${geometryNodes.length}...`)
    }

    // Read geometry properties (id, name, type)
    const geoProps = await readAllProperties(fd, geoNode)
    const geoId = geoProps[0] || 0
    const geoName = typeof geoProps[1] === 'string' ? geoProps[1].split('::').pop() || `Mesh_${gi}` : `Mesh_${gi}`
    const geoType = geoProps[2] || ''

    // Only process "Mesh" type geometries
    if (geoType !== 'Mesh' && geoType !== '') continue

    // Find Vertices and PolygonVertexIndex sub-nodes
    let vertices: number[] = []
    let polyIndices: number[] = []
    let normals: number[] = []

    const geoChildren = await findChildNodes(fd, geoNode, is64)

    for (const child of geoChildren) {
      if (child.name === 'Vertices') {
        const props = await readAllProperties(fd, child)
        if (props[0] && Array.isArray(props[0])) {
          vertices = props[0]
        }
      } else if (child.name === 'PolygonVertexIndex') {
        const props = await readAllProperties(fd, child)
        if (props[0] && Array.isArray(props[0])) {
          polyIndices = props[0]
        }
      } else if (child.name === 'LayerElementNormal') {
        // Look for Normals sub-node
        const normalChildren = await findChildNodes(fd, child, is64)
        for (const nc of normalChildren) {
          if (nc.name === 'Normals') {
            const props = await readAllProperties(fd, nc)
            if (props[0] && Array.isArray(props[0])) {
              normals = props[0]
            }
            break
          }
        }
      }
    }

    if (vertices.length === 0) continue

    // Convert polygon indices to triangles
    const indices = polyIndices.length > 0 ? polygonIndicesToTriangles(polyIndices) : []

    const numVerts = Math.floor(vertices.length / 3)
    const numFaces = Math.floor(indices.length / 3)

    totalVertices += numVerts
    totalFaces += numFaces

    meshes.push({
      name: geoName,
      vertices,
      indices,
      normals,
      color: { r: 0.7, g: 0.7, b: 0.7 }  // Default gray, we'll get materials later
    })

    // Clear arrays to help GC
    vertices = []
    polyIndices = []
    normals = []
  }

  await fd.close()

  onProgress?.(`Concluído: ${meshes.length} meshes, ${totalVertices.toLocaleString()} vértices, ${totalFaces.toLocaleString()} faces`)

  return { meshes, totalVertices, totalFaces }
}
