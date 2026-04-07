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
        <div className="light-row">
          <label>Rotate</label>
          <button className="light-type-btn" style={{ flex: 'none', padding: '3px 10px' }}
            onClick={() => u({ rotY: (light.rotY + Math.PI / 2) % Math.PI })}
            aria-label="Rotate 90 degrees">
            <IconRotate size={10} /> 90°
          </button>
        </div>
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
          <input type="range" min={0.05} max={5} step={0.05}
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

export default function LightingPanel() {
  const {
    ambientIntensity, setAmbientIntensity,
    bounceIntensity, setBounceIntensity,
    bounceDistance, setBounceDistance,
    floorReflection, setFloorReflection,
    envReflection, setEnvReflection,
    lightMultiplier, setLightMultiplier,
    sceneLights, addSceneLight,
    ceilingLights, addCeilingLight,
  } = useGarageStore()

  return (
    <div className="lighting-panel">
      <div className="section-label">Scene Lighting</div>
      <div className="light-row">
        <label id="ambient-brightness">Ambient Fill</label>
        <input type="range" min={0} max={0.5} step={0.005}
          value={ambientIntensity}
          onChange={e => setAmbientIntensity(+e.target.value)}
          aria-labelledby="ambient-brightness" />
        <span className="light-val" aria-live="polite">{ambientIntensity.toFixed(3)}</span>
      </div>
      <div className="light-row">
        <label id="light-multiplier">Light Power</label>
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
        <div className="section-label" style={{ margin: 0 }}>LED Bar Fixtures</div>
        <button className="light-add-btn" onClick={() => addCeilingLight()}>+ Add</button>
      </div>
      <p className="light-empty" style={{ marginTop: 2 }}>
        1ft × 4ft × 2" — drag to position on ceiling
      </p>
      <div className="light-list">
        {ceilingLights.map(l => <CeilingLightEditor key={l.id} light={l} />)}
      </div>
    </div>
  )
}
