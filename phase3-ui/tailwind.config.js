/** @type {import('tailwindcss').Config} */
// Nightjar theme tokens — LOCKED (do not replace with Tailwind defaults).
export default {
  content: ["./src/renderer/**/*.{html,tsx,ts}"],
  theme: {
    extend: {
      colors: {
        nightjar: {
          base: "#14110D", // near-black, warm brown undertone (app background)
          surface: "#2A2419", // muted bark/moss (cards, panels)
          accent: "#C9852E", // dusty amber, nightjar-eye glow (active, orb)
          text: "#EDE6D6", // warm off-white
          alert: "#A13D2B", // muted rust-red (errors, permission-ask)
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
}
