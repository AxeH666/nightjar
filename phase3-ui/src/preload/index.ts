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
  // Chat attachments: native picker + read/save + read-back of generated images.
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke("nightjar:pickFiles"),
  readAttachment: (
    path: string,
  ): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }> =>
    ipcRenderer.invoke("nightjar:readAttachment", path),
  saveAttachment: (dataUrl: string, name: string): Promise<string> =>
    ipcRenderer.invoke("nightjar:saveAttachment", dataUrl, name),
  readGeneratedImage: (filename: string): Promise<string | null> =>
    ipcRenderer.invoke("nightjar:readGeneratedImage", filename),
  onStatus: (cb: (s: ServiceStatus[]) => void) => {
    const handler = (_e: unknown, s: ServiceStatus[]) => cb(s)
    ipcRenderer.on("nightjar:status", handler)
    return () => ipcRenderer.removeListener("nightjar:status", handler)
  },
  // BYOK — raw keys never cross this bridge; only masked status in, key text out.
  byok: {
    keyStorageMode: (): Promise<string> => ipcRenderer.invoke("byok:keyStorageMode"),
    list: (): Promise<ByokProviderStatus[]> => ipcRenderer.invoke("byok:list"),
    set: (providerId: string, key: string): Promise<void> => ipcRenderer.invoke("byok:set", providerId, key),
    remove: (providerId: string): Promise<void> => ipcRenderer.invoke("byok:remove", providerId),
  },
})
