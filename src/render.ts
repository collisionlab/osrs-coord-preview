import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderConfig } from "./config.js";
import type { CoordinateItem, RenderManifest, RenderOptions, RenderResult } from "./types.js";

const TILE_SIZE = 256;
import { resolveTileCoordinate } from "./geometry.js";
export { resolveTileCoordinate } from "./geometry.js";


export async function renderBatch(items: CoordinateItem[], options: RenderOptions): Promise<RenderManifest> {
  const config = renderConfig(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  // Share downloads within a batch, but never retain failed requests across batches.
  const downloads = new Map<string, Promise<Buffer>>();
  const get = (url: string) => {
    if (!downloads.has(url)) downloads.set(url, (async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Failed to fetch source ${url}: ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 4 * 1024 * 1024) throw new Error("Source asset is too large");
      return data;
    })());
    return downloads.get(url)!;
  };
  const json = async (url: string) => JSON.parse((await get(url)).toString());
  await fs.mkdir(options.outputDir, { recursive: true });
  const results: RenderResult[] = [];
  for (const item of items) {
    try {
      const c = renderConfig({ ...options, style: item.style ?? options.style });
      const base = `${c.tileBaseUrl}/${c.style}/${c.tileVersion}`;
      const sidecar = `${c.tileBaseUrl}/insets/${c.insetVersion}`;
      const [manifest, baseManifest, index] = await Promise.all([
        json(`${sidecar}/manifest.json`), json(`${base}/manifest.json`), json(`${base}/index.json`)
      ]);
      if (manifest.tileVersion !== c.tileVersion || manifest.layout !== "explv-tms-v1" ||
          manifest.cacheIdx255Sha256 !== baseManifest.cacheIdx255Sha256 ||
          baseManifest.layout !== "explv-tms-v1" || baseManifest.plane !== 0)
        throw new Error("Tile and inset releases do not match");
      const directory = manifest.supplementalStyles?.[c.style];
      if (!directory || !/^[a-z-]+$/.test(directory)) throw new Error("Source style is unavailable");
      const plane = item.parsed.plane;
      if (!Number.isInteger(plane) || plane < 0 || plane > 3) throw new Error("Invalid plane");
      const supplemental: number[] = manifest.supplemental[plane];
      const resolved = resolveTileCoordinate(item.parsed.x, item.parsed.y);
      if (options.debug) (options.logger ?? console.error)(`[debug] ${item.id}: plane=${plane} tile=${resolved.tileX},${resolved.tileY} pixel=${resolved.pixelX},${resolved.pixelY}`);
      const source = (col: number, row: number) => {
        const relative = `8/${col}/${row}.png`;
        if (plane === 0 && Object.hasOwn(index, relative)) return `${base}/${relative}`;
        const rx = col + 15, ry = row + 19;
        if (rx >= 0 && rx < 256 && ry >= 0 && ry < 256 && supplemental.includes(rx * 256 + ry))
          return `${sidecar}/${directory}/${plane}/${relative}`;
        return undefined;
      };
      if (!source(resolved.tileX, resolved.tileY)) throw new Error(`No source imagery for plane ${plane} at ${item.coordinate}`);
      const nativeCrop = c.cropSize / 2;
      const absoluteX = TILE_SIZE + resolved.pixelX, absoluteY = TILE_SIZE + resolved.pixelY;
      const left = absoluteX - nativeCrop / 2, top = absoluteY - nativeCrop / 2;
      // Round the crop origin to a native pixel; the marker follows the exact square centre.
      const cropLeft = Math.round(left), cropTop = Math.round(top);
      const composites = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const px = (dx + 1) * TILE_SIZE, py = (1 - dy) * TILE_SIZE;
        if (px >= cropLeft + nativeCrop || px + TILE_SIZE <= cropLeft || py >= cropTop + nativeCrop || py + TILE_SIZE <= cropTop) continue;
        const url = source(resolved.tileX + dx, resolved.tileY + dy);
        if (!url) continue; // Known absent squares are void; listed but missing assets fail below.
        const input = await get(url);
        const metadata = await sharp(input, { limitInputPixels: TILE_SIZE * TILE_SIZE }).metadata();
        if (metadata.width !== TILE_SIZE || metadata.height !== TILE_SIZE) throw new Error("Invalid source tile dimensions");
        composites.push({ input, left: px, top: py });
      }
      const stitched = await sharp({ create: { width: TILE_SIZE * 3, height: TILE_SIZE * 3, channels: 4, background: "#000000" } })
        .composite(composites).png().toBuffer();
      const cropped = await sharp(stitched).extract({ left: cropLeft, top: cropTop, width: nativeCrop, height: nativeCrop })
        .resize(c.cropSize, c.cropSize, { kernel: "nearest" }).png().toBuffer();
      const x = (absoluteX - cropLeft) * 2, y = (absoluteY - cropTop) * 2;
      const marker = `<svg width="${c.cropSize}" height="${c.cropSize}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${x-5}" y="${y-5}" width="10" height="10" fill="none" stroke="white" stroke-width="2"/>
        <rect x="${x-4}" y="${y-4}" width="8" height="8" fill="#facc15" fill-opacity="0.28" stroke="#facc15" stroke-width="2"/>
        <circle cx="${x}" cy="${y}" r="${c.markerRadius}" fill="white" stroke="#111827" stroke-width="1.5"/></svg>`;
      const imageName = `${item.id}.png`, imagePath = path.join(options.outputDir, imageName);
      await sharp(cropped).composite([{ input: Buffer.from(marker) }]).png().toFile(imagePath);
      results.push({ status: "success", id: item.id, label: item.label, source: item.source, coordinate: item.coordinate, resolved, imageName, imagePath });
    } catch (error) {
      results.push({ status: "failure", id: item.id, label: item.label, source: item.source, coordinate: item.coordinate, error: (error as Error).message });
    }
  }
  const manifest = { tileBaseUrl: config.tileBaseUrl, generatedAt: new Date().toISOString(),
    renderCount: results.filter(r => r.status === "success").length, failedCount: results.filter(r => r.status === "failure").length, items: results };
  await fs.writeFile(path.join(options.outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
