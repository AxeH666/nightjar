// ChatScreen — the unified Assistant + Research conversation (redesign Stage 5/6).
// Research is no longer a whole-workspace mode: it's a per-message toggle in the
// composer's "+" menu that resolves to the research agent at send time (explicit,
// not AI-guessed). Bound to the chat session slot.
import { useSessions } from "../context/SessionsContext"
import { usePermission } from "../context/PermissionContext"
import { useConnection } from "../context/ConnectionContext"
import { ChatSurface } from "../components/ChatSurface"
import { capabilities } from "../lib/capabilities"
import { isLocalModel } from "../lib/byok"
import { useModel } from "../context/ModelContext"
import { imageUnavailableReason, type CapabilityId, type CapabilitySupportMeta } from "../lib/globalMode"

// The composer's armed web tool → the agent that serves it. Research and Web search are
// two DISTINCT tools: `research` runs the heavy multi-round deep_research pipeline, while
// `websearch` runs the lightweight web_search tool (one search + one short summarize).
// They used to collapse to the same `research` agent, which is why a quick lookup ran the
// full DeepResearcher and timed out on the local model.
const AGENT_FOR_MODE = {
  research: "research",
  websearch: "websearch",
  none: "assistant",
} as const

export function ChatScreen() {
  const { slots, messagesOf, busyOf, send, createImage } = useSessions()
  const { abortSession } = usePermission()
  const { connected } = useConnection()
  const { activeModel } = useModel()
  const id = slots.chat

  return (
    <ChatSurface
      messages={messagesOf(id)}
      busy={busyOf(id)}
      blockedReason={connected && id ? null : "Connecting to the engine…"}
      onSend={(text, { attachments, mode }) =>
        send(id, text, { agent: AGENT_FOR_MODE[mode ?? "none"], attachments })
      }
      onCreateImage={(prompt) => createImage(id, prompt)}
      onCheckImage={async () => {
        // Read the image pref + capability catalog FRESH at Create time so a just-made
        // settings change is honored. localImagePresent is false in v1: offline image
        // has no backend wired yet (NJ-6 / the Local-mode notice), so offline → cloud
        // guidance, and an image-incapable cloud provider → "Current API doesn't support…".
        const [prefs, cat] = await Promise.all([capabilities.list(), capabilities.catalog()])
        const catalog: CapabilitySupportMeta[] = cat.capabilities.map((c) => ({
          id: c.id as CapabilityId,
          onlineProviders: c.onlineProviders,
        }))
        // The cloud provider chat is on (or null when Local) — lets the notice say
        // "Current API doesn't support…" under Cloud+Groq, where image is left offline.
        const chatProviderId = isLocalModel(activeModel)
          ? null
          : activeModel.slice(0, Math.max(0, activeModel.indexOf("/"))) || null
        return imageUnavailableReason({ imagePref: prefs.image, localImagePresent: false, catalog, chatProviderId })
      }}
      onStop={() => abortSession(id)}
      menu={{ research: true, webSearch: true, createImage: true }}
    />
  )
}
