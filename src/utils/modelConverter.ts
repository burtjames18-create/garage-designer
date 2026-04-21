/**
 * Converts OBJ, FBX, STL, and GLTF/GLB files into a Three.js Object3D.
 * Also handles image-based textures (JPG, PNG, WEBP) for wall/floor use.
 */
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export type ModelFileType = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl'
export type TextureFileType = 'jpg' | 'jpeg' | 'png' | 'webp'

export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx', '.stl'] as const
export const TEXTURE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const
export const ALL_EXTENSIONS = [...MODEL_EXTENSIONS, ...TEXTURE_EXTENSIONS] as const

export function getFileType(filename: string): ModelFileType | TextureFileType | null {
  const ext = filename.toLowerCase().split('.').pop()
  if (!ext) return null
  const modelTypes: Record<string, ModelFileType> = { glb: 'glb', gltf: 'gltf', obj: 'obj', fbx: 'fbx', stl: 'stl' }
  const texTypes: Record<string, TextureFileType> = { jpg: 'jpg', jpeg: 'jpeg', png: 'png', webp: 'webp' }
  return modelTypes[ext] ?? texTypes[ext] ?? null
}

export function isModelFile(filename: string): boolean {
  const ext = '.' + filename.toLowerCase().split('.').pop()
  return MODEL_EXTENSIONS.includes(ext as any)
}

export function isTextureFile(filename: string): boolean {
  const ext = '.' + filename.toLowerCase().split('.').pop()
  return TEXTURE_EXTENSIONS.includes(ext as any)
}

/** Load a 3D model file and return a Three.js Object3D */
export async function loadModelFile(file: File): Promise<THREE.Object3D> {
  const type = getFileType(file.name) as ModelFileType
  const arrayBuffer = await file.arrayBuffer()

  switch (type) {
    case 'glb': {
      const loader = new GLTFLoader()
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(arrayBuffer, '', resolve, reject)
      })
      return gltf.scene
    }
    case 'gltf': {
      const text = await file.text()
      const loader = new GLTFLoader()
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(text, '', resolve, reject)
      })
      return gltf.scene
    }
    case 'obj': {
      const text = await file.text()
      const loader = new OBJLoader()
      return loader.parse(text)
    }
    case 'fbx': {
      const loader = new FBXLoader()
      const result = loader.parse(arrayBuffer, '')
      return result
    }
    case 'stl': {
      const loader = new STLLoader()
      const geometry = loader.parse(arrayBuffer)
      const material = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 0.3, roughness: 0.6 })
      return new THREE.Mesh(geometry, material)
    }
    default:
      throw new Error(`Unsupported model format: ${type}`)
  }
}

/** Center a model on origin and optionally normalize its scale */
export function centerModel(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj)
  const center = box.getCenter(new THREE.Vector3())
  const min = box.min
  // Move so bottom-center is at origin
  obj.position.set(-center.x, -min.y, -center.z)
}

/** Convert an Object3D to a GLB ArrayBuffer for storage */
export async function objectToGLB(obj: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(obj, (result) => {
      resolve(result as ArrayBuffer)
    }, reject, { binary: true })
  })
}

/** Read a texture image file and return a data URL */
export async function readTextureFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
