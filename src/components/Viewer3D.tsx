import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, MapControls,
  PerspectiveCamera, OrthographicCamera,
  Grid, Environment,
} from '@react-three/drei'
import { EffectComposer, N8AO, ToneMapping, SMAA } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import React, { Suspense, useRef, useEffect, useCallback, useState } from 'react'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { useGarageStore } from '../store/garageStore'
import type { ExportShot, QualityPreset } from '../store/garageStore'
import GarageShell from './GarageShell'
import FloorPlanBlueprint from './FloorPlanBlueprint'
import { exportCaptureRef } from '../utils/exportCapture'
import { undo, redo, canUndo, canRedo, subscribeUndoHistory } from '../utils/undoHistory'
import './Viewer3D.css'

const FT = (inches: number) => inches / 12

/** Small overlay in the top-left of each viewer with undo / redo arrows.
 *  Subscribes to the history stack so the buttons grey out when there's
 *  nothing left to step through. */
function UndoRedoOverlay() {
  const [, force] = useState(0)
  useEffect(() => subscribeUndoHistory(() => force(n => n + 1)), [])
  const back = canUndo()
  const fwd = canRedo()
  const baseStyle: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(28,28,30,0.78)', color: '#fff',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(6px)',
  }
  return (
    <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 50 }}>
      <button
        onClick={() => undo()}
        disabled={!back}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        style={{ ...baseStyle, opacity: back ? 1 : 0.35, cursor: back ? 'pointer' : 'default' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        onClick={() => redo()}
        disabled={!fwd}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        style={{ ...baseStyle, opacity: fwd ? 1 : 0.35, cursor: fwd ? 'pointer' : 'default' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  )
}


// Interior viewpoints — camera stands in each corner of the garage looking toward center
const PERSPECTIVE_ANGLES = [
  { label: 'FL', offset: [ 1,  1] as [number, number] },  // Front-Left  (x+, z+)
  { label: 'FR', offset: [-1,  1] as [number, number] },  // Front-Right (x-, z+)
  { label: 'BL', offset: [ 1, -1] as [number, number] },  // Back-Left   (x+, z-)
  { label: 'BR', offset: [-1, -1] as [number, number] },  // Back-Right  (x-, z-)
]

// Left click = pan, right click = rotate
const MOUSE_BUTTONS = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }

// ── WASD camera movement ──────────────────────────────────────────────────────
// W/S = forward/back along camera horizontal direction, A/D = strafe left/right
function WASDController({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const keys = useRef(new Set<string>())
  const { camera } = useThree()

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd'].includes(k)) { keys.current.add(k); e.preventDefault() }
      if (e.code === 'Space')        { keys.current.add('space');   e.preventDefault() }
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') { keys.current.add('ctrl'); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase())
      if (e.code === 'Space') keys.current.delete('space')
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.current.delete('ctrl')
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
    }
  }, [])

  useFrame((_, delta) => {
    const k = keys.current
    if (k.size === 0) return
    const speed = 12  // ft / second
    const dist  = speed * delta

    // Forward = camera look direction projected to horizontal plane
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 0.0001) return
    forward.normalize()

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

    const move = new THREE.Vector3()
    if (k.has('w'))     move.addScaledVector(forward,                    dist)
    if (k.has('s'))     move.addScaledVector(forward,                   -dist)
    if (k.has('a'))     move.addScaledVector(right,                     -dist)
    if (k.has('d'))     move.addScaledVector(right,                      dist)
    if (k.has('space')) move.addScaledVector(new THREE.Vector3(0,1,0),   dist)
    if (k.has('ctrl'))  move.addScaledVector(new THREE.Vector3(0,1,0),  -dist)

    camera.position.add(move)
    if (orbitRef.current?.target) {
      orbitRef.current.target.add(move)
      orbitRef.current.update()
    }
  })

  return null
}

