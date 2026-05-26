# EutherDogs Asset Key

EutherDogs uses new assets only. The original Cyberdogs graphics/sounds are not included or referenced. The canonical machine-readable asset map is `assets/eutherdogs/manifest.toml`; this file is the human key for planning, replacing placeholders, and adding new content. Visual rules live in `docs/EUTHERDOGS_VISUAL_REFERENCE.md`.

## Visual Direction

Theme: pharmacy cyberpunk. Sterile floors, white coats, pill bottles, dry retail/apothecary jokes, neon lasers, angry customers, insurance denial energy, kiosks, scanners, label printers, recall crates.

Do not copy original Cyberdogs assets or literal theme. Preserve only composition, readability, scale, menu rhythm, HUD economy, fog behavior, and chunky top-down action feel. All content must read as pharmacy cyberpunk.

Placeholder art is intentionally simple and should keep the final file names. Replace the file contents, not the paths, unless the manifest is updated in the same change.

## Dimensions

| Kind | Size | Notes |
| --- | ---: | --- |
| Characters | 32x32 | Heroes and enemies |
| Tiles | 32x24 | Floors, walls, props |
| Projectiles | 16x16 | Bullets, arcs, capsule grenades |
| UI icons | 32x32 | HUD and menu icons |
| Menu panels | 160x96 | Framed UI art |

## Status Key

| Status | Meaning |
| --- | --- |
| `placeholder` | File exists as temporary art/audio and can be replaced in place |
| `wired` | Renderer/audio code should already know how to use this key |
| `needs-art` | File name/key is planned but needs better temporary art |
| `final` | Good enough to keep unless design changes |

## Heroes

| Key | File | Intent | Status |
| --- | --- | --- | --- |
| `night_shift_tech` | `assets/eutherdogs/sprites/heroes/night_shift_tech.png` | Player 1, white coat tech with neon trim | `placeholder` |
| `neon_pharmacist` | `assets/eutherdogs/sprites/heroes/neon_pharmacist.png` | Player 2, brighter pharmacist silhouette | `placeholder` |
| `compliance_runner` | `assets/eutherdogs/sprites/heroes/compliance_runner.png` | Alternate hero / later unlock | `placeholder` |

## Enemies

| Key | File | Intent | Status |
| --- | --- | --- | --- |
| `angry_customer` | `assets/eutherdogs/sprites/enemies/angry_customer.png` | Basic melee/shooter customer | `placeholder` |
| `claim_denier` | `assets/eutherdogs/sprites/enemies/claim_denier.png` | Insurance-themed ranged enemy | `placeholder` |
| `inventory_drone` | `assets/eutherdogs/sprites/enemies/inventory_drone.png` | Robot/drone enemy | `placeholder` |
| `recall_enforcer` | `assets/eutherdogs/sprites/enemies/recall_enforcer.png` | Heavier enemy | `placeholder` |
| `black_market_courier` | `assets/eutherdogs/sprites/enemies/black_market_courier.png` | Fast enemy | `placeholder` |
| `district_manager` | `assets/eutherdogs/sprites/enemies/district_manager.png` | Boss/elite candidate | `placeholder` |

## Weapons

| Key | File | Gameplay | Status |
| --- | --- | --- | --- |
| `rx_cannon` | `assets/eutherdogs/sprites/weapons/rx_cannon.png` | Heavy power weapon | `placeholder` |
| `scanner_blaster` | `assets/eutherdogs/sprites/weapons/scanner_blaster.png` | Default infinite weapon | `placeholder` |
| `label_printer` | `assets/eutherdogs/sprites/weapons/label_printer.png` | Rapid spray | `placeholder` |
| `sterilizer_spray` | `assets/eutherdogs/sprites/weapons/sterilizer_spray.png` | Area/flame style | `placeholder` |
| `capsule_launcher` | `assets/eutherdogs/sprites/weapons/capsule_launcher.png` | Explosive launcher | `placeholder` |
| `coupon_pistol` | `assets/eutherdogs/sprites/weapons/coupon_pistol.png` | Basic enemy weapon | `placeholder` |
| `receipt_gun` | `assets/eutherdogs/sprites/weapons/receipt_gun.png` | Alternate basic gun | `placeholder` |
| `neon_prior_auth` | `assets/eutherdogs/sprites/weapons/neon_prior_auth.png` | Laser weapon | `placeholder` |
| `turbo_prior_auth` | `assets/eutherdogs/sprites/weapons/turbo_prior_auth.png` | Fast laser | `placeholder` |
| `formulary_zapper` | `assets/eutherdogs/sprites/weapons/formulary_zapper.png` | Electric area weapon | `placeholder` |

