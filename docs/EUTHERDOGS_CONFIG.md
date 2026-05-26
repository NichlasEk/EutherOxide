# EutherDogs Config

`config/eutherdogs.example.toml` is the intended modding and cheating surface for EutherDogs. It is not wired into runtime loading yet; it defines the shape we should preserve when persistence is added.

Goals:

- Make player stats easy to edit.
- Keep high scores human-editable.
- Make mission rules tweakable without recompiling.
- Keep balancing values visible and easy to mod.

Important conventions:

- `ammo = -1` means infinite ammo.
- `time_limit_ticks = 0` means no timer.
- Weapon IDs should match `assets/eutherdogs/manifest.toml` keys where possible.
- High score entries should preserve the fields used by `HighScoreEntry`.

Recommended future load order:

1. Built-in Rust defaults.
2. `config/eutherdogs.example.toml` as reference/default template.
3. User config from EutherOxide data dir, for example `~/.local/share/euther-oxide/eutherdogs.toml`.
4. Runtime state/save files.

The next implementation step for this file is a small parser/serializer layer. Keep it outside the pure simulation loop so invalid config can be reported cleanly before starting a mission.
