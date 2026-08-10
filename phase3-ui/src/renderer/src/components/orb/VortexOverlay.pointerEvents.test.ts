import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { VortexOverlay } from "./VortexOverlay"

const activeStates = ["listening", "connecting", "speaking"] as const

describe("VortexOverlay pointer events (NJ-97)", () => {
  test.each(activeStates)("stays click-through while %s", (state) => {
    const markup = renderToStaticMarkup(
      createElement(VortexOverlay, { state, volume: 0, active: true }),
    )
    const rootClasses = /^<div[^>]*\sclass="([^"]*)"/
      .exec(markup)?.[1]
      .split(/\s+/)

    expect(rootClasses).toEqual(
      expect.arrayContaining(["pointer-events-none", "opacity-100"]),
    )
  })
})
