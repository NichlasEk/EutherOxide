pub use eutherdogs_core::{
    ConfigError, ConfigStoreItem, EutherDogsConfig, FixedStep, Game, MobileInput, PlayerCommand,
    PlayerInput, PurchaseError, TouchButtons, VirtualStick, WeaponId,
    world::{
        CHARACTER_HEIGHT, CHARACTER_WIDTH, MissionSpec, TILE_HEIGHT, TILE_WIDTH, Tile, WorldParams,
    },
};
use serde::{Deserialize, Serialize};

const CAMPAIGN_MISSIONS: i32 = 10;

#[derive(Clone, Debug)]
pub struct EutherDogsRuntime {
    config: EutherDogsConfig,
    game: Game,
    frame: u64,
    explored_tiles: Vec<bool>,
    mission: i32,
    staff: u8,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsInput {
    pub player: Option<u8>,
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub a: bool,
    pub b: bool,
    pub c: bool,
    pub start: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsPurchase {
    pub item_id: String,
    pub player: Option<u8>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsStart {
    pub staff: Option<u8>,
    pub mission: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsFrame {
    pub frame: u64,
    pub width: usize,
    pub height: usize,
    pub tile_width: i32,
    pub tile_height: i32,
    pub character_width: i32,
    pub character_height: i32,
    pub tiles: Vec<&'static str>,
    pub visibility: Vec<u8>,
    pub characters: Vec<EutherDogsActor>,
    pub bullets: Vec<EutherDogsBullet>,
    pub summary: EutherDogsSummary,
    pub store: Vec<EutherDogsStoreItem>,
    pub audio_events: Vec<&'static str>,
    pub highscore_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsStoreItem {
    pub id: String,
    pub label: String,
    pub price: i32,
    pub detail: String,
    pub weapon: Option<String>,
    pub ammo: i32,
    pub armor: i32,
    pub owned: bool,
    pub current_ammo: Option<i32>,
    pub active: bool,
    pub affordable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsActor {
    pub id: u32,
    pub faction: &'static str,
    pub x: i32,
    pub y: i32,
    pub direction: &'static str,
    pub sprite: &'static str,
    pub armor: i32,
    pub lives: i32,
    pub alive: bool,
    pub active_weapon: &'static str,
    pub ammo: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsBullet {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub dx: i32,
    pub dy: i32,
    pub owner_faction: &'static str,
    pub weapon: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EutherDogsSummary {
    pub mission: i32,
    pub max_mission: i32,
    pub status: &'static str,
    pub elapsed_ticks: u32,
    pub score: i32,
    pub cash: i32,
    pub kills: i32,
    pub targets_destroyed: i32,
    pub objects_collected: i32,
    pub shots_fired: i32,
    pub hits: i32,
    pub damage_taken: i32,
    pub targets_left: i32,
    pub objects_left: i32,
    pub minimum_kills: i32,
    pub time_remaining_ticks: Option<u32>,
}

impl EutherDogsRuntime {
    pub fn from_config(config: EutherDogsConfig) -> Result<Self, ConfigError> {
        let mission = config.settings.starting_mission.max(1);
        let game = Game::new_mission_from_config(&campaign_config(&config, mission))?;
        Ok(Self {
            config,
            game,
            frame: 0,
            explored_tiles: Vec::new(),
            mission,
            staff: 1,
        })
    }

    pub fn demo() -> Self {
        Self::from_config(demo_config()).expect("bundled EutherDogs demo config is valid")
    }

    pub fn demo_with_staff(staff: u8) -> Self {
        Self::demo_with_start(EutherDogsStart {
            staff: Some(staff),
            mission: None,
        })
    }

    pub fn demo_with_start(start: EutherDogsStart) -> Self {
        let staff = start.staff.unwrap_or(1).clamp(1, 2);
        let mut config = staff_demo_config(staff);
        config.settings.starting_mission = start
            .mission
            .unwrap_or(config.settings.starting_mission)
            .max(1);
        let mut runtime =
            Self::from_config(config).expect("bundled EutherDogs staff config is valid");
        runtime.staff = staff;
        runtime
    }

    pub fn reset(&mut self) -> Result<(), ConfigError> {
        self.game = Game::new_mission_from_config(&campaign_config(&self.config, self.mission))?;
        self.frame = 0;
        self.explored_tiles.clear();
        Ok(())
    }

    pub fn advance_mission(&mut self) -> Result<EutherDogsFrame, ConfigError> {
        self.persist_player_state();
        if self.mission < CAMPAIGN_MISSIONS {
            self.mission += 1;
        }
        self.game = Game::new_mission_from_config(&campaign_config(&self.config, self.mission))?;
        self.frame = 0;
        self.explored_tiles.clear();
        Ok(self.snapshot())
    }

    pub fn tick(&mut self, input: EutherDogsInput) -> EutherDogsFrame {
        let mut command = 0;
        if input.up {
            command |= PlayerCommand::UP;
        }
        if input.down {
            command |= PlayerCommand::DOWN;
        }
        if input.left {
            command |= PlayerCommand::LEFT;
        }
        if input.right {
            command |= PlayerCommand::RIGHT;
        }
        if input.a || input.b {
            command |= PlayerCommand::SHOOT;
        }
        if input.c {
            command |= PlayerCommand::SWITCH;
        }
        self.game.tick(
            &[PlayerInput {
                player_index: input.player.unwrap_or(1).saturating_sub(1) as usize,
                command: PlayerCommand::from_bits(command),
            }],
            FixedStep { ticks: 1 },
        );
        self.frame += 1;
        let audio_events = self.game.drain_audio_events();
        self.snapshot_with_audio_events(&audio_events)
    }

    pub fn purchase(
        &mut self,
        purchase: EutherDogsPurchase,
    ) -> Result<EutherDogsFrame, PurchaseError> {
        let store = complete_store_items(&self.config.store);
        self.game.purchase_store_item(
            &store,
            &purchase.item_id,
            purchase.player.unwrap_or(1).saturating_sub(1) as usize,
        )?;
        let audio_events = self.game.drain_audio_events();
        Ok(self.snapshot_with_audio_events(&audio_events))
    }

    pub fn snapshot(&mut self) -> EutherDogsFrame {
        self.snapshot_with_audio_events(&[])
    }

    fn snapshot_with_audio_events(
        &mut self,
        audio_events: &[eutherdogs_core::AudioEvent],
    ) -> EutherDogsFrame {
        let visibility = self.update_visibility();
        eutherdogs_frame(
            &self.game,
            &self.config,
            self.mission,
            self.frame,
            audio_events,
            self.config.high_score_table().entries().len(),
            visibility,
        )
    }

    fn update_visibility(&mut self) -> Vec<u8> {
        let current = compute_visibility(&self.game);
        if self.explored_tiles.len() != current.len() {
            self.explored_tiles = vec![false; current.len()];
        }
        let mut visibility = vec![0; current.len()];
        for (index, visible) in current.into_iter().enumerate() {
            if visible {
                self.explored_tiles[index] = true;
                visibility[index] = 255;
            } else if self.explored_tiles[index] {
                visibility[index] = 96;
            }
        }
        visibility
    }

    fn persist_player_state(&mut self) {
        let summary = self.game.summary();
        for (player_index, character) in self
            .game
            .characters()
            .iter()
            .filter(|character| {
                character.faction == eutherdogs_core::entity::Faction::Player && character.alive
            })
            .enumerate()
        {
            let player_key = (player_index + 1).to_string();
            let Some(player) = self.config.player.get_mut(&player_key) else {
                continue;
            };
            player.cash = summary.progress.cash;
            player.score = summary.progress.score;
            player.armor = character.armor.max(1);
            player.lives = character.lives.max(1);
            player.active_weapon = character.active_weapon_id().key().to_string();
            player.weapons = character
                .weapons
                .iter()
                .map(|slot| eutherdogs_core::ConfigWeaponSlot {
                    id: slot.weapon.key().to_string(),
                    ammo: slot.ammo,
                })
                .collect();
        }
    }
}

pub fn demo_game() -> Game {
    Game::new_mission_from_config(&demo_config()).expect("bundled EutherDogs demo config is valid")
}

pub fn demo_config() -> EutherDogsConfig {
    EutherDogsConfig::from_toml_str(include_str!("../config/eutherdogs.example.toml"))
        .expect("bundled EutherDogs config parses")
}

pub fn staff_demo_config(staff: u8) -> EutherDogsConfig {
    let mut config = demo_config();
    let staff_key = staff.clamp(1, 2).to_string();
    if let Some(player) = config.player.get(&staff_key).cloned() {
        config.player.insert("1".to_string(), player);
    }
    config.settings.player_count = 1;
    config
}

fn campaign_config(config: &EutherDogsConfig, mission: i32) -> EutherDogsConfig {
    let mut config = config.clone();
    let mission = mission.clamp(1, CAMPAIGN_MISSIONS);
    let step = mission - 1;
    config.settings.starting_mission = mission;
    config.settings.object_count = (config.settings.object_count + step * 2).clamp(1, 40);
    config.settings.target_count = (config.settings.target_count + step).clamp(0, 40);
    config.settings.minimum_kills = if mission >= 4 && mission % 3 == 0 {
        (config.settings.minimum_kills + mission * 2).max(6)
    } else {
        config.settings.minimum_kills.max(0)
    };
    config.world.seed = config.world.seed.wrapping_add((step as u64) * 10);
    config.world.wall_count = (config.world.wall_count + step * 2).clamp(8, 56);
    config.world.wall_length = (config.world.wall_length + step / 2).clamp(4, 22);
    config.world.room_count = (config.world.room_count + step).clamp(4, 34);
    config.world.detail_density = (config.world.detail_density + step * 3).clamp(8, 64);
    config
}

pub fn eutherdogs_frame(
    game: &Game,
    config: &EutherDogsConfig,
    mission: i32,
    frame: u64,
    audio_events: &[eutherdogs_core::AudioEvent],
    highscore_count: usize,
    visibility: Vec<u8>,
) -> EutherDogsFrame {
    let summary = game.summary();
    EutherDogsFrame {
        frame,
        width: game.world().width(),
        height: game.world().height(),
        tile_width: TILE_WIDTH,
        tile_height: TILE_HEIGHT,
        character_width: CHARACTER_WIDTH,
        character_height: CHARACTER_HEIGHT,
        tiles: game
            .world()
            .tiles()
            .iter()
            .map(|tile| tile_key(*tile))
            .collect(),
        visibility,
        characters: game
            .characters()
            .iter()
            .map(|character| {
                let active_weapon = character.active_weapon_id();
                let ammo = character
                    .weapons
                    .get(character.active_weapon)
                    .map(|slot| slot.ammo)
                    .unwrap_or(-1);
                EutherDogsActor {
                    id: character.id,
                    faction: match character.faction {
                        eutherdogs_core::entity::Faction::Player => "player",
                        eutherdogs_core::entity::Faction::HostileCustomer => "hostile_customer",
                    },
                    x: character.x,
                    y: character.y,
                    direction: direction_key(character.direction),
                    sprite: character.sprite.manifest_key(),
                    armor: character.armor,
                    lives: character.lives,
                    alive: character.alive,
                    active_weapon: active_weapon.key(),
                    ammo,
                }
            })
            .collect(),
        bullets: game
            .bullets()
            .iter()
            .map(|bullet| EutherDogsBullet {
                id: bullet.id,
                x: bullet.x,
                y: bullet.y,
                dx: bullet.dx,
                dy: bullet.dy,
                owner_faction: match bullet.owner_faction {
                    eutherdogs_core::entity::Faction::Player => "player",
                    eutherdogs_core::entity::Faction::HostileCustomer => "hostile_customer",
                },
                weapon: bullet.weapon.key(),
            })
            .collect(),
        summary: EutherDogsSummary {
            mission,
            max_mission: CAMPAIGN_MISSIONS,
            status: match summary.status {
                eutherdogs_core::MissionStatus::Running => "running",
                eutherdogs_core::MissionStatus::Won => "won",
                eutherdogs_core::MissionStatus::Lost => "lost",
            },
            elapsed_ticks: summary.progress.elapsed_ticks,
            score: summary.progress.score,
            cash: summary.progress.cash,
            kills: summary.progress.kills,
            targets_destroyed: summary.progress.targets_destroyed,
            objects_collected: summary.progress.objects_collected,
            shots_fired: summary.progress.shots_fired,
            hits: summary.progress.hits,
            damage_taken: summary.progress.damage_taken,
            targets_left: summary.targets_left,
            objects_left: summary.objects_left,
            minimum_kills: summary.minimum_kills,
            time_remaining_ticks: summary.time_remaining_ticks,
        },
        store: game_store_items(game, config),
        audio_events: audio_events
            .iter()
            .map(|event| match event {
                eutherdogs_core::AudioEvent::Sfx(asset) => asset.manifest_key(),
            })
            .collect(),
        highscore_count,
    }
}

fn game_store_items(game: &Game, config: &EutherDogsConfig) -> Vec<EutherDogsStoreItem> {
    let cash = game.summary().progress.cash;
    let player = game
        .characters()
        .iter()
        .find(|character| character.faction == eutherdogs_core::entity::Faction::Player);
    complete_store_items(&config.store)
        .into_iter()
        .map(|item| {
            let weapon = item
                .weapon
                .as_deref()
                .and_then(eutherdogs_core::WeaponId::from_key);
            let slot = weapon.and_then(|weapon| {
                player.and_then(|player| player.weapons.iter().find(|slot| slot.weapon == weapon))
            });
            let active = weapon
                .zip(player)
                .is_some_and(|(weapon, player)| player.active_weapon_id() == weapon);
            let owned = item.armor > 0 || slot.is_some();
            EutherDogsStoreItem {
                id: item.id,
                label: item.label,
                price: item.price,
                detail: item.detail,
                weapon: item.weapon,
                ammo: item.ammo,
                armor: item.armor,
                owned,
                current_ammo: slot.map(|slot| slot.ammo),
                active,
                affordable: cash >= item.price.max(0),
            }
        })
        .collect()
}

fn compute_visibility(game: &Game) -> Vec<bool> {
    let world = game.world();
    let mut visible = vec![false; world.width() * world.height()];
    let radius = 11;
    for character in game.characters().iter().filter(|character| {
        character.alive && character.faction == eutherdogs_core::entity::Faction::Player
    }) {
        let origin_x = (character.x / TILE_WIDTH).clamp(0, world.width().saturating_sub(1) as i32);
        let origin_y =
            (character.y / TILE_HEIGHT).clamp(0, world.height().saturating_sub(1) as i32);
        for y in origin_y - radius..=origin_y + radius {
            for x in origin_x - radius..=origin_x + radius {
                if x < 0 || y < 0 || x >= world.width() as i32 || y >= world.height() as i32 {
                    continue;
                }
                let dx = x - origin_x;
                let dy = y - origin_y;
                if dx * dx + dy * dy > radius * radius {
                    continue;
                }
                if has_line_of_sight(game, origin_x, origin_y, x, y) {
                    visible[y as usize * world.width() + x as usize] = true;
                }
            }
        }
    }
    visible
}

fn has_line_of_sight(game: &Game, from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> bool {
    let mut x = from_x;
    let mut y = from_y;
    let dx = (to_x - from_x).abs();
    let dy = -(to_y - from_y).abs();
    let step_x = if from_x < to_x { 1 } else { -1 };
    let step_y = if from_y < to_y { 1 } else { -1 };
    let mut err = dx + dy;

    loop {
        if x == to_x && y == to_y {
            return true;
        }
        if (x != from_x || y != from_y) && blocks_sight(game, x, y) {
            return false;
        }
        let e2 = err * 2;
        if e2 >= dy {
            err += dy;
            x += step_x;
        }
        if e2 <= dx {
            err += dx;
            y += step_y;
        }
    }
}

fn blocks_sight(game: &Game, x: i32, y: i32) -> bool {
    if x < 0 || y < 0 {
        return true;
    }
    game.world()
        .tile(x as usize, y as usize)
        .map_or(true, Tile::blocks_walk)
}

fn complete_store_items(store: &[ConfigStoreItem]) -> Vec<ConfigStoreItem> {
    let mut items = store.to_vec();
    for item in standard_store_items() {
        if !items.iter().any(|existing| existing.id == item.id) {
            items.push(item);
        }
    }
    items
}

fn standard_store_items() -> Vec<ConfigStoreItem> {
    vec![
        store_weapon_item(
            "label_printer",
            "Label Printer",
            125,
            "Fast short-range sticker burst",
            WeaponId::LabelPrinter,
            80,
        ),
        store_weapon_item(
            "sterilizer_spray",
            "Sterilizer Spray",
            175,
            "Wide cone for queue control",
            WeaponId::SterilizerSpray,
            70,
        ),
        store_weapon_item(
            "capsule_launcher",
            "Capsule Launcher",
            250,
            "Slow explosive capsule dose",
            WeaponId::CapsuleLauncher,
            12,
        ),
        store_weapon_item(
            "autoinjector",
            "Autoinjector",
            210,
            "Single-dose dart with rude bedside manner",
            WeaponId::Autoinjector,
            24,
        ),
        store_weapon_item(
            "needlegun",
            "Needlegun",
            275,
            "Rapid insurance-approved acupuncture",
            WeaponId::Needlegun,
            120,
        ),
        store_weapon_item(
            "handsanitizer_flamethrower",
            "Handsanitizer Flamethrower",
            325,
            "Kills 99.9% of queue escalation",
            WeaponId::HandSanitizerFlamethrower,
            90,
        ),
        ConfigStoreItem {
            id: "coat_reinforcement".to_string(),
            label: "Coat Reinforcement".to_string(),
            price: 100,
            detail: "Add 25 white-coat armor".to_string(),
            weapon: None,
            ammo: 0,
            armor: 25,
        },
    ]
}

fn store_weapon_item(
    id: &str,
    label: &str,
    price: i32,
    detail: &str,
    weapon: WeaponId,
    ammo: i32,
) -> ConfigStoreItem {
    ConfigStoreItem {
        id: id.to_string(),
        label: label.to_string(),
        price,
        detail: detail.to_string(),
        weapon: Some(weapon.key().to_string()),
        ammo,
        armor: 0,
    }
}

fn tile_key(tile: Tile) -> &'static str {
    match tile {
        Tile::Floor => "floor",
        Tile::Wall => "wall",
        Tile::Door => "door",
        Tile::SterileFloor => "sterile_floor",
        Tile::NeonFloor => "neon_floor",
        Tile::WarningFloor => "warning_floor",
        Tile::FanFloor => "fan_floor",
        Tile::CorruptMedCabinet => "corrupt_med_cabinet",
        Tile::HackedVendingUnit => "hacked_vending_unit",
        Tile::RecallCrate => "recall_crate",
        Tile::ShippingBox => "shipping_box",
        Tile::ServiceElevator => "service_elevator",
        Tile::Prescription => "prescription",
        Tile::Folder => "folder",
        Tile::DataWafer => "data_wafer",
        Tile::CircuitBoard => "circuit_board",
        Tile::PillSample => "pill_sample",
        Tile::LabCoatArmor => "lab_coat_armor",
        Tile::HazardSleeves => "hazard_sleeves",
        Tile::PillSplitter => "pill_splitter",
        Tile::ScorchMark => "scorch_mark",
        Tile::SpilledSyrup => "spilled_syrup",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_backfills_missing_store_items_for_purchase() {
        let mut runtime = EutherDogsRuntime::demo();
        runtime
            .config
            .store
            .retain(|item| item.id != "autoinjector");

        let frame = runtime
            .purchase(EutherDogsPurchase {
                item_id: "autoinjector".to_string(),
                player: Some(1),
            })
            .unwrap();

        let hero = frame
            .characters
            .iter()
            .find(|character| character.faction == "player")
            .unwrap();
        assert_eq!(hero.active_weapon, "autoinjector");
        assert!(
            frame
                .store
                .iter()
                .any(|item| item.id == "autoinjector" && item.active)
        );
    }

    #[test]
    fn snapshot_includes_player_visibility_mask() {
        let mut runtime = EutherDogsRuntime::demo();
        let frame = runtime.snapshot();
        let hero = frame
            .characters
            .iter()
            .find(|character| character.faction == "player")
            .unwrap();
        let tile_x = (hero.x / frame.tile_width) as usize;
        let tile_y = (hero.y / frame.tile_height) as usize;

        assert_eq!(frame.visibility.len(), frame.width * frame.height);
        assert_eq!(frame.visibility[tile_y * frame.width + tile_x], 255);
        assert!(frame.visibility.iter().any(|visibility| *visibility == 0));
    }

    #[test]
    fn runtime_advances_campaign_mission_and_carries_state() {
        let mut runtime = EutherDogsRuntime::demo();
        let starting_cash = runtime.snapshot().summary.cash;

        let frame = runtime.advance_mission().unwrap();

        assert_eq!(frame.summary.mission, 2);
        assert_eq!(frame.summary.max_mission, 10);
        assert!(frame.summary.cash >= starting_cash);
        assert!(frame.summary.objects_left >= 10);
    }
}

fn direction_key(direction: eutherdogs_core::direction::Direction) -> &'static str {
    match direction {
        eutherdogs_core::direction::Direction::Up => "up",
        eutherdogs_core::direction::Direction::UpRight => "up_right",
        eutherdogs_core::direction::Direction::Right => "right",
        eutherdogs_core::direction::Direction::DownRight => "down_right",
        eutherdogs_core::direction::Direction::Down => "down",
        eutherdogs_core::direction::Direction::DownLeft => "down_left",
        eutherdogs_core::direction::Direction::Left => "left",
        eutherdogs_core::direction::Direction::UpLeft => "up_left",
    }
}
