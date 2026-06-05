# EutherCivet

Minimal Rust + Bevy prototype for a satirical civet coffee tycoon sim.

## Run

```bash
cargo run
```

The game saves to `euther_civet_save.json` in the project root. Use the in-game Save and Load buttons.

## Structure

```text
Cargo.toml
README.md
src/
  actions.rs
  main.rs
  model.rs
  simulation.rs
  ui.rs
  visuals.rs
```

## Implemented

- Core plantation model in one `GameState`.
- Coffee plants generate fruit over time.
- Civets eat fed fruit and produce processed beans.
- Happiness changes production, suspicion, and reputation pressure.
- Buttons for planting, harvesting, feeding, collecting, roasting, selling, enclosure upgrades, paperwork, save, and load.
- Random absurd events, including police, journalists, inspections, helicopter, binturong escape, picky civet, and goat.
- Random events pause play and present three response choices with different resource, reputation, suspicion, and welfare effects.
- Inspection event: Operation Bitter Bean, with three responses.
- Seven-day run structure with daily reports, upkeep, reputation/suspicion adjustments, and weekly win/fail verdicts.
- Buyable upgrades: Legal Office, Caretaker, Fruit Sorter, Roasting Shed, and Visitor Tasting Room.
- Premium order contracts with accept/decline choices, delivery deadlines, payouts, reputation rewards, and missed-order penalties.
- First scene flow: main menu, company/mission presentation, and animal book before entering the plantation.
- In-game room flow with Sanctuary, Coffee Field, Roastery, and Paperwork Office views.
- Compact right-side tool panel with collapsible action groups for Care, Field, Production, Compliance, Upgrades, and System.
- Named civets with in-world name labels.
- Clickable civets with a care panel for feeding, petting, and inspecting animal notes.
- Generated original character sprite sheet for three palm civets and the plantation owner.
- Generated original prop sprite sheet for coffee plants, fruit, beans, bags, roaster, paperwork, helicopter, goat, binturong, and room decor.
- Generated four-panel background atlas with dawn, day, sunset, and night plantation scenes.
- Layered environment rendering with crossfading day/night cycle and drifting parallax clouds.
- Generated illustrated UI skin atlas with wooden HUD boards, bamboo tool panels, parchment modals, and drawn button plaques.
- Palm civets have simple wandering/bobbing motion in the Sanctuary.
- Clickable room objects that trigger core actions: plants, fruit baskets, roaster, coffee bags, bean crate, and paperwork stacks.
- Dynamic action buttons that show costs/requirements and dim when unavailable.
- Warm plantation visuals with red suspicion UI and placeholder shapes for plants, civets, binturong, goat, helicopter, and coffee bags.
- Polished first-pass UI with status bars, two-column controls, animated helicopter, enclosure staging, and suspicion glow.
- Local save/load via JSON.

## Expansion Points

- Add new rooms by extending `PlantationRoom` and adding a room renderer in `visuals.rs`.
- Add new animals by extending `GameState` and the Sanctuary room renderer.
- Add buildings/upgrades by adding new `Action` variants and action handlers.
- Add new events in `random_event`.
- Replace placeholder shapes with original sprites later without changing the game model.
