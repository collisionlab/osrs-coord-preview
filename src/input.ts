import { CoordinateItem, CoordinateItemInput, ParsedCoordinate } from "./types.js";

import { MAX_BATCH, MAX_BODY_BYTES } from "./config.js";

const COORDINATE_PATTERN = /^(-?\d+)\/(-?\d+)\/(-?\d+)$/;

export function parseCoordinate(coordinate: string): ParsedCoordinate {
  const match = COORDINATE_PATTERN.exec(coordinate.trim());
  if (!match) {
    throw new Error(`Invalid coordinate "${coordinate}". Expected x/y/plane.`);
  }

  const [x, y, plane] = match.slice(1).map((value) => Number.parseInt(value, 10));
  if (![x, y, plane].every(Number.isFinite)) {
    throw new Error(`Invalid coordinate "${coordinate}". Values must be integers.`);
  }

  if (![x, y].every(n => Number.isSafeInteger(n) && n >= 0 && n < 16384) || plane < 0 || plane > 3) {
    throw new Error("Coordinates must be 0..16383, plane 0..3");
  }
  return { x, y, plane };
}

export function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "coordinate";
}

export function deriveId(item: CoordinateItemInput, index: number): string {
  if (item.id?.trim()) {
    return slugifyId(item.id);
  }
  if (item.label?.trim()) {
    return `${slugifyId(item.label)}-${index + 1}`;
  }
  return `coordinate-${index + 1}`;
}

export function parseCoordinateItems(raw: string): CoordinateItem[] {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error("Coordinates input is too large");
  // The HTTP service and CLI share one JSON contract so upstream workflow steps and local
  // testing use the exact same payload shape.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid coordinates JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The coordinates input must be a non-empty JSON array.");
  }

  if (parsed.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} coordinates are allowed`);
  const items = parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Coordinate item ${index + 1} must be an object.`);
    }

    const item = entry as CoordinateItemInput;
    if (typeof item.coordinate !== "string" || item.coordinate.trim() === "") {
      throw new Error(`Coordinate item ${index + 1} must include a coordinate string.`);
    }

    for (const field of ["id", "label", "source"] as const) {
      if (item[field] !== undefined && (typeof item[field] !== "string" || item[field]!.length > 512))
        throw new Error(`Invalid ${field}`);
    }
    if (item.style !== undefined && !["standard", "tactical"].includes(item.style)) throw new Error("Unsupported map style");
    const id = deriveId(item, index);
    return {
      coordinate: item.coordinate,
      id,
      label: item.label,
      source: item.source,
      style: item.style,
      parsed: parseCoordinate(item.coordinate)
    };
  });

  const duplicates = findDuplicates(items.map((item) => item.id));
  if (duplicates.length > 0) {
    throw new Error(`Duplicate coordinate ids are not allowed: ${duplicates.join(", ")}`);
  }

  return items;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}
