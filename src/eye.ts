import { mimeToExt } from "./cache"
import { unwrap } from "./sdk"

export interface ImageInput {
  data: Buffer
  mime: string
}

export interface EyeHooks {
  onSessionCreated?(id: string): void
  onSessionDeleted?(id: string): void
}

export interface EyeOptions {
  timeoutMs?: number
}

const SYSTEM_PROMPT =
  "You are an image analysis assistant. Answer the user's question about the attached image concisely and accurately."

const INTERNAL_SESSION_TITLE = "opencode-eye image inspection"

export function parseModelSpec(spec: string): [string, string] {
  const i = spec.indexOf("/")
  if (i <= 0) return ["", ""]
  return [spec.slice(0, i), spec.slice(i + 1)]
}

function errorDetail(e: any): string {
  if (!e) return "unknown error"
  const data = e.data?.message ?? e.message ?? e.name ?? "unknown error"
  return typeof data === "string" ? data : JSON.stringify(data)
}

function withTimeout<T>(promise: Promise<T>, deadline: number, message: string, controller?: AbortController): Promise<T> {
  const remaining = Math.max(0, deadline - Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new Error(message))
      }, remaining)
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

async function waitForAssistantText(client: any, sessionID: string, deadline: number, controller: AbortController): Promise<string> {
  const signal = controller.signal
  while (Date.now() < deadline) {
    const msgs = await withTimeout(
      unwrap<Array<any>>(client.session.messages({ path: { id: sessionID }, signal })).catch((e: any) => {
        throw new Error(`eye model error: ${errorDetail(e)}`)
      }),
      deadline,
      "Timed out waiting for eye model response",
      controller,
    )
    if (!Array.isArray(msgs)) throw new Error(`eye model error: ${errorDetail((msgs as any)?.error)}`)
    const assistant = [...msgs].reverse().find((m: any) => m.info?.role === "assistant")
    if (assistant?.info?.error) {
      throw new Error(`eye model error: ${errorDetail(assistant.info.error)}`)
    }
    const text = (assistant?.parts ?? [])
      .filter((p: any) => p.type === "text" && !p.synthetic)
      .map((p: any) => p.text)
      .join("\n")
    if (assistant?.info?.finish) {
      if (text) return text
      throw new Error("eye model returned empty response")
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error("Timed out waiting for eye model response")
}

export async function describeImage(
  client: any,
  modelSpec: string,
  image: ImageInput,
  question: string,
  hooks?: EyeHooks,
  options?: EyeOptions,
): Promise<string> {
  const [providerID, modelID] = parseModelSpec(modelSpec)
  if (!providerID || !modelID) throw new Error(`invalid eye model spec: ${modelSpec}`)

  const timeoutMs = options?.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  const controller = new AbortController()
  const signal = controller.signal

  const created: any = await withTimeout(
    client.session.create({ body: { title: INTERNAL_SESSION_TITLE }, signal }),
    deadline,
    "Timed out waiting for eye model response",
    controller,
  )
  if (created?.error) throw new Error(`eye model error: ${errorDetail(created.error)}`)
  const session = await unwrap<{ id: string }>(created)
  if (!session?.id) throw new Error("eye session could not be created")
  hooks?.onSessionCreated?.(session.id)
  try {
    const result: any = await withTimeout(
      client.session.prompt({
        path: { id: session.id },
        body: {
          model: { providerID, modelID },
          system: SYSTEM_PROMPT,
          tools: { "*": false },
          parts: [
            {
              type: "file",
              mime: image.mime,
              url: `data:${image.mime};base64,${image.data.toString("base64")}`,
              filename: `image.${mimeToExt(image.mime) ?? "png"}`,
            },
            { type: "text", text: question },
          ],
        },
        signal,
      }),
      deadline,
      "Timed out waiting for eye model response",
      controller,
    )
    if (result?.error) throw new Error(`eye model error: ${errorDetail(result.error)}`)
    return await waitForAssistantText(client, session.id, deadline, controller)
  } finally {
    await client.session.delete({ path: { id: session.id } }).catch(() => {})
    hooks?.onSessionDeleted?.(session.id)
  }
}


