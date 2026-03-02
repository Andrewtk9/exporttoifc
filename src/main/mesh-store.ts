/**
 * Mesh Store - binary file format for storing parsed mesh data
 *
 * Instead of passing potentially gigabytes of mesh data through IPC,
 * the worker writes meshes to a temp file and the main process reads them.
 *
 * Format:
 *   Header: 4 bytes magic "MESH" + 4 bytes version + 4 bytes meshCount
 *   For each mesh:
 *     4 bytes nameLength + name (utf8)
 *     4 bytes vertexCount (number of floats, not vertices)
 *     vertexCount * 8 bytes (float64 array)
 *     4 bytes indexCount
 *     indexCount * 4 bytes (int32 array)
 *     4 bytes normalCount (number of floats)
 *     normalCount * 8 bytes (float64 array)
 *     12 bytes color (3 * float32: r, g, b)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface StoredMesh {
  name: string
  vertices: number[]
  indices: number[]
  normals: number[]
  color: { r: number; g: number; b: number }
}

const MAGIC = Buffer.from('MESH')
const VERSION = 1

export function createTempPath(): string {
  return path.join(os.tmpdir(), `paula-meshes-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
}

/**
 * Writer - used by the worker process to write meshes one at a time
 */
export class MeshStoreWriter {
  private fd: number
  private meshCount = 0
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    this.fd = fs.openSync(filePath, 'w')
    // Write header placeholder (will update meshCount at the end)
    const header = Buffer.alloc(12)
    MAGIC.copy(header, 0)
    header.writeUInt32LE(VERSION, 4)
    header.writeUInt32LE(0, 8) // meshCount placeholder
    fs.writeSync(this.fd, header)
  }

  writeMesh(mesh: StoredMesh): void {
    // Name
    const nameBytes = Buffer.from(mesh.name, 'utf-8')
    const nameLenBuf = Buffer.alloc(4)
    nameLenBuf.writeUInt32LE(nameBytes.length, 0)
    fs.writeSync(this.fd, nameLenBuf)
    fs.writeSync(this.fd, nameBytes)

    // Vertices (float64)
    const vertCountBuf = Buffer.alloc(4)
    vertCountBuf.writeUInt32LE(mesh.vertices.length, 0)
    fs.writeSync(this.fd, vertCountBuf)
    if (mesh.vertices.length > 0) {
      const vertBuf = Buffer.alloc(mesh.vertices.length * 8)
      for (let i = 0; i < mesh.vertices.length; i++) {
        vertBuf.writeDoubleLE(mesh.vertices[i], i * 8)
      }
      fs.writeSync(this.fd, vertBuf)
    }

    // Indices (int32)
    const idxCountBuf = Buffer.alloc(4)
    idxCountBuf.writeUInt32LE(mesh.indices.length, 0)
    fs.writeSync(this.fd, idxCountBuf)
    if (mesh.indices.length > 0) {
      const idxBuf = Buffer.alloc(mesh.indices.length * 4)
      for (let i = 0; i < mesh.indices.length; i++) {
        idxBuf.writeInt32LE(mesh.indices[i], i * 4)
      }
      fs.writeSync(this.fd, idxBuf)
    }

    // Normals (float64)
    const normCountBuf = Buffer.alloc(4)
    normCountBuf.writeUInt32LE(mesh.normals.length, 0)
    fs.writeSync(this.fd, normCountBuf)
    if (mesh.normals.length > 0) {
      const normBuf = Buffer.alloc(mesh.normals.length * 8)
      for (let i = 0; i < mesh.normals.length; i++) {
        normBuf.writeDoubleLE(mesh.normals[i], i * 8)
      }
      fs.writeSync(this.fd, normBuf)
    }

    // Color (3 * float32)
    const colorBuf = Buffer.alloc(12)
    colorBuf.writeFloatLE(mesh.color.r, 0)
    colorBuf.writeFloatLE(mesh.color.g, 4)
    colorBuf.writeFloatLE(mesh.color.b, 8)
    fs.writeSync(this.fd, colorBuf)

    this.meshCount++
  }

  close(): void {
    // Update mesh count in header
    const countBuf = Buffer.alloc(4)
    countBuf.writeUInt32LE(this.meshCount, 0)
    fs.writeSync(this.fd, countBuf, 0, 4, 8)
    fs.closeSync(this.fd)
  }

  getPath(): string { return this.filePath }
  getMeshCount(): number { return this.meshCount }
}

/**
 * Reader - used by main process to read meshes from temp file
 * Supports reading all meshes or iterating one at a time
 */
export class MeshStoreReader {
  private fd: number
  private pos: number
  meshCount: number

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(12)
    fs.readSync(this.fd, header, 0, 12, 0)
    if (header.slice(0, 4).toString() !== 'MESH') throw new Error('Invalid mesh store file')
    const version = header.readUInt32LE(4)
    if (version !== VERSION) throw new Error(`Unsupported mesh store version: ${version}`)
    this.meshCount = header.readUInt32LE(8)
    this.pos = 12
  }

  private readBuf(len: number): Buffer {
    const buf = Buffer.alloc(len)
    fs.readSync(this.fd, buf, 0, len, this.pos)
    this.pos += len
    return buf
  }

  readNext(): StoredMesh | null {
    try {
      // Name
      const nameLen = this.readBuf(4).readUInt32LE(0)
      const name = nameLen > 0 ? this.readBuf(nameLen).toString('utf-8') : ''

      // Vertices
      const vertCount = this.readBuf(4).readUInt32LE(0)
      const vertices: number[] = new Array(vertCount)
      if (vertCount > 0) {
        const vb = this.readBuf(vertCount * 8)
        for (let i = 0; i < vertCount; i++) vertices[i] = vb.readDoubleLE(i * 8)
      }

      // Indices
      const idxCount = this.readBuf(4).readUInt32LE(0)
      const indices: number[] = new Array(idxCount)
      if (idxCount > 0) {
        const ib = this.readBuf(idxCount * 4)
        for (let i = 0; i < idxCount; i++) indices[i] = ib.readInt32LE(i * 4)
      }

      // Normals
      const normCount = this.readBuf(4).readUInt32LE(0)
      const normals: number[] = new Array(normCount)
      if (normCount > 0) {
        const nb = this.readBuf(normCount * 8)
        for (let i = 0; i < normCount; i++) normals[i] = nb.readDoubleLE(i * 8)
      }

      // Color
      const cb = this.readBuf(12)
      const color = { r: cb.readFloatLE(0), g: cb.readFloatLE(4), b: cb.readFloatLE(8) }

      return { name, vertices, indices, normals, color }
    } catch {
      return null
    }
  }

  /**
   * Read a subset of meshes (for 3D preview)
   * Reads up to maxMeshes, skipping meshes to get an even sampling if needed
   */
  readSample(maxMeshes: number, maxVerticesTotal: number): StoredMesh[] {
    const result: StoredMesh[] = []
    let totalVerts = 0

    // If few meshes, read all; otherwise sample evenly
    const step = this.meshCount <= maxMeshes ? 1 : Math.floor(this.meshCount / maxMeshes)
    let meshIndex = 0

    // Reset to start of data
    this.pos = 12

    for (let i = 0; i < this.meshCount; i++) {
      const mesh = this.readNext()
      if (!mesh) break

      if (i % step === 0 && result.length < maxMeshes) {
        const verts = Math.floor(mesh.vertices.length / 3)
        if (totalVerts + verts > maxVerticesTotal) break
        totalVerts += verts
        result.push(mesh)
      }
      meshIndex++
    }

    return result
  }

  close(): void {
    fs.closeSync(this.fd)
  }
}
