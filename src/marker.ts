const MARKER_PREFIX = "[Attached image "
const MARKER_SUFFIX = " — use the ask_image tool to inspect its contents]"

export function buildMarker(imagePath: string): string {
  return `${MARKER_PREFIX}${imagePath}${MARKER_SUFFIX}`
}
