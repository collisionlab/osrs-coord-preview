# OSRS coordinate preview

Sharp renderer and local CLI for pinned CollisionLab map imagery. The stable HTTP
interface is a Cloudflare Worker: `POST https://tiles.collisionlab.world/previews/v1/render`.
Images use `https://tiles.collisionlab.world/previews/images/<sha256>.png`.
The Worker reads R2 first and sends cache misses to authenticated Google Cloud Run.

The canonical published GitHub Action is
[collisionlab/osrs-coord-preview-action](https://github.com/collisionlab/osrs-coord-preview-action).
This repository owns the renderer, API, Worker bundle and local CLI.

```sh
curl --fail https://tiles.collisionlab.world/previews/v1/render \
  -H 'content-type: application/json' \
  -d '[{"coordinate":"3222/3218/0","label":"Lumbridge"}]'
```

The response contains `renderCount`, `failedCount` and ordered `items`. Successful
items include `status: "success"` and `imageUrl`; failed items include an `error`.
Labels, IDs and sources round-trip without affecting image identity. Routing is
activated separately through infra's release manifest.

## Local rendering

```sh
nix develop
npm ci
npm run build
npm test
npm run cli -- --coordinates '[{"coordinate":"3222/3218/0"}]' --output-dir out
npm run cli -- --coordinates-file fixtures/coordinates.json --style tactical
```

No credentials are required. Coordinates encode the plane as `x/y/plane`.
`--tile-version`, `--inset-version` and `--tile-base-url` explicitly override
[tiles.json](tiles.json), for example against a locally served fixture tree.
A tile/inset pair must match the same cache; no request-time `latest` lookup is used.
Supported bounds are `0..16383` on both axes and planes `0..3`. Requests and CLI
batches accept at most 10 items / 16 KiB, with bounded string metadata and unique
IDs. An optional per-item `style` is `standard` (default) or `tactical`.
Malformed input returns HTTP 400; excessive HTTP bodies return 413, wrong media
types 415, throttled requests 429. Missing imagery is an individual failure in a
200 batch response, preserving successful siblings.

## Imagery and identity

Native `explv-tms-v1` tile `(column,row)` is map square `(15+column,19+row)`.
At zoom 8 each 256px tile covers 64 game squares at 4px per square. TMS rows
increase northward, while PNG pixels increase southward. The square centre is:

```
column = floor(x/64) - 15        row = floor(y/64) - 19
pixelX = (x % 64)*4 + 2         pixelY = (63 - y % 64)*4 + 2
```

The 384px default preview covers 48×48 game squares: crop 192 native pixels,
then upscale exactly 2× with nearest-neighbour interpolation. The marker encloses
an 8px square. The previous renderer covered the same 48-square extent, but used
a tile-edge pixel as its marker centre; this migration centres the actual square.
See synthetic seam/orientation tests and pinned real-map goldens in `test/`.

Plane 0 uses `<style>/<tileVersion>/8/<column>/<row>.png`. Additional terrain
uses the existing immutable inset sidecar:
`insets/<insetVersion>/planes-standard/<plane>/8/<column>/<row>.png` or
`planes/<plane>/8/<column>/<row>.png` for tactical. The sidecar includes main-world
upper floors as well as dungeon floors. It publishes only map squares containing
visible terrain. A target with no source tile fails. Known absent neighbouring
squares render black; a listed tile returning 404 fails, and no upper floor ever
uses plane 0. Tile and inset cache fingerprints must agree.

SHA-256 keys include numeric XY/plane, style, both immutable source versions,
source base URL, renderer implementation version, crop size and marker radius.
Labels, sources, batch order and IDs are excluded. Update `RENDERER_VERSION` in
`src/config.ts` whenever rendering code or image-affecting dependency versions
change. Update real-map fixtures only by downloading immutable versions and
recording their SHA-256 in `test/source/sources.json`. To deliberately regenerate
goldens, run `UPDATE_GOLDEN=1 npm test` and review the image differences.

## Cloud Run and R2

Cloud Run runs the non-root Node/Sharp container with scale-to-zero, at most two
instances, one request per instance, 1 CPU, 1 GiB RAM and a 60-second timeout.
`GET /health` checks process liveness without fetching tiles. Rendering requires
`Authorization: Bearer <ORIGIN_TOKEN>`; the Worker supplies it on cache misses.
The Worker limits clients to 30 batches per minute. PNG delivery uses immutable
one-year caching, R2 and the edge cache. Concurrent misses can publish the same
complete object; temporary directories are removed after rendering.

Infra supplies `R2_BUCKET`, `R2_ENDPOINT`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `ORIGIN_TOKEN` through Secret Manager.
`PUBLIC_BASE_URL` optionally overrides the PNG URL prefix. For local HTTP testing,
set `PUBLISH_MODE=local`, `LOCAL_PUBLISH_DIR` and
`PUBLIC_BASE_URL=http://127.0.0.1:8080/static`, then `npm run serve`.
Source tile endpoints and versions are build-time inputs, not public HTTP options.

## Releases and checks

CI runs through Nix on main and PRs. PRs test the container build; each main release
publishes one immutable GHCR image and the Worker bundle. `scripts/pin-release`
opens `pin/osrs-coord-preview-<sha12>` in infra, titled
`Deploy osrs-coord-preview <sha12>`, and pins the image, commit and Worker SHA-256.
It preserves project, region and deployment controls. Infra validates the matching
bundle/hash and OpenTofu plan before merging a trusted non-draft bot pin.
Artifact Registry caches the public GHCR image for Cloud Run.

`osrs-tiles` proposes `tiles.json` updates for both this repo and the planner.
Trusted non-draft tile pins merge only after tests; draft pins wait for review.
Tests cover geometry, every plane/style, real-map goldens, deterministic identity,
partial failures, signed R2 requests and Worker miss/publication/cache-hit paths.

Infra runs `scripts/smoke-origin.ts` against the deployed revision with managed
credentials: authentication rejection, a confirmed cache miss, Sharp rendering,
R2 upload/download and repeated identity. When public routing is active it also
checks the Worker miss path and public PNG delivery. This is separate from
`/health` and cached uptime checks. See
[infra operations](https://github.com/collisionlab/infra/blob/main/docs/coordinate-previews.md)
for deployment, monitoring, secrets and rollback.
