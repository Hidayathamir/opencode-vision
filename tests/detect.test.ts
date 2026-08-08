import { describe, expect, it } from "vitest"
import { Detector, getImageSupport, lookupImageSupport } from "../src/detect"

function providersClient(providerID: string, modelID: string, image: boolean): any {
  return {
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: providerID,
              name: providerID,
              models: {
                [modelID]: { capabilities: { input: { image } } },
              },
            },
          ],
        },
        error: undefined,
        request: {},
        response: {},
      }),
    },
  }
}

describe("detect", () => {
  const ref = { providerID: "openrouter", modelID: "qwen-2.5-vl-72b" }

  it("returns true when model supports image input", async () => {
    expect(await lookupImageSupport(providersClient("openrouter", "qwen-2.5-vl-72b", true), ref)).toBe(true)
  })

  it("returns false when model lacks image input", async () => {
    expect(await lookupImageSupport(providersClient("openrouter", "qwen-2.5-vl-72b", false), ref)).toBe(false)
  })

  it("returns null for unknown model", async () => {
    expect(await lookupImageSupport(providersClient("openrouter", "other", true), ref)).toBeNull()
  })

  it("returns null when the model has no image capability declared", async () => {
    const client = {
      config: {
        providers: async () => ({
          data: {
            providers: [
              { id: "openrouter", name: "openrouter", models: { "qwen-2.5-vl-72b": { capabilities: { input: {} } } } },
            ],
          },
          error: undefined,
          request: {},
          response: {},
        }),
      },
    }
    expect(await lookupImageSupport(client, ref)).toBeNull()
  })

  it("returns null when provider lookup throws", async () => {
    const client = { config: { providers: async () => { throw new Error("boom") } } }
    expect(await lookupImageSupport(client, ref)).toBeNull()
  })

  it("caches results in the Detector", async () => {
    const detector = new Detector()
    let calls = 0
    const client = {
      config: {
        providers: async () => {
          calls++
          return {
            data: {
              providers: [{ id: "openrouter", name: "openrouter", models: { "qwen-2.5-vl-72b": { capabilities: { input: { image: true } } } } }],
            },
            error: undefined,
            request: {},
            response: {},
          }
        },
      },
    }
    expect(await getImageSupport(detector, client, ref)).toBe(true)
    expect(await getImageSupport(detector, client, ref)).toBe(true)
    expect(calls).toBe(1)
  })

  it("does not cache a transient lookup failure", async () => {
    const detector = new Detector()
    let calls = 0
    const client = {
      config: {
        providers: async () => {
          calls++
          if (calls === 1) throw new Error("boom")
          return {
            data: {
              providers: [{ id: "openrouter", name: "openrouter", models: { "qwen-2.5-vl-72b": { capabilities: { input: { image: true } } } } }],
            },
            error: undefined,
            request: {},
            response: {},
          }
        },
      },
    }
    expect(await getImageSupport(detector, client, ref)).toBeNull()
    expect(await getImageSupport(detector, client, ref)).toBe(true)
    expect(calls).toBe(2)
  })

  it("does not cache a model-not-found result", async () => {
    const detector = new Detector()
    let models: Record<string, any> = {}
    const client = {
      config: {
        providers: async () => ({
          data: {
            providers: [{ id: "openrouter", name: "openrouter", models }],
          },
          error: undefined,
          request: {},
          response: {},
        }),
      },
    }
    expect(await getImageSupport(detector, client, ref)).toBeNull()
    models = { "qwen-2.5-vl-72b": { capabilities: { input: { image: true } } } }
    expect(await getImageSupport(detector, client, ref)).toBe(true)
  })

  it("warm() seeds the cache from a chat.params-style model", async () => {
    const detector = new Detector()
    detector.warm({ providerID: "deepseek", modelID: "deepseek-chat", capabilities: { input: { image: false } } })
    expect(detector.get({ providerID: "deepseek", modelID: "deepseek-chat" })).toBe(false)
  })
})
