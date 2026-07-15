import { useEffect, useState } from "react"

// Fetch the WSL flag from the main-process config. `isWSL` is a stable, cached fact main-
// side, so this is safe to call ad-hoc (e.g. to re-confirm at an event's decision point
// when a cached hook value might not have resolved yet).
export async function fetchIsWSL(): Promise<boolean> {
  const bridge = (window as { nightjar?: { getConfig?: () => Promise<{ isWSL?: boolean }> } }).nightjar
  try {
    return !!(await bridge?.getConfig?.())?.isWSL
  } catch {
    return false
  }
}

// True when the desktop app runs under WSL/WSLg (read from the main-process config on
// mount). Defaults false until it resolves, so a non-WSL host never briefly shows a
// WSL-only affordance. Drives the drag-drop-unsupported fallback (Windows→WSL DnD isn't
// bridged by the platform, so a drop delivers no payload — we offer Browse instead).
export function useIsWSL(): boolean {
  const [isWSL, setIsWSL] = useState(false)
  useEffect(() => {
    fetchIsWSL().then(setIsWSL)
  }, [])
  return isWSL
}