// ── Camera + controls ──────────────────────────────────────────────────────────
function SceneCamera({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { garageWidth, garageDepth, ceilingHeight, viewMode, cameraAngle, isDraggingWall } = useGarageStore()
  const cx = 0, cz = 0
  const wFt = FT(garageWidth)
  const dFt = FT(garageDepth)
  const chFt = FT(ceilingHeight)
  const orthoF = Math.max(wFt * 0.65 + 3, dFt * 0.65 + 3)

  if (viewMode === 'perspective' || viewMode === 'wireframe') {
    const preset = PERSPECTIVE_ANGLES[cameraAngle]
    // Camera inside the garage: 35% of half-dimensions from center, eye level
    const camPos: [number, number, number] = [
      cx + preset.offset[0] * wFt * 0.35,
      chFt * 0.55,
      cz + preset.offset[1] * dFt * 0.35,
    ]
    // Look toward the center of the room at comfortable height
    const target: [number, number, number] = [cx, chFt * 0.35, cz]

    return (
      <>
        <PerspectiveCamera key={`persp-${cameraAngle}`} makeDefault position={camPos} fov={75} near={0.05} far={2000} />
        <OrbitControls
          ref={orbitRef}
          key={`orbit-${cameraAngle}`}
          target={target}
          maxPolarAngle={Math.PI * 0.92}
          enablePan enableZoom enableRotate
          enableDamping dampingFactor={0.35}
          enabled={!isDraggingWall}
          mouseButtons={MOUSE_BUTTONS}
        />
      </>
    )
  }

  if (viewMode === 'top') {
    return (
      <>
        <OrthographicCamera key="top" makeDefault position={[cx, 500, cz]} up={[0, 0, -1]}
          left={-orthoF} right={orthoF} top={orthoF} bottom={-orthoF} near={0.1} far={1000} />
        <MapControls ref={(r: any) => { orbitRef.current = r; if (r) r.zoomToCursor = true }} target={[cx, 0, cz]}
          enableRotate={false} screenSpacePanning enabled={!isDraggingWall} />
      </>
    )
  }

  return null
}

function SceneLighting() {
  const { ambientIntensity, envReflection, sceneLights, qualityPreset, exposure } = useGarageStore()
  // On low quality, disable shadows on scene lights entirely
  const enableSceneShadows = qualityPreset !== 'low'
  return (
    <>
      {/* Environment for reflections only (epoxy, steel) */}
      <Environment preset="warehouse" environmentIntensity={envReflection * exposure} />

      {/* Ambient fill — user-adjustable base illumination, scaled by exposure */}
      <ambientLight intensity={ambientIntensity * exposure} />

      {/* All real illumination comes from user-placed ceiling lights (CeilingLightMesh)
         and any additional scene lights below */}
      {sceneLights.filter(l => l.enabled).map(l => (
        l.type === 'spot' ? (
          <spotLight
            key={l.id}
            position={[l.x, l.y, l.z]}
            intensity={l.intensity * exposure}
            color={l.color}
            angle={l.angle}
            penumbra={l.penumbra}
            castShadow={enableSceneShadows}
            decay={2}
          />
        ) : (
          <pointLight
            key={l.id}
            position={[l.x, l.y, l.z]}
            intensity={l.intensity * exposure}
            color={l.color}
            castShadow={enableSceneShadows}
            decay={2}
          />
        )
      ))}
    </>
  )
}

function WireframeLighting() {
  return <ambientLight intensity={1} />
}

/** Force GL clear when EffectComposer is removed — prevents smeared frames with preserveDrawingBuffer */
function GLClear() {
  const { gl } = useThree()
  useEffect(() => {
    gl.autoClear = true
    gl.clear()
  }, [gl])
  useFrame(() => {
    gl.autoClear = true
  })
  return null
}

/** Set scene background to white so garage door openings don't render black */
function SceneBackground() {
  const { scene } = useThree()
  useEffect(() => {
    scene.background = new THREE.Color('#ffffff')
  }, [scene])
  return null
}

/** Initialise RectAreaLight LTC lookup textures (required once per renderer) */
let _rectAreaInited = false
function RectAreaLightInit() {
  useEffect(() => {
    if (!_rectAreaInited) {
      RectAreaLightUniformsLib.init()
      _rectAreaInited = true
    }
  }, [])
  return null
}

// ── Smart per-shot lighting analysis ─────────────────────────────────────────
// Analyzes camera angle relative to ceiling lights / garage geometry and returns
// optimal lighting overrides so every export shot looks its best automatically.
interface ExportLightingOverrides {
  ambientIntensity: number
  envMapIntensity: number
  exposure: number
  lightScale: number       // multiplier applied to all scene light intensities
  bounceScale: number      // multiplier for bounce point lights
}

function computeExportLighting(
  camPos: THREE.Vector3,
  targetPos: THREE.Vector3,
  ceilingLights: { x: number; z: number; intensity: number; enabled: boolean }[],
  garageWidthIn: number,
  garageDepthIn: number,
  ceilingHeightIn: number,
  userAmbient: number,
  userEnvReflection: number,
): ExportLightingOverrides {
  const lookDir = new THREE.Vector3().subVectors(targetPos, camPos).normalize()
  const hLook = new THREE.Vector3(lookDir.x, 0, lookDir.z)
  if (hLook.lengthSq() > 0.0001) hLook.normalize()

  const wFt = garageWidthIn / 12
  const dFt = garageDepthIn / 12
  const chFt = ceilingHeightIn / 12

  // ── 1. Lights in front vs behind camera ──
  const activeLights = ceilingLights.filter(l => l.enabled)
  let frontWeight = 0, behindWeight = 0
  for (const cl of activeLights) {
    const toLight = new THREE.Vector3(cl.x - camPos.x, 0, cl.z - camPos.z)
    if (toLight.lengthSq() < 0.001) { frontWeight += cl.intensity; continue }
    toLight.normalize()
    const dot = toLight.dot(hLook)
    if (dot > 0) frontWeight += cl.intensity * (0.5 + 0.5 * dot)
    else behindWeight += cl.intensity * (0.5 - 0.5 * dot)
  }
  const totalWeight = frontWeight + behindWeight
  // 0 = all lights behind camera, 1 = all lights in front
  const frontRatio = totalWeight > 0 ? frontWeight / totalWeight : 0.5

  // ── 2. Camera height in room (low = floor level, high = ceiling) ──
  const heightRatio = Math.max(0, Math.min(1, camPos.y / chFt))

  // ── 3. How close camera is to walls (edge proximity) ──
  const edgeX = Math.min(Math.abs(camPos.x - (-wFt / 2)), Math.abs(camPos.x - (wFt / 2))) / (wFt / 2)
  const edgeZ = Math.min(Math.abs(camPos.z - (-dFt / 2)), Math.abs(camPos.z - (dFt / 2))) / (dFt / 2)
  const edgeFactor = 1 - Math.min(edgeX, edgeZ) // 0 = center, 1 = against wall

  // ── 4. How much the camera looks down (seeing the floor / reflections) ──
  const lookDownFactor = Math.max(0, -lookDir.y) // 0 = level/up, 1 = straight down

  // ── Compute overrides ──

  // Ambient fill: boost when lights are behind camera (backlit) or camera is in a corner
  const ambientIntensity = Math.max(userAmbient,
    userAmbient + 0.06 * (1 - frontRatio) + 0.04 * edgeFactor)

  // Environment reflections: always boost for export — materials look richer
  // Extra boost when camera looks down at the floor (showcases epoxy reflections)
  const envMapIntensity = Math.max(0.15, userEnvReflection + 0.12 + lookDownFactor * 0.08)

  // Exposure: brighten backlit shots, prevent washout on front-lit ones
  const exposure = 1.0
    + (1 - frontRatio) * 0.12   // brighten when lights behind
    - frontRatio * 0.04          // slight darken when facing lights
    + edgeFactor * 0.05          // slight brighten in corners

  // Light intensity scale: boost all rect-area and point lights for export crispness
  const lightScale = 1.05 + (1 - frontRatio) * 0.15 + edgeFactor * 0.1

  // Bounce fill scale: boost when camera is low (eye level) for softer shadows
  const bounceScale = 1.0 + (1 - heightRatio) * 0.2 + (1 - frontRatio) * 0.15

  return {
    ambientIntensity: Math.min(ambientIntensity, 0.5),
    envMapIntensity: Math.min(envMapIntensity, 0.5),
    exposure: Math.max(0.85, Math.min(1.35, exposure)),
    lightScale: Math.min(lightScale, 1.5),
    bounceScale: Math.min(bounceScale, 1.5),
  }
}

// ── Export capture (runs inside Canvas so it can access gl/scene/camera) ──────
function ExportCapture({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { gl, scene, camera } = useThree()
  const { ceilingHeight } = useGarageStore()

  // Frame-counting helper: waitFrames(n) resolves after n R3F render ticks.
  // Default (priority=0) useFrame — R3F handles automatic rendering.
  const frameResolvers = useRef<Array<{ remaining: number; resolve: () => void }>>([])
  useFrame(() => {
    if (frameResolvers.current.length === 0) return
    for (const r of frameResolvers.current) r.remaining--
    const done = frameResolvers.current.filter(r => r.remaining <= 0)
    frameResolvers.current = frameResolvers.current.filter(r => r.remaining > 0)
    for (const r of done) r.resolve()
  })
  const waitFrames = (n: number) =>
    new Promise<void>(resolve => frameResolvers.current.push({ remaining: n, resolve }))

  useEffect(() => {
    const chFt = FT(ceilingHeight)

    // Save current camera view as an export shot (returns shot data + thumbnail).
    // Read the canvas directly — preserveDrawingBuffer=true means it holds the
    // latest composited frame from R3F's render loop. Do NOT call gl.render
    // imperatively: postprocessing's EffectComposer disables autoClear and may
    // leave the render target bound to its internal input buffer, so an
    // imperative render writes into that buffer instead of the canvas and
    // toDataURL reads a stale/blank backing store.
    exportCaptureRef.saveShot = () => {
      if (!camera || !orbitRef.current) return null
      const pos = camera.position.clone()
      const tgt = orbitRef.current.target?.clone() ?? new THREE.Vector3(0, chFt * 0.35, 0)
      const thumbnail = gl.domElement.toDataURL('image/jpeg', 0.6)
      const vm = useGarageStore.getState().viewMode
      const shotMode: 'perspective' | 'wireframe' = vm === 'wireframe' ? 'wireframe' : 'perspective'
      return {
        id: '', label: '',
        camX: pos.x, camY: pos.y, camZ: pos.z,
        targetX: tgt.x, targetY: tgt.y, targetZ: tgt.z,
        thumbnail,
        viewMode: shotMode,
      }
    }

    // Export capture — captures exactly what the viewport shows at the current DPR.
    // No DPR bump: bumping DPR mid-capture forces EffectComposer to resize all its
    // render targets, and the post-loop restore can clear the backing store during
    // the last iteration's flush — leaving the final shot as a blank white image.
    // Keep it simple: native DPR (typically 2) gives ~2× viewport resolution which
    // is plenty for PDF print, and removes the whole class of DPR-race bugs.
    exportCaptureRef.capture = async (shots: ExportShot[], onProgress?: (step: number) => void) => {
      const results: string[] = []

      if (orbitRef.current) orbitRef.current.enabled = false

      const origCamPos = camera.position.clone()
      const origTarget = orbitRef.current?.target?.clone() ?? new THREE.Vector3(0, chFt * 0.35, 0)
      const origViewMode = useGarageStore.getState().viewMode

      for (let i = 0; i < shots.length; i++) {
        if (onProgress) onProgress(i)
        const shot = shots[i]

        // Match the viewMode the shot was captured in (default 'perspective'
        // for legacy shots). Switching remounts EffectComposer and swaps the
        // lighting rig, so we need a couple of RAFs for React to rebuild the
        // tree before we start waiting on render frames.
        const shotMode = shot.viewMode ?? 'perspective'
        if (useGarageStore.getState().viewMode !== shotMode) {
          useGarageStore.getState().setViewMode(shotMode)
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          await waitFrames(4)
        }

        camera.position.set(shot.camX, shot.camY, shot.camZ)
        camera.lookAt(shot.targetX, shot.targetY, shot.targetZ)
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix?.()
        camera.updateMatrixWorld(true)

        // Let R3F's render loop run frames so the reflector FBO, shadow maps,
        // and SSAO converge for the new camera angle. Must go through R3F's loop
        // (not gl.render imperatively) or the reflector uses a stale texture.
        await waitFrames(6)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        results.push(gl.domElement.toDataURL('image/png'))
      }

      if (useGarageStore.getState().viewMode !== origViewMode) {
        useGarageStore.getState().setViewMode(origViewMode)
      }
      camera.position.copy(origCamPos)
      if (orbitRef.current?.target) {
        orbitRef.current.target.copy(origTarget)
        orbitRef.current.update()
      }
      camera.lookAt(origTarget)
      if (orbitRef.current) orbitRef.current.enabled = true

      return results
    }

    return () => { exportCaptureRef.capture = null; exportCaptureRef.saveShot = null }
  }, [gl, scene, camera, ceilingHeight, orbitRef])

  return null
}

/** Suspense fallback — shimmer box while 3D content loads */
function LoadingFallback() {
  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[2, 0.02, 2]} />
      <meshBasicMaterial color="#2a2f38" transparent opacity={0.5} />
    </mesh>
  )
}

