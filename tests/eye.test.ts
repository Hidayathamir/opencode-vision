import { describe, expect, it, vi } from "vitest"
import { describeImage, parseModelSpec, sweepStaleEyeSessions } from "../src/eye"

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

function makeClient(answers: Record<string, string>, errors: string[] = [], promptErrors: string[] = []): any {
  let seq = 0
  const sessions = new Set<string>()
  return {
    session: {
      create: async () => {
        const id = `s${seq++}`
        sessions.add(id)
        return { data: { id }, error: undefined, request: {}, response: {} }
      },
      prompt: async (opts: any) => {
        const spec = `${opts.body.model.providerID}/${opts.body.model.modelID}`
        if (errors.includes(spec)) throw new Error(`provider error: ${spec}`)
        if (promptErrors.includes(spec)) {
          return {
            data: undefined,
            error: { name: "APIError", data: { message: `prompt rejected: ${spec}`, statusCode: 400, isRetryable: false } },
            request: {},
            response: {},
          }
        }
        return { data: { info: { id: opts.path.id }, parts: [] }, error: undefined, request: {}, response: {} }
      },
      messages: async (opts: any) => {
        const answer = answers[opts.path.id] ?? ""
        return {
          data: [{ info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: answer }] }],
          error: undefined,
          request: {},
          response: {},
        }
      },
      delete: async (opts: any) => {
        sessions.delete(opts.path.id)
        return { data: true, error: undefined, request: {}, response: {} }
      },
    },
  }
}

