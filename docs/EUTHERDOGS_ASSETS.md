# EutherDogs Asset Key

EutherDogs uses new assets only. The original Cyberdogs graphics/sounds are not included or referenced. The canonical machine-readable asset map is `assets/eutherdogs/manifest.toml`; this file is the human key for planning, replacing placeholders, and adding new content.

## Visual Direction

Theme: pharmacy cyberpunk. Sterile floors, white coats, pill bottles, dry retail/apothecary jokes, neon lasers, angry customers, insurance denial energy, kiosks, scanners, label printers, recall crates.

Placeholder art is intentionally simple and should keep the final file names. Replace the file contents, not the paths, unless the manifest is updated in the same change.

## Dimensions

| Kind | Size | Notes |
| --- | ---: | --- |
| Characters | 32x32 | Heroes and enemies |
| Tiles | 32x24 | Floors, walls, props |
| Projectiles | 16x16 | Bullets, arcs, capsule grenades |
| UI icons | 32x32 | HUD and menu icons |
| Menu panels | 160x96 | Framed UI art |

## Heroes

| Key | File | Intent |
| --- | --- | --- |
| `night_shift_tech` | `assets/eutherdogs/sprites/heroes/night_shift_tech.png` | Player 1, white coat tech with neon trim |
| `neon_pharmacist` | `assets/eutherdogs/sprites/heroes/neon_pharmacist.png` | Player 2, brighter pharmacist silhouette |
| `compliance_runner` | `assets/eutherdogs/sprites/heroes/compliance_runner.png` | Alternate hero / later unlock |

## Enemies

| Key | File | Intent |
| --- | --- | --- |
| `angry_customer` | `assets/eutherdogs/sprites/enemies/angry_customer.png` | Basic melee/shooter customer |
| `claim_denier` | `assets/eutherdogs/sprites/enemies/claim_denier.png` | Insurance-themed ranged enemy |
| `inventory_drone` | `assets/eutherdogs/sprites/enemies/inventory_drone.png` | Robot/drone enemy |
| `recall_enforcer` | `assets/eutherdogs/sprites/enemies/recall_enforcer.png` | Heavier enemy |
| `black_market_courier` | `assets/eutherdogs/sprites/enemies/black_market_courier.png` | Fast enemy |
| `district_manager` | `assets/eutherdogs/sprites/enemies/district_manager.png` | Boss/elite candidate |

## Weapons

| Key | File | Gameplay |
| --- | --- | --- |
| `rx_cannon` | `assets/eutherdogs/sprites/weapons/rx_cannon.png` | Heavy power weapon |
| `scanner_blaster` | `assets/eutherdogs/sprites/weapons/scanner_blaster.png` | Default infinite weapon |
| `label_printer` | `assets/eutherdogs/sprites/weapons/label_printer.png` | Rapid spray |
| `sterilizer_spray` | `assets/eutherdogs/sprites/weapons/sterilizer_spray.png` | Area/flame style |
| `capsule_launcher` | `assets/eutherdogs/sprites/weapons/capsule_launcher.png` | Explosive launcher |
| `coupon_pistol` | `assets/eutherdogs/sprites/weapons/coupon_pistol.png` | Basic enemy weapon |
| `receipt_gun` | `assets/eutherdogs/sprites/weapons/receipt_gun.png` | Alternate basic gun |
| `neon_prior_auth` | `assets/eutherdogs/sprites/weapons/neon_prior_auth.png` | Laser weapon |
| `turbo_prior_auth` | `assets/eutherdogs/sprites/weapons/turbo_prior_auth.png` | Fast laser |
| `formulary_zapper` | `assets/eutherdogs/sprites/weapons/formulary_zapper.png` | Electric area weapon |

## Projectiles

| Key | File |
| --- | --- |
| `cyan_rx_bolt` | `assets/eutherdogs/sprites/projectiles/cyan_rx_bolt.png` |
| `red_denial_bolt` | `assets/eutherdogs/sprites/projectiles/red_denial_bolt.png` |
| `label_shred` | `assets/eutherdogs/sprites/projectiles/label_shred.png` |
| `sterilizer_cloud` | `assets/eutherdogs/sprites/projectiles/sterilizer_cloud.png` |
| `capsule_grenade` | `assets/eutherdogs/sprites/projectiles/capsule_grenade.png` |
| `green_auth_laser` | `assets/eutherdogs/sprites/projectiles/green_auth_laser.png` |
| `yellow_warning_laser` | `assets/eutherdogs/sprites/projectiles/yellow_warning_laser.png` |
| `power_pill` | `assets/eutherdogs/sprites/projectiles/power_pill.png` |
| `zapper_arc` | `assets/eutherdogs/sprites/projectiles/zapper_arc.png` |

