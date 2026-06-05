# EutherCivet Art Direction

## Target Feel

Cute plantation dollhouse with dry bureaucratic paranoia. The world should feel hand-built, warm, readable, and playful, with a dramatic retro sky behind it.

## Layer Rules

- Background sky: use painted parallax bitmap strips, currently `assets/sprites/euther_civet_parallax_atlas.png`.
- Do not build skies from visible debug rectangles; if a layer moves, it should be a painted image strip.
- Distant jungle: soft and atmospheric, never more detailed than interactable rooms.
- Room floor: painted walkable area with clear foot contact.
- Interactables: brighter, sharper, and anchored by shadows.
- Characters: highest contrast, soft outline, consistent foot anchors.
- UI: physical notebook, mailbox, sack, signs, and wooden buttons rather than generic panels.

## Sprite Rules

- Every character sprite needs a visible foot/base point.
- Every movable character gets idle, walk, and one care interaction animation.
- Do not mix character frames inside the same atlas unless they share animation metadata.
- Palette should stay warm jungle/wood/coffee, with suspicious red used only for alerts.
- Avoid photoreal detail on tiny sprites; readable shapes beat texture noise.

## Planned Sheets

- `player_walk_sheet`: idle plus 4-frame walk cycles.
- `civet_care_sheet`: idle, walk, eat, happy, sleepy.
- `binturong_sheet`: idle, stretch, sleep.
- `goat_sheet`: idle, blink, suspicious witness pose.
- `items_sheet`: coffee fruit, processed beans, sack, tray, brush, collar, puzzle.

## Depth Rules

Sort characters by foot position, not sprite center. Shadows sit under the foot anchor, labels sit above the sprite, and room objects should not float without a contact shadow or shelf.