describe("eye", () => {
  it("parses model specs", () => {
    expect(parseModelSpec("openrouter/qwen-2.5-vl-72b")).toEqual(["openrouter", "qwen-2.5-vl-72b"])
    expect(parseModelSpec("openrouter")).toEqual(["", ""])
  })

  it("returns the model's answer on success", async () => {
    const answers: Record<string, string> = { s0: "a button" }
    const client = makeClient(answers)
    const text = await describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what is this?")
    expect(text).toBe("a button")
  })

  it("throws when the model errors", async () => {
    const client = makeClient({}, ["openrouter/qwen-2.5-vl-72b"])
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what is this?"),
    ).rejects.toThrow("provider error")
  })

  it("rejects an invalid model spec", async () => {
    const client = makeClient({})
    await expect(
      describeImage(client, "openrouter", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("invalid eye model spec")
  })

  it("disables all tools on the internal eye session to avoid tool-count limits", async () => {
    let seenTools: any
    const client = makeClient({ s0: "a button" })
    const original = client.session.prompt
    client.session.prompt = async (opts: any) => {
      seenTools = opts.body.tools
      return original(opts)
    }
    await describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?")
    expect(seenTools).toEqual({ "*": false })
  })

  it("gives the internal session a custom title to suppress title-generation calls", async () => {
    let seenCreateBody: any
    const client = makeClient({ s0: "a button" })
    const original = client.session.create
    client.session.create = async (opts?: any) => {
      seenCreateBody = opts?.body
      return original(opts)
    }
    await describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?")
    expect(seenCreateBody?.title).toBe("opencode-eye · temporary (auto-deletes)")
  })

  it("defers session deletion until the configured lifetime and then deletes it", async () => {
    vi.useFakeTimers()
    try {
      let deleteCalls = 0
      const created: string[] = []
      const destroyed: string[] = []
      const client: any = {
        session: {
          create: async () => ({ data: { id: "s0" }, error: undefined, request: {}, response: {} }),
          prompt: async () => ({ data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }),
          messages: async () => ({
            data: [{ info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "ok" }] }],
            error: undefined,
            request: {},
            response: {},
          }),
          delete: async () => {
            deleteCalls++
            return { data: true, error: undefined, request: {}, response: {} }
          },
        },
      }
      const text = await describeImage(
        client,
        "openrouter/qwen-2.5-vl-72b",
        { data: PNG, mime: "image/png" },
        "what?",
        {
          onSessionCreated: (id) => created.push(id),
          onSessionDeleted: (id) => destroyed.push(id),
        },
        { sessionLifetimeMs: 5_000 },
      )
      expect(text).toBe("ok")
      expect(created).toEqual(["s0"])
      expect(deleteCalls).toBe(0)
      expect(destroyed).toEqual([])
      await vi.advanceTimersByTimeAsync(5_000)
      expect(deleteCalls).toBe(1)
      expect(destroyed).toEqual(["s0"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("deletes the session immediately when sessionLifetimeMs is 0", async () => {
    let deleteCalls = 0
    const destroyed: string[] = []
    const client = makeClient({ s0: "a button" })
    const original = client.session.delete
    client.session.delete = async (opts: any) => {
      deleteCalls++
      return original(opts)
    }
    const text = await describeImage(
      client,
      "openrouter/qwen-2.5-vl-72b",
      { data: PNG, mime: "image/png" },
      "what?",
      { onSessionDeleted: (id) => destroyed.push(id) },
      { sessionLifetimeMs: 0 },
    )
    expect(text).toBe("a button")
    expect(deleteCalls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(destroyed).toEqual(["s0"])
  })

  it("still fires onSessionDeleted when the delete call fails", async () => {
    const destroyed: string[] = []
    const client = makeClient({ s0: "a button" })
    client.session.delete = async () => {
      throw new Error("delete failed")
    }
    const text = await describeImage(
      client,
      "openrouter/qwen-2.5-vl-72b",
      { data: PNG, mime: "image/png" },
      "what?",
      { onSessionDeleted: (id) => destroyed.push(id) },
      { sessionLifetimeMs: 0 },
    )
    expect(text).toBe("a button")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(destroyed).toEqual(["s0"])
  })

  it("surfaces the provider error detail", async () => {
    const rateLimited = makeClient({}, ["openrouter/a"])
    rateLimited.session.prompt = async () => {
      throw new Error("AI_APICallError: [Google AI Studio] x is temporarily rate-limited upstream")
    }
    await expect(
      describeImage(rateLimited, "openrouter/a", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("AI_APICallError: [Google AI Studio] x is temporarily rate-limited upstream")

    const timedOut = makeClient({}, ["openrouter/b"])
    timedOut.session.prompt = async () => {
      throw new Error("AI_APICallError: Provider timed out after 19674ms")
    }
    await expect(
      describeImage(timedOut, "openrouter/b", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("AI_APICallError: Provider timed out after 19674ms")
  })

  it("throws on empty response", async () => {
    const client = makeClient({})
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("eye model returned empty response")
  })

  it("keeps polling until the assistant message finishes instead of returning partial text", async () => {
    let calls = 0
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: async () => ({ data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }),
        messages: async () => {
          calls++
          if (calls === 1) {
            // partial text, still streaming (no finish yet)
            return {
              data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "a red" }] }],
              error: undefined,
              request: {},
              response: {},
            }
          }
          return {
            data: [{ info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "a red button" }] }],
            error: undefined,
            request: {},
            response: {},
          }
        },
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const text = await describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?")
    expect(text).toBe("a red button")
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it("surfaces a clean error when session.messages returns a non-array envelope", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: async () => ({ data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }),
        messages: async () => ({
          data: undefined,
          error: { name: "APIError", data: { message: "messages endpoint failed", statusCode: 500, isRetryable: true } },
          request: {},
          response: {},
        }),
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("eye model error: messages endpoint failed")
  })

  it("fails fast when the prompt returns an error result", async () => {
    const client = makeClient({}, [], ["openrouter/qwen-2.5-vl-72b"])
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("eye model error: prompt rejected")
  })

  it("fails fast when session.create returns an error and never registers the session", async () => {
    const client = makeClient({})
    client.session.create = async () => ({
      data: undefined,
      error: { name: "APIError", data: { message: "could not create session", statusCode: 400, isRetryable: false } },
      request: {},
      response: {},
    })
    const created: string[] = []
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", {
        onSessionCreated: (id) => created.push(id),
      }),
    ).rejects.toThrow("eye model error: could not create session")
    expect(created).toHaveLength(0)
  })

  it("fails fast when the assistant message carries an error", async () => {
    const client = makeClient({})
    client.session.messages = async (opts: any) => ({
      data: [
        {
          info: { role: "assistant", error: { name: "APIError", data: { message: "upstream 500", statusCode: 500, isRetryable: true } } },
          parts: [],
        },
      ],
      error: undefined,
      request: {},
      response: {},
    })
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?"),
    ).rejects.toThrow("eye model error: upstream 500")
  })

  it("honors a custom timeout", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: async () => ({ data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }),
        messages: async () => ({
          data: [{ info: { role: "assistant" }, parts: [] }], // no text, no finish, no error
          error: undefined,
          request: {},
          response: {},
        }),
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out")
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("times out a hung prompt call", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: () => new Promise(() => {}), // never resolves
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out waiting for eye model response")
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("times out a hung session.create call", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: () => new Promise(() => {}), // never resolves
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out waiting for eye model response")
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("times out a hung messages poll", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: async () => ({ data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }),
        messages: () => new Promise(() => {}), // never resolves
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out")
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("aborts in-flight SDK requests when the timeout fires", async () => {
    let seq = 0
    const signals: Array<AbortSignal | undefined> = []
    const client: any = {
      session: {
        create: async (opts?: any) => {
          signals.push(opts?.signal)
          return { data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }
        },
        prompt: async (opts?: any) => {
          signals.push(opts?.signal)
          return { data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }
        },
        messages: (opts?: any) => {
          signals.push(opts?.signal)
          return new Promise(() => {}) // never resolves
        },
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out")
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(signals).toHaveLength(3)
    for (const s of signals) expect(s?.aborted).toBe(true)
  })

  it("bounds the total wall time to the single deadline, not 2x it", async () => {
    let seq = 0
    const client: any = {
      session: {
        create: async () => ({ data: { id: `s${seq++}` }, error: undefined, request: {}, response: {} }),
        prompt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          return { data: { info: { id: "s0" }, parts: [] }, error: undefined, request: {}, response: {} }
        },
        messages: async () => ({
          data: [{ info: { role: "assistant" }, parts: [] }], // no text, no finish, no error
          error: undefined,
          request: {},
          response: {},
        }),
        delete: async () => ({ data: true, error: undefined, request: {}, response: {} }),
      },
    }
    const started = Date.now()
    await expect(
      describeImage(client, "openrouter/qwen-2.5-vl-72b", { data: PNG, mime: "image/png" }, "what?", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow("Timed out")
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(400)
    expect(elapsed).toBeLessThan(800)
  })

  it("sweeps stale internal eye sessions and returns the deleted count", async () => {
    const now = Date.now()
    const deleted: string[] = []
    const client: any = {
      session: {
        list: async () => ({
          data: [
            { id: "stale", title: "opencode-eye · temporary (auto-deletes)", time: { created: now - 7_200_000 } },
            { id: "fresh", title: "opencode-eye · temporary (auto-deletes)", time: { created: now - 60_000 } },
            { id: "legacy", title: "opencode-eye image inspection", time: { created: now - 7_200_000 } },
            { id: "near", title: "opencode-eye something else", time: { created: now - 7_200_000 } },
            { id: "user", title: "my own session", time: { created: now - 86_400_000 } },
          ],
          error: undefined,
          request: {},
          response: {},
        }),
        delete: async (opts: any) => {
          deleted.push(opts.path.id)
          return { data: true, error: undefined, request: {}, response: {} }
        },
      },
    }
    const count = await sweepStaleEyeSessions(client, { lifetimeMs: 1_800_000 })
    expect(count).toBe(2)
    expect(deleted.sort()).toEqual(["legacy", "stale"])
  })

  it("returns 0 and never throws when listing sessions fails", async () => {
    const client: any = {
      session: {
        list: async () => {
          throw new Error("boom")
        },
      },
    }
    await expect(sweepStaleEyeSessions(client, { lifetimeMs: 1_800_000 })).resolves.toBe(0)
  })

  it("returns 0 when the list response is not an array", async () => {
    const client: any = {
      session: {
        list: async () => ({
          data: undefined,
          error: { name: "APIError", data: { message: "boom", statusCode: 500, isRetryable: true } },
          request: {},
          response: {},
        }),
      },
    }
    await expect(sweepStaleEyeSessions(client, { lifetimeMs: 1_800_000 })).resolves.toBe(0)
  })

  it("keeps sweeping past a per-session delete failure", async () => {
    const now = Date.now()
    let deleteCalls = 0
    const client: any = {
      session: {
        list: async () => ({
          data: [
            { id: "a", title: "opencode-eye · temporary (auto-deletes)", time: { created: now - 7_200_000 } },
            { id: "b", title: "opencode-eye · temporary (auto-deletes)", time: { created: now - 7_200_000 } },
          ],
          error: undefined,
          request: {},
          response: {},
        }),
        delete: async () => {
          deleteCalls++
          if (deleteCalls === 1) throw new Error("boom")
          return { data: true, error: undefined, request: {}, response: {} }
        },
      },
    }
    await expect(sweepStaleEyeSessions(client, { lifetimeMs: 1_800_000 })).resolves.toBe(1)
  })
})