## Tiles And Props

| Key | File | Intent |
| --- | --- | --- |
| `sterile_tile` | `assets/eutherdogs/tiles/floor/sterile_tile.png` | Clean pharmacy floor |
| `neon_floor` | `assets/eutherdogs/tiles/floor/neon_floor.png` | Cyberpunk accent floor |
| `warning_floor` | `assets/eutherdogs/tiles/floor/warning_floor.png` | Hazard/queue marker |
| `fan_floor` | `assets/eutherdogs/tiles/floor/fan_floor.png` | Vent/fan tile |
| `pharmacy_wall` | `assets/eutherdogs/tiles/walls/pharmacy_wall.png` | Default wall |
| `neon_shelf_wall` | `assets/eutherdogs/tiles/walls/neon_shelf_wall.png` | Shelving/wall detail |
| `consultation_wall` | `assets/eutherdogs/tiles/walls/consultation_wall.png` | Clinic room wall |
| `security_glass_wall` | `assets/eutherdogs/tiles/walls/security_glass_wall.png` | Secure counter/glass |
| `corrupt_med_cabinet` | `assets/eutherdogs/tiles/props/corrupt_med_cabinet.png` | Mission target |
| `hacked_vending_unit` | `assets/eutherdogs/tiles/props/hacked_vending_unit.png` | Destructible prop |
| `recall_crate` | `assets/eutherdogs/tiles/props/recall_crate.png` | Destructible prop |
| `shipping_box` | `assets/eutherdogs/tiles/props/shipping_box.png` | Destructible prop |
| `service_elevator` | `assets/eutherdogs/tiles/props/service_elevator.png` | Exit |

## Pickups

| Key | File | Gameplay |
| --- | --- | --- |
| `prescription` | `assets/eutherdogs/sprites/items/prescription.png` | Objective/ammo |
| `folder` | `assets/eutherdogs/sprites/items/folder.png` | Objective/ammo |
| `data_wafer` | `assets/eutherdogs/sprites/items/data_wafer.png` | Objective/ammo |
| `circuit_board` | `assets/eutherdogs/sprites/items/circuit_board.png` | Objective |
| `pill_sample` | `assets/eutherdogs/sprites/items/pill_sample.png` | Objective |
| `lab_coat_armor` | `assets/eutherdogs/sprites/items/lab_coat_armor.png` | Armor |
| `hazard_sleeves` | `assets/eutherdogs/sprites/items/hazard_sleeves.png` | Better armor |
| `pill_splitter` | `assets/eutherdogs/sprites/items/pill_splitter.png` | Weapon/ammo pickup |

## Audio

| Key | File | Event |
| --- | --- | --- |
| `impact_heavy` | `assets/eutherdogs/audio/sfx/impact_heavy.wav` | Wall/target/armor hit |
| `customer_defeated` | `assets/eutherdogs/audio/sfx/customer_defeated.wav` | Enemy defeated |
| `rx_cannon` | `assets/eutherdogs/audio/sfx/rx_cannon.wav` | Heavy weapon fire |
| `capsule_launcher` | `assets/eutherdogs/audio/sfx/capsule_launcher.wav` | Launcher fire |
| `pickup_rx` | `assets/eutherdogs/audio/sfx/pickup_rx.wav` | Pickup collected |
| `scanner_blaster` | `assets/eutherdogs/audio/sfx/scanner_blaster.wav` | Default weapon |
| `label_printer_burst` | `assets/eutherdogs/audio/sfx/label_printer_burst.wav` | Rapid weapon |
| `weapon_switch` | `assets/eutherdogs/audio/sfx/weapon_switch.wav` | Weapon changed |
| `sterilizer_spray` | `assets/eutherdogs/audio/sfx/sterilizer_spray.wav` | Area spray |
| `neon_laser` | `assets/eutherdogs/audio/sfx/neon_laser.wav` | Laser/zapper |
| `impact_light` | `assets/eutherdogs/audio/sfx/impact_light.wav` | Bullet expires/light impact |
| `pill_splitter` | `assets/eutherdogs/audio/sfx/pill_splitter.wav` | Close/utility weapon |

## Adding Assets

1. Add the file under `assets/eutherdogs/...`.
2. Add the path to `assets/eutherdogs/manifest.toml`.
3. Add a row to this document.
4. Add or update the relevant `AssetId` in `crates/eutherdogs-core/src/assets.rs`.
5. Keep final filenames stable so configs, saves, and renderer code do not churn.