## Projectiles

| Key | File | Status |
| --- | --- | --- |
| `cyan_rx_bolt` | `assets/eutherdogs/sprites/projectiles/cyan_rx_bolt.png` | `placeholder` |
| `red_denial_bolt` | `assets/eutherdogs/sprites/projectiles/red_denial_bolt.png` | `placeholder` |
| `label_shred` | `assets/eutherdogs/sprites/projectiles/label_shred.png` | `placeholder` |
| `sterilizer_cloud` | `assets/eutherdogs/sprites/projectiles/sterilizer_cloud.png` | `placeholder` |
| `capsule_grenade` | `assets/eutherdogs/sprites/projectiles/capsule_grenade.png` | `placeholder` |
| `green_auth_laser` | `assets/eutherdogs/sprites/projectiles/green_auth_laser.png` | `placeholder` |
| `yellow_warning_laser` | `assets/eutherdogs/sprites/projectiles/yellow_warning_laser.png` | `placeholder` |
| `power_pill` | `assets/eutherdogs/sprites/projectiles/power_pill.png` | `placeholder` |
| `zapper_arc` | `assets/eutherdogs/sprites/projectiles/zapper_arc.png` | `placeholder` |

## Tiles And Props

| Key | File | Intent | Status |
| --- | --- | --- | --- |
| `sterile_tile` | `assets/eutherdogs/tiles/floor/sterile_tile.png` | Clean pharmacy floor | `placeholder` |
| `neon_floor` | `assets/eutherdogs/tiles/floor/neon_floor.png` | Cyberpunk accent floor | `placeholder` |
| `warning_floor` | `assets/eutherdogs/tiles/floor/warning_floor.png` | Hazard/queue marker | `placeholder` |
| `fan_floor` | `assets/eutherdogs/tiles/floor/fan_floor.png` | Vent/fan tile | `placeholder` |
| `pharmacy_wall` | `assets/eutherdogs/tiles/walls/pharmacy_wall.png` | Default wall | `placeholder` |
| `neon_shelf_wall` | `assets/eutherdogs/tiles/walls/neon_shelf_wall.png` | Shelving/wall detail | `placeholder` |
| `consultation_wall` | `assets/eutherdogs/tiles/walls/consultation_wall.png` | Clinic room wall | `placeholder` |
| `security_glass_wall` | `assets/eutherdogs/tiles/walls/security_glass_wall.png` | Secure counter/glass | `placeholder` |
| `corrupt_med_cabinet` | `assets/eutherdogs/tiles/props/corrupt_med_cabinet.png` | Mission target | `placeholder` |
| `hacked_vending_unit` | `assets/eutherdogs/tiles/props/hacked_vending_unit.png` | Destructible prop | `placeholder` |
| `recall_crate` | `assets/eutherdogs/tiles/props/recall_crate.png` | Destructible prop | `placeholder` |
| `shipping_box` | `assets/eutherdogs/tiles/props/shipping_box.png` | Destructible prop | `placeholder` |
| `service_elevator` | `assets/eutherdogs/tiles/props/service_elevator.png` | Exit | `placeholder` |

## Pickups

| Key | File | Gameplay | Status |
| --- | --- | --- | --- |
| `prescription` | `assets/eutherdogs/sprites/items/prescription.png` | Objective/ammo | `placeholder` |
| `folder` | `assets/eutherdogs/sprites/items/folder.png` | Objective/ammo | `placeholder` |
| `data_wafer` | `assets/eutherdogs/sprites/items/data_wafer.png` | Objective/ammo | `placeholder` |
| `circuit_board` | `assets/eutherdogs/sprites/items/circuit_board.png` | Objective | `placeholder` |
| `pill_sample` | `assets/eutherdogs/sprites/items/pill_sample.png` | Objective | `placeholder` |
| `lab_coat_armor` | `assets/eutherdogs/sprites/items/lab_coat_armor.png` | Armor | `placeholder` |
| `hazard_sleeves` | `assets/eutherdogs/sprites/items/hazard_sleeves.png` | Better armor | `placeholder` |
| `pill_splitter` | `assets/eutherdogs/sprites/items/pill_splitter.png` | Weapon/ammo pickup | `placeholder` |

