import pin from "../tiles.json" with { type: "json" };
import type { CoordinateItem, RenderOptions } from "./types.js";

export const PUBLIC_RENDER_URL = "https://tiles.collisionlab.world/previews/v1/render";
export const CACHE_CONTROL = "public, max-age=31536000, immutable";
export const MAX_BODY_BYTES = 16384;
export const MAX_BATCH = 10;
// Bump whenever pixel generation or source interpretation changes.
export const RENDERER_VERSION = "collisionlab-1";
export function renderConfig(options: Partial<RenderOptions> = {}) {
  const config = {
    tileBaseUrl: (options.tileBaseUrl ?? pin.base).replace(/\/+$/, ""),
    tileVersion: options.tileVersion ?? pin.version,
    insetVersion: options.insetVersion ?? pin.insets.version,
    style: options.style ?? "standard",
    cropSize: options.cropSize ?? 384,
    markerRadius: options.markerRadius ?? 2
  };
  if (!/^[0-9]+-[a-f0-9]{12}$/.test(config.tileVersion) || !/^[a-f0-9]{24}$/.test(config.insetVersion))
    throw new Error("Explicit immutable tile and inset versions are required");
  if (!["standard", "tactical"].includes(config.style)) throw new Error("Unsupported map style");
  if (!Number.isInteger(config.cropSize) || config.cropSize < 32 || config.cropSize > 768 || config.cropSize % 2)
    throw new Error("Crop size must be an even integer from 32 to 768");
  if (!Number.isFinite(config.markerRadius) || config.markerRadius < 0 || config.markerRadius > 8)
    throw new Error("Marker radius must be from 0 to 8");
  return config;
}
export async function objectKey(item: CoordinateItem, options: Partial<RenderOptions> = {}): Promise<string> {
  const c = renderConfig(options);
  const canonical = JSON.stringify([RENDERER_VERSION, item.parsed.x, item.parsed.y, item.parsed.plane,
    c.style, c.tileVersion, c.insetVersion, c.cropSize, c.markerRadius, c.tileBaseUrl]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}.png`;
}
