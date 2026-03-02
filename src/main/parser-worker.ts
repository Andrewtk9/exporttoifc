/**
 * Parser Worker - runs as a child process
 *
 * For FBX files: uses streaming disk reader (minimal RAM, handles any file size)
 * For OBJ/glTF/DAE: uses Three.js loaders (good for smaller files)
 *
 * Writes mesh data to a temp binary file (not IPC) to avoid RAM accumulation.
 * Sends only the temp file path + summary via IPC.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { inflateSync } from 'zlib'

interface ParsedMesh {
  name: string
  vertices: number[]
  indices: number[]
  normals: number[]
  color: { r: number; g: number; b: number }
}

function sendProgress(msg: string) {
  process.send?.({ type: 'progress', message: msg })
}

// ===== Temp file writer (same format as mesh-store.ts) =====
const MESH_MAGIC = Buffer.from('MESH')

class TempMeshWriter {
  private fd: number
  private meshCount = 0
  filePath: string

  constructor() {
    this.filePath = path.join(os.tmpdir(), `paula-meshes-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
    this.fd = fs.openSync(this.filePath, 'w')
    const header = Buffer.alloc(12)
    MESH_MAGIC.copy(header, 0)
    header.writeUInt32LE(1, 4) // version
    header.writeUInt32LE(0, 8) // count placeholder
    fs.writeSync(this.fd, header)
  }

  write(mesh: ParsedMesh): void {
    // Name
    const nameBytes = Buffer.from(mesh.name, 'utf-8')
    const nameLenBuf = Buffer.alloc(4)
    nameLenBuf.writeUInt32LE(nameBytes.length, 0)
    fs.writeSync(this.fd, nameLenBuf)
    if (nameBytes.length > 0) fs.writeSync(this.fd, nameBytes)

    // Vertices (float64)
    const vertCountBuf = Buffer.alloc(4)
    vertCountBuf.writeUInt32LE(mesh.vertices.length, 0)
    fs.writeSync(this.fd, vertCountBuf)
    if (mesh.vertices.length > 0) {
      const vb = Buffer.alloc(mesh.vertices.length * 8)
      for (let i = 0; i < mesh.vertices.length; i++) vb.writeDoubleLE(mesh.vertices[i], i * 8)
      fs.writeSync(this.fd, vb)
    }

    // Indices (int32)
    const idxCountBuf = Buffer.alloc(4)
    idxCountBuf.writeUInt32LE(mesh.indices.length, 0)
    fs.writeSync(this.fd, idxCountBuf)
    if (mesh.indices.length > 0) {
      const ib = Buffer.alloc(mesh.indices.length * 4)
      for (let i = 0; i < mesh.indices.length; i++) ib.writeInt32LE(mesh.indices[i], i * 4)
      fs.writeSync(this.fd, ib)
    }

    // Normals (float64)
    const normCountBuf = Buffer.alloc(4)
    normCountBuf.writeUInt32LE(mesh.normals.length, 0)
    fs.writeSync(this.fd, normCountBuf)
    if (mesh.normals.length > 0) {
      const nb = Buffer.alloc(mesh.normals.length * 8)
      for (let i = 0; i < mesh.normals.length; i++) nb.writeDoubleLE(mesh.normals[i], i * 8)
      fs.writeSync(this.fd, nb)
    }

    // Color (3 * float32)
    const cb = Buffer.alloc(12)
    cb.writeFloatLE(mesh.color.r, 0)
    cb.writeFloatLE(mesh.color.g, 4)
    cb.writeFloatLE(mesh.color.b, 8)
    fs.writeSync(this.fd, cb)

    this.meshCount++
  }

  close(): number {
    const countBuf = Buffer.alloc(4)
    countBuf.writeUInt32LE(this.meshCount, 0)
    fs.writeSync(this.fd, countBuf, 0, 4, 8)
    fs.closeSync(this.fd)
    return this.meshCount
  }
}

// ===== FBX Streaming Reader =====
const FBX_MAGIC = 'Kaydara FBX Binary\x20\x20\x00\x1a\x00'

interface NodeHeader {
  endOffset: number
  numProperties: number
  propertyListLen: number
  name: string
  dataStart: number
}

async function readBytes(fd: fs.promises.FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  await fd.read(buf, 0, len, pos)
  return buf
}

async function readNodeHeader(fd: fs.promises.FileHandle, pos: number, is64: boolean): Promise<NodeHeader | null> {
  const hSize = is64 ? 25 : 13
  const buf = await readBytes(fd, pos, hSize)
  let off = 0
  let endOffset: number, numProperties: number, propertyListLen: number

  if (is64) {
    endOffset = Number(buf.readBigUInt64LE(off)); off += 8
    numProperties = Number(buf.readBigUInt64LE(off)); off += 8
    propertyListLen = Number(buf.readBigUInt64LE(off)); off += 8
  } else {
    endOffset = buf.readUInt32LE(off); off += 4
    numProperties = buf.readUInt32LE(off); off += 4
    propertyListLen = buf.readUInt32LE(off); off += 4
  }
  const nameLen = buf.readUInt8(off)
  if (endOffset === 0) return null
  const nameBuf = await readBytes(fd, pos + hSize, nameLen)
  return { endOffset, numProperties, propertyListLen, name: nameBuf.toString('ascii'), dataStart: pos + hSize + nameLen }
}

async function readProperty(fd: fs.promises.FileHandle, pos: number): Promise<{ value: any; nextPos: number }> {
  const tb = await readBytes(fd, pos, 1)
  const t = String.fromCharCode(tb[0])
  pos += 1
  switch (t) {
    case 'Y': { const b = await readBytes(fd, pos, 2); return { value: b.readInt16LE(0), nextPos: pos + 2 } }
    case 'C': { const b = await readBytes(fd, pos, 1); return { value: b[0] !== 0, nextPos: pos + 1 } }
    case 'I': { const b = await readBytes(fd, pos, 4); return { value: b.readInt32LE(0), nextPos: pos + 4 } }
    case 'F': { const b = await readBytes(fd, pos, 4); return { value: b.readFloatLE(0), nextPos: pos + 4 } }
    case 'D': { const b = await readBytes(fd, pos, 8); return { value: b.readDoubleLE(0), nextPos: pos + 8 } }
    case 'L': { const b = await readBytes(fd, pos, 8); return { value: Number(b.readBigInt64LE(0)), nextPos: pos + 8 } }
    case 'S': {
      const lb = await readBytes(fd, pos, 4); const len = lb.readUInt32LE(0); pos += 4
      if (len === 0) return { value: '', nextPos: pos }
      const sb = await readBytes(fd, pos, len)
      let s = sb.toString('utf-8')
      if (s.includes('\x00\x01')) s = s.split('\x00\x01').reverse().join('::')
      return { value: s, nextPos: pos + len }
    }
    case 'R': {
      const lb = await readBytes(fd, pos, 4); const len = lb.readUInt32LE(0)
      return { value: null, nextPos: pos + 4 + len }
    }
    case 'f': case 'd': case 'l': case 'i': case 'b': case 'c': {
      const h = await readBytes(fd, pos, 12)
      const arrLen = h.readUInt32LE(0), enc = h.readUInt32LE(4), compLen = h.readUInt32LE(8)
      pos += 12
      const raw = await readBytes(fd, pos, compLen)
      const data = enc === 1 ? inflateSync(raw) : raw
      const result: number[] = new Array(arrLen)
      if (t === 'd') { for (let i = 0; i < arrLen; i++) result[i] = data.readDoubleLE(i * 8) }
      else if (t === 'f') { for (let i = 0; i < arrLen; i++) result[i] = data.readFloatLE(i * 4) }
      else if (t === 'i') { for (let i = 0; i < arrLen; i++) result[i] = data.readInt32LE(i * 4) }
      else if (t === 'l') { for (let i = 0; i < arrLen; i++) result[i] = Number(data.readBigInt64LE(i * 8)) }
      else { for (let i = 0; i < arrLen; i++) result[i] = data[i] }
      return { value: result, nextPos: pos + compLen }
    }
    default:
      throw new Error(`Unknown FBX property type: 0x${tb[0].toString(16)}`)
  }
}

async function readAllProps(fd: fs.promises.FileHandle, h: NodeHeader): Promise<any[]> {
  const props: any[] = []
  let pos = h.dataStart
  for (let i = 0; i < h.numProperties; i++) {
    try {
      const { value, nextPos } = await readProperty(fd, pos)
      props.push(value)
      pos = nextPos
    } catch { return props }
  }
  return props
}

function skipProps(h: NodeHeader): number { return h.dataStart + h.propertyListLen }

async function findChildren(fd: fs.promises.FileHandle, h: NodeHeader, is64: boolean): Promise<NodeHeader[]> {
  const kids: NodeHeader[] = []
  let pos = skipProps(h)
  const nrs = is64 ? 25 : 13
  while (pos + nrs < h.endOffset) {
    const child = await readNodeHeader(fd, pos, is64)
    if (!child) break
    kids.push(child)
    pos = child.endOffset
  }
  return kids
}

// ===== 4x4 Matrix helpers for FBX transforms =====
type Mat4 = Float64Array // 16 elements, column-major (like OpenGL/Three.js)

function mat4Identity(): Mat4 {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Float64Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      r[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return r
}

function mat4FromTRS(
  tx: number, ty: number, tz: number,
  rx: number, ry: number, rz: number,
  sx: number, sy: number, sz: number
): Mat4 {
  // Euler XYZ rotation (degrees → radians), matrix = Rz * Ry * Rx
  const d2r = Math.PI / 180
  const cx = Math.cos(rx * d2r), snx = Math.sin(rx * d2r)
  const cy = Math.cos(ry * d2r), sny = Math.sin(ry * d2r)
  const cz = Math.cos(rz * d2r), snz = Math.sin(rz * d2r)

  // Combined rotation: R = Rz * Ry * Rx
  const r00 = cy * cz, r01 = snx * sny * cz - cx * snz, r02 = cx * sny * cz + snx * snz
  const r10 = cy * snz, r11 = snx * sny * snz + cx * cz, r12 = cx * sny * snz - snx * cz
  const r20 = -sny,     r21 = snx * cy,                   r22 = cx * cy

  // Column-major: [col0, col1, col2, col3]
  return new Float64Array([
    r00 * sx, r10 * sx, r20 * sx, 0,
    r01 * sy, r11 * sy, r21 * sy, 0,
    r02 * sz, r12 * sz, r22 * sz, 0,
    tx, ty, tz, 1
  ])
}

function mat4TransformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ]
}

// ===== FBX geometry helpers =====

function polyToTriangles(polyIndices: number[]): number[] {
  const tris: number[] = []
  let start = 0
  for (let i = 0; i < polyIndices.length; i++) {
    if (polyIndices[i] < 0) {
      const last = -(polyIndices[i] + 1)
      const verts: number[] = []
      for (let j = start; j < i; j++) verts.push(polyIndices[j])
      verts.push(last)
      for (let j = 1; j < verts.length - 1; j++) tris.push(verts[0], verts[j], verts[j + 1])
      start = i + 1
    }
  }
  return tris
}

// Helper to extract Properties70 transform values from a Model node
async function readModelTransform(
  fd: fs.promises.FileHandle, node: NodeHeader, is64: boolean
): Promise<{ t: [number, number, number]; r: [number, number, number]; s: [number, number, number]; gt: [number, number, number]; gr: [number, number, number]; gs: [number, number, number]; pre: [number, number, number] }> {
  const t: [number, number, number] = [0, 0, 0]
  const r: [number, number, number] = [0, 0, 0]
  const s: [number, number, number] = [1, 1, 1]
  const gt: [number, number, number] = [0, 0, 0]  // GeometricTranslation
  const gr: [number, number, number] = [0, 0, 0]  // GeometricRotation
  const gs: [number, number, number] = [1, 1, 1]  // GeometricScaling
  const pre: [number, number, number] = [0, 0, 0] // PreRotation

  const children = await findChildren(fd, node, is64)
  for (const child of children) {
    if (child.name !== 'Properties70') continue
    const pChildren = await findChildren(fd, child, is64)
    for (const pc of pChildren) {
      if (pc.name !== 'P') continue
      const pp = await readAllProps(fd, pc)
      const name = pp[0]
      if (typeof name !== 'string') continue
      const x = typeof pp[4] === 'number' ? pp[4] : 0
      const y = typeof pp[5] === 'number' ? pp[5] : 0
      const z = typeof pp[6] === 'number' ? pp[6] : 0
      switch (name) {
        case 'Lcl Translation': t[0] = x; t[1] = y; t[2] = z; break
        case 'Lcl Rotation': r[0] = x; r[1] = y; r[2] = z; break
        case 'Lcl Scaling': s[0] = x; s[1] = y; s[2] = z; break
        case 'GeometricTranslation': gt[0] = x; gt[1] = y; gt[2] = z; break
        case 'GeometricRotation': gr[0] = x; gr[1] = y; gr[2] = z; break
        case 'GeometricScaling': gs[0] = x; gs[1] = y; gs[2] = z; break
        case 'PreRotation': pre[0] = x; pre[1] = y; pre[2] = z; break
      }
    }
    break
  }
  return { t, r, s, gt, gr, gs, pre }
}

async function parseFBXStreaming(filePath: string): Promise<{ tempFile: string; meshCount: number; totalVertices: number; totalFaces: number }> {
  const fd = await fs.promises.open(filePath, 'r')
  const stats = await fd.stat()
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(0)

  sendProgress(`Lendo cabeçalho FBX (${sizeMB} MB)...`)

  const magic = await readBytes(fd, 0, FBX_MAGIC.length)
  if (magic.toString('binary') !== FBX_MAGIC) throw new Error('Arquivo não é FBX binário')

  const vBuf = await readBytes(fd, FBX_MAGIC.length, 4)
  const version = vBuf.readUInt32LE(0)
  const is64 = version >= 7500

  sendProgress(`FBX v${version} — Escaneando estrutura...`)

  // ===== Phase 1: Scan top-level nodes =====
  let pos = FBX_MAGIC.length + 4
  const nrs = is64 ? 25 : 13
  let objectsNode: NodeHeader | null = null
  let connectionsNode: NodeHeader | null = null
  let globalSettingsNode: NodeHeader | null = null

  while (pos + nrs < stats.size) {
    const node = await readNodeHeader(fd, pos, is64)
    if (!node) break
    if (node.name === 'Objects') objectsNode = node
    else if (node.name === 'Connections') connectionsNode = node
    else if (node.name === 'GlobalSettings') globalSettingsNode = node
    pos = node.endOffset
  }

  if (!objectsNode) throw new Error('Seção Objects não encontrada')

  // ===== Phase 2: Read UnitScaleFactor =====
  let unitScale = 1.0
  if (globalSettingsNode) {
    const gsChildren = await findChildren(fd, globalSettingsNode, is64)
    for (const gsChild of gsChildren) {
      if (gsChild.name === 'Properties70') {
        const propChildren = await findChildren(fd, gsChild, is64)
        for (const pc of propChildren) {
          if (pc.name === 'P') {
            const pProps = await readAllProps(fd, pc)
            if (pProps[0] === 'UnitScaleFactor' && typeof pProps[4] === 'number') {
              unitScale = pProps[4]
            }
          }
        }
        break
      }
    }
  }
  const toMeters = unitScale / 100
  sendProgress(`Unidade FBX: ${unitScale} cm/unit (×${toMeters} para metros)`)

  // ===== Phase 3: Scan Objects for Geometry and Model nodes =====
  sendProgress('Escaneando objetos (geometrias + modelos)...')
  const geoNodes: { header: NodeHeader; id: number; name: string }[] = []
  const modelHeaders: { header: NodeHeader; id: number }[] = []

  let childPos = skipProps(objectsNode)
  while (childPos + nrs < objectsNode.endOffset) {
    const child = await readNodeHeader(fd, childPos, is64)
    if (!child) break
    if (child.name === 'Geometry' || child.name === 'Model') {
      const props = await readAllProps(fd, child)
      const nodeId = typeof props[0] === 'number' ? props[0] : 0
      if (child.name === 'Geometry') {
        const geoType = props[2] || ''
        if (geoType === 'Mesh' || geoType === '') {
          const geoName = typeof props[1] === 'string' ? props[1].split('::').pop() || `Mesh_${geoNodes.length}` : `Mesh_${geoNodes.length}`
          geoNodes.push({ header: child, id: nodeId, name: geoName })
        }
      } else {
        modelHeaders.push({ header: child, id: nodeId })
      }
    }
    childPos = child.endOffset
  }
  sendProgress(`Encontrados ${geoNodes.length} geometrias, ${modelHeaders.length} modelos`)

  // ===== Phase 4: Read Model transforms =====
  sendProgress('Lendo transforms dos modelos...')
  interface ModelData {
    t: [number, number, number]; r: [number, number, number]; s: [number, number, number]
    gt: [number, number, number]; gr: [number, number, number]; gs: [number, number, number]
    pre: [number, number, number]
  }
  const modelTransforms = new Map<number, ModelData>()
  for (const mh of modelHeaders) {
    const xf = await readModelTransform(fd, mh.header, is64)
    modelTransforms.set(mh.id, xf)
  }

  // ===== Phase 5: Parse Connections =====
  sendProgress('Lendo conexões...')
  const childToParent = new Map<number, number>() // childId → parentId (for hierarchy)

  if (connectionsNode) {
    const connChildren = await findChildren(fd, connectionsNode, is64)
    for (const cc of connChildren) {
      if (cc.name !== 'C') continue
      const cProps = await readAllProps(fd, cc)
      // cProps: [type, childId, parentId]
      if (cProps[0] === 'OO' && typeof cProps[1] === 'number' && typeof cProps[2] === 'number') {
        childToParent.set(cProps[1], cProps[2])
      }
    }
  }
  sendProgress(`${childToParent.size} conexões lidas`)

  // ===== Phase 6: Compute world transforms (with caching) =====
  const worldTransformCache = new Map<number, Mat4>()

  function getWorldTransform(modelId: number): Mat4 {
    const cached = worldTransformCache.get(modelId)
    if (cached) return cached

    const data = modelTransforms.get(modelId)
    if (!data) {
      const identity = mat4Identity()
      worldTransformCache.set(modelId, identity)
      return identity
    }

    // Local transform: PreRotation * T * R * S
    let local: Mat4
    if (data.pre[0] !== 0 || data.pre[1] !== 0 || data.pre[2] !== 0) {
      const preRot = mat4FromTRS(0, 0, 0, data.pre[0], data.pre[1], data.pre[2], 1, 1, 1)
      const trs = mat4FromTRS(data.t[0], data.t[1], data.t[2], data.r[0], data.r[1], data.r[2], data.s[0], data.s[1], data.s[2])
      local = mat4Multiply(preRot, trs)
    } else {
      local = mat4FromTRS(data.t[0], data.t[1], data.t[2], data.r[0], data.r[1], data.r[2], data.s[0], data.s[1], data.s[2])
    }

    // Walk up hierarchy
    const parentId = childToParent.get(modelId)
    let world: Mat4
    if (parentId && parentId !== 0 && modelTransforms.has(parentId)) {
      world = mat4Multiply(getWorldTransform(parentId), local)
    } else {
      world = local
    }

    worldTransformCache.set(modelId, world)
    return world
  }

  // For each geometry, find its connected Model
  function getGeoWorldTransform(geoId: number): Mat4 {
    const modelId = childToParent.get(geoId)
    if (!modelId) return mat4Identity()

    const world = getWorldTransform(modelId)
    const modelData = modelTransforms.get(modelId)
    if (!modelData) return world

    // Geometric transform (applies to geometry only, not children)
    const hasGeo = modelData.gt[0] !== 0 || modelData.gt[1] !== 0 || modelData.gt[2] !== 0 ||
                   modelData.gr[0] !== 0 || modelData.gr[1] !== 0 || modelData.gr[2] !== 0 ||
                   modelData.gs[0] !== 1 || modelData.gs[1] !== 1 || modelData.gs[2] !== 1
    if (hasGeo) {
      const geoMat = mat4FromTRS(
        modelData.gt[0], modelData.gt[1], modelData.gt[2],
        modelData.gr[0], modelData.gr[1], modelData.gr[2],
        modelData.gs[0], modelData.gs[1], modelData.gs[2]
      )
      return mat4Multiply(world, geoMat)
    }
    return world
  }

  // ===== Phase 7: Process geometries =====
  const writer = new TempMeshWriter()
  let totalVertices = 0
  let totalFaces = 0
  let skipped = 0

  for (let gi = 0; gi < geoNodes.length; gi++) {
    if (gi % 100 === 0) {
      const pct = Math.round((gi / geoNodes.length) * 100)
      sendProgress(`[${pct}%] Geometria ${gi + 1}/${geoNodes.length} — ${writer.meshCount} meshes (${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB RAM)`)
    }

    const geo = geoNodes[gi]
    const children = await findChildren(fd, geo.header, is64)
    let vertices: number[] = []
    let polyIndices: number[] = []
    let normals: number[] = []

    for (const child of children) {
      if (child.name === 'Vertices') {
        const p = await readAllProps(fd, child)
        if (p[0] && Array.isArray(p[0])) vertices = p[0]
      } else if (child.name === 'PolygonVertexIndex') {
        const p = await readAllProps(fd, child)
        if (p[0] && Array.isArray(p[0])) polyIndices = p[0]
      } else if (child.name === 'LayerElementNormal') {
        const nChildren = await findChildren(fd, child, is64)
        for (const nc of nChildren) {
          if (nc.name === 'Normals') {
            const p = await readAllProps(fd, nc)
            if (p[0] && Array.isArray(p[0])) normals = p[0]
            break
          }
        }
      }
    }

    if (vertices.length === 0) { skipped++; continue }

    // Apply world transform + unit conversion
    const worldMat = getGeoWorldTransform(geo.id)
    const isIdentity = worldMat[0] === 1 && worldMat[5] === 1 && worldMat[10] === 1 &&
                       worldMat[12] === 0 && worldMat[13] === 0 && worldMat[14] === 0 &&
                       worldMat[1] === 0 && worldMat[2] === 0 && worldMat[4] === 0 &&
                       worldMat[6] === 0 && worldMat[8] === 0 && worldMat[9] === 0

    for (let vi = 0; vi < vertices.length; vi += 3) {
      let x = vertices[vi], y = vertices[vi + 1], z = vertices[vi + 2]
      if (!isIdentity) {
        [x, y, z] = mat4TransformPoint(worldMat, x, y, z)
      }
      // Unit conversion (FBX units → meters)
      vertices[vi] = x * toMeters
      vertices[vi + 1] = y * toMeters
      vertices[vi + 2] = z * toMeters
    }

    const indices = polyIndices.length > 0 ? polyToTriangles(polyIndices) : []
    const nVerts = Math.floor(vertices.length / 3)
    const nFaces = Math.floor(indices.length / 3)
    totalVertices += nVerts
    totalFaces += nFaces

    writer.write({ name: geo.name, vertices, indices, normals, color: { r: 0.7, g: 0.7, b: 0.7 } })

    // Let GC collect
    vertices = []
    polyIndices = []
    normals = []
  }

  await fd.close()
  const meshCount = writer.close()

  sendProgress(`Concluido: ${meshCount} meshes, ${totalVertices.toLocaleString()} vertices, ${totalFaces.toLocaleString()} faces (${skipped} ignorados)`)

  return { tempFile: writer.filePath, meshCount, totalVertices, totalFaces }
}

// ===== Three.js Loaders for non-FBX formats =====
async function readSmallFile(filePath: string): Promise<ArrayBuffer> {
  const data = await fs.promises.readFile(filePath)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

async function parseWithThreeJS(filePath: string): Promise<{ tempFile: string; meshCount: number; totalVertices: number; totalFaces: number }> {
  const THREE = await import('three')
  const ext = path.extname(filePath).toLowerCase()
  const arrayBuffer = await readSmallFile(filePath)
  const sizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(0)

  sendProgress(`Parseando ${ext.toUpperCase()} (${sizeMB} MB) com Three.js...`)

  let object: any

  switch (ext) {
    case '.obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
      object = new OBJLoader().parse(new TextDecoder().decode(new Uint8Array(arrayBuffer)))
      break
    }
    case '.gltf':
    case '.glb': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      object = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(
          arrayBuffer, path.dirname(filePath) + '/',
          (gltf: any) => resolve(gltf.scene),
          (error: any) => reject(new Error(`Erro GLTF: ${error}`))
        )
      })
      break
    }
    case '.dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
      const result = new ColladaLoader().parse(
        new TextDecoder().decode(new Uint8Array(arrayBuffer)),
        path.dirname(filePath) + '/'
      )
      object = result.scene
      break
    }
    default:
      throw new Error(`Formato ${ext} nao suportado`)
  }

  // Extract meshes and write to temp file
  const writer = new TempMeshWriter()
  let totalVertices = 0
  let totalFaces = 0

  object.traverse((child: any) => {
    if (!(child instanceof THREE.Mesh)) return
    const geometry = child.geometry
    child.updateWorldMatrix(true, false)
    const cloned = geometry.clone()
    cloned.applyMatrix4(child.matrixWorld)

    const posAttr = cloned.getAttribute('position')
    if (!posAttr) return

    const vertices: number[] = new Array(posAttr.count * 3)
    for (let i = 0; i < posAttr.count; i++) {
      vertices[i * 3] = posAttr.getX(i)
      vertices[i * 3 + 1] = posAttr.getY(i)
      vertices[i * 3 + 2] = posAttr.getZ(i)
    }

    let indices: number[]
    if (cloned.index) { indices = Array.from(cloned.index.array) }
    else { indices = Array.from({ length: posAttr.count }, (_, i) => i) }

    const normAttr = cloned.getAttribute('normal')
    const normals: number[] = normAttr
      ? Array.from({ length: normAttr.count * 3 }, (_, i) => normAttr.array[i])
      : []

    let color = { r: 0.7, g: 0.7, b: 0.7 }
    const mat = child.material
    if (mat?.color) color = { r: mat.color.r, g: mat.color.g, b: mat.color.b }

    totalVertices += posAttr.count
    totalFaces += indices.length / 3

    writer.write({ name: child.name || `Mesh_${writer.meshCount}`, vertices, indices, normals, color })
    cloned.dispose()
  })

  const meshCount = writer.close()
  return { tempFile: writer.filePath, meshCount, totalVertices, totalFaces }
}

// ===== Main =====
async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    process.send?.({ type: 'error', error: 'Nenhum arquivo especificado' })
    process.exit(1)
  }

  try {
    const ext = path.extname(filePath).toLowerCase()

    let result: { tempFile: string; meshCount: number; totalVertices: number; totalFaces: number }

    if (ext === '.fbx') {
      result = await parseFBXStreaming(filePath)
    } else {
      result = await parseWithThreeJS(filePath)
    }

    // Send only the summary + temp file path (NOT the mesh data)
    process.send?.({ type: 'result', data: result })
  } catch (error: any) {
    process.send?.({ type: 'error', error: error.message || String(error) })
  }
}

main()
