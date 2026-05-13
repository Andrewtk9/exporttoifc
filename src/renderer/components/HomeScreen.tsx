interface HomeScreenProps {
  onSelectMode: (mode: 'convert' | 'optimize') => void
}

export default function HomeScreen({ onSelectMode }: HomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Title */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white/90">O que deseja fazer?</h1>
          <p className="text-sm text-white/30">Selecione uma opcao para comecar</p>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Convert 3D → IFC */}
          <button
            onClick={() => onSelectMode('convert')}
            className="group relative p-6 rounded-2xl border border-white/5 bg-white/[0.02]
                       hover:bg-indigo-600/10 hover:border-indigo-500/30 transition-all text-left
                       active:scale-[0.98]"
          >
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 flex items-center justify-center
                              group-hover:bg-indigo-600/30 transition-colors">
                <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white/80 group-hover:text-indigo-300 transition-colors">
                  Converter 3D para IFC
                </h3>
                <p className="text-xs text-white/30 mt-1 leading-relaxed">
                  Converte arquivos FBX, OBJ, glTF, DAE para formato IFC4 com otimizacao integrada
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['FBX', 'OBJ', 'glTF', 'DAE'].map(fmt => (
                  <span key={fmt} className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/[0.04] text-white/30">
                    {fmt}
                  </span>
                ))}
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-600/20 text-indigo-400">
                  → IFC
                </span>
              </div>
            </div>
          </button>

          {/* Optimize IFC */}
          <button
            onClick={() => onSelectMode('optimize')}
            className="group relative p-6 rounded-2xl border border-white/5 bg-white/[0.02]
                       hover:bg-emerald-600/10 hover:border-emerald-500/30 transition-all text-left
                       active:scale-[0.98]"
          >
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center
                              group-hover:bg-emerald-600/30 transition-colors">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white/80 group-hover:text-emerald-300 transition-colors">
                  Otimizar IFC existente
                </h3>
                <p className="text-xs text-white/30 mt-1 leading-relaxed">
                  Reduz o tamanho de arquivos IFC pesados que travam o Revit. Mescla, deduplica e simplifica
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/[0.04] text-white/30">
                  IFC pesado
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-600/20 text-emerald-400">
                  → IFC leve
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
