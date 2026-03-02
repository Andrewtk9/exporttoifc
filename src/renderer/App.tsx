import { useState, useCallback, useEffect } from 'react'
import Header from './components/Header'
import DropZone from './components/DropZone'
import FileInfo from './components/FileInfo'
import Viewer3D from './components/Viewer3D'
import ConvertButton from './components/ConvertButton'
import Settings from './components/Settings'
import type { MeshData } from './lib/ipc'

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
}

type AppState = 'idle' | 'loaded' | 'converting' | 'done' | 'error'

export default function App() {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [state, setState] = useState<AppState>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<IfcSettings>({
    projectName: 'Projeto Convertido',
    siteName: 'Site',
    buildingName: 'Edificio',
    storeyName: 'Pavimento'
  })

  // Listen for convert progress from main process
  useEffect(() => {
    const cleanup = window.api.onConvertProgress((data) => {
      setProgress(data.percent)
      setProgressMsg(data.message)
    })
    return cleanup
  }, [])

  const handleFileLoaded = useCallback((loadedFile: LoadedFile) => {
    setFile(loadedFile)
    setState('loaded')
    setError(null)
    setSettings(prev => ({
      ...prev,
      projectName: loadedFile.name.replace(/\.[^.]+$/, '')
    }))
  }, [])

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

      setProgress(100)
      setProgressMsg('Concluido!')
      setState('done')

      setTimeout(() => setState('loaded'), 3000)
    } catch (err: any) {
      setError(err.message)
      setState('error')
    }
  }, [file, settings])

  const handleReset = useCallback(() => {
    setFile(null)
    setState('idle')
    setProgress(0)
    setProgressMsg('')
    setError(null)
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

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0f]">
      <Header />

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
                  <p className="text-emerald-400 text-sm animate-fade-in">
                    Arquivo IFC salvo com sucesso!
                  </p>
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
