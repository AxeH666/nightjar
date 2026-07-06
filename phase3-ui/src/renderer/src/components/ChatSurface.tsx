import { useState, useEffect, useRef } from "react"
import type { ToolCall } from "../lib/opencode"
import { ToolCallCard } from "./ToolCallCard"

export type UiBlock = { kind: "text"; text: string } | { kind: "tool"; call: ToolCall }
export interface UiMessage {
  id: string
  role: "user" | "assistant"
  blocks: UiBlock[]
}

export function ChatSurface({
  messages,
  busy,
  onSend,
}: {
  messages: UiMessage[]
  busy: boolean
  onSend: (text: string) => void
}) {
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  function submit() {
    const t = input.trim()
    if (!t || busy) return
    onSend(t)
    setInput("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="mt-20 text-center text-nightjar-text/40">Ask Nightjar something.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-nightjar-text/40">
              {m.role === "user" ? "you" : "nightjar"}
            </div>
            <div
              className={
                m.role === "user"
                  ? "rounded-lg bg-nightjar-surface px-4 py-2 text-nightjar-text"
                  : "text-nightjar-text/90"
              }
            >
              {m.blocks.map((b, i) =>
                b.kind === "text" ? (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {b.text}
                  </p>
                ) : (
                  <ToolCallCard key={b.call.callID} call={b.call} />
                ),
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-nightjar-accent/70">▍working…</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-nightjar-surface p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="Message Nightjar…  (Enter to send, Shift+Enter for newline)"
            className="max-h-40 flex-1 resize-none rounded-lg bg-nightjar-surface px-3 py-2 text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
          />
          <button
            onClick={submit}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-nightjar-accent px-4 py-2 font-medium text-nightjar-base disabled:opacity-40 hover:brightness-110"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
