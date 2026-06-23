# JOX Trophy Shop next steps

SecondSight JOX artifacts should behave like family collectible artifacts in Eutherium, while keeping provenance visible and avoiding silent owner changes.

## Slice 1: atomic accept

- Move JOX owner mutation from the browser to the EutherOxide backend.
- On accept, EutherOxide should debit the buyer, credit the seller when the seller is a real user, update inventory, mark competing offers expired, mutate the `.jox` owner through EutherSight, and only then report success.
- Unknown provenance must remain visible and should not be accepted into Eutherium-value flows.

## Slice 2: provenance details

- Show JOX details from the Eutherium UI: owner, price, provenance status, shop status, JOX download URL, and recent offer history.
- Keep this deterministic from stored JOX/shop state first; richer container-history rendering can be layered on top later.

## Slice 3: resale and trade

- Let an owner relist an owned JOX artifact from inventory with a new price.
- A relisted artifact appears in Trophy Shop as a normal request/accept flow.
- Accepting a relisted artifact removes it from the seller inventory and credits the seller.

## Slice 4: admin overview

- Add an admin view for JOX listings and offers: active, owned, pending, accepted, declined, expired.
- Admin can unlist a JOX item without deleting provenance or inventory history.
