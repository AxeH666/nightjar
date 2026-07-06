// Bridge an OrbAdapter's subscribe({onStateChange,onVolumeChange}) into React
// state, yielding the `{state, volume}` pair for orb-ui's controlled mode
// (`<Orb state={state} volume={volume} theme="circle" />`). Keeping the adapter
// as the source of truth and the component purely controlled mirrors how orb-ui
// separates provider adapters from rendering.
import { useEffect, useState } from "react"
import type { OrbAdapter, OrbState } from "orb-ui"

export function useOrbAdapter(adapter: OrbAdapter | null): { state: OrbState; volume: number } {
  const [state, setState] = useState<OrbState>("idle")
  const [volume, setVolume] = useState(0)

  useEffect(() => {
    if (!adapter) return
    const unsubscribe = adapter.subscribe({
      onStateChange: setState,
      onVolumeChange: setVolume,
    })
    return unsubscribe
  }, [adapter])

  return { state, volume }
}
