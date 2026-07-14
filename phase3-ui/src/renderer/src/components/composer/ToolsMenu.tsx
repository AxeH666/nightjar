// ToolsMenu — the composer's "+" popover (redesign Stage 6). Replaces the loose
// 📎/🎨 buttons with one menu: Add files, Research, Web search, Create image.
// Research + Web search are per-MESSAGE toggles that resolve to two DIFFERENT agents
// at send time (`research` → the heavy deep_research pipeline; `websearch` → the
// lightweight web_search tool). They are RADIO-like, not checkboxes: the parent holds a
// single armed mode, so arming one clears the other. The parent also decides which items
// to show (the Code tab hides Research/Web-search).
import { useEffect, useRef, useState } from "react"

export interface ToolsMenuShow {
  research: boolean
  webSearch: boolean
  createImage: boolean
}
export interface ToolsMenuActive {
  research: boolean
  webSearch: boolean
  createImage: boolean
}

export function ToolsMenu({
  show,
  active,
  disabled,
  onAddFiles,
  onToggleResearch,
  onToggleWebSearch,
  onToggleCreateImage,
}: {
  show: ToolsMenuShow
  active: ToolsMenuActive
  disabled?: boolean
  onAddFiles: () => void
  onToggleResearch: () => void
  onToggleWebSearch: () => void
  onToggleCreateImage: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const rowClass = (on: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-nightjar-surface ${
      on ? "text-nightjar-accent" : "text-nightjar-text/80"
    }`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Add files & tools"
        aria-label="Add files and tools"
        className={`rounded-lg border px-2.5 py-2 text-lg leading-none disabled:opacity-40 ${
          open ? "border-nightjar-accent text-nightjar-accent" : "border-nightjar-surface text-nightjar-text/70 hover:bg-nightjar-surface"
        }`}
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-lg border border-nightjar-surface bg-nightjar-base p-1 shadow-lg shadow-black/40">
          <button
            className={rowClass(false)}
            onClick={() => {
              onAddFiles()
              setOpen(false)
            }}
          >
            <span aria-hidden className="w-4 text-center">📎</span>
            <span className="flex-1">Add files</span>
          </button>
          {show.webSearch && (
            <button className={rowClass(active.webSearch)} onClick={onToggleWebSearch} role="menuitemradio" aria-checked={active.webSearch}>
              <span aria-hidden className="w-4 text-center">🌐</span>
              <span className="flex-1">
                Web search
                <span className="block text-[11px] text-nightjar-text/40">Quick answer with sources</span>
              </span>
              {active.webSearch && <span aria-hidden>✓</span>}
            </button>
          )}
          {show.research && (
            <button className={rowClass(active.research)} onClick={onToggleResearch} role="menuitemradio" aria-checked={active.research}>
              <span aria-hidden className="w-4 text-center">🔎</span>
              <span className="flex-1">
                Research
                <span className="block text-[11px] text-nightjar-text/40">Full report · slower</span>
              </span>
              {active.research && <span aria-hidden>✓</span>}
            </button>
          )}
          {show.createImage && (
            <button
              className={rowClass(active.createImage)}
              onClick={() => {
                onToggleCreateImage()
                setOpen(false)
              }}
            >
              <span aria-hidden className="w-4 text-center">🎨</span>
              <span className="flex-1">Create image</span>
              {active.createImage && <span aria-hidden>✓</span>}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
