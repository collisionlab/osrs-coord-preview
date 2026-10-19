# OSRS coordinate preview

CollisionLab GitHub Action, local CLI and Sharp renderer for OSRS coordinate batches.
The public API is `POST https://tiles.collisionlab.world/previews/v1/render`;
PNGs live at `/previews/images/<sha256>.png`. Infrastructure activation is a
separate reviewed release: see [migration.md](migration.md) for current status.

```yaml
permissions:
  contents: read
  pull-requests: write # only needed for comment: true
steps:
  - uses: collisionlab/osrs-coord-preview-action@v1.5.0-rc.1 # candidate; public API activation is pending
    with:
      coordinates: >-
        [{"coordinate":"3222/3218/0","id":"gate","label":"Lumbridge gate","source":"steps.json:4"},
         {"coordinate":"3207/3210/2","label":"Upper floor","style":"tactical"}]
      comment: 'true'
      github-token: ${{ github.token }}
```

The [standalone client](https://github.com/collisionlab/osrs-coord-preview-action)
is the migration target for existing standalone consumers. It additionally retains
`coordinates-file`, `pr-number`, `comment_body_path` and `summary_path`, plus the
existing composite comment action and default GitHub token handling. Use its
`renderer-url` override for acceptance testing until the public API is activated.

The embedded Action in this renderer repository retains its inputs (`coordinates`, `comment`, `renderer-url`, `github-token`,
`output-dir`), outputs (`manifest_path`, `render_count`, `failed_count`) and
`<!-- osrs-coordinate-preview -->` comment marker are preserved. The Action
bundles all JavaScript dependencies in `action-dist/main.cjs`; consumers do not
install packages or receive storage credentials. It uses GitHub's Node 24 runtime.
`renderer-url` remains available for testing and staged migration.

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

## Hosted build

The application produces a non-root Node container and a small Worker bundle.
Cloud Run checks R2 with HEAD before fetching source imagery or invoking Sharp,
then uploads each complete PNG with an atomic S3 PUT. Concurrent misses may do
redundant work but publish the same deterministic complete object; no locks,
database or queue are required. Temporary rendering directories are removed.
The Worker checks R2 first, authenticates misses to Cloud Run, serves PNGs through
its R2 binding and Cache API, and never composes images.

Cloud Run needs `R2_BUCKET`, `R2_ENDPOINT`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, and `ORIGIN_TOKEN`, supplied by infra/Secret Manager.
`PUBLIC_BASE_URL` optionally overrides the image URL prefix. A standalone local
HTTP server can use `PUBLISH_MODE=local`, `LOCAL_PUBLISH_DIR` and
`PUBLIC_BASE_URL=http://127.0.0.1:8080/static`, then `npm run serve`. Production
never uses local mode. Source endpoints and version pins are build-time inputs,
not public HTTP options.

CI builds/tests, checks the committed Action bundle, builds a container and opens
a **draft** infra PR pinning the container digest and matching Worker bytes.
Application CI does not deploy. The renderer image must be public in GHCR so
infra's Artifact Registry remote can cache it for Cloud Run.
