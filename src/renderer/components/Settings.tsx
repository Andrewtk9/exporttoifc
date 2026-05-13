import type { IfcSettings } from '../App'
import type { OptimizationLevel } from '../lib/ipc'

interface SettingsProps {
  settings: IfcSettings
  onChange: (settings: IfcSettings) => void
}

const OPTIMIZATION_OPTIONS: { value: OptimizationLevel; label: string; desc: string }[] = [
  { value: 'none', label: 'Nenhuma', desc: 'Arquivo original, sem alteracoes' },
  { value: 'light', label: 'Leve', desc: 'Dedup vertices + mesclar por cor' },
  { value: 'medium', label: 'Media', desc: 'Leve + simplificacao 50%' },
  { value: 'aggressive', label: 'Agressiva', desc: 'Leve + simplificacao 75%' }
]

export default function Settings({ settings, onChange }: SettingsProps) {
  const update = (key: keyof IfcSettings, value: string) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
        Configuracoes IFC
      </h3>

      <div className="space-y-3">
        <Field
          label="Nome do Projeto"
          value={settings.projectName}
          onChange={(v) => update('projectName', v)}
        />
        <Field
          label="Site"
          value={settings.siteName}
          onChange={(v) => update('siteName', v)}
        />
        <Field
          label="Edificio"
          value={settings.buildingName}
          onChange={(v) => update('buildingName', v)}
        />
        <Field
          label="Pavimento"
          value={settings.storeyName}
          onChange={(v) => update('storeyName', v)}
        />
      </div>

      {/* Optimization Level */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
          Otimizacao IFC
        </h3>
        <p className="text-[10px] text-white/20 leading-relaxed">
          Reduz o tamanho do arquivo IFC para evitar travamentos no Revit
        </p>
        <div className="space-y-1.5">
          {OPTIMIZATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...settings, optimization: opt.value })}
              className={`
                w-full text-left px-3 py-2.5 rounded-lg border transition-all
                ${settings.optimization === opt.value
                  ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300'
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

      <div className="bg-white/[0.03] rounded-xl p-4 space-y-2">
        <p className="text-[10px] text-white/25 uppercase tracking-wider">Schema</p>
        <p className="text-sm text-white/70 font-medium">IFC4</p>
        <p className="text-[10px] text-white/25 uppercase tracking-wider mt-2">Geometria</p>
        <p className="text-sm text-white/70 font-medium">IfcTriangulatedFaceSet</p>
        <p className="text-[10px] text-white/25 uppercase tracking-wider mt-2">Elementos</p>
        <p className="text-sm text-white/70 font-medium">IfcBuildingElementProxy</p>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/[0.04] border border-white/5 rounded-lg px-3 py-2 text-sm text-white/80
                   focus:outline-none focus:border-indigo-500/40 focus:bg-white/[0.06] transition-all"
      />
    </div>
  )
}
