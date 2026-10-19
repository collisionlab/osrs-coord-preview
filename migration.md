# Migration and release checklist

## Status of this change

Implemented in migration branches across `osrs-coord-preview`, `osrs-tiles` and
`infra`. The new public repository `collisionlab/osrs-coord-preview` has been created
and seeded from the original Git history. The original repository remains available.
Production has not been deployed, release tags have not been published, and the
existing Cloud Run/GCS deployment has not been changed. All 17 application tests and 32 tile-publication tests passed in the pinned Nix shells. All five OpenTofu roots passed validation without a production backend. Live unchanged-tile SHA-256 checks passed. Worker/R2/Sharp
integration runs locally in workerd. Live Worker-on-R2-domain coexistence, provider
plans with production credentials, GHCR-to-Artifact-Registry pulls, external
released-Action execution and historical GCS inventory remain release gates.

## Findings and architecture

* Infra's `tofu/edge/tiles.tf` owns the `collisionlab-tiles` R2 custom domain at
  `tiles.collisionlab.world`; keep it. Add only a `/previews/*` Worker route.
  [Cloudflare route documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/)
  describes path routing before an existing origin. It is not proof of this live
  R2 combination: the deployment acceptance script must pass before cutover.
* `osrs-tiles/scripts/build-insets` already extracts visible terrain on planes
  0–3, including main-world upper floors, and renders sparse square lists in both
  styles against matching cache/keys. The currently pinned sidecar has 942 plane-1,
  478 plane-2 and 226 plane-3 supplemental squares. Reuse those assets. Do not add
  a second upper-plane renderer or change base-map publication. New sidecars add
  `preview-source.json` with layout, source pair, renderer revision and styles.
  Its outer manifest hashes the descriptor and already includes full source/build
  hashes and cache fingerprints. Existing immutable versions are untouched.
* Keep Sharp on a new scale-to-zero Cloud Run service alongside the old service.
  Infra has no prior GCP deployment mechanism, so a new encrypted OpenTofu root
  manages it directly, with providers pinned by the existing Nix flake. Artifact
  Registry is a required Cloud Run image bridge for public GHCR release digests,
  not another compute service. No VM, queue, database or new public hostname.
* A bucket-scoped R2 token goes only to Cloud Run via Secret Manager. The Worker
  has a bucket binding and a separate managed random origin bearer secret. The
  origin is publicly reachable at the transport layer but rejects unauthenticated
  renders. This avoids maintaining GCP identity-token issuance in the Worker.
  Invalid/unauthenticated requests still incur small HTTP costs; source fetches and
  Sharp run only after authentication. Worker limits are not a globally exact quota.

## Required merge/deployment order

1. Review and merge `osrs-tiles` descriptor/tests/docs first. Existing sidecars
   already support the app's initial pin; no old tile version is modified. New
   sidecars publish through existing CI with their completion manifest last.
2. Review the infra additions with activation flags false. Provision the separate
   R2 bucket/token and origin secret through normal CI only. Add a least-privileged
   GCP deploy credential to SOPS `secrets/bootstrap.yaml` as
   `gcp_preview_credentials` (JSON); give it Cloud Run, project service usage,
   Artifact Registry, service account creation/use, Secret Manager and monitoring
   management permissions in the selected existing project. Reuse the current
   project initially; creating/billing a project is an operator decision. No key
   or deployment permission goes to application CI. Prefer the organisation's WIF
   bootstrap when available instead of expanding this into app-owned IAM setup.
3. Per the migration instruction, create the new public repository
   `collisionlab/osrs-coord-preview` and seed `main` with the original repository's
   history before opening the migration PR. Keep `mpickering/osrs-coord-preview`
   and its existing tags available; do not repoint or retire old consumers.
   Install the CollisionLab bot/infra apps. In the reviewed infra PR set
   `adoptRepository=true`; OpenTofu imports the populated new repository. Merge
   the app migration PR after infra has supplied its release-bot configuration.
4. Run application CI in CollisionLab. Make the GHCR image public. Review its
   draft `pin/osrs-coord-preview-*` infra PR: it pins image digest and Worker
   SHA-256, retaining activation flags. Infra explicitly excludes these PRs from
   automatic merging. This restriction remains after initial migration.
