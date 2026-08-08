import { describe, expect, it } from "vitest"
import { buildMarker } from "../src/marker"

describe("marker", () => {
  it("builds a marker containing the full image path", () => {
    expect(buildMarker("/home/user/.cache/opencode-eye/img/img_0123456789abcdef0123456789abcdef01234567.png")).toBe(
      "[Attached image /home/user/.cache/opencode-eye/img/img_0123456789abcdef0123456789abcdef01234567.png — use the ask_image tool to inspect its contents]",
    )
  })
})
