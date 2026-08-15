import { describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { OpencodeEye } from "../plugin"

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-eye-plugin-"))
}

function providersClient(providerID: string, modelID: string, image: boolean): any {
  return {
    config: {
      providers: async () => ({
        data: {
          providers: [{ id: providerID, name: providerID, models: { [modelID]: { capabilities: { input: { image } } } } }],
        },
        error: undefined,
        request: {},
        response: {},
      }),
    },
  }
}

async function makePlugin(opts: any, client: any) {
  const hooks = await OpencodeEye({ client }, opts)
  return hooks
}

const imagePart = (id = "p1") => ({ id, sessionID: "s1", messageID: "m1", type: "file", mime: "image/png", url: DATA_URL })

describe("opencode-eye plugin", () => {
  it("strips image to a marker for a non-eye model", async () => {
    const dir = tmpDir()
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: dir }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts.length).toBe(1)
    expect(output.parts[0].type).toBe("text")
    const text = (output.parts[0] as any).text as string
    expect(text).toMatch(/^\[Attached image .+\/img\/img_[0-9a-f]{40}\.png — use the ask_image tool to inspect its contents\]$/)
    const imgPath = /\[Attached image (.+?) — use the ask_image tool/.exec(text)![1]
    expect(fs.existsSync(imgPath)).toBe(true)
  })

  it("strips a disk-attached image (source.path) to a marker", async () => {
    const dir = tmpDir()
    const attached = path.join(dir, "attached.png")
    fs.writeFileSync(attached, PNG)
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: dir }, client)
    const output = {
      message: { id: "m1" },
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "file", mime: "image/png", url: "", source: { type: "file", path: attached } }],
    }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts[0].type).toBe("text")
    const text = (output.parts[0] as any).text as string
    const imgPath = /\[Attached image (.+?) — use the ask_image tool/.exec(text)![1]
    expect(imgPath).not.toBe(attached)
    expect(fs.existsSync(imgPath)).toBe(true)
  })

  it("keeps the image for an eye-capable model", async () => {
    const client = providersClient("anthropic", "claude-sonnet-4-6", true)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: tmpDir() }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } }, output)
    expect(output.parts[0].type).toBe("file")
  })

  it("keeps the image for the model listed in eye.model", async () => {
    const client = providersClient("openrouter", "qwen-2.5-vl-72b", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: tmpDir() }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "openrouter", modelID: "qwen-2.5-vl-72b" } }, output)
    expect(output.parts[0].type).toBe("file")
  })

  it("replaces images with a guidance marker when no eye model is configured", async () => {
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ cacheDir: tmpDir() }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    const text = (output.parts[0] as any).text as string
    expect(text).toContain("cannot see images")
    expect(text).toContain("eye.model")
  })

  it("does not block when capability lookup fails and no eye model is configured", async () => {
    const client = { config: { providers: async () => { throw new Error("boom") } } }
    const hooks = await makePlugin({ cacheDir: tmpDir() }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } }, output)
    expect(output.parts[0].type).toBe("file")
  })

  it("does nothing when the message has no images", async () => {
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: tmpDir() }, client)
    const output = { message: { id: "m1" }, parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hello" }] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
  })

  it("replaces each image part with its own marker, and error-markers ones it cannot cache", async () => {
    const dir = tmpDir()
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: dir }, client)
    const output = {
      message: { id: "m1" },
      parts: [
        imagePart("good"),
        { id: "uncacheable", sessionID: "s1", messageID: "m1", type: "file", mime: "image/png", url: "" },
        { id: "also-good", sessionID: "s1", messageID: "m1", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" },
      ],
    }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(3)
    expect(output.parts.every((p: any) => p.type === "text")).toBe(true)
    const texts = output.parts.map((p: any) => p.text)
    expect(texts[0]).toMatch(/^\[Attached image .+\/img\/img_[0-9a-f]{40}\.png — use the ask_image tool to inspect its contents\]$/)
    expect(texts[1]).toContain("could not be cached")
    expect(texts[2]).toMatch(/^\[Attached image .+\/img\/img_[0-9a-f]{40}\.png — use the ask_image tool to inspect its contents\]$/)
    expect(texts[0]).not.toBe(texts[2])
  })

  it("falls back to an error-marker when the cache write throws", async () => {
    const dir = tmpDir()
    const cacheFile = path.join(dir, "not-a-dir")
    fs.writeFileSync(cacheFile, "x")
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: cacheFile }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    expect((output.parts[0] as any).text).toContain("could not be cached")
  })

  it("does not mislabel an unsupported image format as png", async () => {
    const dir = tmpDir()
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: dir }, client)
    const output = {
      message: { id: "m1" },
      parts: [
        { id: "p1", sessionID: "s1", messageID: "m1", type: "file", mime: "image/heic", url: `data:image/heic;base64,${Buffer.from("notheic").toString("base64")}` },
      ],
    }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    const text = (output.parts[0] as any).text as string
    expect(text).toContain("could not be cached")
    expect(text).not.toMatch(/img_[0-9a-f]{40}\.png/)
  })

  it("embeds the original source.path in the error-marker when a disk image cannot be cached", async () => {
    const dir = tmpDir()
    const attached = path.join(dir, "attached")
    fs.writeFileSync(attached, "not-an-image")
    const client = providersClient("deepseek", "deepseek-chat", false)
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: dir }, client)
    const output = {
      message: { id: "m1" },
      parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "file", mime: "image/png", url: "", source: { type: "file", path: attached } }],
    }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].type).toBe("text")
    const text = (output.parts[0] as any).text as string
    expect(text).toContain("could not be cached")
    expect(text).toContain(attached)
  })

  it("routes the marker through the ask_image tool to the eye model end-to-end", async () => {
    const dir = tmpDir()
    const calls: string[] = []
    let seq = 0
    const client = providersClient("deepseek", "deepseek-chat", false)
    client.session = {
      create: async () => {
        calls.push("create")
        return { data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }
      },
      prompt: async (opts: any) => {
        calls.push("prompt")
        expect(opts.body.model).toEqual({ providerID: "openrouter", modelID: "qwen-2.5-vl-72b" })
        expect(opts.body.tools).toEqual({ "*": false })
        const file = opts.body.parts.find((p: any) => p.type === "file")
        expect(file?.mime).toBe("image/png")
        return { data: { info: { id: opts.path.id }, parts: [] }, error: undefined, request: {}, response: {} }
      },
      messages: async () => ({
        data: [{ info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "a red button" }] }],
        error: undefined,
        request: {},
        response: {},
      }),
      delete: async () => {
        calls.push("delete")
        return { data: true, error: undefined, request: {}, response: {} }
      },
    }
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b", sessionLifetimeMs: 0 }, cacheDir: dir }, client)
    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: "s1", model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    const text = (output.parts[0] as any).text as string
    const imgPath = /\[Attached image (.+?) — use the ask_image tool/.exec(text)![1]

    const toolDef = (hooks.tool as any).ask_image
    const answer = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath: imgPath, question: "what color is the button?" },
      {},
    )
    expect(answer).toBe("a red button")
    expect(calls).toEqual(["create", "prompt", "delete"])
  })

  it("defers the internal session deletion for eye.sessionLifetimeMs", async () => {
    vi.useFakeTimers()
    try {
      const dir = tmpDir()
      const imgPath = path.join(dir, "img.png")
      fs.writeFileSync(imgPath, PNG)
      const calls: string[] = []
      let seq = 0
      const client = providersClient("deepseek", "deepseek-chat", false)
      client.session = {
        list: async () => ({ data: [], error: undefined, request: {}, response: {} }),
        create: async () => {
          calls.push("create")
          return { data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }
        },
        prompt: async (opts: any) => {
          calls.push("prompt")
          return { data: { info: { id: opts.path.id }, parts: [] }, error: undefined, request: {}, response: {} }
        },
        messages: async () => ({
          data: [{ info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "a red button" }] }],
          error: undefined,
          request: {},
          response: {},
        }),
        delete: async () => {
          calls.push("delete")
          return { data: true, error: undefined, request: {}, response: {} }
        },
      }
      const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b", sessionLifetimeMs: 5_000 }, cacheDir: dir }, client)
      const toolDef = (hooks.tool as any).ask_image
      const answer = await (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
        { imagePath: imgPath, question: "what color?" },
        {},
      )
      expect(answer).toBe("a red button")
      expect(calls).toEqual(["create", "prompt"])
      await vi.advanceTimersByTimeAsync(5_000)
      expect(calls).toEqual(["create", "prompt", "delete"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("runs the stale-session sweep at init without breaking startup", async () => {
    const client = providersClient("deepseek", "deepseek-chat", false)
    const listSpy = vi.fn(async () => {
      throw new Error("boom")
    })
    client.session = { list: listSpy }
    const hooks = await makePlugin({ eye: { model: "openrouter/qwen-2.5-vl-72b" }, cacheDir: tmpDir() }, client)
    expect(hooks.tool).toBeDefined()
    expect((hooks.tool as any).ask_image).toBeDefined()
    expect(listSpy).toHaveBeenCalled()
  })

  it("does not strip images from its own internal eye sessions", async () => {
    const dir = tmpDir()
    const imgPath = path.join(dir, "img.png")
    fs.writeFileSync(imgPath, PNG)
    const client = providersClient("deepseek", "deepseek-chat", false)
    let internalID = ""
    let seq = 0
    client.session = {
      create: async () => {
        internalID = `s${seq++}`
        return { data: { id: internalID }, error: undefined, request: {}, response: {} }
      },
      prompt: () => new Promise(() => {}),
      messages: async () => ({ data: [], error: undefined, request: {}, response: {} }),
      delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
    }
    const hooks = await makePlugin(
      { eye: { model: "openrouter/qwen-2.5-vl-72b", timeoutMs: 500 }, cacheDir: dir },
      client,
    )
    const toolDef = (hooks.tool as any).ask_image
    const pending = (toolDef.execute as (args: any, ctx: any) => Promise<string>)(
      { imagePath: imgPath, question: "what?" },
      {},
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(internalID).not.toBe("")

    const output = { message: { id: "m1" }, parts: [imagePart()] }
    await (hooks["chat.message"] as any)({ sessionID: internalID, model: { providerID: "deepseek", modelID: "deepseek-chat" } }, output)
    expect(output.parts[0].type).toBe("file")

    const err = await pending
    expect(err).toContain("Timed out")
  })
})