5. In the reviewed deployment PR set `enabled=true`, retain `public=false`, check
   the project/region and pinned artifacts, and apply only through infra CI.
   Verify the Cloud Run health probe, secret access, R2 uploads and origin 401s
   without its secret. No existing Cloud Run or GCS resource is imported/replaced.
6. Approve the additive route deployment with `public=true`. Run
   `nix develop -c python3 scripts/check-preview-routing` from infra, recording
   workflow logs. It compares old tile bytes with published indexes, renders all
   eight plane/style combinations, fetches every PNG, checks immutable headers,
   verifies cross-batch identities, then rechecks unchanged tile bytes. Check
   Worker logs for cache hits (no Cloud Run request) and mixed-failure batches.
   If path routing does not coexist, revert the route PR and investigate; do not
   replace the R2 custom domain or add a whole-host Worker without review.
7. Publish an immutable Action release/tag containing `action.yml` and the checked-in
   `action-dist/main.cjs`. Run `osrs-tiles`'s manual
   `coordinate-preview-consumer` workflow with that exact release revision: it
   checks out the external Action and runs it without `npm install`. Exercise
   the opt-in `test-pr-comment` workflow in an actual PR to verify create/update
   with the unchanged comment marker. Update consumer pins only after both pass.
8. Validate planner tile loads/insets and legacy previews in real consumers.
   Record revision, workflow links, sample image URLs and the acceptance results.
   Only then approve retirement of the old compute deployment.

## Rollback

Keep the previous app release and infra artifact pin. Revert the infra release
pin to restore matching Worker/container versions, or revert just the route
activation before public adoption. After public adoption keep image retrieval
available even when rolling back render compute, since existing comments embed
new URLs. Point affected Action consumers' `renderer-url` back to the old `/render`
endpoint or their previous release. Never delete preview objects as rollback;
never change a published tile/inset version. Do not set `enabled=false` on an
existing deployment: deletion protection intentionally blocks destroying compute.
Use a prior release pin or a narrow render-disable change instead.

## Historical images and decommissioning

The old script defaults to GCS bucket `osrs-coordinate-preview-images` and applies
365-day deletion. The actual bucket, contents, lifecycle and oldest embedded URLs
must be inventoried with the production account before cutover. Arrange a reviewed
infra adoption of that existing bucket with no automatic object expiration before
links age out. Do not run the removed legacy deploy script: the old revision is
available in Git history if needed for application rollback.

Retain the existing publicly readable GCS objects at their original URLs. Copying
them to R2 alone cannot preserve `storage.googleapis.com` URLs, and cannot recover
objects already expired. Keep the legacy bucket read-only after stopping its
uploader. An optional archival R2 copy is a later reviewed operation, preserving
an object-name/hash inventory. Do not rewrite historical PR comments or delete
GCS unless consumers explicitly accept the link consequences. Retire the old
Cloud Run renderer, GCS uploader IAM and old deployment secrets only after a
successful cutover; the legacy read-only bucket may need to remain indefinitely.
The new application has no GCS SDK or Wiki-tile runtime dependency.

## Retention and operations

Infra's preview bucket has `prevent_destroy` and no completed-image expiry;
only abandoned multipart uploads are removed after seven days. Browser/edge cache
TTL is one year but object retention is indefinite. This favours years-old PR
links over automatic storage savings. Review R2 stored bytes/object count and
operation costs monthly, and configure account billing alerts before release.
Cloud Run is capped at two 1-vCPU/1-GiB instances, concurrency one, min zero;
its timeout is 60 seconds, source requests 10 seconds, and Worker origin calls
25 seconds. A cold timeout can return a per-item failure while the completed image
becomes available for retry. No queue is introduced. Worker rate limit is 30
batches/minute per IP per Cloudflare location, max 10 items and 16 KiB per batch.
Logs contain batch failure counts. Cloud Monitoring records origin-5xx incidents;
notification-channel routing needs the operator's existing on-call destination.
Infra's manual/daily `preview-smoke` workflow is the public end-to-end monitor.

## Dependency audit

Compatible production dependency fixes were applied while replacing GCS. The
remaining npm advisories are in Miniflare's development-only Sharp/Undici tree;
these test utilities process controlled fixtures and are pruned from the runtime
image. Track them when upgrading Miniflare. Do not run its development proxy on
untrusted public traffic. The deployed Sharp version is 0.35.5.
