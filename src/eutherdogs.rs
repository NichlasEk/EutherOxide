pub use eutherdogs_core::{
    ConfigError, EutherDogsConfig, FixedStep, Game, MobileInput, PlayerCommand, PlayerInput,
    PurchaseError, TouchButtons, VirtualStick,
    world::{
        CHARACTER_HEIGHT, CHARACTER_WIDTH, MissionSpec, TILE_HEIGHT, TILE_WIDTH, Tile, WorldParams,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct EutherDogsRuntime {
    config: EutherDogsConfig,
    game: Game,
    frame: u64,
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
    pub characters: Vec<EutherDogsActor>,
    pub bullets: Vec<EutherDogsBullet>,
    pub summary: EutherDogsSummary,
    pub store: Vec<EutherDogsStoreItem>,
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
        let game = Game::new_mission_from_config(&config)?;
        Ok(Self {
            config,
            game,
            frame: 0,
        })
    }

    pub fn demo() -> Self {
        Self::from_config(demo_config()).expect("bundled EutherDogs demo config is valid")
    }

    pub fn reset(&mut self) -> Result<(), ConfigError> {
        self.game = Game::new_mission_from_config(&self.config)?;
        self.frame = 0;
        Ok(())
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
        self.snapshot()
    }

    pub fn purchase(
        &mut self,
        purchase: EutherDogsPurchase,
    ) -> Result<EutherDogsFrame, PurchaseError> {
        self.game.purchase_store_item(
            &self.config.store,
            &purchase.item_id,
            purchase.player.unwrap_or(1).saturating_sub(1) as usize,
        )?;
        Ok(self.snapshot())
    }

    pub fn snapshot(&self) -> EutherDogsFrame {
        eutherdogs_frame(
            &self.game,
            &self.config,
            self.frame,
            self.config.high_score_table().entries().len(),
        )
    }
}

pub fn demo_game() -> Game {
    Game::new_mission_from_config(&demo_config()).expect("bundled EutherDogs demo config is valid")
}

pub fn demo_config() -> EutherDogsConfig {
    EutherDogsConfig::from_toml_str(include_str!("../config/eutherdogs.example.toml"))
        .expect("bundled EutherDogs config parses")
}

pub fn eutherdogs_frame(
    game: &Game,
    config: &EutherDogsConfig,
    frame: u64,
    highscore_count: usize,
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
        highscore_count,
    }
}

fn game_store_items(game: &Game, config: &EutherDogsConfig) -> Vec<EutherDogsStoreItem> {
    let cash = game.summary().progress.cash;
    let player = game
        .characters()
        .iter()
        .find(|character| character.faction == eutherdogs_core::entity::Faction::Player);
    config
        .store
        .iter()
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
                id: item.id.clone(),
                label: item.label.clone(),
                price: item.price,
                detail: item.detail.clone(),
                weapon: item.weapon.clone(),
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
