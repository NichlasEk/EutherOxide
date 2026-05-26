# EutherDogs Config

`config/eutherdogs.example.toml` is the intended modding and cheating surface for EutherDogs. It is wired into the Rust core and CLI/web demo startup; persistence to a user-writable config file is still planned.

Goals:

- Make player stats easy to edit.
- Keep high scores human-editable.
- Make mission rules tweakable without recompiling.
- Keep balancing values visible and easy to mod.

Important conventions:

- `ammo = -1` means infinite ammo.
- `time_limit_ticks = 0` means no timer.
- Weapon IDs should match `assets/eutherdogs/manifest.toml` keys where possible.
- `[[store]]` entries define RX Store inventory. `weapon` adds/refills a weapon, `ammo` sets the refill amount, and `armor` adds coat armor.
- High score entries should preserve the fields used by `HighScoreEntry`.
- `target_count` and `object_count` define generated mission goals.
- `highscore_limit` controls how many entries the editable table keeps.

Recommended future load order:

1. Built-in Rust defaults.
2. `config/eutherdogs.example.toml` as reference/default template.
3. User config from EutherOxide data dir, for example `~/.local/share/euther-oxide/eutherdogs.toml`.
4. Runtime state/save files.

Runtime support:

- `EutherDogsConfig::from_toml_str` parses and validates the file.
- `Game::new_mission_from_config` starts a mission from seed, world settings, mission goals, scoring, player stats, lives, armor, weapons, ammo, and active weapon.
- `Game::purchase_store_item` spends mission cash and applies configured RX Store weapon/ammo/armor effects.
- `EutherDogsConfig::high_score_table` converts the editable entries into the sorted runtime table.
- The CLI demo can load an edited file with `cargo run --bin euther-oxide -- --eutherdogs-demo --eutherdogs-config config/eutherdogs.example.toml`.

The next implementation step is persistence: load the user config from the EutherOxide data dir, save updated high scores back to a user-writable TOML file, and expose the active values in the web UI.
