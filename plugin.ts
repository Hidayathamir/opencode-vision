import type { Hooks } from "@opencode-ai/plugin"
import { Detector, getImageSupport } from "./src/detect"
import { decodeDataUrl, readImageFile, resolveCacheDir, writeImage } from "./src/cache"
import { buildMarker } from "./src/marker"
import { describeImage, type ImageInput } from "./src/eye"
import { askImageTool } from "./src/tool"

export interface OpencodeEyeOptions {
  eye?: { model?: string; timeoutMs?: number }
  cacheDir?: string
}

const BLOCK_TEXT =
  "[Attached image — this model cannot see images, and no eye model is configured (eye.model). Add one to opencode.json to inspect images.]"

export const OpencodeEye: (input: { client: any }, options?: OpencodeEyeOptions) => Promise<Hooks> = async (
  { client },
  options: OpencodeEyeOptions = {},
) => {
  const model = options.eye?.model ?? ""
  const timeoutMs = options.eye?.timeoutMs ?? 60_000
  const cacheDir = resolveCacheDir(options.cacheDir)
  const detector = new Detector()
  const internalSessions = new Set<string>()

  const isEyeModel = (ref: { providerID: string; modelID: string }) =>
    model !== "" && model === `${ref.providerID}/${ref.modelID}`

  const isImagePart = (p: any): p is { id: string; sessionID: string; messageID: string; mime: string; url: string; source?: { type?: string; path?: string } } =>
    p?.type === "file" && typeof p.mime === "string" && p.mime.startsWith("image/")

  const writeImagePart = (cacheDir: string, part: { url: string; source?: { type?: string; path?: string } }): string | null => {
    const decoded = decodeDataUrl(part.url)
    if (decoded) return writeImage(cacheDir, decoded.data, decoded.mime)
    if (part.source?.type === "file" && typeof part.source.path === "string") {
      const fromDisk = readImageFile(part.source.path)
      if (fromDisk) return writeImage(cacheDir, fromDisk.data, fromDisk.mime)
    }
    return null
  }

  return {
    "chat.params": async (input) => {
      detector.warm({ providerID: input.model.providerID, modelID: input.model.id, capabilities: input.model.capabilities })
    },
    "chat.message": async (input, output) => {
      if (input.sessionID && internalSessions.has(input.sessionID)) return
      if (!input.model) return
      if (isEyeModel(input.model)) return

      const imageParts = output.parts.filter(isImagePart) as Array<{
        id: string
        sessionID: string
        messageID: string
        mime: string
        url: string
        source?: { type?: string; path?: string }
      }>
      if (imageParts.length === 0) return

      const supportsImage = await getImageSupport(detector, client, input.model)
      if (supportsImage === true) return
      if (model === "") {
        if (supportsImage === false) {
          for (let i = 0; i < output.parts.length; i++) {
            if (isImagePart(output.parts[i])) {
              output.parts[i] = {
                id: output.parts[i].id,
                sessionID: output.parts[i].sessionID,
                messageID: output.parts[i].messageID,
                type: "text",
                text: BLOCK_TEXT,
              }
            }
          }
        }
        return
      }

      const replacements = new Map<string, { id: string; sessionID: string; messageID: string; type: "text"; text: string }>()
      for (const part of imageParts) {
        let file: string | null = null
        try {
          file = writeImagePart(cacheDir, part)
        } catch {
          file = null
        }
        const text = file
          ? buildMarker(file)
          : typeof part.source?.path === "string"
            ? `[Attached image (could not be cached — use the ask_image tool with the path ${part.source.path} to inspect its contents)]`
            : `[Attached image (could not be cached — please re-attach the image or provide a file path to inspect it)]`
        replacements.set(part.id, { id: part.id, sessionID: part.sessionID, messageID: part.messageID, type: "text", text })
      }
      for (let i = 0; i < output.parts.length; i++) {
        if (isImagePart(output.parts[i])) {
          const replacement = replacements.get(output.parts[i].id)
          if (replacement) output.parts[i] = replacement
        }
      }
    },
    tool: {
      ask_image: askImageTool({
        describe: (image: ImageInput, question: string) =>
          describeImage(client, model, image, question, {
            onSessionCreated: (id) => internalSessions.add(id),
            onSessionDeleted: (id) => internalSessions.delete(id),
          }, { timeoutMs }),
      }),
    },
  }
}

export default OpencodeEye
