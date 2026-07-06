// Rules-based mode suggestion (NON-blocking, NON-LLM — per the §8 decision:
// explicit-first, with a lightweight keyword hint that never switches silently).
// Returns a suggested mode name ONLY if it differs from the active mode and the
// phrasing is a clear signal. Never routes by asking the model.

const RULES: { mode: string; patterns: RegExp[] }[] = [
  {
    mode: "research",
    patterns: [/\bresearch\b/i, /\blook up\b/i, /\bfind out (about|what)\b/i, /\bsummari[sz]e .*(web|online|latest)\b/i, /\bwhat('s| is) the latest\b/i],
  },
  {
    mode: "coding",
    patterns: [/\b(fix|refactor|implement|debug|write) .*(code|function|bug|file|test)\b/i, /\brun (the )?(tests|build)\b/i, /\bedit .*\.(ts|js|py|go|rs|json)\b/i, /\bgit\b/i],
  },
  {
    mode: "assistant",
    patterns: [/\b(remember|note|remind|schedule|calendar|task|email|to-?do)\b/i, /\bwhat('s| is) on my (calendar|schedule)\b/i, /\bsend .*(email|mail)\b/i],
  },
]

export function suggestMode(text: string, activeMode: string, availableModes: string[]): string | null {
  const t = text.trim()
  if (t.length < 4) return null
  for (const rule of RULES) {
    if (!availableModes.includes(rule.mode)) continue
    if (rule.mode === activeMode) continue
    if (rule.patterns.some((re) => re.test(t))) return rule.mode
  }
  return null
}
