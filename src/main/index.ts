import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { fork } from 'child_process'
import { convertToIfc } from './converter'
import { parseFileFromDisk, ParseResult } from './parser'
import { MeshStoreReader } from './mesh-store'
import { optimizeMeshes } from './optimizer'
import { scanIfcCategories } from './ifc-scanner'

let mainWindow: BrowserWindow | null = null
let currentParseResult: ParseResult | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Clean up temp files on exit
app.on('will-quit', () => {
  if (currentParseResult?.tempFile) {
    try { fs.unlinkSync(currentParseResult.tempFile) } catch {}
  }
})

// IPC Handlers
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('file:open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Selecionar arquivo 3D',
    filters: [
      { name: 'Arquivos 3D', extensions: ['fbx', 'obj', 'gltf', 'glb', 'dae'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const stats = await fs.promises.stat(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    extension: path.extname(filePath).toLowerCase()
  }
})

ipcMain.handle('file:get-info', async (_event, filePath: string) => {
  const stats = await fs.promises.stat(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    extension: path.extname(filePath).toLowerCase()
  }
})

ipcMain.handle('file:parse', async (_event, filePath: string) => {
  try {
    // Clean up previous temp file
    if (currentParseResult?.tempFile) {
      try { fs.unlinkSync(currentParseResult.tempFile) } catch {}
    }

    const result = await parseFileFromDisk(filePath, (msg) => {
      mainWindow?.webContents.send('parse:progress', msg)
    })

    currentParseResult = result

    // Read a sample of meshes for 3D preview (max 500 meshes, max 2M vertices)
    const reader = new MeshStoreReader(result.tempFile)
    const previewMeshes = reader.readSample(500, 2_000_000)
    reader.close()

    return {
      success: true,
      data: {
        meshes: previewMeshes,
        totalVertices: result.totalVertices,
        totalFaces: result.totalFaces,
        meshCount: result.meshCount
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('file:save-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Salvar arquivo IFC',
    defaultPath: 'modelo.ifc',
    filters: [{ name: 'IFC Files', extensions: ['ifc'] }]
  })
  return result.filePath
})

ipcMain.handle('file:save', async (_event, filePath: string, data: Uint8Array) => {
  await fs.promises.writeFile(filePath, Buffer.from(data))
  return true
})

// Save/Load state - avoid re-parsing 8 min every time
ipcMain.handle('state:save', async () => {
  if (!currentParseResult?.tempFile) {
    return { success: false, error: 'Nenhum estado para salvar' }
  }
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Salvar estado (meshes parseados)',
    defaultPath: 'paula-state.bin',
    filters: [{ name: 'Paula State', extensions: ['bin'] }]
  })
  if (!result.filePath) return { success: false, error: 'Cancelado' }
  // Copy temp file + save metadata as JSON sidecar
  await fs.promises.copyFile(currentParseResult.tempFile, result.filePath)
  const meta = {
    meshCount: currentParseResult.meshCount,
    totalVertices: currentParseResult.totalVertices,
    totalFaces: currentParseResult.totalFaces
  }
  await fs.promises.writeFile(result.filePath + '.json', JSON.stringify(meta))
  return { success: true, path: result.filePath }
})

ipcMain.handle('state:load', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Carregar estado salvo',
    filters: [{ name: 'Paula State', extensions: ['bin'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Cancelado' }
  const binPath = result.filePaths[0]
  const jsonPath = binPath + '.json'
  if (!fs.existsSync(jsonPath)) {
    return { success: false, error: 'Arquivo .json de metadados não encontrado' }
  }
  const meta = JSON.parse(await fs.promises.readFile(jsonPath, 'utf-8'))
  currentParseResult = {
    tempFile: binPath,
    meshCount: meta.meshCount,
    totalVertices: meta.totalVertices,
    totalFaces: meta.totalFaces
  }
  // Read preview sample
  const reader = new MeshStoreReader(binPath)
  const previewMeshes = reader.readSample(500, 2_000_000)
  reader.close()
  return {
    success: true,
    data: {
      meshes: previewMeshes,
      totalVertices: meta.totalVertices,
      totalFaces: meta.totalFaces,
      meshCount: meta.meshCount
    }
  }
})

// ---- Convert 3D → IFC (with optional optimization) ----
ipcMain.handle('convert:to-ifc', async (_event, options: {
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
  optimization?: string
}) => {
  try {
    if (!currentParseResult?.tempFile) {
      throw new Error('Nenhum arquivo parseado. Carregue um arquivo primeiro.')
    }

    // Ask where to save FIRST (before converting)
    const saveResult = await dialog.showSaveDialog(mainWindow!, {
      title: 'Salvar arquivo IFC',
      defaultPath: 'modelo.ifc',
      filters: [{ name: 'IFC Files', extensions: ['ifc'] }]
    })

    if (!saveResult.filePath) {
      return { success: false, canceled: true }
    }

    const optimizationLevel = (options.optimization || 'none') as 'none' | 'light' | 'medium' | 'aggressive'
    let tempFileToUse = currentParseResult.tempFile
    let meshCountToUse = currentParseResult.meshCount
    let optimizationStats: any = null
    let optimizedTempFile: string | null = null

    // Run optimization if requested
    if (optimizationLevel !== 'none') {
      mainWindow?.webContents.send('convert:progress', {
        message: 'Otimizando meshes...',
        percent: 1
      })

      const optResult = await optimizeMeshes(
        currentParseResult.tempFile,
        currentParseResult.meshCount,
        {
          level: optimizationLevel,
          onProgress: (message, percent) => {
            // Scale optimization progress to 0-50% of total
            const scaledPercent = Math.round(percent * 0.5)
            mainWindow?.webContents.send('convert:progress', { message, percent: scaledPercent })
          }
        }
      )

      tempFileToUse = optResult.tempFile
      meshCountToUse = optResult.meshCount
      optimizedTempFile = optResult.tempFile !== currentParseResult.tempFile ? optResult.tempFile : null

      optimizationStats = {
        originalVertices: optResult.originalVertices,
        originalFaces: optResult.originalFaces,
        optimizedVertices: optResult.totalVertices,
        optimizedFaces: optResult.totalFaces,
        meshesBeforeOptimization: currentParseResult.meshCount,
        meshesAfterOptimization: optResult.meshCount
      }
    }

    mainWindow?.webContents.send('convert:progress', {
      message: 'Gerando arquivo IFC...',
      percent: optimizationLevel !== 'none' ? 52 : 1
    })

    // Convert and write directly to file (streaming, no memory buffer)
    await convertToIfc({
      tempFile: tempFileToUse,
      meshCount: meshCountToUse,
      outputPath: saveResult.filePath,
      projectName: options.projectName,
      siteName: options.siteName,
      buildingName: options.buildingName,
      storeyName: options.storeyName,
      onProgress: (message, percent) => {
        // Scale conversion progress to 50-100% if optimized, or 0-100% if not
        const scaledPercent = optimizationLevel !== 'none'
          ? 52 + Math.round(percent * 0.48)
          : percent
        mainWindow?.webContents.send('convert:progress', { message, percent: scaledPercent })
      }
    })

    // Clean up optimized temp file
    if (optimizedTempFile) {
      try { fs.unlinkSync(optimizedTempFile) } catch {}
    }

    mainWindow?.webContents.send('convert:progress', {
      message: 'Concluido!',
      percent: 100
    })

    return { success: true, optimizationStats }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ---- Scan IFC categories (fast, runs in main process) ----
ipcMain.handle('scan:categories', async (_event, filePath: string) => {
  try {
    const result = await scanIfcCategories(filePath, (message, percent) => {
      mainWindow?.webContents.send('scan:progress', { message, percent })
    })
    // Convert Map to serializable array for IPC
    const faceSetMapping: [number, string][] = []
    for (const [fsId, cat] of result.faceSetToCategory) {
      faceSetMapping.push([fsId, cat])
    }
    return {
      success: true,
      categories: result.categories,
      faceSetMapping
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ---- Open IFC file dialog (for optimize mode) ----
ipcMain.handle('file:open-ifc-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Selecionar arquivo IFC para otimizar',
    filters: [
      { name: 'IFC Files', extensions: ['ifc'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ---- Optimize existing IFC file (runs in child process with 8GB heap) ----
ipcMain.handle('optimize:ifc', async (_event, options: {
  inputPath: string
  level: string
  excludedCategories?: string[]
}) => {
  try {
    const inputPath = options.inputPath
    const inputName = path.basename(inputPath, '.ifc')

    // Ask where to save the optimized file
    const saveResult = await dialog.showSaveDialog(mainWindow!, {
      title: 'Salvar IFC otimizado',
      defaultPath: `${inputName}_otimizado.ifc`,
      filters: [{ name: 'IFC Files', extensions: ['ifc'] }]
    })

    if (!saveResult.filePath) {
      return { success: false, canceled: true }
    }

    const level = (options.level || 'medium') as 'none' | 'light' | 'medium' | 'aggressive'

    // Run the heavy pipeline in a child process with 8GB heap
    const workerPath = path.join(__dirname, 'optimize-worker.js')

    return await new Promise((resolve) => {
      const child = fork(workerPath, [], {
        execArgv: ['--max-old-space-size=8192'],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      })

      child.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          mainWindow?.webContents.send('optimize:progress', {
            message: msg.message,
            percent: msg.percent
          })
        } else if (msg.type === 'done') {
          mainWindow?.webContents.send('optimize:progress', {
            message: 'Otimizado com sucesso!',
            percent: 100
          })
          resolve({ success: true, stats: msg.stats })
        } else if (msg.type === 'error') {
          resolve({ success: false, error: msg.message })
        } else if (msg.type === 'ready') {
          // Worker is ready, send the start command
          child.send({
            type: 'start',
            inputPath,
            outputPath: saveResult.filePath,
            level,
            projectName: inputName,
            siteName: 'Site',
            buildingName: 'Edificio',
            storeyName: 'Pavimento',
            excludedCategories: options.excludedCategories || []
          })
        }
      })

      child.on('error', (err) => {
        resolve({ success: false, error: `Worker error: ${err.message}` })
      })

      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          resolve({ success: false, error: `Worker exited with code ${code} (possivelmente falta de memoria)` })
        }
      })

      // Forward stderr for debugging
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) console.error('[optimize-worker]', text)
      })
    })
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})
