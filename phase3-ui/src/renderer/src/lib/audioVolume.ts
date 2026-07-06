// Nightjar audio-reduction core (Phase 4).
//
// Reduces a Web Audio `AnalyserNode`'s `getByteFrequencyData` output to a single
// normalized 0–1 volume scalar, one value per animation frame, for the voice orb.
// The RMS reduction + EMA smoothing + normalization curve mirror orb-ui's own
// mic monitor (MIT, © Alexander Chen) so our custom adapter produces the same
// visual feel as orb-ui's built-in providers.
//
// Everything here is provider- and DOM-agnostic: the AnalyserNode / AudioContext
// are reached through minimal structural interfaces and an injectable frame
// scheduler, so the exact same code runs in the Electron renderer (real Web
// Audio) and under a headless test runner (mock nodes + manual clock).

// ─── Minimal structural interfaces (a real AudioContext satisfies these) ──────

export interface AnalyserLike {
  fftSize: number
  readonly frequencyBinCount: number
  getByteFrequencyData(array: Uint8Array): void
}

export interface SourceLike {
  connect(destination: unknown): unknown
  disconnect(): void
}

export interface AudioCtxLike {
  createAnalyser(): AnalyserLike
  createMediaStreamSource(stream: unknown): SourceLike
  createMediaElementSource(element: unknown): SourceLike
  readonly destination: unknown
  readonly state?: string
  resume?(): Promise<void>
  close(): Promise<void>
}

// A frame scheduler so the poll loop is drivable by requestAnimationFrame in the
// renderer and by a manual/interval clock in tests.
export interface FrameScheduler {
  schedule(cb: () => void): number
  cancel(handle: number): void
}

export function defaultScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === "function") {
    return {
      schedule: (cb) => requestAnimationFrame(() => cb()),
      cancel: (h) => cancelAnimationFrame(h),
    }
  }
  // headless fallback (~60fps)
  return {
    schedule: (cb) => setTimeout(cb, 16) as unknown as number,
    cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  }
}

// ─── Pure reductions (unit-tested directly) ──────────────────────────────────

/**
 * Root-mean-square of a `getByteFrequencyData` array, rescaled 0–255 → 0–1.
 * This is the per-frame "loudness" proxy the orb reacts to.
 */
export function rmsFromByteFrequency(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length) / 255
}

/**
 * Rescale a raw 0–1 mic/output RMS to the orb's display range. Same curve as
 * orb-ui's `normalizeMicVolume`: lift the useful band up to full-scale, then a
 * mild pow to keep quiet speech visible without the orb pinning at 1.0.
 */
export function normalizeVolume(v: number): number {
  const vol = Math.min(v / 0.5, 1.0)
  return Math.pow(vol, 1.3)
}

// ─── AudioLevelMonitor ────────────────────────────────────────────────────────
// Wraps one AudioContext + AnalyserNode. Attach either a mic MediaStream
// (listening) or an <audio> element (speaking), then start() a per-frame loop
// that emits the normalized level. attack/release EMA matches orb-ui.

export interface AudioLevelMonitorOptions {
  createAudioContext: () => AudioCtxLike
  scheduler?: FrameScheduler
  fftSize?: number
  attack?: number
  release?: number
}

export class AudioLevelMonitor {
  private readonly make: () => AudioCtxLike
  private readonly scheduler: FrameScheduler
  private readonly fftSize: number
  private readonly attack: number
  private readonly release: number

  private ctx: AudioCtxLike | null = null
  private analyser: AnalyserLike | null = null
  private source: SourceLike | null = null
  private data: Uint8Array = new Uint8Array(0)
  private handle = 0
  private running = false
  private ema = 0

  constructor(opts: AudioLevelMonitorOptions) {
    this.make = opts.createAudioContext
    this.scheduler = opts.scheduler ?? defaultScheduler()
    this.fftSize = opts.fftSize ?? 256
    this.attack = opts.attack ?? 0.7
    this.release = opts.release ?? 0.3
  }

  private ensureCtx(): AudioCtxLike {
    if (!this.ctx) this.ctx = this.make()
    return this.ctx
  }

  private prepareAnalyser(): AnalyserLike {
    const ctx = this.ensureCtx()
    if (ctx.state === "suspended") ctx.resume?.().catch(() => {})
    const analyser = ctx.createAnalyser()
    analyser.fftSize = this.fftSize
    this.analyser = analyser
    this.data = new Uint8Array(analyser.frequencyBinCount)
    return analyser
  }

  /** Mic path — analyser only; deliberately NOT wired to the speakers (no echo). */
  attachStream(stream: unknown): void {
    this.detachSource()
    const ctx = this.ensureCtx()
    const analyser = this.prepareAnalyser()
    this.source = ctx.createMediaStreamSource(stream)
    this.source.connect(analyser)
  }

  /** TTS path — split to the analyser AND the speakers so it stays audible. */
  attachElement(element: unknown): void {
    this.detachSource()
    const ctx = this.ensureCtx()
    const analyser = this.prepareAnalyser()
    this.source = ctx.createMediaElementSource(element)
    this.source.connect(analyser)
    this.source.connect(ctx.destination)
  }

  start(onLevel: (level: number) => void): void {
    if (this.running || !this.analyser) return
    this.running = true
    this.ema = 0
    const poll = () => {
      if (!this.running || !this.analyser) return
      this.analyser.getByteFrequencyData(this.data)
      const rms = rmsFromByteFrequency(this.data)
      const rate = rms > this.ema ? this.attack : this.release
      this.ema += (rms - this.ema) * rate
      onLevel(normalizeVolume(this.ema))
      this.handle = this.scheduler.schedule(poll)
    }
    this.handle = this.scheduler.schedule(poll)
  }

  stop(): void {
    this.running = false
    if (this.handle) this.scheduler.cancel(this.handle)
    this.handle = 0
    this.ema = 0
    this.detachSource()
  }

  private detachSource(): void {
    try {
      this.source?.disconnect()
    } catch {
      /* already disconnected */
    }
    this.source = null
    this.analyser = null
  }

  async dispose(): Promise<void> {
    this.stop()
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      await ctx.close().catch(() => {})
    }
  }
}
