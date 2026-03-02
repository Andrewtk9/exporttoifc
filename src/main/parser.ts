import { spawn } from 'child_process'
import path from 'path'

export interface ParseResult {
  tempFile: string      // path to binary temp file with mesh data
  meshCount: number
  totalVertices: number
  totalFaces: number
}

export function parseFileFromDisk(
  filePath: string,
  onProgress?: (msg: string) => void
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'parser-worker.js')

    // 4GB heap is enough - FBX uses streaming reader (reads from disk, not RAM)
    const child = spawn('node', [
      '--max-old-space-size=4096',
      workerPath,
      filePath
    ], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    })

    let resolved = false
    let stderrData = ''

    child.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString()
    })

    child.stdout?.on('data', (data: Buffer) => {
      console.log('[worker stdout]', data.toString())
    })

    child.on('message', (msg: any) => {
      switch (msg.type) {
        case 'progress':
          onProgress?.(msg.message)
          break
        case 'result':
          if (!resolved) {
            resolved = true
            resolve(msg.data)
          }
          child.kill()
          break
        case 'error':
          if (!resolved) {
            resolved = true
            reject(new Error(msg.error))
          }
          child.kill()
          break
      }
    })

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(new Error(`Worker error: ${err.message}`))
      }
    })

    child.on('exit', (code) => {
      if (!resolved && code !== 0 && code !== null) {
        resolved = true
        const detail = stderrData.trim()
          ? `\n${stderrData.trim().slice(0, 500)}`
          : 'Tente fechar outros programas para liberar memoria.'
        reject(new Error(`Worker saiu com codigo ${code}. ${detail}`))
      }
    })
  })
}
