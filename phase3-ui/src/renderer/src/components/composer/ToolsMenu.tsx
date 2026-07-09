// ToolsMenu — the composer's "+" popover (redesign Stage 6). Replaces the loose
// 📎/🎨 buttons with one menu: Add files, Research, Web search, Create image.
// Research + Web search are per-MESSAGE toggles (both resolve to the research
// agent at send time — the only web-capable agent today); the parent decides
// which items to show (the Code tab hides Research/Web-search).
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
          {show.research && (
            <button className={rowClass(active.research)} onClick={onToggleResearch}>
              <span aria-hidden className="w-4 text-center">🔎</span>
              <span className="flex-1">Research</span>
              {active.research && <span aria-hidden>✓</span>}
            </button>
          )}
          {show.webSearch && (
            <button className={rowClass(active.webSearch)} onClick={onToggleWebSearch}>
              <span aria-hidden className="w-4 text-center">🌐</span>
              <span className="flex-1">Web search</span>
              {active.webSearch && <span aria-hidden>✓</span>}
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
