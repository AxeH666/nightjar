import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

// Electron/Chromium default: a file dropped anywhere in the window NAVIGATES to its
// file:// URL — replacing the whole app with the raw file. That's the #1 reason drag-
// and-drop "didn't work". Swallow drag/drop at the window level so a stray drop can
// never navigate; the composer's own drop zone still handles real attaches (its handler
// runs first and processes the files, then this preventDefault stops the navigation).
window.addEventListener("dragover", (e) => e.preventDefault())
window.addEventListener("drop", (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
