import type { ReactNode } from "react"

// The shared LAB workspace shell (Lab.md §4): the SAME layout for every lab — a left nav
// rail, a center viewport (the ONLY part that differs per lab), a right inspector, and a
// full-width bottom conversation panel. Clean chrome only (§4.5 — no ribbon, banner, or
// debug strip). This is a pure layout scaffold; each lab supplies the region contents.
//
// Transcript-placement note: §4/§5.1 under-specify where the conversation lives. §5.1 says
// "the composer collapses into the bottom prompt + left history rail, and the viewer moves
// to the center with its controls folded into the right inspector." We read that as — the
// CENTER is the viewer, the RIGHT is the inspector, and the conversation (transcript +
// input) sits in a full-width BOTTOM panel; the left rail is navigation (Chats/Projects/
// Settings). This is an interpretation, open to adjustment once the shell is in use.
export function LabShell({
  rail,
  center,
  inspector,
  bottom,
}: {
  rail: ReactNode
  center: ReactNode
  inspector: ReactNode
  bottom: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top: nav rail | center viewport | inspector (≈60% of height) */}
      <div className="flex min-h-0 flex-[3]">
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-nightjar-surface">{rail}</aside>
        <div className="relative min-h-0 flex-1">{center}</div>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-nightjar-surface">{inspector}</aside>
      </div>
      {/* Bottom: the conversation — transcript + prompt, full width (≈40% of height) */}
      <div className="flex min-h-0 flex-[2] flex-col border-t border-nightjar-surface">{bottom}</div>
    </div>
  )
}
