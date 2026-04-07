import { useState, useMemo } from 'react'
import { useGarageStore } from '../store/garageStore'
import { MODEL_CATALOG, CATEGORY_LABELS, CATEGORY_COLORS } from '../data/modelCatalog'
import type { ModelCategory, ModelDef } from '../data/modelCatalog'
import { getLibraryModels, removeLibraryModel } from '../utils/modelLibrary'
import { removeCachedModel } from '../utils/importedModelCache'
import { cameraFloorPos } from '../utils/measurements'
import { IconDelete } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import './ItemsPanel.css'

const FT = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12 > 0 ? ` ${inches % 12}"` : ''}`


function ModelCard({ def, onAdd }: { def: ModelDef; onAdd: () => void }) {
  const color = CATEGORY_COLORS[def.category]
  return (
    <div className="model-card">
      <div className="model-card-preview" style={{ background: color }}>
        <CarSilhouette category={def.category} />
      </div>
      <div className="model-card-info">
        <div className="model-card-name">{def.label}</div>
        <div className="model-card-dims">
          {FT(def.w)} × {FT(def.d)} × {FT(def.h)} H
        </div>
      </div>
      <button className="model-card-add" onClick={onAdd} aria-label={`Add ${def.label} to scene`}>+</button>
    </div>
  )
}

function CarSilhouette({ category }: { category: ModelCategory }) {
  if (category === 'car') return (
    <svg viewBox="0 0 60 30" fill="none" className="model-silhouette" aria-hidden="true">
      <path d="M5 20 L10 20 L14 11 L28 9 L46 11 L50 20 L55 20" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M14 20 L14 11 Q18 8 30 8 Q42 8 46 11 L46 20 Z" fill="rgba(255,255,255,0.12)"/>
      <circle cx="18" cy="21.5" r="3.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <circle cx="42" cy="21.5" r="3.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <line x1="5" y1="20" x2="55" y2="20" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
    </svg>
  )
  if (category === 'motorcycle') return (
    <svg viewBox="0 0 60 36" fill="none" className="model-silhouette" aria-hidden="true">
      <circle cx="14" cy="24" r="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <circle cx="46" cy="24" r="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <path d="M14 24 L22 14 L30 12 L38 10 L46 16" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      <path d="M30 12 L34 20 L46 24" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" fill="none"/>
    </svg>
  )
  if (category === 'equipment') return (
    <svg viewBox="0 0 60 40" fill="none" className="model-silhouette" aria-hidden="true">
      <rect x="10" y="8" width="40" height="24" rx="2" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <line x1="10" y1="16" x2="50" y2="16" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
      <line x1="10" y1="24" x2="50" y2="24" stroke="rgba(255,255,255,0.25)" strokeWidth="1"/>
      <rect x="16" y="32" width="8" height="4" rx="1" fill="rgba(255,255,255,0.3)"/>
      <rect x="36" y="32" width="8" height="4" rx="1" fill="rgba(255,255,255,0.3)"/>
    </svg>
  )
  if (category === 'car-lift') return (
    <svg viewBox="0 0 60 40" fill="none" className="model-silhouette" aria-hidden="true">
      <line x1="8"  y1="36" x2="8"  y2="6"  stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="52" y1="36" x2="52" y2="6"  stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="8" y1="7" x2="52" y2="7" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5"/>
      <rect x="6" y="17" width="48" height="3" rx="1" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
      <line x1="52" y1="20" x2="58" y2="36" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M14 17 L17 12 L24 11 L38 11 L43 13 L46 17" stroke="rgba(255,255,255,0.35)" strokeWidth="1" fill="rgba(255,255,255,0.08)"/>
      <path d="M14 36 L16 31 L22 30 L38 30 L42 31 L46 36" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2 2" fill="none"/>
    </svg>
  )
  return (
    <svg viewBox="0 0 60 40" fill="none" className="model-silhouette" aria-hidden="true">
      <rect x="8" y="14" width="44" height="18" rx="2" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)"/>
      <line x1="8" y1="32" x2="52" y2="32" stroke="rgba(255,255,255,0.4)" strokeWidth="2"/>
      <line x1="16" y1="32" x2="16" y2="38" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
      <line x1="44" y1="32" x2="44" y2="38" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
    </svg>
  )
}

export default function ItemsPanel() {
  const { items, addItem, removeItem, selectItem, selectedItemId } = useGarageStore()
  const [activeCategory, setActiveCategory] = useState<ModelCategory | 'all'>('car')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [libRefresh, setLibRefresh] = useState(0)

  const filtered = activeCategory === 'all'
    ? MODEL_CATALOG
    : MODEL_CATALOG.filter(m => m.category === activeCategory)

  // Library models (app-wide, persists across projects)
  const libraryModels = useMemo(() => {
    void libRefresh // dependency to force re-read
    return getLibraryModels().filter(m =>
      activeCategory === 'all' || m.category === activeCategory
    )
  }, [activeCategory, libRefresh])

  const handleAdd = (def: ModelDef) => {
    const id = crypto.randomUUID()
    addItem({
      id,
      type: def.type,
      label: def.label,
      position: [cameraFloorPos.x / 12, 0, cameraFloorPos.z / 12],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
    selectItem(id)
  }

  const handleAddLibraryModel = (model: ReturnType<typeof getLibraryModels>[0]) => {
    const id = crypto.randomUUID()
    addItem({
      id,
      type: `imported:${model.id}`,
      label: model.label,
      position: [cameraFloorPos.x / 12, 0, cameraFloorPos.z / 12],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
    selectItem(id)
  }

  const handleDeleteLibraryModel = (modelId: string) => {
    removeLibraryModel(modelId)
    removeCachedModel(modelId)
    setLibRefresh(n => n + 1)
  }

  return (
    <div className="items-panel">

      {/* Category filter */}
      <div className="items-cat-row" role="tablist" aria-label="Vehicle category">
        {(['car', 'motorcycle', 'equipment', 'furniture', 'car-lift'] as ModelCategory[]).map(cat => (
          <button
            key={cat}
            role="tab"
            aria-selected={activeCategory === cat}
            className={`items-cat-btn ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Model catalog grid */}
      <div className="model-grid">
        {filtered.map(def => (
          <ModelCard key={def.type} def={def} onAdd={() => handleAdd(def)} />
        ))}
      </div>

      {/* Library models (app-wide, persists across projects) */}
      {libraryModels.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 12 }}>My Models</div>
          <div className="model-grid">
            {libraryModels.map(model => (
              <div key={model.id} className="model-card">
                <div className="model-card-preview" style={{ background: '#6a4aaa' }}>
                  <CarSilhouette category={model.category} />
                </div>
                <div className="model-card-info">
                  <div className="model-card-name">{model.label}</div>
                  <div className="model-card-dims">Imported</div>
                </div>
                <button
                  className="model-card-del"
                  onClick={(e) => { e.stopPropagation(); handleDeleteLibraryModel(model.id) }}
                  aria-label={`Remove ${model.label} from library`}
                  title="Remove from library"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px', cursor: 'pointer', fontSize: '11px' }}
                >
                  <IconDelete size={10} />
                </button>
                <button className="model-card-add" onClick={() => handleAddLibraryModel(model)} aria-label={`Add ${model.label}`}>+</button>
              </div>
            ))}
          </div>
        </>
      )}

      {filtered.length === 0 && libraryModels.length === 0 && (
        <p className="field-hint" style={{ marginTop: 12, textAlign: 'center' }}>
          No models in this category. Use the <strong>Import</strong> button in the top bar to add your own.
        </p>
      )}

      {/* Placed items list */}
      {items.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 16 }}>In Scene ({items.length})</div>
          <div className="placed-list">
            {items.map(item => (
              <div
                key={item.id}
                className={`placed-item ${selectedItemId === item.id ? 'selected' : ''}`}
                onClick={() => selectItem(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectItem(item.id) }}}
                aria-selected={selectedItemId === item.id}
              >
                <span className="placed-item-name">{item.label}</span>
                <button
                  className="placed-item-del"
                  onClick={e => { e.stopPropagation(); setConfirmRemove(item.id) }}
                  aria-label={`Remove ${item.label}`}
                >
                  <IconDelete size={10} />
                </button>
              </div>
            ))}
          </div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            GLB files go in <code>public/assets/models/</code> — shows a placeholder box until downloaded.
          </p>
        </>
      )}

      {confirmRemove && (() => {
        const item = items.find(i => i.id === confirmRemove)
        return (
          <ConfirmDialog
            title={`Remove ${item?.label ?? 'item'}?`}
            message="This item will be removed from the scene."
            confirmLabel="Remove"
            onConfirm={() => { removeItem(confirmRemove); setConfirmRemove(null) }}
            onCancel={() => setConfirmRemove(null)}
          />
        )
      })()}

    </div>
  )
}
