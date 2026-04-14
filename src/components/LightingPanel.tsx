import { useGarageStore } from '../store/garageStore'
import type { SceneLight, CeilingLight } from '../store/garageStore'
import { IconDelete, IconRotate, IconToggleOn, IconToggleOff } from './Icons'
import './LightingPanel.css'

const WARM_WHITE = '#fff8f0'
const COOL_WHITE = '#f0f4ff'
const DAYLIGHT   = '#ffffff'
const CT_PRESETS = [
  { label: 'Warm', color: WARM_WHITE },
  { label: 'Cool', color: COOL_WHITE },
  { label: 'Day',  color: DAYLIGHT  },
]

function CeilingLightEditor({ light }: { light: CeilingLight }) {
  const { updateCeilingLight, deleteCeilingLight } = useGarageStore()
  const u = (changes: Partial<CeilingLight>) => updateCeilingLight(light.id, changes)
  return (
    <div className={`light-item${light.enabled ? '' : ' disabled'}`}>
      <div className="light-header">
        <button className={`light-toggle${light.enabled ? ' on' : ''}`}
          onClick={() => u({ enabled: !light.enabled })}
          aria-label={light.enabled ? 'Disable light' : 'Enable light'}
        >
          {light.enabled ? <IconToggleOn size={16} /> : <IconToggleOff size={16} />}
        </button>
        <input className="light-name" value={light.label}
          onChange={e => u({ label: e.target.value })}
          aria-label="Light name" />
        <button className="light-del" onClick={() => deleteCeilingLight(light.id)}
          aria-label={`Delete ${light.label}`}>
          <IconDelete size={10} />
        </button>
      </div>
      <div className="light-body">
        {(light.kind ?? 'bar') === 'bar' && (
          <div className="light-row">
            <label>Rotate</label>
            <button className="light-type-btn" style={{ flex: 'none', padding: '3px 10px' }}
              onClick={() => u({ rotY: (light.rotY + Math.PI / 2) % Math.PI })}
              aria-label="Rotate 90 degrees">
              <IconRotate size={10} /> 90°
            </button>
          </div>
        )}
        <div className="light-row">
          <label>Color</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {CT_PRESETS.map(p => (
              <button key={p.label}
                className={`light-type-btn${light.color === p.color ? ' active' : ''}`}
                style={{ flex: 'none', padding: '3px 8px' }}
                onClick={() => u({ color: p.color })}
                aria-label={`${p.label} white`}
                aria-pressed={light.color === p.color}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="light-row">
          <label id={`ceil-int-${light.id}`}>Intensity</label>
          <input type="range" min={0.1} max={10} step={0.1}
            value={light.intensity} onChange={e => u({ intensity: +e.target.value })}
            aria-labelledby={`ceil-int-${light.id}`} />
          <span className="light-val" aria-live="polite">{light.intensity.toFixed(1)}</span>
        </div>
        <div className="light-coords">
          <div className="light-coord">
            <label>X ft</label>
            <input type="number" step={0.5} value={light.x} onChange={e => u({ x: +e.target.value })} />
          </div>
          <div className="light-coord">
            <label>Z ft</label>
            <input type="number" step={0.5} value={light.z} onChange={e => u({ z: +e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  )
}

function LightEditor({ light }: { light: SceneLight }) {
  const { updateSceneLight, deleteSceneLight } = useGarageStore()
  const u = (changes: Partial<SceneLight>) => updateSceneLight(light.id, changes)

  return (
    <div className={`light-item${light.enabled ? '' : ' disabled'}`}>
      <div className="light-header">
        <button
          className={`light-toggle${light.enabled ? ' on' : ''}`}
          aria-label={light.enabled ? 'Disable light' : 'Enable light'}
          onClick={() => u({ enabled: !light.enabled })}
        >
          {light.enabled ? <IconToggleOn size={16} /> : <IconToggleOff size={16} />}
        </button>
        <input
          className="light-name"
          value={light.label}
          onChange={e => u({ label: e.target.value })}
          aria-label="Light name"
        />
        <button className="light-del" onClick={() => deleteSceneLight(light.id)}
          aria-label={`Delete ${light.label}`}>
          <IconDelete size={10} />
        </button>
      </div>

      <div className="light-body">
        <div className="light-type-row" role="radiogroup" aria-label="Light type">
          <button role="radio" aria-checked={light.type === 'point'}
            className={`light-type-btn${light.type === 'point' ? ' active' : ''}`}
            onClick={() => u({ type: 'point' })}>Point</button>
          <button role="radio" aria-checked={light.type === 'spot'}
            className={`light-type-btn${light.type === 'spot' ? ' active' : ''}`}
            onClick={() => u({ type: 'spot' })}>Spot</button>
        </div>

        <div className="light-row">
          <label>Color</label>
          <input type="color" value={light.color} onChange={e => u({ color: e.target.value })}
            aria-label="Light color" />
        </div>

        <div className="light-row">
          <label id={`int-${light.id}`}>Intensity</label>
          <input type="range" min={5} max={400} step={5}
            value={light.intensity}
            onChange={e => u({ intensity: +e.target.value })}
            aria-labelledby={`int-${light.id}`} />
          <span className="light-val" aria-live="polite">{light.intensity.toFixed(2)}</span>
        </div>

        <div className="light-coords">
          <div className="light-coord">
            <label>X</label>
            <input type="number" step={0.5} value={light.x}
              onChange={e => u({ x: +e.target.value })} />
          </div>
          <div className="light-coord">
            <label>Y</label>
            <input type="number" step={0.5} value={light.y}
              onChange={e => u({ y: +e.target.value })} />
          </div>
          <div className="light-coord">
            <label>Z</label>
            <input type="number" step={0.5} value={light.z}
              onChange={e => u({ z: +e.target.value })} />
          </div>
        </div>

        {light.type === 'spot' && (
          <>
            <div className="light-row">
              <label id={`angle-${light.id}`}>Angle</label>
              <input type="range" min={0.05} max={1.5} step={0.05}
                value={light.angle}
                onChange={e => u({ angle: +e.target.value })}
                aria-labelledby={`angle-${light.id}`} />
              <span className="light-val">{Math.round(light.angle * 180 / Math.PI)}°</span>
            </div>
            <div className="light-row">
              <label id={`pen-${light.id}`}>Penumbra</label>
              <input type="range" min={0} max={1} step={0.05}
                value={light.penumbra}
                onChange={e => u({ penumbra: +e.target.value })}
                aria-labelledby={`pen-${light.id}`} />
              <span className="light-val">{light.penumbra.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const IconWand = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 14L10 6"/>
    <path d="M10 6L12.5 3.5C13 3 13.5 3 14 3.5C14.5 4 14.5 4.5 14 5L11.5 7.5Z"/>
    <path d="M7 2V0.5"/><path d="M4.5 3.5L3.5 2.5"/><path d="M3 6H1.5"/>
    <path d="M12 10V11.5"/><path d="M14 8L15 7"/>
  </svg>
)

export default function LightingPanel() {
  const {
    ambientIntensity, setAmbientIntensity,
    bounceIntensity, setBounceIntensity,
    bounceDistance, setBounceDistance,
    floorReflection, setFloorReflection,
    envReflection, setEnvReflection,
    lightMultiplier, setLightMultiplier,
    exposure, setExposure,
    sceneLights, addSceneLight,
    ceilingLights, addCeilingLight,
    autoLighting,
  } = useGarageStore()

  return (
    <div className="lighting-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="section-label" style={{ margin: 0 }}>Scene Lighting</div>
        <button
          className="auto-light-btn"
          onClick={autoLighting}
          title="Auto-configure lights based on room size"
        >
          <IconWand size={13} /> Auto Light
        </button>
      </div>
      <div className="light-row">
        <label id="exposure">Exposure</label>
        <input type="range" min={0.3} max={2.0} step={0.05}
          value={exposure}
          onChange={e => setExposure(+e.target.value)}
          aria-labelledby="exposure" />
        <span className="light-val" aria-live="polite">{exposure.toFixed(2)}</span>
      </div>
      <div className="light-row">
        <label id="ambient-brightness">Ambient Fill</label>
        <input type="range" min={0} max={0.5} step={0.005}
          value={ambientIntensity}
          onChange={e => setAmbientIntensity(+e.target.value)}
          aria-labelledby="ambient-brightness" />
        <span className="light-val" aria-live="polite">{ambientIntensity.toFixed(3)}</span>
      </div>
      <div className="light-row">
        <label id="light-multiplier">Ceiling Light Power</label>
        <input type="range" min={1} max={40} step={0.5}
          value={lightMultiplier}
          onChange={e => setLightMultiplier(+e.target.value)}
          aria-labelledby="light-multiplier" />
        <span className="light-val" aria-live="polite">{lightMultiplier.toFixed(1)}</span>
      </div>
      <div className="light-row">
        <label id="bounce-intensity">Bounce Scatter</label>
        <input type="range" min={0} max={15} step={0.5}
          value={bounceIntensity}
          onChange={e => setBounceIntensity(+e.target.value)}
          aria-labelledby="bounce-intensity" />
        <span className="light-val" aria-live="polite">{bounceIntensity.toFixed(1)}</span>
      </div>
      <div className="light-row">
        <label id="bounce-distance">Bounce Range</label>
        <input type="range" min={5} max={60} step={1}
          value={bounceDistance}
          onChange={e => setBounceDistance(+e.target.value)}
          aria-labelledby="bounce-distance" />
        <span className="light-val" aria-live="polite">{bounceDistance.toFixed(0)}</span>
      </div>
      <div className="light-row">
        <label id="floor-reflection">Floor Reflection</label>
        <input type="range" min={0} max={1} step={0.01}
          value={floorReflection}
          onChange={e => setFloorReflection(+e.target.value)}
          aria-labelledby="floor-reflection" />
        <span className="light-val" aria-live="polite">{floorReflection.toFixed(2)}</span>
      </div>
      <div className="light-row">
        <label id="env-reflection">Env Reflections</label>
        <input type="range" min={0} max={1} step={0.01}
          value={envReflection}
          onChange={e => setEnvReflection(+e.target.value)}
          aria-labelledby="env-reflection" />
        <span className="light-val" aria-live="polite">{envReflection.toFixed(2)}</span>
      </div>

      <div className="light-add-row">
        <div className="section-label" style={{ margin: 0 }}>Light Sources</div>
        <div className="light-add-btns">
          <button className="light-add-btn" onClick={() => addSceneLight('point')}>+ Point</button>
          <button className="light-add-btn" onClick={() => addSceneLight('spot')}>+ Spot</button>
        </div>
      </div>

      {sceneLights.length === 0 && (
        <p className="light-empty">No lights added. Add a Point or Spot light above.</p>
      )}

      <div className="light-list">
        {sceneLights.map(l => <LightEditor key={l.id} light={l} />)}
      </div>

      <div className="light-add-row" style={{ marginTop: 4 }}>
        <div className="section-label" style={{ margin: 0 }}>Ceiling Fixtures</div>
        <div className="light-add-btns">
          <button className="light-add-btn" onClick={() => addCeilingLight('bar')}>+ LED Bar</button>
          <button className="light-add-btn" onClick={() => addCeilingLight('puck')}>+ Puck</button>
        </div>
      </div>
      <div className="light-add-row" style={{ marginTop: 4 }}>
        <div className="section-label" style={{ margin: 0 }}>Under-Cabinet Lighting</div>
        <div className="light-add-btns">
          <UnderCabinetAddButton />
        </div>
      </div>
      <p className="light-empty" style={{ marginTop: 2 }}>
        Drag fixtures to position them on the ceiling
      </p>
      <div className="light-list">
        {ceilingLights.map(l => <CeilingLightEditor key={l.id} light={l} />)}
      </div>
    </div>
  )
}

function UnderCabinetAddButton() {
  const selectedCabinetId = useGarageStore(s => s.selectedCabinetId)
  const cabinets = useGarageStore(s => s.cabinets)
  const addCeilingLight = useGarageStore(s => s.addCeilingLight)
  const selectedCab = selectedCabinetId ? cabinets.find(c => c.id === selectedCabinetId) : null
  const canAdd = !!selectedCab && selectedCab.style === 'upper'
  return (
    <button
      className="light-add-btn"
      onClick={() => addCeilingLight('ledbar')}
      disabled={!canAdd}
      title={canAdd ? 'Add LED bar under selected upper cabinet' : 'Select an upper cabinet first'}
    >
      + Under-Cab LED Bar
    </button>
  )
}
