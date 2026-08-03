// Bridge an OrbAdapter's subscribe({onStateChange,onVolumeChange}) into React
// state, yielding the `{state, volume}` pair the orb renderers consume
// (NightjarOrb → CssMiniOrb / VortexOverlay). Keeping the adapter as the source
// of truth and the components purely controlled separates provider adapters
// from rendering (a split inherited from the retired orb-ui design).
import { useEffect, useState } from "react"
import type { OrbAdapter, OrbState } from "./orbTypes"

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
