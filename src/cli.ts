import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCoordinateItems } from "./input.js";
import { renderBatch } from "./render.js";

interface CliArgs {
  coordinates?: string;
  coordinatesFile?: string;
  outputDir: string;
  debug: boolean;
  tileBaseUrl?: string;
  tileVersion?: string;
  insetVersion?: string;
  style?: "standard" | "tactical";
}

async function main() {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  const coordinatesRaw = await loadCoordinates(args);
  const items = parseCoordinateItems(coordinatesRaw);
  const outputDir = path.resolve(args.outputDir);
  const manifest = await renderBatch(items, {
    ...args,
    outputDir,
    debug: args.debug,
    logger: (message) => process.stderr.write(`${message}\n`)
  });
  process.stdout.write(`${path.join(outputDir, "manifest.json")}\n`);
  return manifest.failedCount > 0 ? 1 : 0;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      "tile-base-url": { type: "string" },
      "tile-version": { type: "string" },
      "inset-version": { type: "string" },
      style: { type: "string" },
      coordinates: {
        type: "string"
      },
      "coordinates-file": {
        type: "string"
      },
      "output-dir": {
        type: "string",
        default: ".osrs-coordinate-preview"
      },
      debug: {
        type: "boolean",
        default: false
      }
    },
    allowPositionals: false
  });

  const args: CliArgs = {
    tileBaseUrl: parsed.values["tile-base-url"],
    tileVersion: parsed.values["tile-version"],
    insetVersion: parsed.values["inset-version"],
    style: parsed.values.style as "standard" | "tactical" | undefined,
    coordinates: parsed.values.coordinates,
    coordinatesFile: parsed.values["coordinates-file"],
    outputDir: parsed.values["output-dir"] ?? ".osrs-coordinate-preview",
    debug: parsed.values.debug ?? false
  };

  if (!args.coordinates && !args.coordinatesFile) {
    throw new Error("Provide --coordinates or --coordinates-file.");
  }
  return args;
}

export async function loadCoordinates(args: CliArgs): Promise<string> {
  if (args.coordinates) {
    return args.coordinates;
  }
  return fs.readFile(path.resolve(process.cwd(), args.coordinatesFile!), "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
