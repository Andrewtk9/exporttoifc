import type { OptimizationLevel, IfcCategory } from '../lib/ipc'

interface OptimizeSettingsProps {
  level: OptimizationLevel
  onChange: (level: OptimizationLevel) => void
  categories?: IfcCategory[]
  excludedCategories?: Set<string>
  onToggleCategory?: (type: string) => void
  onExcludeAll?: () => void
  onIncludeAll?: () => void
}

const OPTIMIZATION_OPTIONS: { value: OptimizationLevel; label: string; desc: string }[] = [
  { value: 'light', label: 'Leve', desc: 'Dedup vertices + mesclar meshes por cor' },
  { value: 'medium', label: 'Media', desc: 'Leve + simplificacao 50% triangulos' },
  { value: 'aggressive', label: 'Agressiva', desc: 'Leve + simplificacao 75% triangulos' }
]

export default function OptimizeSettings({
  level,
  onChange,
  categories,
  excludedCategories,
  onToggleCategory,
  onExcludeAll,
  onIncludeAll
}: OptimizeSettingsProps) {
  return (
    <div className="space-y-5">
      {/* Optimization level */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          Nivel de Otimizacao
        </h3>

        <div className="space-y-1.5">
          {OPTIMIZATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`
                w-full text-left px-3 py-2.5 rounded-lg border transition-all
                ${level === opt.value
                  ? 'bg-emerald-600/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/[0.02] border-white/5 text-white/50 hover:bg-white/[0.04] hover:text-white/70'
                }
              `}
            >
              <span className="text-sm font-medium block">{opt.label}</span>
              <span className="text-[10px] opacity-60 block mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      {categories && categories.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
              Categorias
            </h3>
            <div className="flex gap-2">
              <button
                onClick={onIncludeAll}
                className="text-[10px] text-white/30 hover:text-emerald-400 transition-colors"
              >
                Todas
              </button>
              <span className="text-white/10 text-[10px]">|</span>
              <button
                onClick={onExcludeAll}
                className="text-[10px] text-white/30 hover:text-red-400 transition-colors"
              >
                Nenhuma
              </button>
            </div>
          </div>

          <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">
            {categories.map((cat) => {
              const isExcluded = excludedCategories?.has(cat.type) ?? false
              return (
                <button
                  key={cat.type}
                  onClick={() => onToggleCategory?.(cat.type)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg border transition-all flex items-center gap-2.5
                    ${isExcluded
                      ? 'bg-red-600/5 border-red-500/15 text-white/30'
                      : 'bg-white/[0.02] border-white/5 text-white/60 hover:bg-white/[0.04]'
                    }
                  `}
                >
                  {/* Checkbox indicator */}
                  <div className={`
                    w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                    ${isExcluded
                      ? 'border-red-500/30 bg-red-600/10'
                      : 'border-emerald-500/40 bg-emerald-600/15'
                    }
                  `}>
                    {!isExcluded && (
                      <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className={`text-xs font-medium block truncate ${isExcluded ? 'line-through opacity-50' : ''}`}>
                      {cat.label}
                    </span>
                    <span className="text-[10px] opacity-40 block">
                      {cat.count.toLocaleString()} elementos
                      {cat.faceSetCount !== cat.count && ` (${cat.faceSetCount.toLocaleString()} face sets)`}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {excludedCategories && excludedCategories.size > 0 && (
            <div className="bg-amber-600/10 border border-amber-500/15 rounded-lg p-2.5">
              <p className="text-[10px] text-amber-400/70 leading-relaxed">
                {excludedCategories.size} {excludedCategories.size === 1 ? 'categoria excluida' : 'categorias excluidas'} — os elementos dessas categorias serao removidos do IFC otimizado.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
        <h4 className="text-[10px] text-white/25 uppercase tracking-wider">O que faz cada otimizacao</h4>

        <div className="space-y-2 text-xs text-white/40 leading-relaxed">
          <div>
            <p className="text-white/50 font-medium">Deduplicacao de vertices</p>
            <p>Remove vertices duplicados e reindexa os triangulos. Reducao tipica: 30-60%.</p>
          </div>
          <div>
            <p className="text-white/50 font-medium">Mesclagem por cor</p>
            <p>Agrupa e mescla meshes com a mesma cor em um unico mesh. Reduz drasticamente o numero de elementos IFC.</p>
          </div>
          <div>
            <p className="text-white/50 font-medium">Simplificacao geometrica</p>
            <p>Reduz o numero de triangulos mantendo a forma geral. Usa grid-based vertex clustering.</p>
          </div>
        </div>
      </div>

      <div className="bg-amber-600/10 border border-amber-500/15 rounded-xl p-3">
        <p className="text-[10px] text-amber-400/70 leading-relaxed">
          A otimizacao agressiva pode perder detalhes finos. Recomendamos comecar com "Media" e verificar o resultado no Revit.
        </p>
      </div>
    </div>
  )
}
