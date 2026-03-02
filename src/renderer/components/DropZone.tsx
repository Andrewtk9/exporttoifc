import { useState, useCallback, useEffect, useRef } from 'react'
import type { LoadedFile } from '../App'

interface DropZoneProps {
  onFileLoaded: (file: LoadedFile) => void
}

const SUPPORTED_EXTENSIONS = ['.fbx', '.obj', '.gltf', '.glb', '.dae']

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function DropZone({ onFileLoaded }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    const cleanup = window.api.onParseProgress((msg) => {
      setLoadingStatus(msg)
    })
    return cleanup
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [])

  const stopTimer = useCallback((): number => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return Math.floor((Date.now() - startTimeRef.current) / 1000)
  }, [])

  const loadFromPath = useCallback(async (filePath: string, fileName: string, fileSize: number, ext: string) => {
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setLoadError(`Formato "${ext}" nao suportado. Use: ${SUPPORTED_EXTENSIONS.join(', ')}`)
      return
    }

    setIsLoading(true)
    setLoadError(null)
    setLoadingStatus(`Lendo arquivo (${(fileSize / (1024 * 1024)).toFixed(0)} MB)...`)
    startTimer()

    try {
      const result = await window.api.parseFile(filePath)

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Erro ao parsear arquivo')
      }

      const parseTime = stopTimer()

      onFileLoaded({
        name: fileName,
        size: fileSize,
        path: filePath,
        extension: ext,
        meshes: result.data.meshes,
        totalVertices: result.data.totalVertices,
        totalFaces: result.data.totalFaces,
        meshCount: result.data.meshCount,
        parseTime
      })
    } catch (err: any) {
      stopTimer()
      setLoadError(err.message || 'Erro ao carregar arquivo')
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }, [onFileLoaded, startTimer, stopTimer])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (!file) return

    const filePath = (file as any).path as string
    if (!filePath) {
      setLoadError('Nao foi possivel obter o caminho do arquivo')
      return
    }

    try {
      const info = await window.api.getFileInfo(filePath)
      await loadFromPath(info.path, info.name, info.size, info.extension)
    } catch {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      await loadFromPath(filePath, file.name, file.size, ext)
    }
  }, [loadFromPath])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleClick = useCallback(async () => {
    const fileInfo = await window.api.openFileDialog()
    if (!fileInfo) return
    await loadFromPath(fileInfo.path, fileInfo.name, fileInfo.size, fileInfo.extension)
  }, [loadFromPath])

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={!isLoading ? handleClick : undefined}
        className={`
          w-full max-w-2xl aspect-[16/10] rounded-3xl border-2 border-dashed
          flex flex-col items-center justify-center gap-5
          transition-all duration-300 ease-out
          ${isLoading ? 'pointer-events-none' : 'cursor-pointer'}
          ${isDragging
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]'
            : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
          }
        `}
      >
        {isLoading ? (
          <>
            <div className="w-12 h-12 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            <p className="text-white/50 text-sm text-center max-w-md">{loadingStatus || 'Carregando...'}</p>
            <p className="text-indigo-400/60 text-xs font-mono">
              Tempo decorrido: {formatTime(elapsed)}
            </p>
            <p className="text-white/20 text-xs">Arquivos grandes podem levar alguns minutos</p>
          </>
        ) : (
          <>
            <div className={`
              w-16 h-16 rounded-2xl flex items-center justify-center
              transition-all duration-300
              ${isDragging ? 'bg-indigo-500/20' : 'bg-white/5'}
            `}>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-colors ${isDragging ? 'text-indigo-400' : 'text-white/30'}`}
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div className="text-center space-y-2">
              <p className="text-white/70 text-sm font-medium">
                {isDragging ? 'Solte o arquivo aqui' : 'Arraste um arquivo 3D ou clique para selecionar'}
              </p>
              <p className="text-white/25 text-xs">
                FBX, OBJ, glTF, GLB, DAE
              </p>
            </div>

            {loadError && (
              <p className="text-red-400/80 text-xs max-w-md text-center animate-fade-in">
                {loadError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
