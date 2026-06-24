# JOX container refactor

`.jox` must be a self-contained artifact carrier, not a pointer to whichever service created it. A child account without camera permissions must still be able to see an owned SecondSight or Joxbox artifact in Eutherium.

## Problem

The first `.jox` version stores artifact metadata and provenance, but images are mostly URL based:

- SecondSight artifacts can point back into camera/AI endpoints.
- Joxbox artifacts can point to Eutherium media URLs or bundled web assets.
- Downloaded files are not complete portable artifacts.

That makes `.jox` too weak for the long term. It should be able to carry images, thumbnails, lore, ownership history, value state, and later a larger idea/mutation system.

## Direction

Treat `.jox` as a container:

- `format`: stable magic string, currently `jox`.
- `version`: schema version.
- `payload`: canonical manifest for artifact identity, lore, current owner, values, and history.
- `assets`: embedded binary assets as base64 entries with id, role, content type, filename, size, and sha256.
- `integrity`: hashes over manifest and assets.

This is deliberately zip/arj-like in shape, even if v2 remains JSON for low-risk implementation. A later v3 can become a custom binary format without changing the conceptual model.

## Native format target

The fun long-term target is not “JSON with a funny extension”. A proper native `.jox` can be:

- Magic header: `JOX\0`.
- Format version and feature flags.
- Table of contents with named sections.
- Section records for manifest, assets, thumbnails, lore, ownership ledger, signatures, mutations, and future idea-graph data.
- Per-section compression flags once we want it.
- Per-section hashes plus a whole-container hash.

That gives the nostalgia and permanence of a small archive format while still letting the system grow. The important constraint is that the current semantic model must be nailed first, because bad semantics inside a custom binary container are harder to repair than bad JSON.

## Rules

- A displayed artifact image must prefer an embedded asset from the `.jox`.
- External URLs are migration/fallback only.
- Every user-visible mutation appends history and rehashes the container.
- Unknown or tampered provenance is allowed to exist, trade socially, and sit in a trophy room, but cannot be sold for Eutherium value.
- A user cannot import duplicate copies of the same payload hash.
- Side-loaded ownership changes become visible as import history and should not silently preserve value.

## First implementation slice

1. Add v2-compatible `.jox` helper functions in EutherOxide.
2. Embed uploaded Joxbox images inside `.jox`.
3. Serve embedded assets through Eutherium-owned artifact asset URLs.
4. Preserve embedded assets during import and owner-transfer mutations.
5. Keep v1 JSON `.jox` readable for existing artifacts.

## Later slices

- Teach EutherSight SecondSight export to embed original/generated image assets in the `.jox`.
- Add thumbnail generation and an explicit `assets/primary`, `assets/thumb`, `assets/original` convention.
- Add a JOX validation endpoint that reports provenance, hashes, embedded assets, and mutation history.
- Add a migration tool to repack existing URL-based JOX files when the source image is still reachable.
- Consider compressed/binary v3 once the JSON v2 semantics are stable.
