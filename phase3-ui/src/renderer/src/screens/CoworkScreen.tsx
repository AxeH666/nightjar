// CoworkScreen — DEFERRED TO v2. NOT WIRED INTO THE v1 BUILD.
//
// This file is intentionally orphaned: nothing imports it, and Cowork appears in neither
// TabBar's tab list nor AppShell's mounted screens, so there is no way to reach it in v1
// (JUNE_better.md — "keep it hidden/disabled in the v1 build; do not release it"). It is
// removed rather than merely disabled because a disabled tab button still renders the
// surface behind it. Kept in the tree, not deleted, because v2 picks it up.
//
// It is NOT dead code to be swept — do not delete it as "unused".
//
// Content lands with Phase 5 (OS-level computer-use: consent/preview + kill switch). Note
// the 3D/CAD viewport once sketched for here now has its OWN tab (Task 5), taking the slot
// Cowork vacates — CAD is explicitly not going into Cowork.
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
