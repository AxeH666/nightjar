import type { ToolCall } from "../lib/opencode"
import { isTruncatedWrite } from "../lib/preview"

// A tool call rendered from message.part.updated events, keyed by callID. The
// same card advances pending → running → completed/error as events arrive.
const STATUS: Record<ToolCall["status"], { label: string; dot: string; ring: string }> = {
  pending: { label: "queued", dot: "bg-nightjar-text/40", ring: "border-nightjar-surface" },
  running: { label: "running", dot: "bg-nightjar-accent animate-pulse", ring: "border-nightjar-accent/60" },
  completed: { label: "done", dot: "bg-emerald-500", ring: "border-nightjar-surface" },
  error: { label: "error", dot: "bg-nightjar-alert", ring: "border-nightjar-alert/70" },
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const s = STATUS[call.status]
  const errored = call.status === "error"
  const argStr = call.input ? JSON.stringify(call.input) : ""
  return (
    <div className={`my-2 rounded-lg border ${s.ring} ${errored ? "bg-nightjar-alert/10" : "bg-nightjar-surface/60"} px-3 py-2 font-mono text-sm`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
        <span className="text-nightjar-accent">{call.tool}</span>
        <span className="text-nightjar-text/50 text-xs uppercase tracking-wide">{s.label}</span>
      </div>
      {argStr && (
        <div className="mt-1 truncate text-nightjar-text/60 text-xs" title={argStr}>
          {argStr.length > 160 ? argStr.slice(0, 160) + "…" : argStr}
        </div>
      )}
      {call.status === "completed" && call.output && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-nightjar-text/80 text-xs">
          {call.output.length > 800 ? call.output.slice(0, 800) + "\n…(truncated)" : call.output}
        </pre>
      )}
      {errored && (
        <div className="mt-2 rounded border border-nightjar-alert/50 bg-nightjar-alert/10 px-2 py-1.5 text-nightjar-alert text-xs">
          <span className="font-semibold">✕ Failed — no result.</span>{" "}
          {call.error || "the tool call errored (nothing was produced)."}
        </div>
      )}
      {isTruncatedWrite(call) && (
        <div className="mt-2 rounded border border-nightjar-alert/40 bg-nightjar-alert/10 px-2 py-1.5 text-nightjar-text/80 text-xs">
          This write didn't complete — usually because the file was too large for the local model's output limit, so
          the tool call was cut off. Try a smaller or multi-file version (e.g. separate HTML/CSS/JS), a stronger BYOK
          model, or the design profile (<span className="font-mono">NIGHTJAR_DESIGN_PROFILE=1</span>).
        </div>
      )}
    </div>
  )
}
