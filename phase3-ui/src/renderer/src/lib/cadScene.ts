// Pure three.js controller for the CAD viewer (Task 5). No React — a canvas in, an imperative
// controller out — so the scene lifecycle (renderer, controls, disposal) is separate from the
// component and the explode/isolate logic is inspectable on its own.
//
// The GLB comes from the trusted STEP→GLB converter (phase-cad/step_to_glb.py). Its structure,
// verified against real output: scene → a root container → one GROUP per part, named by the
// part's build123d label (`sun_gear`, `planet_gear_1`, …), meshes nested inside each Group.
// So a "part" is a named child of the container, and it's individually addressable — which is
// exactly what exploded-view / drill-down / reassemble need.
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

export interface CadPart {
  name: string
  visible: boolean
}

export interface CadSceneController {
  load(glb: ArrayBuffer): Promise<CadPart[]>
  clear(): void // remove the current model (for glb → null); invalidates any in-flight load
  setExplode(factor: number): void // 0 = assembled; larger = parts pushed radially outward
  setIsolated(name: string | null): void // show only this part (drill-down); null = show all
  setPartVisible(name: string, visible: boolean): void
  frameAll(): void
  getBounds(): [number, number, number] | null // model bounding-box size [x,y,z] in mm, or null if no model
  resize(): void
  dispose(): void
}

interface PartNode {
  name: string
  object: THREE.Object3D
  home: THREE.Vector3 // original local position
  dir: THREE.Vector3 // unit direction from assembly center to this part's center
}

// Walk single-child container chains to the node whose children are the actual parts. For our
// converter that's scene → COMPOUND → [parts]; for a flatter export it's the scene itself.
function findPartContainer(root: THREE.Object3D): THREE.Object3D {
  let node = root
  // Descend while there's exactly one child AND that child itself has children (a wrapper),
  // so we don't descend into a single leaf part.
  while (node.children.length === 1 && node.children[0].children.length > 0) {
    node = node.children[0]
  }
  return node
}

function hasMesh(o: THREE.Object3D): boolean {
  let found = false
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) found = true
  })
  return found
}

export function createCadScene(canvas: HTMLCanvasElement): CadSceneController {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000)
  camera.position.set(1, 1, 1)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(1, 1.5, 1)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.4)
  fill.position.set(-1, -0.5, -1)
  scene.add(fill)

  let modelRoot: THREE.Object3D | null = null
  let parts: PartNode[] = []
  const center = new THREE.Vector3()
  let radius = 1
  let explodeFactor = 0
  let raf = 0
  // Monotonic load token. Each load() captures its value; a load whose token is no longer
  // current (a newer load started, or clear() ran) must NOT attach its result. Guards the
  // out-of-order-completion race Bugbot flagged.
  let loadGen = 0

  function clearModel() {
    if (modelRoot) {
      scene.remove(modelRoot)
      disposeObject(modelRoot)
      modelRoot = null
    }
    parts = []
    explodeFactor = 0
  }

  function animate() {
    raf = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  function applyExplode() {
    for (const p of parts) {
      // position = home + dir * factor * radius. factor 0 → home (assembled).
      p.object.position.copy(p.home).addScaledVector(p.dir, explodeFactor * radius)
    }
  }

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function frameAll() {
    if (!modelRoot) return
    const box = new THREE.Box3().setFromObject(modelRoot)
    if (box.isEmpty()) return
    box.getCenter(center)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    radius = Math.max(sphere.radius, 1e-3)
    controls.target.copy(center)
    // Pull the camera back to frame the whole (assembled) model.
    const dist = radius / Math.sin((camera.fov * Math.PI) / 180 / 2)
    const dir = new THREE.Vector3(1, 0.8, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, dist * 1.4)
    camera.near = Math.max(dist / 100, 0.01)
    camera.far = dist * 100
    camera.updateProjectionMatrix()
  }

  async function load(glb: ArrayBuffer): Promise<CadPart[]> {
    const gen = ++loadGen

    // Parse FIRST — do NOT tear down the current model until we have a valid new scene. On a
    // parse failure the exception propagates (the caller shows the error) and the previous
    // model stays on screen, so the viewport never goes blank-but-controls-populated (Bugbot).
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
      new GLTFLoader().parse(glb, "", (g) => resolve(g as unknown as { scene: THREE.Group }), reject),
    )

    // A newer load (or a clear) started while we were parsing → drop this stale result and
    // dispose it rather than attaching a second model (Bugbot: out-of-order completion).
    if (gen !== loadGen) {
      disposeObject(gltf.scene)
      return []
    }

    clearModel() // now safe to swap: we hold a parsed scene and we're still the current load
    modelRoot = gltf.scene
    scene.add(modelRoot)

    // Frame first so `center`/`radius` are set before we compute per-part explode directions.
    frameAll()

    const container = findPartContainer(modelRoot)
    const partObjects = container.children.filter(hasMesh)
    modelRoot.updateMatrixWorld(true) // so per-part world bounding boxes are correct
    parts = partObjects.map((object, i) => {
      const box = new THREE.Box3().setFromObject(object)
      const pc = box.getCenter(new THREE.Vector3())
      const dir = pc.clone().sub(center)
      // A part at (or very near) the assembly center — e.g. a planetary sun gear — has no
      // meaningful radial direction, so a purely-radial explode would leave it sitting inside
      // the others. Lift those out along the axis instead (alternating ±Z by index), so every
      // part separates. "Near center" = within 10% of the model radius.
      if (dir.length() < radius * 0.1) {
        dir.set(0, 0, i % 2 === 0 ? 1 : -1)
      }
      dir.normalize()
      return { name: object.name || `part_${i + 1}`, object, home: object.position.clone(), dir }
    })

    return parts.map((p) => ({ name: p.name, visible: true }))
  }

  function clear() {
    loadGen++ // invalidate any in-flight load so it won't attach after we've cleared
    clearModel()
  }

  function setExplode(factor: number) {
    explodeFactor = Math.max(0, factor)
    applyExplode()
  }

  function setIsolated(name: string | null) {
    for (const p of parts) p.object.visible = name === null || p.name === name
  }

  function setPartVisible(name: string, visible: boolean) {
    const p = parts.find((x) => x.name === name)
    if (p) p.object.visible = visible
  }

  function getBounds(): [number, number, number] | null {
    if (!modelRoot) return null
    const box = new THREE.Box3().setFromObject(modelRoot)
    if (box.isEmpty()) return null
    const size = box.getSize(new THREE.Vector3())
    return [size.x, size.y, size.z]
  }

  function dispose() {
    cancelAnimationFrame(raf)
    controls.dispose()
    if (modelRoot) disposeObject(modelRoot)
    renderer.dispose()
  }

  return { load, clear, setExplode, setIsolated, setPartVisible, frameAll, getBounds, resize, dispose }
}

// Free GPU resources for a subtree (geometries + materials) so repeated loads don't leak.
function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose()
    }
  })
}
