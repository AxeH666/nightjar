import { useEffect, useState } from "react"

// True when the desktop app runs under WSL/WSLg (read once from the main-process config).
// Defaults false until the config resolves, so a non-WSL host never briefly shows a
// WSL-only affordance. Drives the drag-drop-unsupported fallback (Windows→WSL DnD isn't
// bridged by the platform, so a drop delivers no payload — we offer Browse instead).
export function useIsWSL(): boolean {
  const [isWSL, setIsWSL] = useState(false)
  useEffect(() => {
    const bridge = (window as { nightjar?: { getConfig?: () => Promise<{ isWSL?: boolean }> } }).nightjar
    bridge
      ?.getConfig?.()
      .then((c) => setIsWSL(!!c?.isWSL))
      .catch(() => {})
  }, [])
  return isWSL
}
