import type { LoadedFile } from '../App'

interface FileInfoProps {
  file: LoadedFile
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function FileInfo({ file }: FileInfoProps) {
  const totalVertices = file.totalVertices ?? file.meshes.reduce((acc, m) => acc + m.vertices.length / 3, 0)
  const totalFaces = file.totalFaces ?? file.meshes.reduce((acc, m) => acc + m.indices.length / 3, 0)

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Arquivo</h3>

      <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
            <span className="text-indigo-400 text-[10px] font-bold uppercase">
              {file.extension.replace('.', '')}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white/80 font-medium truncate">{file.name}</p>
            <p className="text-xs text-white/30">{formatSize(file.size)}</p>
          </div>
        </div>

        <div className="h-px bg-white/5" />

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Meshes" value={file.meshCount.toLocaleString()} />
          <Stat label="Vertices" value={totalVertices.toLocaleString()} />
          <Stat label="Faces" value={totalFaces.toLocaleString()} />
          <Stat label="Formato" value={file.extension.replace('.', '').toUpperCase()} />
          <Stat label="Tempo parse" value={formatTime(file.parseTime)} />
          {file.meshes.length < file.meshCount && (
            <Stat label="Preview" value={`${file.meshes.length.toLocaleString()} meshes`} />
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-white/25 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-white/70 font-medium">{value}</p>
    </div>
  )
}
