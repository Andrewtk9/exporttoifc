/**
 * Optimize Worker - runs IFC read + optimize + write in a child process
 * with a large heap to handle GB-size IFC files without OOM.
 *
 * Communication via IPC messages:
 *   Parent → Worker: { type: 'start', inputPath, outputPath, level, projectName, ..., excludedCategories? }
 *   Worker → Parent: { type: 'progress', message, percent }
 *   Worker → Parent: { type: 'done', stats }
 *   Worker → Parent: { type: 'error', message }
 */

import { readIfcFile } from './ifc-reader'
import { scanIfcCategories, buildExcludedFaceSetIds } from './ifc-scanner'
import { optimizeMeshes } from './optimizer'
import { convertToIfc } from './converter'
import fs from 'fs'

interface StartMessage {
  type: 'start'
  inputPath: string
  outputPath: string
  level: 'none' | 'light' | 'medium' | 'aggressive'
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
  excludedCategories?: string[]
}

function sendProgress(message: string, percent: number) {
  process.send?.({ type: 'progress', message, percent })
}

function sendDone(stats: any) {
  process.send?.({ type: 'done', stats })
}

function sendError(message: string) {
  process.send?.({ type: 'error', message })
}

process.on('message', async (msg: StartMessage) => {
  if (msg.type !== 'start') return

  try {
    let excludedFaceSetIds: Set<number> | undefined

    // Phase 0: Scan categories if exclusions requested (0-10%)
    if (msg.excludedCategories && msg.excludedCategories.length > 0) {
      sendProgress('Analisando categorias para filtro...', 1)

      const scanResult = await scanIfcCategories(msg.inputPath, (message, percent) => {
        sendProgress(message, Math.round(percent * 0.1))
      })

      excludedFaceSetIds = buildExcludedFaceSetIds(
        scanResult.faceSetToCategory,
        msg.excludedCategories
      )

      sendProgress(`Excluindo ${excludedFaceSetIds.size} face sets de ${msg.excludedCategories.length} categorias`, 10)
    }

    // Phase 1: Read IFC file (10-35% or 0-35%)
    const readStart = excludedFaceSetIds ? 10 : 0
    const readRange = 25
    sendProgress('Lendo arquivo IFC...', readStart + 1)

    const readResult = await readIfcFile(msg.inputPath, (message, percent) => {
      sendProgress(message, readStart + Math.round(percent / 100 * readRange))
    }, excludedFaceSetIds)

    // Phase 2: Optimize meshes (35-70%)
    sendProgress('Otimizando geometria...', 37)

    const optResult = await optimizeMeshes(
      readResult.tempFile,
      readResult.meshCount,
      {
        level: msg.level,
        onProgress: (message, percent) => {
          sendProgress(message, 37 + Math.round(percent / 100 * 33))
        }
      }
    )

    // Clean up reader's temp file
    if (readResult.tempFile !== optResult.tempFile) {
      try { fs.unlinkSync(readResult.tempFile) } catch {}
    }

    // Phase 3: Write optimized IFC (70-100%)
    sendProgress('Escrevendo IFC otimizado...', 72)

    await convertToIfc({
      tempFile: optResult.tempFile,
      meshCount: optResult.meshCount,
      outputPath: msg.outputPath,
      projectName: msg.projectName,
      siteName: msg.siteName,
      buildingName: msg.buildingName,
      storeyName: msg.storeyName,
      onProgress: (message, percent) => {
        sendProgress(message, 72 + Math.round(percent * 0.28))
      }
    })

    // Clean up optimized temp file
    try { fs.unlinkSync(optResult.tempFile) } catch {}

    sendDone({
      originalVertices: optResult.originalVertices,
      originalFaces: optResult.originalFaces,
      optimizedVertices: optResult.totalVertices,
      optimizedFaces: optResult.totalFaces,
      meshesBeforeOptimization: readResult.meshCount,
      meshesAfterOptimization: optResult.meshCount
    })
  } catch (error: any) {
    sendError(error.message || 'Erro desconhecido no worker')
  }
})

// Signal that worker is ready
process.send?.({ type: 'ready' })
