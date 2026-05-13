import { useState, useCallback, useEffect } from 'react'
import Header from './components/Header'
import HomeScreen from './components/HomeScreen'
import DropZone from './components/DropZone'
import FileInfo from './components/FileInfo'
import Viewer3D from './components/Viewer3D'
import ConvertButton from './components/ConvertButton'
import Settings from './components/Settings'
import OptimizeSettings from './components/OptimizeSettings'
import type { MeshData, OptimizationLevel, OptimizationStats, IfcCategory } from './lib/ipc'

export interface LoadedFile {
  name: string
  size: number
  path: string
  extension: string
  meshes: MeshData[]        // preview sample for 3D viewer
  totalVertices: number
  totalFaces: number
  meshCount: number         // total meshes (may differ from meshes.length)
  parseTime: number         // seconds it took to parse
}

export interface IfcSettings {
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
  optimization: OptimizationLevel
}

type AppMode = 'home' | 'convert' | 'optimize'
type AppState = 'idle' | 'loaded' | 'converting' | 'done' | 'error'

export default function App() {
  const [mode, setMode] = useState<AppMode>('home')
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [state, setState] = useState<AppState>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [optimizationStats, setOptimizationStats] = useState<OptimizationStats | null>(null)
  const [optimizeLevel, setOptimizeLevel] = useState<OptimizationLevel>('medium')
  const [optimizeFilePath, setOptimizeFilePath] = useState<string | null>(null)
  const [optimizeFileName, setOptimizeFileName] = useState<string>('')
  const [ifcCategories, setIfcCategories] = useState<IfcCategory[]>([])
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [settings, setSettings] = useState<IfcSettings>({
    projectName: 'Projeto Convertido',
    siteName: 'Site',
    buildingName: 'Edificio',
    storeyName: 'Pavimento',
    optimization: 'light'
  })

  // Listen for convert/optimize progress from main process
  useEffect(() => {
    const cleanupConvert = window.api.onConvertProgress((data) => {
      setProgress(data.percent)
      setProgressMsg(data.message)
    })
    const cleanupOptimize = window.api.onOptimizeProgress((data) => {
      setProgress(data.percent)
      setProgressMsg(data.message)
    })
    const cleanupScan = window.api.onScanProgress((data) => {
      setProgressMsg(data.message)
    })
    return () => { cleanupConvert(); cleanupOptimize(); cleanupScan() }
  }, [])

  const handleSelectMode = useCallback((selectedMode: 'convert' | 'optimize') => {
    setMode(selectedMode)
    setState('idle')
    setFile(null)
    setError(null)
    setProgress(0)
    setProgressMsg('')
    setOptimizationStats(null)
  }, [])

  const handleBackToHome = useCallback(() => {
    setMode('home')
    setFile(null)
    setState('idle')
    setProgress(0)
    setProgressMsg('')
    setError(null)
    setOptimizationStats(null)
    setOptimizeFilePath(null)
    setOptimizeFileName('')
    setIfcCategories([])
    setExcludedCategories(new Set())
  }, [])

  const handleFileLoaded = useCallback((loadedFile: LoadedFile) => {
    setFile(loadedFile)
    setState('loaded')
    setError(null)
    setOptimizationStats(null)
    setSettings(prev => ({
      ...prev,
      projectName: loadedFile.name.replace(/\.[^.]+$/, '')
    }))
  }, [])

  // ---- Convert 3D → IFC ----
  const handleConvert = useCallback(async () => {
    if (!file) return

    setState('converting')
    setProgress(0)
    setProgressMsg('Iniciando conversao...')
    setError(null)

    try {
      const result = await window.api.convertToIfc(settings)

      if (!result.success) {
        if (result.canceled) {
          setState('loaded')
          return
        }
        throw new Error(result.error || 'Falha na conversao')
      }

      if (result.optimizationStats) {
        setOptimizationStats(result.optimizationStats)
      }

      setProgress(100)
      setProgressMsg('Concluido!')
      setState('done')

      setTimeout(() => setState('loaded'), 3000)
    } catch (err: any) {
      setError(err.message)
      setState('error')
    }
  }, [file, settings])

  // ---- Select IFC file for optimization ----
  const handleSelectIfcFile = useCallback(async () => {
    setError(null)
    const filePath = await window.api.openIfcDialog()
    if (!filePath) return

    const fileName = filePath.split(/[/\\]/).pop() || filePath
    setOptimizeFilePath(filePath)
    setOptimizeFileName(fileName)
    setIfcCategories([])
    setExcludedCategories(new Set())
    setOptimizationStats(null)
    setState('idle')

    // Auto-scan categories
    setScanning(true)
    setProgressMsg('Analisando categorias...')
    try {
      const scanResult = await window.api.scanCategories(filePath)
      if (scanResult.success && scanResult.categories) {
        setIfcCategories(scanResult.categories)
      } else if (scanResult.error) {
        setError('Erro ao analisar categorias: ' + scanResult.error)
      }
    } catch (err: any) {
      setError('Erro ao analisar: ' + err.message)
    } finally {
      setScanning(false)
      setProgressMsg('')
    }
  }, [])

  // ---- Toggle category exclusion ----
  const handleToggleCategory = useCallback((type: string) => {
    setExcludedCategories(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // ---- Optimize existing IFC ----
  const handleOptimizeIfc = useCallback(async () => {
    if (!optimizeFilePath) return

    setState('converting')
    setProgress(0)
    setProgressMsg('Iniciando otimizacao...')
    setError(null)
    setOptimizationStats(null)

    try {
      const result = await window.api.optimizeIfc({
        inputPath: optimizeFilePath,
        level: optimizeLevel,
        excludedCategories: excludedCategories.size > 0 ? Array.from(excludedCategories) : undefined
      })

      if (!result.success) {
        if (result.canceled) {
          setState('idle')
          return
        }
        throw new Error(result.error || 'Falha na otimizacao')
      }

      if (result.stats) {
        setOptimizationStats(result.stats)
      }

      setProgress(100)
      setProgressMsg('Otimizado com sucesso!')
      setState('done')

      setTimeout(() => setState('idle'), 5000)
    } catch (err: any) {
      setError(err.message)
      setState('error')
    }
  }, [optimizeFilePath, optimizeLevel, excludedCategories])

  const handleReset = useCallback(() => {
    setFile(null)
    setState('idle')
    setProgress(0)
    setProgressMsg('')
    setError(null)
    setOptimizationStats(null)
  }, [])

  const handleSaveState = useCallback(async () => {
    const result = await window.api.saveState()
    if (result.success) {
      setError(null)
      setProgressMsg('Estado salvo!')
      setTimeout(() => setProgressMsg(''), 2000)
    }
  }, [])

  const handleLoadState = useCallback(async () => {
    const result = await window.api.loadState()
    if (result.success && result.data) {
      handleFileLoaded({
        name: 'Estado carregado',
        size: 0,
        path: '',
        extension: '.bin',
        meshes: result.data.meshes,
        totalVertices: result.data.totalVertices,
        totalFaces: result.data.totalFaces,
        meshCount: result.data.meshCount,
        parseTime: 0
      })
    }
  }, [handleFileLoaded])

  // ---- HOME SCREEN ----
  if (mode === 'home') {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0f]">
        <Header onBack={null} />
        <HomeScreen onSelectMode={handleSelectMode} />
      </div>
    )
  }

  // ---- OPTIMIZE IFC MODE ----
  if (mode === 'optimize') {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0f]">
        <Header onBack={handleBackToHome} />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col p-6 gap-6">
            {/* Main content area */}
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              {/* Description */}
              <div className="text-center max-w-md space-y-2">
                <div className="w-16 h-16 rounded-2xl bg-emerald-600/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white/80">Otimizar IFC existente</h2>
                <p className="text-sm text-white/30 leading-relaxed">
                  Selecione um arquivo IFC pesado. O Paula vai ler, otimizar a geometria e salvar um novo arquivo mais leve.
                </p>
              </div>

              {/* Selected file info */}
              {optimizeFilePath && (
                <div className="bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 w-full max-w-md animate-fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white/70 text-sm font-medium truncate">{optimizeFileName}</p>
                      {scanning && (
                        <p className="text-white/30 text-xs">{progressMsg || 'Analisando categorias...'}</p>
                      )}
                      {!scanning && ifcCategories.length > 0 && (
                        <p className="text-white/30 text-xs">
                          {ifcCategories.length} categorias encontradas
                          {excludedCategories.size > 0 && (
                            <span className="text-amber-400/70"> ({excludedCategories.size} excluidas)</span>
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleSelectIfcFile}
                      disabled={state === 'converting' || scanning}
                      className="text-white/30 text-xs hover:text-white/60 transition-colors"
                    >
                      Trocar
                    </button>
                  </div>
                </div>
              )}

              {/* Optimization stats */}
              {optimizationStats && (
                <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-xl p-4 w-full max-w-md animate-fade-in">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">Resultado da Otimizacao</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-white/30 text-xs">Vertices</p>
                      <p className="text-white/70">
                        {optimizationStats.originalVertices.toLocaleString()} → {optimizationStats.optimizedVertices.toLocaleString()}
                      </p>
                      <p className="text-emerald-400 text-xs">
                        -{Math.round((1 - optimizationStats.optimizedVertices / optimizationStats.originalVertices) * 100)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-white/30 text-xs">Faces</p>
                      <p className="text-white/70">
                        {optimizationStats.originalFaces.toLocaleString()} → {optimizationStats.optimizedFaces.toLocaleString()}
                      </p>
                      <p className="text-emerald-400 text-xs">
                        -{Math.round((1 - optimizationStats.optimizedFaces / optimizationStats.originalFaces) * 100)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-white/30 text-xs">Meshes</p>
                      <p className="text-white/70">
                        {optimizationStats.meshesBeforeOptimization.toLocaleString()} → {optimizationStats.meshesAfterOptimization.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                {!optimizeFilePath ? (
                  <button
                    onClick={handleSelectIfcFile}
                    className="h-12 px-8 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500 active:scale-[0.98] transition-all"
                  >
                    Selecionar arquivo IFC
                  </button>
                ) : (
                  <button
                    onClick={handleOptimizeIfc}
                    disabled={state === 'converting' || scanning}
                    className={`
                      relative h-12 px-8 rounded-xl text-sm font-medium transition-all overflow-hidden
                      ${state === 'converting'
                        ? 'bg-emerald-600/30 text-emerald-300 cursor-wait w-80'
                        : state === 'done'
                        ? 'bg-emerald-600/20 text-emerald-300'
                        : state === 'error'
                        ? 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
                        : scanning
                        ? 'bg-white/5 text-white/30 cursor-wait'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-[0.98]'
                      }
                    `}
                  >
                    {state === 'converting' && (
                      <div
                        className="absolute inset-0 bg-emerald-500/20 transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    )}
                    <span className="relative z-10">
                      {state === 'converting'
                        ? `Otimizando... ${progress}%`
                        : state === 'done'
                        ? 'Otimizado!'
                        : state === 'error'
                        ? 'Tentar novamente'
                        : scanning
                        ? 'Analisando...'
                        : 'Otimizar'
                      }
                    </span>
                  </button>
                )}
              </div>

              {state === 'converting' && progressMsg && (
                <p className="text-white/40 text-sm animate-fade-in">{progressMsg}</p>
              )}
              {error && (
                <p className="text-red-400 text-sm animate-fade-in">{error}</p>
              )}
              {state === 'done' && !optimizationStats && (
                <p className="text-emerald-400 text-sm animate-fade-in">
                  Arquivo IFC otimizado salvo com sucesso!
                </p>
              )}
            </div>
          </div>

          {/* Sidebar with optimization settings + categories */}
          <div className="w-80 border-l border-white/5 bg-[#0c0c14] p-5 flex flex-col gap-5 overflow-y-auto">
            <OptimizeSettings
              level={optimizeLevel}
              onChange={setOptimizeLevel}
              categories={ifcCategories}
              excludedCategories={excludedCategories}
              onToggleCategory={handleToggleCategory}
              onExcludeAll={() => setExcludedCategories(new Set(ifcCategories.map(c => c.type)))}
              onIncludeAll={() => setExcludedCategories(new Set())}
            />
          </div>
        </div>
      </div>
    )
  }

  // ---- CONVERT 3D → IFC MODE ----
  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f]">
      <Header onBack={handleBackToHome} />

      <div className="flex-1 flex overflow-hidden">
        {/* Main Area */}
        <div className="flex-1 flex flex-col p-6 gap-6">
          {state === 'idle' ? (
            <div className="flex-1 flex flex-col">
              <DropZone onFileLoaded={handleFileLoaded} />
              <div className="flex justify-center pb-4">
                <button
                  onClick={handleLoadState}
                  className="text-white/30 text-xs hover:text-white/60 transition-colors underline"
                >
                  Carregar estado salvo (.bin)
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Viewer */}
              <div className="flex-1 rounded-2xl overflow-hidden border border-white/5 bg-[#0f0f1a]">
                <Viewer3D meshes={file?.meshes || []} />
              </div>

              {/* Bottom bar */}
              <div className="flex items-center gap-4">
                <ConvertButton
                  state={state}
                  progress={progress}
                  onConvert={handleConvert}
                  onReset={handleReset}
                />
                {state === 'loaded' && (
                  <button
                    onClick={handleSaveState}
                    className="h-11 px-4 rounded-xl border border-white/5 bg-white/[0.03] text-white/50 text-xs
                               hover:bg-white/[0.06] hover:text-white/70 transition-all"
                  >
                    Salvar estado
                  </button>
                )}
                {state === 'converting' && progressMsg && (
                  <p className="text-white/40 text-sm animate-fade-in">{progressMsg}</p>
                )}
                {error && (
                  <p className="text-red-400 text-sm animate-fade-in">{error}</p>
                )}
                {state === 'done' && (
                  <div className="flex flex-col gap-1 animate-fade-in">
                    <p className="text-emerald-400 text-sm">
                      Arquivo IFC salvo com sucesso!
                    </p>
                    {optimizationStats && (
                      <p className="text-white/30 text-xs">
                        Vertices: {optimizationStats.originalVertices.toLocaleString()} → {optimizationStats.optimizedVertices.toLocaleString()} (-{Math.round((1 - optimizationStats.optimizedVertices / optimizationStats.originalVertices) * 100)}%)
                        {' | '}Faces: {optimizationStats.originalFaces.toLocaleString()} → {optimizationStats.optimizedFaces.toLocaleString()} (-{Math.round((1 - optimizationStats.optimizedFaces / optimizationStats.originalFaces) * 100)}%)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        {file && (
          <div className="w-80 border-l border-white/5 bg-[#0c0c14] p-5 flex flex-col gap-5 overflow-y-auto animate-fade-in">
            <FileInfo file={file} />
            <Settings settings={settings} onChange={setSettings} />
          </div>
        )}
      </div>
    </div>
  )
}
