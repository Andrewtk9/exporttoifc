interface ConvertButtonProps {
  state: 'idle' | 'loaded' | 'converting' | 'done' | 'error'
  progress: number
  onConvert: () => void
  onReset: () => void
}

export default function ConvertButton({ state, progress, onConvert, onReset }: ConvertButtonProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Reset button */}
      <button
        onClick={onReset}
        className="h-11 px-4 rounded-xl border border-white/5 bg-white/[0.03] text-white/50 text-sm
                   hover:bg-white/[0.06] hover:text-white/70 transition-all"
      >
        Novo arquivo
      </button>

      {/* Convert button */}
      <button
        onClick={onConvert}
        disabled={state === 'converting'}
        className={`
          relative h-11 px-8 rounded-xl text-sm font-medium transition-all overflow-hidden
          ${state === 'converting'
            ? 'bg-indigo-600/30 text-indigo-300 cursor-wait'
            : state === 'done'
            ? 'bg-emerald-600/20 text-emerald-300'
            : state === 'error'
            ? 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
            : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98] animate-pulse-glow'
          }
        `}
      >
        {/* Progress bar background */}
        {state === 'converting' && (
          <div
            className="absolute inset-0 bg-indigo-500/20 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        )}

        <span className="relative z-10">
          {state === 'converting'
            ? `Convertendo... ${progress}%`
            : state === 'done'
            ? 'Convertido!'
            : state === 'error'
            ? 'Tentar novamente'
            : 'Converter para IFC'
          }
        </span>
      </button>
    </div>
  )
}
