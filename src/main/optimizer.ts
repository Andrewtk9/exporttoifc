/**
 * IFC Optimizer - streaming disk-based approach
 *
 * Instead of loading all meshes into RAM (which causes OOM on 145K+ meshes),
 * processes one mesh at a time using per-color accumulator files on disk:
 *
 * Pass 1: Stream read → dedup → decimate → append to per-color temp files
 * Pass 2: For each color group, stream-copy accumulated data into output mesh store
 *
 * Memory usage: O(single_mesh) + O(color_count * 64 bytes metadata)
 * Disk usage: ~same as input (temp files cleaned up after)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { MeshStoreReader, StoredMesh, createTempPath } from './mesh-store'

export interface OptimizationOptions {
  level: 'none' | 'light' | 'medium' | 'aggressive'
  onProgress?: (message: string, percent: number) => void
}

interface OptimizedResult {
  tempFile: string
  meshCount: number
  totalVertices: number
  totalFaces: number
  originalVertices: number
  originalFaces: number
}

// Per-color disk accumulator metadata (kept in RAM — tiny per color)
interface ColorAccumulator {
  vertexFilePath: string
  indexFilePath: string
  vertFd: number
  idxFd: number
  vertexOffset: number       // running vertex count for index offset adjustment
  totalVertexFloats: number  // total float64 values written
  totalIndexInts: number     // total int32 values written
  color: { r: number; g: number; b: number }
}

const MESH_MAGIC = Buffer.from('MESH')
const MESH_VERSION = 1
const COPY_CHUNK = 1024 * 1024 // 1MB chunks for stream copy

const colorKey = (r: number, g: number, b: number) =>
  `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`

// ---- Vertex Deduplication (per-mesh, constant memory) ----

function deduplicateVertices(mesh: StoredMesh, precision: number): StoredMesh {
  const factor = Math.pow(10, precision)
  const vertexMap = new Map<string, number>()
  const newVertices: number[] = []
  const newIndices: number[] = []
  const vertexCount = Math.floor(mesh.vertices.length / 3)

  const oldToNew = new Int32Array(vertexCount)

  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.vertices[i * 3]
    const y = mesh.vertices[i * 3 + 1]
    const z = mesh.vertices[i * 3 + 2]

    const key = `${Math.round(x * factor)},${Math.round(y * factor)},${Math.round(z * factor)}`

    let newIdx = vertexMap.get(key)
    if (newIdx === undefined) {
      newIdx = newVertices.length / 3
      vertexMap.set(key, newIdx)
      newVertices.push(x, y, z)
    }
    oldToNew[i] = newIdx
  }

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = oldToNew[mesh.indices[i]]
    const b = oldToNew[mesh.indices[i + 1]]
    const c = oldToNew[mesh.indices[i + 2]]

    if (a === b || b === c || a === c) continue
    newIndices.push(a, b, c)
  }

  return {
    name: mesh.name,
    vertices: newVertices,
    indices: newIndices,
    normals: [],
    color: mesh.color
  }
}

// ---- Grid-Based Decimation (per-mesh, constant memory) ----

function decimateMesh(mesh: StoredMesh, ratio: number): StoredMesh {
  if (ratio >= 1.0 || mesh.vertices.length === 0) return mesh

  const vertexCount = Math.floor(mesh.vertices.length / 3)

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i], y = mesh.vertices[i + 1], z = mesh.vertices[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const dx = maxX - minX || 1
  const dy = maxY - minY || 1
  const dz = maxZ - minZ || 1
  const maxDim = Math.max(dx, dy, dz)

  const targetVerts = Math.max(4, Math.floor(vertexCount * ratio))
  const gridRes = Math.max(4, Math.ceil(Math.cbrt(targetVerts) * 1.5))
  const cellSize = maxDim / gridRes

  const vertexMap = new Map<string, { idx: number; x: number; y: number; z: number; count: number }>()
  const oldToNew = new Int32Array(vertexCount)
  const newVertices: number[] = []
  let nextIdx = 0

  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.vertices[i * 3]
    const y = mesh.vertices[i * 3 + 1]
    const z = mesh.vertices[i * 3 + 2]

    const gx = Math.floor((x - minX) / cellSize)
    const gy = Math.floor((y - minY) / cellSize)
    const gz = Math.floor((z - minZ) / cellSize)
    const key = `${gx},${gy},${gz}`

    let entry = vertexMap.get(key)
    if (!entry) {
      entry = { idx: nextIdx++, x: 0, y: 0, z: 0, count: 0 }
      vertexMap.set(key, entry)
    }

    entry.x += x
    entry.y += y
    entry.z += z
    entry.count++
    oldToNew[i] = entry.idx
  }

  for (const [, entry] of vertexMap) {
    const idx = entry.idx * 3
    newVertices[idx] = entry.x / entry.count
    newVertices[idx + 1] = entry.y / entry.count
    newVertices[idx + 2] = entry.z / entry.count
  }

  const newIndices: number[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = oldToNew[mesh.indices[i]]
    const b = oldToNew[mesh.indices[i + 1]]
    const c = oldToNew[mesh.indices[i + 2]]

    if (a === b || b === c || a === c) continue
    newIndices.push(a, b, c)
  }

  return {
    name: mesh.name,
    vertices: newVertices,
    indices: newIndices,
    normals: [],
    color: mesh.color
  }
}

// ---- Stream copy bytes between file descriptors in chunks ----

function streamCopyBytes(srcFd: number, destFd: number, totalBytes: number): void {
  let remaining = totalBytes
  let srcPos = 0

  while (remaining > 0) {
    const chunkSize = Math.min(COPY_CHUNK, remaining)
    const buf = Buffer.alloc(chunkSize)
    fs.readSync(srcFd, buf, 0, chunkSize, srcPos)
    fs.writeSync(destFd, buf)
    srcPos += chunkSize
    remaining -= chunkSize
  }
}

// ---- Main Streaming Optimization Pipeline ----

export async function optimizeMeshes(
  inputTempFile: string,
  meshCount: number,
  options: OptimizationOptions
): Promise<OptimizedResult> {
  if (options.level === 'none') {
    const reader = new MeshStoreReader(inputTempFile)
    let totalVerts = 0, totalFaces = 0
    for (let i = 0; i < reader.meshCount; i++) {
      const m = reader.readNext()
      if (!m) break
      totalVerts += Math.floor(m.vertices.length / 3)
      totalFaces += Math.floor(m.indices.length / 3)
    }
    reader.close()
    return {
      tempFile: inputTempFile,
      meshCount,
      totalVertices: totalVerts,
      totalFaces: totalFaces,
      originalVertices: totalVerts,
      originalFaces: totalFaces
    }
  }

  const precision = options.level === 'aggressive' ? 3 : options.level === 'medium' ? 4 : 5
  const decimationRatio = options.level === 'aggressive' ? 0.25 : options.level === 'medium' ? 0.5 : 1.0

  // Create temp directory for per-color accumulator files
  const tempDir = path.join(os.tmpdir(), `paula-opt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(tempDir, { recursive: true })

  const accumulators = new Map<string, ColorAccumulator>()
  let originalVerts = 0
  let originalFaces = 0
  let colorIndex = 0

  options.onProgress?.('Processando meshes...', 2)

  // ======== PASS 1: Stream read → dedup → decimate → append to per-color files ========
  // Memory: only 1 mesh in RAM at a time + small metadata per color

  const reader = new MeshStoreReader(inputTempFile)

  for (let i = 0; i < reader.meshCount; i++) {
    const mesh = reader.readNext()
    if (!mesh) break

    originalVerts += Math.floor(mesh.vertices.length / 3)
    originalFaces += Math.floor(mesh.indices.length / 3)

    // Dedup vertices (per-mesh, no cross-mesh state)
    let processed = deduplicateVertices(mesh, precision)

    // Decimate if needed (per-mesh)
    if (decimationRatio < 1.0) {
      processed = decimateMesh(processed, decimationRatio)
    }

    // Skip empty meshes after optimization
    if (processed.vertices.length === 0 || processed.indices.length === 0) continue

    // Get or create disk accumulator for this color
    const key = colorKey(processed.color.r, processed.color.g, processed.color.b)
    let acc = accumulators.get(key)
    if (!acc) {
      const vPath = path.join(tempDir, `v${colorIndex}.bin`)
      const iPath = path.join(tempDir, `i${colorIndex}.bin`)
      acc = {
        vertexFilePath: vPath,
        indexFilePath: iPath,
        vertFd: fs.openSync(vPath, 'w'),
        idxFd: fs.openSync(iPath, 'w'),
        vertexOffset: 0,
        totalVertexFloats: 0,
        totalIndexInts: 0,
        color: processed.color
      }
      accumulators.set(key, acc)
      colorIndex++
    }

    // Append vertices to color's vertex file (raw float64)
    if (processed.vertices.length > 0) {
      const vertBuf = Buffer.alloc(processed.vertices.length * 8)
      for (let v = 0; v < processed.vertices.length; v++) {
        vertBuf.writeDoubleLE(processed.vertices[v], v * 8)
      }
      fs.writeSync(acc.vertFd, vertBuf)
      acc.totalVertexFloats += processed.vertices.length
    }

    // Append indices with vertex offset to color's index file (raw int32)
    if (processed.indices.length > 0) {
      const idxBuf = Buffer.alloc(processed.indices.length * 4)
      for (let j = 0; j < processed.indices.length; j++) {
        idxBuf.writeInt32LE(processed.indices[j] + acc.vertexOffset, j * 4)
      }
      fs.writeSync(acc.idxFd, idxBuf)
      acc.totalIndexInts += processed.indices.length
    }

    acc.vertexOffset += Math.floor(processed.vertices.length / 3)

    if (i % 500 === 0) {
      options.onProgress?.(
        `Processando: ${i}/${reader.meshCount} (${accumulators.size} cores)`,
        2 + Math.round((i / reader.meshCount) * 68)
      )
    }
  }

  reader.close()

  // Close all accumulator write FDs
  for (const [, acc] of accumulators) {
    fs.closeSync(acc.vertFd)
    fs.closeSync(acc.idxFd)
  }

  options.onProgress?.(
    `${meshCount} meshes → ${accumulators.size} grupos por cor`,
    72
  )

  // ======== PASS 2: Stream-copy per-color data into output mesh store ========
  // Write output mesh store format manually to avoid loading accumulated data into JS arrays.
  // Instead, stream-copy binary data directly from accumulator files to output file.

  const outputPath = createTempPath()
  const outFd = fs.openSync(outputPath, 'w')

  // Write mesh store header (meshCount updated at end)
  const header = Buffer.alloc(12)
  MESH_MAGIC.copy(header, 0)
  header.writeUInt32LE(MESH_VERSION, 4)
  header.writeUInt32LE(0, 8) // placeholder
  fs.writeSync(outFd, header)

  let totalVerts = 0
  let totalFaces = 0
  let colorsDone = 0
  const totalColors = accumulators.size

  for (const [, acc] of accumulators) {
    // ---- Write one mesh store entry per color group ----

    // Name
    const name = `Merged_${colorsDone}`
    const nameBytes = Buffer.from(name, 'utf-8')
    const nameLenBuf = Buffer.alloc(4)
    nameLenBuf.writeUInt32LE(nameBytes.length, 0)
    fs.writeSync(outFd, nameLenBuf)
    fs.writeSync(outFd, nameBytes)

    // Vertices: count + stream-copy from vertex accumulator file
    const vertCountBuf = Buffer.alloc(4)
    vertCountBuf.writeUInt32LE(acc.totalVertexFloats, 0)
    fs.writeSync(outFd, vertCountBuf)
    if (acc.totalVertexFloats > 0) {
      const srcFd = fs.openSync(acc.vertexFilePath, 'r')
      streamCopyBytes(srcFd, outFd, acc.totalVertexFloats * 8)
      fs.closeSync(srcFd)
    }

    // Indices: count + stream-copy from index accumulator file
    const idxCountBuf = Buffer.alloc(4)
    idxCountBuf.writeUInt32LE(acc.totalIndexInts, 0)
    fs.writeSync(outFd, idxCountBuf)
    if (acc.totalIndexInts > 0) {
      const srcFd = fs.openSync(acc.indexFilePath, 'r')
      streamCopyBytes(srcFd, outFd, acc.totalIndexInts * 4)
      fs.closeSync(srcFd)
    }

    // Normals: count = 0 (Revit recalculates)
    const normCountBuf = Buffer.alloc(4)
    normCountBuf.writeUInt32LE(0, 0)
    fs.writeSync(outFd, normCountBuf)

    // Color (3 * float32)
    const colorBuf = Buffer.alloc(12)
    colorBuf.writeFloatLE(acc.color.r, 0)
    colorBuf.writeFloatLE(acc.color.g, 4)
    colorBuf.writeFloatLE(acc.color.b, 8)
    fs.writeSync(outFd, colorBuf)

    totalVerts += Math.floor(acc.totalVertexFloats / 3)
    totalFaces += Math.floor(acc.totalIndexInts / 3)

    colorsDone++
    if (colorsDone % 50 === 0 || colorsDone === totalColors) {
      options.onProgress?.(
        `Escrevendo: ${colorsDone}/${totalColors} grupos`,
        72 + Math.round((colorsDone / totalColors) * 25)
      )
    }
  }

  // Update header with final mesh count
  const countBuf = Buffer.alloc(4)
  countBuf.writeUInt32LE(totalColors, 0)
  fs.writeSync(outFd, countBuf, 0, 4, 8)
  fs.closeSync(outFd)

  // Clean up accumulator temp files
  for (const [, acc] of accumulators) {
    try { fs.unlinkSync(acc.vertexFilePath) } catch {}
    try { fs.unlinkSync(acc.indexFilePath) } catch {}
  }
  try { fs.rmdirSync(tempDir) } catch {}

  const vertReduction = originalVerts > 0 ? Math.round((1 - totalVerts / originalVerts) * 100) : 0
  const faceReduction = originalFaces > 0 ? Math.round((1 - totalFaces / originalFaces) * 100) : 0
  options.onProgress?.(
    `Otimizado! Vertices: -${vertReduction}%, Faces: -${faceReduction}%`,
    98
  )

  return {
    tempFile: outputPath,
    meshCount: totalColors,
    totalVertices: totalVerts,
    totalFaces: totalFaces,
    originalVertices: originalVerts,
    originalFaces: originalFaces
  }
}
