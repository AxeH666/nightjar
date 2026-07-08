/** @type {import('tailwindcss').Config} */
// JUNE theme tokens — LOCKED (do not replace with Tailwind defaults).
// Values live as CSS custom properties in src/renderer/src/index.css (:root);
// these tokens map onto them via the <alpha-value> pattern so opacity
// modifiers (bg-nightjar-accent/10, text-nightjar-text/40) keep working.
// Token NAMES stay `nightjar.*` for now; the nightjar-→june- class rename is
// a separate mechanical stage of the redesign.
export default {
  content: ["./src/renderer/**/*.{html,tsx,ts}"],
  theme: {
    extend: {
      colors: {
        nightjar: {
          base: "rgb(var(--nj-base) / <alpha-value>)", // #080A08 app background
          surface: "rgb(var(--nj-surface) / <alpha-value>)", // #141915 cards/panels
          accent: "rgb(var(--nj-accent) / <alpha-value>)", // #39D353 green (active, orb)
          text: "rgb(var(--nj-text) / <alpha-value>)", // #D4E8D6 warm off-white
          alert: "rgb(var(--nj-alert) / <alpha-value>)", // #E5484D warnings/permission ONLY
          silver: "rgb(var(--nj-silver) / <alpha-value>)", // #AEB8B2 HUD rings/secondary chrome
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
