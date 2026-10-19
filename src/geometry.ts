import type { TileCoordinate } from "./types.js";
const SCALE = 4;
export function resolveTileCoordinate(x: number, y: number): TileCoordinate {
  if (![x, y].every(n => Number.isSafeInteger(n) && n >= 0 && n < 16384)) throw new Error("Invalid game coordinate");
  return {
    tileX: Math.floor(x / 64) - 15,
    tileY: Math.floor(y / 64) - 19,
    // Centre of the game square, with PNG rows counted from the north.
    pixelX: (x % 64) * SCALE + SCALE / 2,
    pixelY: (63 - y % 64) * SCALE + SCALE / 2
  };
}