// ── uid helper (matches store) ────────────────────────────────────────────────
let _uidCounter = 0
function uid(): string { return `shot_${Date.now()}_${++_uidCounter}` }

export default function Viewer3D() {
  const { viewMode, cameraAngle, setCameraAngle, setFloorSelected, selectWall, selectShape, selectSlatwallPanel, selectItem,
    selectBaseboard, selectStemWall,
    exportShots, addExportShot, updateExportShot, deleteExportShot, reorderExportShots,
    walls, cabinets, countertops, floorPoints, floorSteps, slatwallPanels, overheadRacks, baseboards, stemWalls,
    items, importedAssets,
    qualityPreset, snappingEnabled, setSnappingEnabled,
    wallAngleSnapEnabled, setWallAngleSnapEnabled,
    cornerAngleLabelsVisible, setCornerAngleLabelsVisible } = useGarageStore()
  // Floor-plan measurement tool — when ON, shows a draggable tape-measure
  // line on the floor plan with two endpoint handles.
  const [measureToolEnabled, setMeasureToolEnabled] = useState(false)
  const isWireframe  = viewMode === 'wireframe'
  const isPerspective = viewMode === 'perspective' || viewMode === 'wireframe'
  const orbitRef     = useRef<any>(null)
  const isTopView = viewMode === 'top'
  const bgColor = isWireframe ? '#0a0f1a' : isTopView ? '#ffffff' : '#ffffff'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Wireframe mode floor-grid visibility (local toggle, not persisted)
  const [gridVisible, setGridVisible] = useState(false)
  const showGrid     = (viewMode === 'top') || (viewMode === 'wireframe' && gridVisible)

  const handleSaveShot = useCallback(() => {
    if (!exportCaptureRef.saveShot) return
    const data = exportCaptureRef.saveShot()
    if (!data) return
    const shotNum = exportShots.length + 1
    addExportShot({ ...data, id: uid(), label: `Shot ${shotNum}` })
  }, [exportShots.length, addExportShot])

  // ── Top view: pan/zoom state ──
  // Use refs + forceUpdate so zoom and pan are always in sync (no stale-state batching issues)
  const fpZoomRef = useRef(1)
  const fpPanRef = useRef<[number, number]>([0, 0])
  const [, forceUpdate] = useState(0)
  const fpDragging = useRef(false)
  const fpLastMouse = useRef<[number, number]>([0, 0])

  // Reset pan/zoom when entering top view
  useEffect(() => {
    if (isTopView) { fpZoomRef.current = 1; fpPanRef.current = [0, 0]; forceUpdate(n => n + 1) }
  }, [isTopView])

  // Expose as local vars for rendering
  const fpZoom = fpZoomRef.current
  const fpPan = fpPanRef.current

  if (isTopView) {
    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const oldZ = fpZoomRef.current
      const newZ = Math.min(Math.max(oldZ * factor, 0.3), 8)
      const r = newZ / oldZ
      // Zoom toward cursor: adjust pan so the point under the mouse stays fixed
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const [px, py] = fpPanRef.current
      fpZoomRef.current = newZ
      fpPanRef.current = [mx * (1 - r) + px * r, my * (1 - r) + py * r]
      forceUpdate(n => n + 1)
    }
    const handlePointerDown = (e: React.PointerEvent) => {
      // Only pan on right-click (2) or middle-click (1). Left-click (0) is
      // reserved for cabinet/rack drag inside the SVG.
      if (e.button !== 1 && e.button !== 2) return
      e.preventDefault()
      fpDragging.current = true
      fpLastMouse.current = [e.clientX, e.clientY]
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    const handlePointerMove = (e: React.PointerEvent) => {
      if (!fpDragging.current) return
      const dx = e.clientX - fpLastMouse.current[0]
      const dy = e.clientY - fpLastMouse.current[1]
      fpLastMouse.current = [e.clientX, e.clientY]
      fpPanRef.current = [fpPanRef.current[0] + dx, fpPanRef.current[1] + dy]
      forceUpdate(n => n + 1)
    }
    const handlePointerUp = (e: React.PointerEvent) => {
      fpDragging.current = false
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch (_) {}
    }

    return (
      <div className="viewer-wrap" style={{ background: '#fff', position: 'relative' }}>
        <UndoRedoOverlay />
        <div
          className="floor-plan-svg-viewport"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: fpDragging.current ? 'grabbing' : 'default' }}
        >
          <div style={{
            transform: `translate(${fpPan[0]}px, ${fpPan[1]}px) scale(${fpZoom})`,
            transformOrigin: 'center center',
            width: '100%',
            height: '100%',
          }}>
            <FloorPlanBlueprint
              walls={walls}
              cabinets={cabinets}
              countertops={countertops}
              floorPoints={floorPoints}
              floorSteps={floorSteps}
              slatwallPanels={slatwallPanels}
              overheadRacks={overheadRacks}
              baseboards={baseboards}
              stemWalls={stemWalls}
              items={items}
              importedAssets={importedAssets}
              showMeasureTool={measureToolEnabled}
            />
          </div>
        </div>
        {/* Snap toggle — also available in floor plan view */}
        <div className="shot-panel">
          <div className="shot-btn-row">
            <button
              className={`shot-save-btn snap-toggle-btn${snappingEnabled ? '' : ' off'}`}
              onClick={() => setSnappingEnabled(!snappingEnabled)}
              title={snappingEnabled ? 'Snapping ON — click to disable' : 'Snapping OFF — click to enable'}
              aria-pressed={!snappingEnabled}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6h-6z" />
              </svg>
              Snap: {snappingEnabled ? 'On' : 'Off'}
            </button>
            <button
              className={`shot-save-btn snap-toggle-btn${wallAngleSnapEnabled ? '' : ' off'}`}
              onClick={() => setWallAngleSnapEnabled(!wallAngleSnapEnabled)}
              title={wallAngleSnapEnabled ? 'Wall angle snap ON — click to disable' : 'Wall angle snap OFF — click to enable'}
              aria-pressed={!wallAngleSnapEnabled}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21 L21 3 M3 21 L21 21 M12 21 L12 12" />
              </svg>
              Angle Snap: {wallAngleSnapEnabled ? 'On' : 'Off'}
            </button>
            <button
              className={`shot-save-btn snap-toggle-btn${cornerAngleLabelsVisible ? '' : ' off'}`}
              onClick={() => setCornerAngleLabelsVisible(!cornerAngleLabelsVisible)}
              title={cornerAngleLabelsVisible ? 'Corner angle labels ON — click to hide' : 'Corner angle labels OFF — click to show'}
              aria-pressed={!cornerAngleLabelsVisible}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20 L20 20 M4 20 L12 6 M12 6 L20 20 M8 17 A5 5 0 0 1 16 17" />
              </svg>
              Angle Labels: {cornerAngleLabelsVisible ? 'On' : 'Off'}
            </button>
            <button
              className={`shot-save-btn snap-toggle-btn${measureToolEnabled ? '' : ' off'}`}
              onClick={() => setMeasureToolEnabled(!measureToolEnabled)}
              title={measureToolEnabled ? 'Measure tool ON — click to hide' : 'Measure tool OFF — click to show'}
              aria-pressed={!measureToolEnabled}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 14 L14 3 L21 10 L10 21 Z M6 13 L8 11 M9 16 L11 14 M12 19 L14 17" />
              </svg>
              Measure: {measureToolEnabled ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        {/* View mode label */}
        <div className="view-label view-label--blueprint">Floor Plan</div>
      </div>
    )
  }

  return (
    <div className="viewer-wrap" style={{ position: 'relative' }}>
      <UndoRedoOverlay />
      <Canvas
        shadows={qualityPreset === 'low' ? false : qualityPreset === 'high' ? 'variance' : 'soft'}
        dpr={[1, 2]}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          toneMapping: THREE.NoToneMapping,
          powerPreference: qualityPreset === 'low' ? 'low-power' : 'high-performance',
        }}
        style={{ background: bgColor }}
        onPointerMissed={() => { setFloorSelected(false); selectShape(null); selectSlatwallPanel(null); selectItem(null); selectBaseboard(null); selectStemWall(null) }}
      >
        <SceneBackground />
        <RectAreaLightInit />
        <SceneCamera orbitRef={orbitRef} />
        <ExportCapture orbitRef={orbitRef} />
        {isPerspective && <WASDController orbitRef={orbitRef} />}
        {isWireframe ? <WireframeLighting /> : <SceneLighting />}

        {showGrid && (
          <Grid
            position={[0, 0.01, 0]}
            args={[200, 200]}
            // Thicker lines in wireframe let the shader's built-in derivative
            // AA sample more pixels per line, which kills shimmer at distance.
            cellSize={1}
            cellThickness={isWireframe ? 0.8 : 0.4}
            cellColor={isWireframe ? '#1a3050' : '#e0e0e0'}
            sectionSize={10}
            sectionThickness={isWireframe ? 1.4 : 0.8}
            sectionColor={isWireframe ? '#2d5a85' : '#cccccc'}
            fadeDistance={150}
            fadeStrength={1}
            infiniteGrid
          />
        )}

        <Suspense fallback={<LoadingFallback />}>
          <GarageShell />
        </Suspense>

        {/* Post-processing: SSAO + tone mapping — keyed so clean unmount/remount on mode switch.
            Low quality: tone mapping only (no SSAO). Medium: SSAO low quality. High: SSAO medium. */}
        {!isWireframe ? (
          /* multisampling enables MSAA on the composer's internal render
             target. Without it, Canvas's gl.antialias=true has no effect
             because the scene renders into a non-multisampled offscreen
             buffer, and everything comes out aliased — worst on rounded
             geometry and high-frequency textures like the countertops. */
          <EffectComposer
            key={`${viewMode}-${qualityPreset}`}
            multisampling={qualityPreset === 'high' ? 8 : 4}
          >
            {qualityPreset !== 'low' && (
              <N8AO
                aoRadius={qualityPreset === 'high' ? 0.8 : 0.5}
                intensity={qualityPreset === 'high' ? 1.5 : 1.0}
                distanceFalloff={0.5}
                quality={qualityPreset === 'high' ? 'medium' : 'low'}
              />
            )}
            <ToneMapping mode={ToneMappingMode.AGX} />
          </EffectComposer>
        ) : (
          <EffectComposer key={`wire-${qualityPreset}`} multisampling={8}>
            <SMAA />
          </EffectComposer>
        )}

      </Canvas>

      {/* Perspective angle presets — 2×2 grid */}
      {isPerspective && (
        <div className="cam-angles">
          <div className="cam-grid">
            {PERSPECTIVE_ANGLES.map((a, i) => (
              <button
                key={i}
                className={`cam-btn ${cameraAngle === i ? 'active' : ''}`}
                onClick={() => setCameraAngle(i)}
                aria-label={`Camera angle: ${a.label === 'FL' ? 'Front Left' : a.label === 'FR' ? 'Front Right' : a.label === 'BL' ? 'Back Left' : 'Back Right'}`}
                aria-pressed={cameraAngle === i}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="cam-hint">WASD to walk</div>
        </div>
      )}

      {/* ── Export shots + snap toggle panel ── */}
      <div className="shot-panel">
          <div className="shot-btn-row">
            {isPerspective && (
              <button className="shot-save-btn" onClick={handleSaveShot}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Save Shot
              </button>
            )}
            <button
              className={`shot-save-btn snap-toggle-btn${snappingEnabled ? '' : ' off'}`}
              onClick={() => setSnappingEnabled(!snappingEnabled)}
              title={snappingEnabled ? 'Snapping ON — click to disable' : 'Snapping OFF — click to enable'}
              aria-pressed={!snappingEnabled}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
              Snap: {snappingEnabled ? 'On' : 'Off'}
            </button>
            {isWireframe && (
              <button
                className={`shot-save-btn snap-toggle-btn${gridVisible ? '' : ' off'}`}
                onClick={() => setGridVisible(!gridVisible)}
                title={gridVisible ? 'Floor grid ON — click to hide' : 'Floor grid OFF — click to show'}
                aria-pressed={!gridVisible}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
                </svg>
                Grid: {gridVisible ? 'On' : 'Off'}
              </button>
            )}
            {isWireframe && (
              <button
                className={`shot-save-btn snap-toggle-btn${cornerAngleLabelsVisible ? '' : ' off'}`}
                onClick={() => setCornerAngleLabelsVisible(!cornerAngleLabelsVisible)}
                title={cornerAngleLabelsVisible ? 'Corner angle labels ON — click to hide' : 'Corner angle labels OFF — click to show'}
                aria-pressed={!cornerAngleLabelsVisible}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20 L20 20 M4 20 L12 6 M12 6 L20 20 M8 17 A5 5 0 0 1 16 17" />
                </svg>
                Angle Labels: {cornerAngleLabelsVisible ? 'On' : 'Off'}
              </button>
            )}
          </div>

          {isPerspective && exportShots.length > 0 && (
            <div className="shot-list">
              {exportShots.map((shot, idx) => (
                <div
                  key={shot.id}
                  className={`shot-item${dragId === shot.id ? ' shot-dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragId(shot.id)}
                  onDragOver={e => { e.preventDefault() }}
                  onDrop={() => {
                    if (dragId && dragId !== shot.id) {
                      const ids = exportShots.map(s => s.id)
                      const fromIdx = ids.indexOf(dragId)
                      const toIdx = ids.indexOf(shot.id)
                      ids.splice(fromIdx, 1)
                      ids.splice(toIdx, 0, dragId)
                      reorderExportShots(ids)
                    }
                    setDragId(null)
                  }}
                  onDragEnd={() => setDragId(null)}
                >
                  <img src={shot.thumbnail} alt={shot.label} className="shot-thumb" />
                  <div className="shot-info">
                    {editingId === shot.id ? (
                      <input
                        className="shot-label-input"
                        defaultValue={shot.label}
                        autoFocus
                        onBlur={e => { updateExportShot(shot.id, { label: e.target.value || `Shot ${idx + 1}` }); setEditingId(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    ) : (
                      <span className="shot-label" onDoubleClick={() => setEditingId(shot.id)}>{shot.label}</span>
                    )}
                    <span className="shot-num">#{idx + 1}</span>
                  </div>
                  <button className="shot-del-btn" onClick={() => deleteExportShot(shot.id)} aria-label={`Delete ${shot.label}`}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {isPerspective && exportShots.length > 0 && (
            <div className="shot-hint">{exportShots.length} shot{exportShots.length !== 1 ? 's' : ''} saved for export</div>
          )}
        </div>

      {/* View mode label */}
      <div className="view-label">
        {viewMode === 'perspective' && '3D Perspective'}
        {viewMode === 'wireframe'   && 'Wireframe'}
        {viewMode === 'elevation'   && 'Wall Edit'}
      </div>
    </div>
  )
}
