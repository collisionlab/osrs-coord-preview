import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fixtureFetch } from "./fixtures.js";
import { parseCliArgs, runCli } from "../src/cli.js";

test("parseCliArgs parses standard options", () => {
  const args = parseCliArgs([
    "--coordinates",
    '[{"coordinate":"3200/3200/0"}]',
    "--output-dir",
    "out",
    "--debug"
  ]);

  assert.equal(args.outputDir, "out");
  assert.equal(args.debug, true);
  assert.match(args.coordinates ?? "", /3200\/3200\/0/);
});

test("runCli renders a local manifest", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "osrs-cli-"));
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  globalThis.fetch = await fixtureFetch();

  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    const exitCode = await runCli([
      "--coordinates",
      '[{"coordinate":"3200/3200/0","label":"Quest start"}]',
      "--output-dir",
      tempDir
    ]);

    assert.equal(exitCode, 0);
    await fs.access(path.join(tempDir, "manifest.json"));
    await fs.access(path.join(tempDir, "quest-start-1.png"));
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
});
