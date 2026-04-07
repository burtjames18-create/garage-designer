import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, MapControls,
  PerspectiveCamera, OrthographicCamera,
  Grid, Environment,
} from '@react-three/drei'
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import React, { Suspense, useRef, useEffect, useCallback, useState } from 'react'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { useGarageStore } from '../store/garageStore'
import type { ExportShot, QualityPreset } from '../store/garageStore'
import GarageShell from './GarageShell'
import FloorPlanBlueprint from './FloorPlanBlueprint'
import { exportCaptureRef } from '../utils/exportCapture'
import './Viewer3D.css'

const FT = (inches: number) => inches / 12


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
        <MapControls ref={orbitRef} target={[cx, 0, cz]}
          enableRotate={false} screenSpacePanning enabled={!isDraggingWall} />
      </>
    )
  }

  return null
}

function SceneLighting() {
  const { ambientIntensity, envReflection, sceneLights, qualityPreset } = useGarageStore()
  // On low quality, disable shadows on scene lights entirely
  const enableSceneShadows = qualityPreset !== 'low'
  return (
    <>
      {/* Environment for reflections only (epoxy, steel) */}
      <Environment preset="warehouse" environmentIntensity={envReflection} />

      {/* Ambient fill — user-adjustable base illumination */}
      <ambientLight intensity={ambientIntensity} />

      {/* All real illumination comes from user-placed ceiling lights (CeilingLightMesh)
         and any additional scene lights below */}
      {sceneLights.filter(l => l.enabled).map(l => (
        l.type === 'spot' ? (
          <spotLight
            key={l.id}
            position={[l.x, l.y, l.z]}
            intensity={l.intensity * 80}
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
            intensity={l.intensity * 80}
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
  const { garageWidth, garageDepth, ceilingHeight } = useGarageStore()

  useEffect(() => {
    const chFt = FT(ceilingHeight)

    // Save current camera view as an export shot (returns shot data + thumbnail)
    exportCaptureRef.saveShot = () => {
      if (!camera || !orbitRef.current) return null
      const pos = camera.position.clone()
      const tgt = orbitRef.current.target?.clone() ?? new THREE.Vector3(0, chFt * 0.35, 0)

      // Render a small thumbnail
      const origRatio = gl.getPixelRatio()
      gl.setPixelRatio(1)
      gl.render(scene, camera)
      const thumbnail = gl.domElement.toDataURL('image/jpeg', 0.6)
      gl.setPixelRatio(origRatio)
      gl.render(scene, camera)

      return {
        id: '',  // caller assigns id
        label: '',
        camX: pos.x, camY: pos.y, camZ: pos.z,
        targetX: tgt.x, targetY: tgt.y, targetZ: tgt.z,
        thumbnail,
      }
    }

    // High-res capture with full visual quality: reflections, smart lighting,
    // tone mapping. Each shot gets automatic lighting adjustments based on
    // camera angle relative to ceiling lights and garage geometry.
    exportCaptureRef.capture = async (shots: ExportShot[], onProgress?: (step: number) => void) => {
      const results: string[] = []
      const store = useGarageStore.getState()

      // ── Force high quality for export — components read isExporting to override qualityPreset ──
      useGarageStore.getState().setIsExporting(true)
      // Wait a frame so React re-renders with isExporting=true (swaps floor to reflector, enables shadows)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      // ── Save ALL original renderer state ──
      const originalPixelRatio = gl.getPixelRatio()
      const originalToneMapping = gl.toneMapping
      const originalToneMappingExposure = gl.toneMappingExposure
      const originalShadowMapEnabled = gl.shadowMap.enabled

      // ── Save original scene lighting state ──
      const origLightStates: { obj: any; intensity: number }[] = []
      const origAmbientStates: { obj: any; intensity: number }[] = []
      const origEnvMapMaterials: { mat: any; envMapIntensity: number }[] = []
      scene.traverse((obj: any) => {
        if (obj.isAmbientLight) {
          origAmbientStates.push({ obj, intensity: obj.intensity })
        } else if (obj.isRectAreaLight || obj.isPointLight || obj.isSpotLight) {
          origLightStates.push({ obj, intensity: obj.intensity })
        }
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const mat of mats) {
            if (mat.envMapIntensity !== undefined) {
              origEnvMapMaterials.push({ mat, envMapIntensity: mat.envMapIntensity })
            }
          }
        }
      })

      // ── Configure renderer for maximum export quality ──
      gl.toneMapping = THREE.AgXToneMapping
      gl.toneMappingExposure = 1.0
      gl.shadowMap.enabled = true
      gl.setPixelRatio(Math.min(window.devicePixelRatio * 2, 4))

      // ── Keep MeshReflectorMaterial — floor reflections are a key visual feature.
      // We render extra warm-up frames so the reflector's internal render-to-texture
      // pass updates for each new camera position. ──

      // Save original camera and canvas state
      const origCamPos = camera.position.clone()
      const origTarget = orbitRef.current?.target?.clone() ?? new THREE.Vector3(0, chFt * 0.35, 0)
      const origCanvasWidth = gl.domElement.width
      const origCanvasHeight = gl.domElement.height
      const origCanvasStyleW = gl.domElement.style.width
      const origCanvasStyleH = gl.domElement.style.height

      // Resize canvas to 4K for high-res capture
      const exportW = 3840, exportH = 2160
      gl.setPixelRatio(1)
      gl.setSize(exportW, exportH, false)
      if ((camera as THREE.PerspectiveCamera).aspect !== undefined) {
        ;(camera as THREE.PerspectiveCamera).aspect = exportW / exportH
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      }

      const waitFrames = (n: number) => new Promise<void>(resolve => {
        let count = 0
        const tick = () => { if (++count >= n) resolve(); else requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })

      for (let i = 0; i < shots.length; i++) {
        if (onProgress) onProgress(i)
        const shot = shots[i]

        // Position camera for this shot
        camera.position.set(shot.camX, shot.camY, shot.camZ)
        if (orbitRef.current?.target) {
          orbitRef.current.target.set(shot.targetX, shot.targetY, shot.targetZ)
          orbitRef.current.update()
        }
        camera.lookAt(shot.targetX, shot.targetY, shot.targetZ)
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix?.()

        // ── Smart lighting: compute optimal settings for this camera angle ──
        const overrides = computeExportLighting(
          camera.position,
          new THREE.Vector3(shot.targetX, shot.targetY, shot.targetZ),
          store.ceilingLights,
          garageWidth, garageDepth, ceilingHeight,
          store.ambientIntensity,
          store.envReflection,
        )

        // Apply per-shot lighting overrides
        gl.toneMappingExposure = overrides.exposure

        for (const s of origAmbientStates) {
          s.obj.intensity = overrides.ambientIntensity
        }

        // Scale all scene lights (rect-area, point, spot)
        // Separate bounce point lights (positioned below ceiling fixtures) get bounceScale
        for (const s of origLightStates) {
          if (s.obj.isPointLight && s.obj.parent?.isGroup) {
            // Bounce light inside a ceiling fixture group — use bounceScale
            s.obj.intensity = s.intensity * overrides.bounceScale
          } else {
            s.obj.intensity = s.intensity * overrides.lightScale
          }
        }

        // Boost env map on all materials for richer reflections
        for (const s of origEnvMapMaterials) {
          s.mat.envMapIntensity = overrides.envMapIntensity
        }

        // ── Warm-up frames: let reflector material, shadows, and lighting stabilize.
        // MeshReflectorMaterial needs its internal mirror render pass to execute
        // with the new camera position — each gl.render() triggers onBeforeRender
        // which updates the reflection texture. We do multiple passes so the
        // reflection converges (reflections of reflections, light bounces). ──
        for (let f = 0; f < 6; f++) {
          gl.setRenderTarget(null)
          gl.clear()
          gl.render(scene, camera)
        }
        // Then let the R3F loop also run a few frames for any async updates
        await waitFrames(8)

        // Final render at 4K
        gl.setRenderTarget(null)
        gl.clear()
        gl.render(scene, camera)
        results.push(gl.domElement.toDataURL('image/jpeg', 0.95))

        // Restore original light intensities before next shot (re-computed per shot)
        for (const s of origAmbientStates) s.obj.intensity = s.intensity
        for (const s of origLightStates) s.obj.intensity = s.intensity
        for (const s of origEnvMapMaterials) s.mat.envMapIntensity = s.envMapIntensity
      }

      // ── Restore everything ──
      useGarageStore.getState().setIsExporting(false)
      gl.setPixelRatio(originalPixelRatio)
      gl.setSize(origCanvasWidth / originalPixelRatio, origCanvasHeight / originalPixelRatio, false)
      gl.domElement.style.width = origCanvasStyleW
      gl.domElement.style.height = origCanvasStyleH
      if ((camera as THREE.PerspectiveCamera).aspect !== undefined) {
        ;(camera as THREE.PerspectiveCamera).aspect = origCanvasWidth / origCanvasHeight
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
      }
      gl.toneMapping = originalToneMapping
      gl.toneMappingExposure = originalToneMappingExposure
      gl.shadowMap.enabled = originalShadowMapEnabled
      camera.position.copy(origCamPos)
      if (orbitRef.current?.target) {
        orbitRef.current.target.copy(origTarget)
        orbitRef.current.update()
      }
      camera.lookAt(origTarget)
      gl.render(scene, camera)

      return results
    }

    return () => { exportCaptureRef.capture = null; exportCaptureRef.saveShot = null }
  }, [gl, scene, camera, garageWidth, garageDepth, ceilingHeight, orbitRef])

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
    exportShots, addExportShot, updateExportShot, deleteExportShot, reorderExportShots,
    walls, cabinets, countertops, floorPoints, floorSteps, slatwallPanels, overheadRacks,
    qualityPreset } = useGarageStore()
  const isWireframe  = viewMode === 'wireframe'
  const isPerspective = viewMode === 'perspective' || viewMode === 'wireframe'
  const showGrid     = viewMode === 'top' || viewMode === 'wireframe'
  const orbitRef     = useRef<any>(null)
  const isTopView = viewMode === 'top'
  const bgColor = isWireframe ? '#0a0f1a' : isTopView ? '#ffffff' : '#ffffff'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const handleSaveShot = useCallback(() => {
    if (!exportCaptureRef.saveShot) return
    const data = exportCaptureRef.saveShot()
    if (!data) return
    const shotNum = exportShots.length + 1
    addExportShot({ ...data, id: uid(), label: `Shot ${shotNum}` })
  }, [exportShots.length, addExportShot])

  // ── Top view: pan/zoom state ──
  const [fpZoom, setFpZoom] = useState(1)
  const [fpPan, setFpPan] = useState<[number, number]>([0, 0])
  const fpDragging = useRef(false)
  const fpLastMouse = useRef<[number, number]>([0, 0])

  // Reset pan/zoom when entering top view
  useEffect(() => {
    if (isTopView) { setFpZoom(1); setFpPan([0, 0]) }
  }, [isTopView])

  if (isTopView) {
    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setFpZoom(z => Math.min(Math.max(z * delta, 0.3), 8))
    }
    const handlePointerDown = (e: React.PointerEvent) => {
      // Don't start viewport pan if clicking on an interactive SVG element (rack polygon/circle)
      const target = e.target as Element
      if (target instanceof SVGPolygonElement || target instanceof SVGCircleElement) return
      fpDragging.current = true
      fpLastMouse.current = [e.clientX, e.clientY]
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
    const handlePointerMove = (e: React.PointerEvent) => {
      if (!fpDragging.current) return
      const dx = e.clientX - fpLastMouse.current[0]
      const dy = e.clientY - fpLastMouse.current[1]
      fpLastMouse.current = [e.clientX, e.clientY]
      setFpPan(([px, py]) => [px + dx, py + dy])
    }
    const handlePointerUp = () => { fpDragging.current = false }

    return (
      <div className="viewer-wrap" style={{ background: '#fff' }}>
        <div
          className="floor-plan-svg-viewport"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ cursor: fpDragging.current ? 'grabbing' : 'grab' }}
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
            />
          </div>
        </div>
        {/* View mode label */}
        <div className="view-label view-label--blueprint">Floor Plan</div>
      </div>
    )
  }

  return (
    <div className="viewer-wrap">
      <Canvas
        shadows={qualityPreset !== 'low'}
        gl={{
          preserveDrawingBuffer: true,
          antialias: qualityPreset !== 'low',
          toneMapping: THREE.NoToneMapping,
          powerPreference: qualityPreset === 'low' ? 'low-power' : 'high-performance',
        }}
        style={{ background: bgColor }}
        onPointerMissed={() => { setFloorSelected(false); selectWall(null); selectShape(null); selectSlatwallPanel(null); selectItem(null) }}
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
            cellSize={1}
            cellThickness={0.4}
            cellColor={isWireframe ? '#1a3050' : '#e0e0e0'}
            sectionSize={10}
            sectionThickness={0.8}
            sectionColor={isWireframe ? '#204060' : '#cccccc'}
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
          <EffectComposer key={`${viewMode}-${qualityPreset}`}>
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
          <GLClear />
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

      {/* ── Export shots panel ── */}
      {isPerspective && (
        <div className="shot-panel">
          <button className="shot-save-btn" onClick={handleSaveShot}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Save Shot
          </button>

          {exportShots.length > 0 && (
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

          {exportShots.length > 0 && (
            <div className="shot-hint">{exportShots.length} shot{exportShots.length !== 1 ? 's' : ''} saved for export</div>
          )}
        </div>
      )}

      {/* View mode label */}
      <div className="view-label">
        {viewMode === 'perspective' && '3D Perspective'}
        {viewMode === 'wireframe'   && 'Wireframe'}
      </div>
    </div>
  )
}
