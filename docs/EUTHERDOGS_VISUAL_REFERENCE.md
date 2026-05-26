# EutherDogs Visual Reference

EutherDogs should preserve the readable arcade structure of classic top-down DOS shooters while replacing the theme completely. Do not copy Cyberdogs art, characters, logos, sounds, or literal setting. Keep only composition, scale discipline, HUD economy, menu rhythm, fog behavior, and chunky top-down readability.

## Theme Rule

The game is pharmacy cyberpunk:

- Heroes are pharmacy staff, night technicians, compliance runners, and neon pharmacists.
- Enemies are angry customers, claim deniers, recall enforcers, audit bots, couriers, and district managers.
- Weapons are scanners, label printers, RX cannons, sterilizer spray, prior-auth lasers, and formulary zappers.
- Objectives are prescriptions, denied forms, pill samples, data wafers, circuit boards, and recall evidence.
- Environment reads as pharmacy back room, dispensary counter, sterile clinic corridor, warehouse shelves, security glass, kiosks, and neon signage.
- Decals should be spilled syrup, scorch marks, shredded labels, cracked blister packs, and chemical stains instead of gore.

## Screen And Scale

- Design target is a low-resolution game surface, rendered pixel-perfect and scaled up.
- Keep gameplay readable at roughly 320x200 composition density.
- Current core tile size is 32x24 and character size is 32x32. Art may contain transparent padding, but gameplay collision should stay independent from sprite bounds.
- Characters should be small, chunky, high-contrast sprites with one or two defining pharmacy/cyberpunk details visible at game scale.
- Projectiles must be more readable than realistic: bright neon streaks, pills, label strips, or scanner bolts.

## Menus

Menus use full-screen industrial pharmacy surfaces, not floating cards.

- Background: dark pharmacy steel, storage wall panels, rivets/screws, safety-glass seams, subtle neon wear.
- Logo: large metallic/pill-pack inspired wordmark with strong dark outline and grayscale/cyan-magenta highlight. It should read as `EUTHERDOGS`, not the original title.
- Selection: circular hardware buttons, warning lamps, scanner dots, or prescription-status LEDs.
- Typography: white pixel text with dark shadow. Yellow is reserved for mission-critical values: cash, count, deadline, warnings, selected rule.
- Layout rhythm: two-column option lists, generous spacing, status instructions along the bottom.

Recommended renamed screens:

| Original role | EutherDogs screen |
| --- | --- |
| Main menu | Shift Console |
| Heroes | Staff Roster |
| Armory | Dispensary |
| Mission briefing | Shift Briefing |
| Options | Systems |
| Credits | Ingredients |

## Gameplay

- The visible playfield is a camera over a larger facility map.
- Outside the known/visible map should fall to black or deep purple fog.
- Walls should be blocky and clear: clinic brick, modular steel, pharmacy shelving, security glass.
- Floors should be low-contrast but textured: sterile tile, dark stockroom tile, queue markings, neon utility lines.
- Props should sit on top of floors and be identifiable: recall crates, vending/kiosk units, med cabinets, shipping boxes, dispensary counters.
- HUD stays minimal: health/armor bar, lives/staff icons, objective count, deadline/timer, cash/score only when needed.
- Combat readability is more important than decoration. Angry customers and bolts must pop from the floor.

## Map View

The map view should feel like a pharmacy security/diagnostic overlay:

- Dim most of the world into monochrome purple or cyan.
- Show explored geometry with hard rectangular blocks.
- Draw the current viewport as a bright rectangular outline.
- Mark player/objectives with tiny high-contrast pixels or dots.
- Keep it sparse; this is a tactical overlay, not a separate illustrated map.

## Color Direction

Use a mixed palette. Avoid letting the game become only purple, only slate, or only neon cyan.

- Base: near-black, charcoal, dark steel, muted clinic gray.
- Pharmacy: white coats, sterile off-white, pale blue, label-paper white.
- Cyberpunk accents: cyan, magenta, warning yellow, red alert lamps.
- Retail/apothecary accents: green prescription glow, orange hazard labels, barcode black.

## Implementation Order

1. Lock this visual reference and asset status.
2. Wire renderer to manifest-backed placeholders with fallback colors.
3. Replace tile/prop placeholders first.
4. Replace player/enemy/projectile placeholders.
5. Add HUD and fog/map overlay.
6. Add screen-specific menus: Shift Console, Staff Roster, Dispensary, Shift Briefing.
7. Add sound event routing for scanner shots, label bursts, pickup RX, impacts, denied-customer defeat, and alarm/alert.
