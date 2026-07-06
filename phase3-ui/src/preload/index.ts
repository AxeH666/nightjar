// Nightjar preload — minimal safe bridge to the renderer.
import { contextBridge, ipcRenderer } from "electron"

export interface ServiceStatus {
  name: string
  state: string
  pid?: number
  restarts: number
  detail?: string
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
})
