import { unwrap } from "./sdk"

export interface ModelRef {
  providerID: string
  modelID: string
}

export class Detector {
  private cache = new Map<string, boolean>()

  private key(ref: ModelRef): string {
    return `${ref.providerID}/${ref.modelID}`
  }

  get(ref: ModelRef): boolean | undefined {
    return this.cache.get(this.key(ref))
  }

  set(ref: ModelRef, image: boolean): void {
    this.cache.set(this.key(ref), image)
  }

  warm(model: { providerID: string; modelID: string; capabilities?: { input?: { image?: boolean } } }): void {
    const image = model.capabilities?.input?.image
    if (typeof image === "boolean") this.set(model, image)
  }
}

export async function lookupImageSupport(client: any, ref: ModelRef): Promise<boolean | null> {
  try {
    const res = await unwrap<any>(client.config?.providers?.())
    const providers = res?.providers ?? res?.all ?? []
    const provider = providers.find(
      (p: any) => p.id === ref.providerID || p.name === ref.providerID,
    )
    const model = provider?.models?.[ref.modelID]
    if (!model) return null
    const image = model.capabilities?.input?.image
    return typeof image === "boolean" ? image : null
  } catch {
    return null
  }
}

export async function getImageSupport(
  detector: Detector,
  client: any,
  ref: ModelRef,
): Promise<boolean | null> {
  const cached = detector.get(ref)
  if (cached !== undefined) return cached
  const support = await lookupImageSupport(client, ref)
  if (support !== null) detector.set(ref, support)
  return support
}
