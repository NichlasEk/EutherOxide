# Eutherium JOX roadmap

This plan tracks the next JOX and Trophy Room slices for Eutherium. The goal is to make `.jox` artifacts feel collectible, tradeable, inspectable, and hard to cheat with, while keeping the format able to grow.

## 1. JOX Details 2.0

- Show current ask price, intrinsic value, last sale price, current owner, provenance status, and shop status in the Eutherium details panel.
- Surface integrity fields from the `.jox` container: payload hash, asset hash, format version, and asset count.
- Render ownership history from the `.jox` payload, not only offer history from the shop.
- Make it easy to see whether a relist changed only the ask price or whether a completed sale changed intrinsic value.

## 2. User offers on artifacts

- Let a user make a bid on another user's JOX artifact from shop, inventory, or Trophy Room inspection.
- Route bids to the owner for accept or decline.
- On accept, debit buyer, credit seller, mutate the `.jox`, rehash it, move inventory ownership, and expire competing pending bids.
- Keep invalid-provenance artifacts tradeable outside the EUX economy but not sellable for Eutherium.

## 3. Trophy Room inspection

- Let visitors click artifacts in another user's skrytrum.
- Show JOX details, ownership history, intrinsic value, current ask price, and provenance.
- Allow bid creation from the inspected artifact when the artifact is valid and owned by another user.

## 4. Shop filters

- Add filters for JOX only, valid provenance, owner, price range, intrinsic value range, and rarity.
- Keep filters usable on mobile.
- Reuse deterministic listing data rather than AI summaries.

## 5. Anti-cheat hardening

- Compare imported `.jox` files by payload hash, artifact id, and lineage markers.
- Detect parallel side-loaded ownership chains and mark them as unknown provenance rather than silently accepting value.
- Keep side-loaded artifacts visible and tradeable as curiosities, but block EUX sale when provenance is broken.

## 6. JOX schema/versioning

- Add explicit schema versioning for payload fields.
- Separate canonical fields from mutable mutation logs.
- Keep older JSON `.jox` readable while preparing for a future binary/container layout.

## 7. Lore and kid-facing artifact view

- Add a story view for each artifact: where it came from, who owned it, what it survived, and why it is funny.
- Use the same deterministic `.jox` data, but render it like a collectible saga rather than an admin ledger.
- Keep it safe for child accounts without camera permissions.

## Commit rhythm

Each completed slice should be committed, pushed, built locally, deployed to the EutherOxide server, and smoke-checked with `eutherhost.service` active.
