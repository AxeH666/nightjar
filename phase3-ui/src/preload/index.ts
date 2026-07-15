// Nightjar preload — minimal safe bridge to the renderer.
import { contextBridge, ipcRenderer, webUtils } from "electron"

export interface ServiceStatus {
  name: string
  state: string
  pid?: number
  restarts: number
  detail?: string
}

export interface ByokProviderStatus {
  id: string
  name: string
  defaultModel: string
  keyHint: string
  hasKey: boolean
}

export interface CapabilityPref {
  mode: "offline" | "online"
  providerId?: string
  modelId?: string
}

export interface CapabilityMeta {
  id: string
  name: string
  onlineProviders: string[]
  offlineLabel: string
}

contextBridge.exposeInMainWorld("nightjar", {
  getConfig: (): Promise<{ opencodeUrl: string; sideChannelUrl: string }> =>
    ipcRenderer.invoke("nightjar:config"),
  getStatus: (): Promise<ServiceStatus[]> => ipcRenderer.invoke("nightjar:status"),
  restartService: (name: string): Promise<void> => ipcRenderer.invoke("nightjar:restart", name),
  readAudio: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke("nightjar:readAudio", path),
  // Chat attachments: native picker + read/save + read-back of generated images.
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke("nightjar:pickFiles"),
  readAttachment: (
    path: string,
  ): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }> =>
    ipcRenderer.invoke("nightjar:readAttachment", path),
  saveAttachment: (dataUrl: string, name: string): Promise<string> =>
    ipcRenderer.invoke("nightjar:saveAttachment", dataUrl, name),
  // Electron 32 removed File.path. webUtils.getPathForFile is the ONLY way to recover a
  // dropped/browsed file's real on-disk path — it MUST be called in the preload with the
  // actual File object. Returns "" for a blob with no backing file (e.g. a pasted
  // screenshot), so the caller falls back to reading the bytes.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  readGeneratedImage: (filename: string): Promise<string | null> =>
    ipcRenderer.invoke("nightjar:readGeneratedImage", filename),
  // WSL image-paste workaround: read a copied bitmap from the Windows clipboard via
  // PowerShell → PNG data URL (null off WSL / no image / powershell unreachable).
  readWindowsClipboardImage: (): Promise<string | null> =>
    ipcRenderer.invoke("nightjar:readWindowsClipboardImage"),
  // Live-preview / Artifacts: mirror write/edit content into a per-session sandbox
  // served by the loopback static server, list/read for the Files tab, save-as (any
  // type) + reveal-in-folder for download.
  preview: {
    write: (sessionID: string, filePath: string, content: string): Promise<{ url: string; nonce: number; rel: string }> =>
      ipcRenderer.invoke("nightjar:previewWrite", sessionID, filePath, content),
    edit: (sessionID: string, filePath: string, oldString: string, newString: string, replaceAll: boolean): Promise<{ url: string; nonce: number; rel: string }> =>
      ipcRenderer.invoke("nightjar:previewEdit", sessionID, filePath, oldString, newString, replaceAll),
    url: (sessionID: string, entry?: string): Promise<string> => ipcRenderer.invoke("nightjar:previewUrl", sessionID, entry),
    list: (sessionID: string): Promise<{ path: string; size: number }[]> => ipcRenderer.invoke("nightjar:previewList", sessionID),
    read: (sessionID: string, relPath: string): Promise<{ mime: string; dataUrl: string }> => ipcRenderer.invoke("nightjar:previewRead", sessionID, relPath),
    saveAs: (sessionID: string, relPath: string): Promise<boolean> => ipcRenderer.invoke("nightjar:saveFileAs", sessionID, relPath),
    reveal: (sessionID: string, relPath?: string): Promise<void> => ipcRenderer.invoke("nightjar:previewReveal", sessionID, relPath),
  },
  onStatus: (cb: (s: ServiceStatus[]) => void) => {
    const handler = (_e: unknown, s: ServiceStatus[]) => cb(s)
    ipcRenderer.on("nightjar:status", handler)
    return () => ipcRenderer.removeListener("nightjar:status", handler)
  },
  // Local vision (Ollama gemma3:4b): status, one-click model install, and an
  // "install Ollama" link for when it isn't present.
  getVisionStatus: (): Promise<unknown> => ipcRenderer.invoke("nightjar:visionStatus"),
  installVisionModel: (): Promise<unknown> => ipcRenderer.invoke("nightjar:visionInstallModel"),
  openOllamaDownload: (): Promise<void> => ipcRenderer.invoke("nightjar:openOllamaDownload"),
  onVisionStatus: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on("nightjar:visionStatus", handler)
    return () => ipcRenderer.removeListener("nightjar:visionStatus", handler)
  },
  // BYOK — raw keys never cross this bridge; only masked status in, key text out.
  byok: {
    keyStorageMode: (): Promise<string> => ipcRenderer.invoke("byok:keyStorageMode"),
    list: (): Promise<ByokProviderStatus[]> => ipcRenderer.invoke("byok:list"),
    set: (providerId: string, key: string): Promise<void> => ipcRenderer.invoke("byok:set", providerId, key),
    remove: (providerId: string): Promise<void> => ipcRenderer.invoke("byok:remove", providerId),
  },
  // Per-capability Online/Offline + provider preference. No secrets cross here —
  // only {mode, providerId, modelId}. The main process persists + (in later PRs)
  // applies the choice to the engine.
  capabilities: {
    catalog: (): Promise<{ capabilities: CapabilityMeta[]; ui: string[] }> => ipcRenderer.invoke("capabilities:catalog"),
    list: (): Promise<Record<string, CapabilityPref>> => ipcRenderer.invoke("capabilities:list"),
    set: (id: string, pref: CapabilityPref): Promise<CapabilityPref> => ipcRenderer.invoke("capabilities:set", id, pref),
    // Bulk-apply for the global Local/Cloud toggle — one store write + one engine restart.
    setBulk: (prefs: Record<string, CapabilityPref>): Promise<Record<string, CapabilityPref>> =>
      ipcRenderer.invoke("capabilities:setBulk", prefs),
  },
  // CAD (Task 5): convert a model-exported STEP file to a viewable GLB, and read its bytes.
  cad: {
    convert: (
      stepPath: string,
    ): Promise<{ ok: boolean; glbPath?: string; parts?: string[]; nodes?: number; meshes?: number; error?: string }> =>
      ipcRenderer.invoke("cad:convert", stepPath),
    readGlb: (glbPath: string): Promise<Uint8Array | null> => ipcRenderer.invoke("cad:readGlb", glbPath),
    loadHero: (): Promise<{ ok: boolean; glb?: Uint8Array; parts?: string[]; error?: string }> =>
      ipcRenderer.invoke("cad:loadHero"),
  },
})
