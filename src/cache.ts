import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const MAGIC_SNIFFERS: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  {
    mime: "image/png",
    test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: "image/jpeg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", test: (b) => b.length >= 4 && b.subarray(0, 4).toString("ascii") === "GIF8" },
  {
    mime: "image/webp",
    test: (b) =>
      b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
]

function sniffImageMime(data: Buffer): string | null {
  for (const s of MAGIC_SNIFFERS) {
    if (s.test(data)) return s.mime
  }
  return null
}

export function resolveCacheDir(override?: string): string {
  return override ?? path.join(os.homedir(), ".cache", "opencode-eye")
}

export function mimeToExt(mime: string): string | undefined {
  return MIME_TO_EXT[mime]
}

export function decodeDataUrl(url: string): { mime: string; data: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (!m) return null
  return { mime: m[1], data: Buffer.from(m[2], "base64") }
}

export function writeImage(cacheDir: string, data: Buffer, mime: string): string | null {
  const ext = mimeToExt(mime)
  if (!ext) return null
  const id = `img_${createHash("sha1").update(data).digest("hex")}`
  const dir = path.join(cacheDir, "img")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.${ext}`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, data)
  return file
}

export function readImageFile(imagePath: string): { data: Buffer; mime: string } | null {
  let data: Buffer
  try {
    data = fs.readFileSync(imagePath)
  } catch {
    return null
  }
  const mime = sniffImageMime(data) ?? EXT_TO_MIME[path.extname(imagePath).slice(1).toLowerCase()]
  if (!mime) return null
  return { data, mime }
}
