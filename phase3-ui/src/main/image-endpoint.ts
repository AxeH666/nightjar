// Pure image-backend selection — extracted from index.ts so the precedence REMOVAL is
// unit-testable. Replaces the old implicit chain (local-first, then OpenAI > OpenRouter)
// with the user's EXPLICIT per-capability choice:
//   • Offline → the local diffusion sidecar, and ONLY when it's actually serving.
//   • Online  → EXACTLY the chosen provider's endpoint, and ONLY when its key is present.
// There is deliberately NO cross-provider fallback (OpenAI↔OpenRouter) and NO
// cloud↔local fallback: picking a backend is the user's call, so a missing key or a
// down sidecar yields "none" (no endpoint) rather than silently routing elsewhere.
import type { CapabilityPref } from "./capabilities"

export type ImageBackend = "local" | "openai" | "openrouter" | "none"

export function resolveImageBackend(
  pref: CapabilityPref,
  localReady: boolean,
  hasOpenAIKey: boolean,
  hasOpenRouterKey: boolean,
): ImageBackend {
  if (pref.mode === "online") {
    // Honor EXACTLY the chosen provider — never fall back to the other one just
    // because its key happens to exist (that was the old OpenAI-wins precedence).
    if (pref.providerId === "openai") return hasOpenAIKey ? "openai" : "none"
    if (pref.providerId === "openrouter") return hasOpenRouterKey ? "openrouter" : "none"
    return "none" // an image-unsupported / absent provider → no endpoint
  }
  // Offline: local only, never a silent cloud fallback when the sidecar is down.
  return localReady ? "local" : "none"
}
