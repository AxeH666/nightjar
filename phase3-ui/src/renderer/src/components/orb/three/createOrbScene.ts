// createOrbScene — builds the Three.js vortex-orb scene on a given canvas
// (redesign Stage 7). Returns a controller: feed it {state, volume} and call
// render(elapsed) from a rAF loop; dispose() tears the GL context down. Inputs
// are EMA-smoothed so state/volume changes glide instead of snapping.
//
// Returns null if a WebGL context can't be created — the caller falls back to
// the CSS orb. Main-thread renderer only (CSP: no worker/OffscreenCanvas).
import * as THREE from "three"
import { VORTEX_VERT, VORTEX_FRAG } from "./orbShaders"
import { orbColors } from "./orbPalette"
import type { OrbState } from "../../../lib/orbTypes"

export interface OrbSceneController {
  setInputs(state: OrbState, volume: number): void
  render(elapsedSeconds: number): void
  dispose(): void
}

export function createOrbScene(canvas: HTMLCanvasElement, size: number): OrbSceneController | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" })
  } catch {
    return null // constructor threw → no WebGL, caller uses the CSS fallback
  }
  // The constructor does NOT always throw when a usable GL context can't be
  // acquired: a blocked/software/already-lost context can still yield a renderer
  // whose canvas draws nothing. Validate the real context and bail to the CSS
  // fallback if it's missing or lost — otherwise the orb is a permanently blank
  // canvas instead of degrading. (Bugbot: "WebGL init skips fallback".)
  const gl = renderer.getContext()
  if (!gl || (typeof gl.isContextLost === "function" && gl.isContextLost())) {
    try {
      renderer.dispose()
      renderer.forceContextLoss()
    } catch {
      /* already-dead context → nothing to release */
    }
    return null
  }
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)) // cap DPR (GPU/VRAM budget)
  renderer.setSize(size, size, false)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const pal = orbColors()
  const idle = pal.forState("idle")
  const uniforms = {
    uTime: { value: 0 },
    uVolume: { value: 0 },
    uCore: { value: idle.core.clone() },
    uEdge: { value: idle.edge.clone() },
    uAccent: { value: pal.accent.clone() },
  }
  const material = new THREE.ShaderMaterial({
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  const geometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(geometry, material)
  scene.add(quad)

  // EMA-smoothed inputs.
  let targetVol = 0
  let curVol = 0
  let targetCore = idle.core.clone()
  let targetEdge = idle.edge.clone()
  const curCore = idle.core.clone()
  const curEdge = idle.edge.clone()

  function setInputs(state: OrbState, volume: number) {
    targetVol = Math.max(0, Math.min(1, volume || 0))
    const c = pal.forState(state)
    targetCore = c.core
    targetEdge = c.edge
  }

  function render(elapsed: number) {
    curVol += (targetVol - curVol) * 0.15
    curCore.lerp(targetCore, 0.06)
    curEdge.lerp(targetEdge, 0.06)
    uniforms.uTime.value = elapsed
    uniforms.uVolume.value = curVol
    uniforms.uCore.value.copy(curCore)
    uniforms.uEdge.value.copy(curEdge)
    renderer.render(scene, camera)
  }

  function dispose() {
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  return { setInputs, render, dispose }
}
