// orbShaders — GLSL for the swirling-vortex orb (redesign Stage 7). A single
// full-quad fragment shader draws the whole look procedurally: a green energy
// vortex (polar swirl + flow noise), a bright core, concentric HUD rings, and
// sparkle specks. Reactive to uVolume (swirl speed / brightness / core size).
// Standard ShaderMaterial GLSL1 (three injects the prefixes); main-thread only
// (CSP forbids worker/OffscreenCanvas here).
export const VORTEX_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const VORTEX_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uVolume;   // 0..1 smoothed
  uniform vec3  uCore;     // bright center color
  uniform vec3  uEdge;     // deep edge color
  uniform vec3  uAccent;   // ring / sparkle accent

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;        // [-1, 1]
    float r = length(uv);
    float ang = atan(uv.y, uv.x);
    float t = uTime;
    float vol = clamp(uVolume, 0.0, 1.0);

    // Swirling energy: rotate by time+volume, add per-radius twist + flow noise.
    float spin = t * (0.4 + vol * 1.3);
    float swirl = ang + spin + r * (3.0 + vol * 4.0);
    float arms = 5.0;
    float energy = 0.5 + 0.5 * sin(swirl * arms - t * 2.0);
    float n = noise(vec2(swirl * 1.5, r * 4.0 - t * 1.5));
    energy = mix(energy, energy * n * 1.7, 0.5);
    energy *= smoothstep(1.0, 0.12, r);          // fade toward the rim

    // Bright core, grows a little with volume.
    float core = exp(-r * 3.6) * (0.75 + vol * 0.9);

    // Concentric HUD rings (one steady, one dashed + rotating).
    float rings = smoothstep(0.02, 0.0, abs(r - 0.55));
    rings += smoothstep(0.02, 0.0, abs(r - 0.78)) * (0.55 + 0.45 * sin(ang * 20.0 - t * 3.0));
    rings *= smoothstep(1.05, 0.35, r);

    // Sparkle specks.
    float sp = noise(uv * 18.0 + vec2(t * 0.6, -t * 0.4));
    sp = smoothstep(0.85, 1.0, sp) * smoothstep(1.0, 0.2, r);

    vec3 col = mix(uEdge, uCore, energy);
    col += uCore * core;
    col += uAccent * rings * 0.9;
    col += uAccent * sp * (0.6 + vol);

    float alpha = clamp(energy * 0.9 + core + rings * 0.8 + sp * 0.5, 0.0, 1.0);
    alpha *= smoothstep(1.02, 0.9, r);            // soft circular mask
    gl_FragColor = vec4(col, alpha);
  }
`
