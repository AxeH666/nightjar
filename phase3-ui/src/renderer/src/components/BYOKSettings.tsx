import { useEffect, useState } from "react"
import { byok, type ByokProviderStatus, type KeyStorageMode } from "../lib/byok"
import { CapabilitiesSettings } from "./CapabilitiesSettings"

// Modal to manage cloud provider API keys. Keys are stored encrypted-at-rest by
// the main process (OS keychain); this panel only ever sees masked status.
// Adding/removing a key restarts the engine so it picks up the new provider.
export function BYOKSettings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [providers, setProviders] = useState<ByokProviderStatus[]>([])
  const [mode, setMode] = useState<KeyStorageMode | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Saving is only refused outright when there's no keychain AND no test hatch.
  const savingDisabled = mode === "unavailable"

  async function refresh() {
    setProviders(await byok.list())
    setMode(await byok.keyStorageMode())
  }
  useEffect(() => {
    refresh()
  }, [])

  async function save(id: string) {
    const key = (drafts[id] ?? "").trim()
    if (!key) return
    setBusy(id)
    setError(null)
    try {
      await byok.set(id, key) // main restarts opencode-serve
      setDrafts((d) => ({ ...d, [id]: "" }))
      await refresh()
      onChanged()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    setError(null)
    try {
      await byok.remove(id)
      await refresh()
      onChanged()
    } catch (e: any) {
      // Mirror save() (P3-8): a failed removal (IPC error, engine-restart failure) must surface,
      // not silently leave the row as "key set" with no explanation.
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[88vh] w-[560px] max-w-[94vw] overflow-y-auto rounded-xl border border-nightjar-surface bg-nightjar-base shadow-2xl">
        <div className="flex items-center gap-2 border-b border-nightjar-surface px-5 py-3">
          <span className="font-semibold text-nightjar-accent">Cloud API Keys · Bring-Your-Own-Key</span>
          <button onClick={onClose} className="ml-auto text-nightjar-text/50 hover:text-nightjar-text">
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* privacy framing — local vs cloud */}
          <p className="rounded-md bg-nightjar-surface/60 p-3 text-xs leading-relaxed text-nightjar-text/80">
            June is <b>local-first</b>: every capability runs <b>Offline</b> (on your machine) by default —
            nothing leaves it. Adding a cloud key lets you set a capability <b>Online</b> below, but{" "}
            <b className="text-nightjar-alert">data for a capability you set Online leaves your machine</b>. Keys are
            used <b>only</b> for the capabilities you explicitly set Online — your local <b>voice</b> and <b>memory</b>{" "}
            always stay on-device regardless of which keys are set.
          </p>

          {/* storage mode — must be honest about whether keys are truly encrypted */}
          {mode === "encrypted" && (
            <p className="text-xs text-nightjar-text/60">
              🔒 Keys are encrypted at rest via your OS keychain (Keychain / DPAPI / libsecret).
            </p>
          )}
          {mode === "insecure" && (
            <p className="rounded-md border border-nightjar-alert/60 bg-nightjar-alert/10 p-2 text-xs text-nightjar-alert">
              ⚠️ <b>TEST MODE (NIGHTJAR_BYOK_ALLOW_INSECURE)</b> — no OS keychain on this machine, so keys are stored with
              weak obfuscation, <b>not real encryption</b>. Fine for local testing; do <b>not</b> store real production keys.
            </p>
          )}
          {mode === "unavailable" && (
            <p className="rounded-md border border-nightjar-alert/60 bg-nightjar-alert/10 p-2 text-xs text-nightjar-alert">
              ⚠️ Your OS secure storage (keychain) is unavailable, so saving keys is <b>disabled</b> on this machine —
              June will never write a key in plaintext. Enable a system keyring, or use macOS/Windows.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-nightjar-alert/60 bg-nightjar-alert/10 p-2 text-xs text-nightjar-alert">
              {error}
            </p>
          )}

          {/* per-provider rows */}
          <div className="space-y-3">
            {providers.map((p) => (
              <div key={p.id} className="rounded-lg border border-nightjar-surface p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-medium text-nightjar-text">{p.name}</span>
                  {p.hasKey ? (
                    <span className="rounded bg-nightjar-accent/20 px-1.5 py-0.5 text-[10px] uppercase text-nightjar-accent">
                      key set
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase text-nightjar-text/40">no key</span>
                  )}
                  {p.hasKey && (
                    <button
                      onClick={() => remove(p.id)}
                      disabled={busy === p.id}
                      className="ml-auto text-xs text-nightjar-alert hover:underline disabled:opacity-40"
                    >
                      remove
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={p.hasKey ? "replace key…" : p.keyHint}
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    disabled={savingDisabled || busy === p.id}
                    className="flex-1 rounded-md bg-nightjar-surface px-2 py-1 font-mono text-xs text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent disabled:opacity-50"
                  />
                  <button
                    onClick={() => save(p.id)}
                    disabled={savingDisabled || busy === p.id || !(drafts[p.id] ?? "").trim()}
                    className="rounded-md bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === p.id ? "saving…" : "save"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-nightjar-text/40">
            Saving or removing a key restarts the local engine (a few seconds) so it picks up the change.
          </p>

          {/* Per-capability Online/Offline + provider selection (replaces implicit
              precedence). Reflects key availability from the same `providers` list. */}
          <CapabilitiesSettings providers={providers} />
        </div>
      </div>
    </div>
  )
}
