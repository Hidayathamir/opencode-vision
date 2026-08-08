import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { askImageTool } from "../src/tool"
import type { ImageInput } from "../src/eye"

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-eye-tool-"))
}

describe("askImageTool", () => {
  it("returns the describe() answer and caches it", async () => {
    const dir = tmpDir()
    const imagePath = path.join(dir, "img.png")
    fs.writeFileSync(imagePath, PNG)
    let calls = 0
    const toolDef = askImageTool({
      describe: async (_image: ImageInput, question: string) => {
        calls++
        return `answer to ${question}`
      },
    })
    const args = { imagePath, question: "what is shown?" }
    const first = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(args, {})
    const second = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(args, {})
    expect(first).toBe("answer to what is shown?")
    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  it("returns an error string when the image path is missing", async () => {
    const toolDef = askImageTool({
      describe: async () => "unreachable",
    })
    const out = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath: path.join(tmpDir(), "nope.png"), question: "x" },
      {},
    )
    expect(out).toContain("no image found at")
  })

  it("returns an error string for a non-image path", async () => {
    const dir = tmpDir()
    const imagePath = path.join(dir, "notes.txt")
    fs.writeFileSync(imagePath, "just text")
    const toolDef = askImageTool({
      describe: async () => "unreachable",
    })
    const out = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath, question: "x" },
      {},
    )
    expect(out).toContain("no image found at")
  })

  it("returns an error string when describe() throws", async () => {
    const dir = tmpDir()
    const imagePath = path.join(dir, "img.png")
    fs.writeFileSync(imagePath, PNG)
    const toolDef = askImageTool({
      describe: async () => { throw new Error("provider down") },
    })
    const out = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath, question: "x" },
      {},
    )
    expect(out).toContain("provider down")
  })

  it("resolves a relative image path against the session directory", async () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, "img.png"), PNG)
    const toolDef = askImageTool({
      describe: async () => "found it",
    })
    const out = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath: "img.png", question: "what is shown?" },
      { directory: dir },
    )
    expect(out).toBe("found it")
  })

  it("re-inspects the file when it changes on disk", async () => {
    const dir = tmpDir()
    const imagePath = path.join(dir, "img.png")
    fs.writeFileSync(imagePath, PNG)
    let calls = 0
    const toolDef = askImageTool({
      describe: async (_image: ImageInput, question: string) => {
        calls++
        return `answer ${calls} to ${question}`
      },
    })
    const args = { imagePath, question: "what is shown?" }
    const first = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(args, {})
    expect(first).toBe("answer 1 to what is shown?")

    fs.writeFileSync(imagePath, PNG)
    fs.utimesSync(imagePath, new Date(Date.now() + 1000), new Date(Date.now() + 1000))
    const second = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(args, {})
    expect(second).toBe("answer 2 to what is shown?")
    expect(calls).toBe(2)
  })

  it("dedupes concurrent identical calls into one describe()", async () => {
    const dir = tmpDir()
    const imagePath = path.join(dir, "img.png")
    fs.writeFileSync(imagePath, PNG)
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const toolDef = askImageTool({
      describe: async () => {
        calls++
        await gate
        return "answer"
      },
    })
    const args = { imagePath, question: "what?" }
    const execute = toolDef.execute as (args: any, ctx: any) => Promise<string>
    const first = execute(args, {})
    const second = execute(args, {})
    release()
    expect(await first).toBe("answer")
    expect(await second).toBe("answer")
    expect(calls).toBe(1)
  })
})
