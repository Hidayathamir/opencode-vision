import { tool, type ToolContext } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import { readImageFile } from "./cache"
import type { ImageInput } from "./eye"

export interface AskImageDeps {
  describe: (image: ImageInput, question: string) => Promise<string>
}

function fileStamp(imagePath: string): string {
  try {
    const stat = fs.statSync(imagePath)
    return `${stat.size}:${stat.mtimeMs}`
  } catch {
    return "missing"
  }
}

export function askImageTool(deps: AskImageDeps) {
  const answerCache = new Map<string, string>()
  const pendingCache = new Map<string, Promise<string>>()
  return tool({
    description:
      "Inspect an image file on disk by its absolute path. Use when the user references an image file or an attached image marker and you need to see its contents.",
    args: {
      imagePath: tool.schema.string().describe("Absolute path to the image file to inspect (PNG, JPEG, GIF, or WEBP)"),
      question: tool.schema.string().describe("What you need to know about the image"),
    },
    async execute(args: { imagePath: string; question: string }, ctx: ToolContext) {
      const imagePath = path.isAbsolute(args.imagePath)
        ? args.imagePath
        : ctx.directory
          ? path.resolve(ctx.directory, args.imagePath)
          : path.resolve(args.imagePath)
      const key = `${imagePath}\u0000${fileStamp(imagePath)}\u0000${args.question}`
      const cached = answerCache.get(key)
      if (cached !== undefined) return cached
      const pending = pendingCache.get(key)
      if (pending !== undefined) return pending

      const run = (async () => {
        const image = readImageFile(imagePath)
        if (!image) {
          return `ERROR: opencode-eye: no image found at ${imagePath} (must be a PNG, JPEG, GIF, or WEBP file).`
        }

        try {
          const answer = await deps.describe(image, args.question)
          answerCache.set(key, answer)
          return answer
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          return (
            `ERROR: opencode-eye could not inspect the image.\n\n` +
            `${detail}\n\n` +
            `Tell the user: the image at ${imagePath} could not be inspected by the configured eye model. ` +
            `They can add a reliable eye model to eye.model in their opencode config and retry.`
          )
        }
      })()

      pendingCache.set(key, run)
      try {
        return await run
      } finally {
        pendingCache.delete(key)
      }
    },
  })
}
