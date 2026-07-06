// Nightjar preload — minimal safe bridge to the renderer.
import { contextBridge, ipcRenderer } from "electron"

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

contextBridge.exposeInMainWorld("nightjar", {
  getConfig: (): Promise<{ opencodeUrl: string; sideChannelUrl: string }> =>
    ipcRenderer.invoke("nightjar:config"),
  getStatus: (): Promise<ServiceStatus[]> => ipcRenderer.invoke("nightjar:status"),
  restartService: (name: string): Promise<void> => ipcRenderer.invoke("nightjar:restart", name),
  readAudio: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke("nightjar:readAudio", path),
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
})