## UI And Menus

| Key | File | Intent | Status |
| --- | --- | --- | --- |
| `icon_player` | `assets/eutherdogs/ui/icons/icon_player.png` | HUD staff/lives icon | `placeholder` |
| `icon_target` | `assets/eutherdogs/ui/icons/icon_target.png` | HUD objective icon | `placeholder` |
| `icon_prescription` | `assets/eutherdogs/ui/icons/icon_prescription.png` | HUD/pickup icon | `placeholder` |
| `icon_cash` | `assets/eutherdogs/ui/icons/icon_cash.png` | Cash/copay icon | `placeholder` |
| `menu_panel` | `assets/eutherdogs/ui/menus/menu_panel.png` | Generic temporary panel | `placeholder` |
| `shift_console_background` | `assets/eutherdogs/ui/menus/shift_console_background.png` | Main menu pharmacy steel wall | `needs-art` |
| `staff_roster_background` | `assets/eutherdogs/ui/menus/staff_roster_background.png` | Hero/staff selection background | `needs-art` |
| `dispensary_background` | `assets/eutherdogs/ui/menus/dispensary_background.png` | Armory/pharmacy counter background | `needs-art` |
| `shift_briefing_background` | `assets/eutherdogs/ui/menus/shift_briefing_background.png` | Mission briefing room background | `needs-art` |
| `eutherdogs_logo` | `assets/eutherdogs/ui/menus/eutherdogs_logo.png` | Metallic pharmacy-cyberpunk logo | `needs-art` |
| `selector_lamp_off` | `assets/eutherdogs/ui/icons/selector_lamp_off.png` | Round inactive hardware selector | `needs-art` |
| `selector_lamp_on` | `assets/eutherdogs/ui/icons/selector_lamp_on.png` | Red active selector lamp | `needs-art` |
| `hud_health_bar` | `assets/eutherdogs/ui/icons/hud_health_bar.png` | Minimal HUD health/coat bar | `needs-art` |
| `map_viewport` | `assets/eutherdogs/ui/icons/map_viewport.png` | Bright rectangle for map view | `needs-art` |
| `security_map_overlay` | `assets/eutherdogs/ui/menus/security_map_overlay.png` | Purple/cyan security map overlay | `needs-art` |

## Audio

| Key | File | Event | Status |
| --- | --- | --- | --- |
| `impact_heavy` | `assets/eutherdogs/audio/sfx/impact_heavy.wav` | Wall/target/armor hit | `placeholder` |
| `customer_defeated` | `assets/eutherdogs/audio/sfx/customer_defeated.wav` | Enemy defeated | `placeholder` |
| `rx_cannon` | `assets/eutherdogs/audio/sfx/rx_cannon.wav` | Heavy weapon fire | `placeholder` |
| `capsule_launcher` | `assets/eutherdogs/audio/sfx/capsule_launcher.wav` | Launcher fire | `placeholder` |
| `pickup_rx` | `assets/eutherdogs/audio/sfx/pickup_rx.wav` | Pickup collected | `placeholder` |
| `scanner_blaster` | `assets/eutherdogs/audio/sfx/scanner_blaster.wav` | Default weapon | `placeholder` |
| `label_printer_burst` | `assets/eutherdogs/audio/sfx/label_printer_burst.wav` | Rapid weapon | `placeholder` |
| `weapon_switch` | `assets/eutherdogs/audio/sfx/weapon_switch.wav` | Weapon changed | `placeholder` |
| `sterilizer_spray` | `assets/eutherdogs/audio/sfx/sterilizer_spray.wav` | Area spray | `placeholder` |
| `neon_laser` | `assets/eutherdogs/audio/sfx/neon_laser.wav` | Laser/zapper | `placeholder` |
| `impact_light` | `assets/eutherdogs/audio/sfx/impact_light.wav` | Bullet expires/light impact | `placeholder` |
| `pill_splitter` | `assets/eutherdogs/audio/sfx/pill_splitter.wav` | Close/utility weapon | `placeholder` |

## Adding Assets

1. Add the file under `assets/eutherdogs/...`.
2. Add the path to `assets/eutherdogs/manifest.toml`.
3. Add a row to this document.
4. Add or update the relevant `AssetId` in `crates/eutherdogs-core/src/assets.rs`.
5. Keep final filenames stable so configs, saves, and renderer code do not churn.
