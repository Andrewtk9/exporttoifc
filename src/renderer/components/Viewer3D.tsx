import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MeshData } from '../lib/ipc'

interface Viewer3DProps {
  meshes: MeshData[]
}

export default function Viewer3D({ meshes }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    animationId: number
  } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f0f1a)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.8

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7)
    scene.add(directionalLight)

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3)
    fillLight.position.set(-5, -2, -5)
    scene.add(fillLight)

    // Grid
    const grid = new THREE.GridHelper(50, 50, 0x222244, 0x161630)
    scene.add(grid)

    // Animate
    const animate = () => {
      const animId = requestAnimationFrame(animate)
      sceneRef.current!.animationId = animId
      controls.update()
      renderer.render(scene, camera)
    }

    sceneRef.current = { scene, camera, renderer, controls, animationId: 0 }
    animate()

    // Resize
    const handleResize = () => {
      if (!container) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(sceneRef.current?.animationId || 0)
      renderer.dispose()
      container.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  // Update meshes
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    // Remove old meshes
    const toRemove: THREE.Object3D[] = []
    ctx.scene.traverse((obj) => {
      if (obj.userData.isModelMesh) toRemove.push(obj)
    })
    toRemove.forEach((obj) => {
      ctx.scene.remove(obj)
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (obj.material instanceof THREE.Material) obj.material.dispose()
      }
    })

    if (meshes.length === 0) return

    // Add new meshes
    const group = new THREE.Group()
    group.userData.isModelMesh = true

    for (const meshData of meshes) {
      const geometry = new THREE.BufferGeometry()

      const vertices = new Float32Array(meshData.vertices)
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))

      if (meshData.indices.length > 0) {
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(meshData.indices), 1))
      }

      if (meshData.normals.length > 0) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(meshData.normals), 3))
      } else {
        geometry.computeVertexNormals()
      }

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(meshData.color.r, meshData.color.g, meshData.color.b),
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide
      })

      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.isModelMesh = true
      group.add(mesh)
    }

    ctx.scene.add(group)

    // Fit camera
    const box = new THREE.Box3().setFromObject(group)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const distance = maxDim * 1.5

    ctx.camera.position.set(
      center.x + distance * 0.7,
      center.y + distance * 0.5,
      center.z + distance * 0.7
    )
    ctx.controls.target.copy(center)
    ctx.controls.update()
  }, [meshes])

  return (
    <div ref={containerRef} className="w-full h-full" />
  )
}
