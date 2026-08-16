// The single renderer-facing contract exposed by Electron preload. Keep shutdown
// messages content-free: they convey only a request id, never media or user text.

export interface ServiceStatus {
  name: string
  state: string
  pid?: number
  restarts: number
  detail?: string
}

export interface VoiceStatus {
  enabled: boolean
  running: boolean
  starting: boolean
  stillListening: boolean
}

export interface VoiceShutdownRequest {
  id: string
}

export type KeyStorageMode = "encrypted" | "insecure" | "unavailable"
export interface BridgeCapabilityPref { mode: "offline" | "online"; providerId?: string; modelId?: string }
export interface BridgeCapabilityMeta { id: "chat" | "image" | "research" | "vision" | "browser"; name: string; onlineProviders: string[]; offlineLabel: string }
export interface BridgeVisionStatus { ollama: "running" | "installed" | "absent"; model: "present" | "missing" | "pulling" | "unknown"; pct?: number; detail?: string }
export type BridgeSchedulerStatus = { available: true } | { available: false; reason: "setup" | "notifications" }

export interface NightjarBridge {
  getConfig(): Promise<{ opencodeUrl: string; sideChannelUrl: string; isWSL: boolean }>
  getStatus(): Promise<ServiceStatus[]>
  restartService(name: string): Promise<void>
  serviceLogs(name: string): Promise<string[]>
  readAudio(path: string): Promise<ArrayBuffer>
  pickFiles(): Promise<string[]>
  readAttachment(path: string): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }>
  saveAttachment(dataUrl: string, name: string): Promise<string>
  getPathForFile(file: File): string
  readGeneratedImage(filename: string): Promise<string | null>
  readWindowsClipboardImage(): Promise<string | null>
  onStatus(cb: (s: ServiceStatus[]) => void): () => void
  getVisionStatus(): Promise<BridgeVisionStatus>
  installVisionModel(): Promise<BridgeVisionStatus>
  openOllamaDownload(): Promise<void>
  onVisionStatus(cb: (s: BridgeVisionStatus) => void): () => void
  getSchedulerStatus(): Promise<BridgeSchedulerStatus>
  onSchedulerStatus(cb: (s: BridgeSchedulerStatus) => void): () => void
  byok: {
    keyStorageMode(): Promise<KeyStorageMode>
    list(): Promise<{ id: string; name: string; defaultModel: string; keyHint: string; hasKey: boolean }[]>
    set(providerId: string, key: string): Promise<void>
    remove(providerId: string): Promise<void>
  }
  capabilities: {
    catalog(): Promise<{ capabilities: BridgeCapabilityMeta[]; ui: string[] }>
    list(): Promise<Record<string, BridgeCapabilityPref>>
    set(id: BridgeCapabilityMeta["id"], pref: BridgeCapabilityPref): Promise<BridgeCapabilityPref>
    setBulk(prefs: Record<string, BridgeCapabilityPref>): Promise<Record<string, BridgeCapabilityPref>>
  }
  voice: {
    get(): Promise<VoiceStatus>
    set(enabled: boolean): Promise<VoiceStatus>
    onStatus(cb: (s: VoiceStatus) => void): () => void
    onShutdown(cb: (request: VoiceShutdownRequest) => void): () => void
    acknowledgeShutdown(requestId: string): Promise<void>
  }
  preview: {
    write(sessionID: string, filePath: string, content: string): Promise<{ url: string; nonce: number; rel: string }>
    edit(sessionID: string, filePath: string, oldString: string, newString: string, replaceAll: boolean): Promise<{ url: string; nonce: number; rel: string }>
    url(sessionID: string, entry?: string): Promise<string>
    list(sessionID: string): Promise<{ path: string; size: number }[]>
    read(sessionID: string, relPath: string): Promise<{ mime: string; dataUrl: string }>
    saveAs(sessionID: string, relPath: string): Promise<boolean>
    reveal(sessionID: string, relPath?: string): Promise<void>
  }
  cad: {
    convert(stepPath: string): Promise<{ ok: boolean; glbPath?: string; parts?: string[]; nodes?: number; meshes?: number; error?: string }>
    readGlb(glbPath: string): Promise<Uint8Array | null>
    loadHero(): Promise<{ ok: boolean; glb?: Uint8Array; parts?: string[]; error?: string }>
  }
}

declare global {
  interface Window {
    nightjar?: NightjarBridge
  }
}

export {}
