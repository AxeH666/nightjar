// ChatScreen — the unified Assistant + Research conversation (redesign Stage 5/6).
// Research is no longer a whole-workspace mode: it's a per-message toggle in the
// composer's "+" menu that resolves to the research agent at send time (explicit,
// not AI-guessed). Bound to the chat session slot.
import { useSessions } from "../context/SessionsContext"
import { ChatSurface } from "../components/ChatSurface"

export function ChatScreen() {
  const { slots, messagesOf, busyOf, send, createImage } = useSessions()
  const id = slots.chat

  return (
    <ChatSurface
      messages={messagesOf(id)}
      busy={busyOf(id)}
      onSend={(text, { attachments, research }) =>
        send(id, text, { agent: research ? "research" : "assistant", attachments })
      }
      onCreateImage={(prompt) => createImage(id, prompt)}
      menu={{ research: true, webSearch: true, createImage: true }}
    />
  )
}
