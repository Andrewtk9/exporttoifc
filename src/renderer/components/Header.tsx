export default function Header() {
  return (
    <header className="drag-region h-12 flex items-center justify-between px-4 border-b border-white/5 bg-[#0c0c14]">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
          P
        </div>
        <span className="text-sm font-semibold text-white/90 tracking-wide">Paula</span>
        <span className="text-[10px] text-white/30 font-medium">3D to IFC</span>
      </div>

      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={() => window.api.minimize()}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" className="text-white/50">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => window.api.maximize()}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/50">
            <rect x="0.5" y="0.5" width="8" height="8" />
          </svg>
        </button>
        <button
          onClick={() => window.api.close()}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-red-500/20 transition-colors group"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" className="text-white/50 group-hover:text-red-400">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </header>
  )
}
