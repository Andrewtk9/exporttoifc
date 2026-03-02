import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import type { MeshData } from '../lib/ipc'

export async function parseFile(filename: string, data: Uint8Array): Promise<MeshData[]> {
  const ext = filename.split('.').pop()?.toLowerCase()

  let object: THREE.Object3D

  switch (ext) {
    case 'fbx':
      object = parseFBX(data)
      break
    case 'obj':
      object = parseOBJ(data)
      break
    case 'gltf':
    case 'glb':
      object = await parseGLTF(data, ext)
      break
    case 'dae':
      object = parseCollada(data)
      break
    default:
      throw new Error(`Formato .${ext} não suportado`)
  }

  return extractMeshes(object)
}

function parseFBX(data: Uint8Array): THREE.Object3D {
  const loader = new FBXLoader()
  const group = loader.parse(data.buffer, '')
  return group
}

function parseOBJ(data: Uint8Array): THREE.Object3D {
  const loader = new OBJLoader()
  const text = new TextDecoder().decode(data)
  return loader.parse(text)
}

async function parseGLTF(data: Uint8Array, ext: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.parse(
      data.buffer,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(new Error(`Erro ao carregar ${ext}: ${error}`))
    )
  })
}

function parseCollada(data: Uint8Array): THREE.Object3D {
  const loader = new ColladaLoader()
  const text = new TextDecoder().decode(data)
  const result = loader.parse(text, '')
  return result.scene
}

function extractMeshes(object: THREE.Object3D): MeshData[] {
  const meshes: MeshData[] = []
  let meshIndex = 0

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    const geometry = child.geometry as THREE.BufferGeometry

    // Get world matrix to include transformations
    child.updateWorldMatrix(true, false)
    const cloned = geometry.clone()
    cloned.applyMatrix4(child.matrixWorld)

    const posAttr = cloned.getAttribute('position')
    if (!posAttr) return

    const vertices = new Float64Array(posAttr.count * 3)
    for (let i = 0; i < posAttr.count; i++) {
      vertices[i * 3] = posAttr.getX(i)
      vertices[i * 3 + 1] = posAttr.getY(i)
      vertices[i * 3 + 2] = posAttr.getZ(i)
    }

    let indices: Uint32Array
    if (cloned.index) {
      indices = new Uint32Array(cloned.index.array)
    } else {
      // Non-indexed geometry: create sequential indices
      indices = new Uint32Array(posAttr.count)
      for (let i = 0; i < posAttr.count; i++) {
        indices[i] = i
      }
    }

    const normAttr = cloned.getAttribute('normal')
    let normals: Float64Array
    if (normAttr) {
      normals = new Float64Array(normAttr.count * 3)
      for (let i = 0; i < normAttr.count; i++) {
        normals[i * 3] = normAttr.getX(i)
        normals[i * 3 + 1] = normAttr.getY(i)
        normals[i * 3 + 2] = normAttr.getZ(i)
      }
    } else {
      normals = new Float64Array(0)
    }

    // Extract color from material
    let color = { r: 0.7, g: 0.7, b: 0.7 }
    const material = child.material
    if (material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshPhongMaterial ||
        material instanceof THREE.MeshLambertMaterial ||
        material instanceof THREE.MeshBasicMaterial) {
      color = {
        r: material.color.r,
        g: material.color.g,
        b: material.color.b
      }
    }

    meshes.push({
      name: child.name || `Mesh_${meshIndex}`,
      vertices,
      indices,
      normals,
      color
    })

    meshIndex++
    cloned.dispose()
  })

  return meshes
}
