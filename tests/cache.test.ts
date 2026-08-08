import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { decodeDataUrl, readImageFile, writeImage } from "../src/cache"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-eye-test-"))
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

describe("cache", () => {
  it("decodes a data URL", () => {
    const d = decodeDataUrl(`data:image/png;base64,${PNG.toString("base64")}`)
    expect(d?.mime).toBe("image/png")
    expect(d?.data.equals(PNG)).toBe(true)
  })

  it("returns null for non-data URLs", () => {
    expect(decodeDataUrl("file:///tmp/x.png")).toBeNull()
    expect(decodeDataUrl("")).toBeNull()
  })

  it("writes and reads an image, deduping by content", () => {
    const dir = tmpDir()
    const file1 = writeImage(dir, PNG, "image/png")
    const file2 = writeImage(dir, PNG, "image/png")
    expect(file1).toBe(file2)
    expect(path.basename(file1!)).toMatch(/^img_[0-9a-f]{40}\.png$/)
    const read = readImageFile(file1!)
    expect(read?.data.equals(PNG)).toBe(true)
    expect(read?.mime).toBe("image/png")
  })

  it("writeImage returns null for an unsupported mime instead of mislabeling it", () => {
    const dir = tmpDir()
    expect(writeImage(dir, PNG, "image/heic")).toBeNull()
    expect(writeImage(dir, PNG, "image/svg+xml")).toBeNull()
  })

  it("readImageFile reads a file and sniffs its mime", () => {
    const dir = tmpDir()
    const file = writeImage(dir, PNG, "image/png")
    const read = readImageFile(file!)
    expect(read?.data.equals(PNG)).toBe(true)
    expect(read?.mime).toBe("image/png")
  })

  it("readImageFile prefers magic bytes over a misleading extension", () => {
    const dir = tmpDir()
    const file = path.join(dir, "sniffed.txt")
    fs.writeFileSync(file, PNG)
    expect(readImageFile(file)?.mime).toBe("image/png")
  })

  it("readImageFile falls back to the extension when magic bytes are unknown", () => {
    const dir = tmpDir()
    const file = path.join(dir, "stub.png")
    fs.writeFileSync(file, "not really an image")
    expect(readImageFile(file)?.mime).toBe("image/png")
  })

  it("readImageFile returns null for a missing file", () => {
    expect(readImageFile(path.join(tmpDir(), "nope.png"))).toBeNull()
  })

  it("readImageFile returns null for a non-image file", () => {
    const dir = tmpDir()
    const file = path.join(dir, "notes.txt")
    fs.writeFileSync(file, "just text")
    expect(readImageFile(file)).toBeNull()
  })
})
