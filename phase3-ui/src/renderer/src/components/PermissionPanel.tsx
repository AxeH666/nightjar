import type { PermissionAsk, ReplyKind } from "../lib/opencode"

// CRITICAL: permissions have NO server-side timeout — an unanswered ask blocks
// the agent loop indefinitely. This panel is deliberately loud (rust-red, modal
// overlay, can't be missed) and always offers an escape hatch (Abort) so a user
// who doesn't want to answer can bail instead of wedging the run.

function humanAction(ask: PermissionAsk): { title: string; detail: string; alwaysLabel: string } {
  const p = ask.permission
  const meta = ask.metadata ?? {}
  const target = (ask.patterns && ask.patterns[0]) || ""
  if (p.includes("email") || ask.tool?.callID?.includes("email") || "to" in meta) {
    const to = (meta["to"] as string) || target || "this recipient"
    return { title: "Send email?", detail: `Nightjar wants to send an email to ${to}.`, alwaysLabel: `Always allow sending to ${to}` }
  }
  if (p === "edit" || p === "write") {
    return { title: "Edit file?", detail: `Nightjar wants to modify ${target || "a file"}.`, alwaysLabel: `Always allow edits to ${target || "this path"}` }
  }
  if (p === "bash") {
    return { title: "Run command?", detail: `Nightjar wants to run: ${(meta["command"] as string) || target || "a shell command"}.`, alwaysLabel: "Always allow this command" }
  }
  if (p === "doom_loop") {
    return { title: "Repeated action detected", detail: `Nightjar is repeating the same '${meta["tool"] ?? "tool"}' call. Continue?`, alwaysLabel: "Always allow" }
  }
  return { title: `Permission: ${p}`, detail: `Nightjar is requesting the '${p}' permission${target ? ` (${target})` : ""}.`, alwaysLabel: "Always allow this" }
}

export function PermissionPanel({
  ask,
  onReply,
  onAbort,
}: {
  ask: PermissionAsk
  onReply: (reply: ReplyKind) => void
  onAbort: () => void
}) {
  const h = humanAction(ask)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-w-[92vw] rounded-xl border-2 border-nightjar-alert bg-nightjar-surface shadow-2xl">
        <div className="flex items-center gap-2 rounded-t-xl bg-nightjar-alert px-4 py-2 text-nightjar-text">
          <span className="text-lg">⚠</span>
          <span className="font-semibold">Approval needed</span>
          <span className="ml-auto text-xs opacity-80">the agent is paused until you answer</span>
        </div>
        <div className="px-5 py-4">
          <div className="text-lg font-semibold text-nightjar-text">{h.title}</div>
          <p className="mt-1 text-sm text-nightjar-text/80">{h.detail}</p>
          {ask.permission && (
            <div className="mt-2 font-mono text-xs text-nightjar-text/50">
              permission: {ask.permission}
              {ask.tool?.callID ? ` · call: ${ask.tool.callID}` : ""}
            </div>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => onReply("once")}
              className="rounded-md bg-nightjar-accent px-4 py-2 font-medium text-nightjar-base hover:brightness-110"
            >
              Allow once
            </button>
            <button
              onClick={() => onReply("always")}
              className="rounded-md border border-nightjar-accent px-4 py-2 text-sm text-nightjar-accent hover:bg-nightjar-accent/10"
            >
              {h.alwaysLabel}
            </button>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => onReply("reject")}
                className="flex-1 rounded-md border border-nightjar-alert px-4 py-2 text-sm text-nightjar-alert hover:bg-nightjar-alert/10"
              >
                Reject
              </button>
              <button
                onClick={onAbort}
                className="flex-1 rounded-md border border-nightjar-text/30 px-4 py-2 text-sm text-nightjar-text/70 hover:bg-nightjar-text/5"
                title="Cancel the whole request instead of answering"
              >
                Abort request
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
