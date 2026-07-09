// App — thin composition of the context providers around the AppShell (the
// redesigned Chat/Cowork/Code frame). Nearly all state lives in ./context/*.
// Provider nesting (outer → inner, by dependency direction):
//   Connection → Model → Artifact → Sessions → Permission
//   • Artifact sits above Sessions so the session reducer can delegate onToolCall.
//   • Permission is innermost so its abort can clear a session's busy flag.
import { ConnectionProvider } from "./context/ConnectionContext"
import { ModelProvider } from "./context/ModelContext"
import { ArtifactProvider } from "./context/ArtifactContext"
import { SessionsProvider } from "./context/SessionsContext"
import { PermissionProvider } from "./context/PermissionContext"
import { AppShell } from "./shell/AppShell"

export default function App() {
  return (
    <ConnectionProvider>
      <ModelProvider>
        <ArtifactProvider>
          <SessionsProvider>
            <PermissionProvider>
              <AppShell />
            </PermissionProvider>
          </SessionsProvider>
        </ArtifactProvider>
      </ModelProvider>
    </ConnectionProvider>
  )
}
