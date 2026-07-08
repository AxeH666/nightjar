// CoworkScreen — placeholder reserved for later (redesign Stage 5). The 3-tab
// structure is in place now; the content lands with Phase 5 (OS-level
// computer-use: consent/preview + kill switch) and Phase 6 (voice-driven CAD 3D
// viewport). Kept behind the same context stack so those retrofits are additive
// — no shell restructuring needed. This is the documented extension seam.
export function CoworkScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-5xl opacity-30" aria-hidden>
        🖥️
      </div>
      <h2 className="text-lg font-semibold text-nightjar-text">Cowork — coming soon</h2>
      <p className="max-w-md text-sm leading-relaxed text-nightjar-text/50">
        Reserved for agent computer-use (Phase 5) and voice-driven CAD (Phase 6). Desktop
        control and a live 3D viewport will live here, behind explicit, opt-in consent.
      </p>
      {/* Phase 5 consent/preview + kill switch and Phase 6 CAD viewport mount here. */}
    </div>
  )
}
