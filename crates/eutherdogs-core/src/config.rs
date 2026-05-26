use std::{collections::BTreeMap, error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::{
    entity::WeaponSlot,
    game::{MissionRules, ScoringRules},
    highscore::{HighScoreEntry, HighScoreTable, DEFAULT_HIGH_SCORE_LIMIT},
    weapon::WeaponId,
    world::{MissionSpec, WorldParams},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EutherDogsConfig {
    pub settings: ConfigSettings,
    pub player: BTreeMap<String, PlayerConfig>,
    pub store: Vec<ConfigStoreItem>,
    pub scoring: ConfigScoring,
    pub world: ConfigWorld,
    pub highscores: Vec<ConfigHighScoreEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigSettings {
    pub player_count: usize,
    pub starting_mission: i32,
    pub target_count: i32,
    pub object_count: i32,
    pub difficulty: String,
    pub minimum_kills: i32,
    pub time_limit_ticks: u32,
    pub friendly_fire: bool,
    pub highscore_limit: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PlayerConfig {
    pub name: String,
    pub cash: i32,
    pub score: i32,
    pub armor: i32,
    pub lives: i32,
    pub active_weapon: String,
    pub weapons: Vec<ConfigWeaponSlot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigWeaponSlot {
    pub id: String,
    pub ammo: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigStoreItem {
    pub id: String,
    pub label: String,
    pub price: i32,
    pub detail: String,
    pub weapon: Option<String>,
    pub ammo: i32,
    pub armor: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigScoring {
    pub enemy_kill_score: i32,
    pub enemy_kill_cash: i32,
    pub target_score: i32,
    pub target_cash: i32,
    pub pickup_score: i32,
    pub pickup_cash: i32,
    pub time_bonus_divisor: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigWorld {
    pub seed: u64,
    pub wall_count: i32,
    pub wall_length: i32,
    pub room_count: i32,
    pub detail_density: i32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ConfigHighScoreEntry {
    pub name: String,
    pub score: i32,
    pub cash: i32,
    pub mission: i32,
    pub kills: i32,
    pub targets_destroyed: i32,
    pub objects_collected: i32,
    pub elapsed_ticks: u32,
    pub completed: bool,
}

#[derive(Debug)]
pub enum ConfigError {
    Toml(toml::de::Error),
    TomlSerialize(toml::ser::Error),
    UnknownWeapon { player: usize, weapon: String },
    UnknownStoreWeapon { item: String, weapon: String },
}

impl EutherDogsConfig {
    pub fn from_toml_str(input: &str) -> Result<Self, ConfigError> {
        let config = toml::from_str::<Self>(input).map_err(ConfigError::Toml)?;
        config.validate()?;
        Ok(config)
    }

    pub fn to_toml_string(&self) -> Result<String, ConfigError> {
        toml::to_string_pretty(self).map_err(ConfigError::TomlSerialize)
    }

    pub fn seed(&self) -> u64 {
        self.world.seed
    }

    pub fn world_params(&self) -> WorldParams {
        WorldParams {
            wall_count: self.world.wall_count,
            wall_length: self.world.wall_length,
            room_count: self.world.room_count,
            detail_density: self.world.detail_density,
        }
    }

    pub fn mission_spec(&self) -> MissionSpec {
        MissionSpec {
            mission: self.settings.starting_mission.max(1),
            targets: self.settings.target_count.max(0),
            objects: self.settings.object_count.max(0),
        }
    }

    pub fn mission_rules(&self) -> MissionRules {
        MissionRules {
            player_count: self.settings.player_count.clamp(1, 2),
            minimum_kills: self.settings.minimum_kills.max(0),
            time_limit_ticks: (self.settings.time_limit_ticks > 0).then_some(self.settings.time_limit_ticks),
            scoring: self.scoring.into(),
        }
    }

    pub fn player_config(&self, player_number: usize) -> Option<&PlayerConfig> {
        self.player.get(&player_number.to_string())
    }

    pub fn high_score_table(&self) -> HighScoreTable {
        HighScoreTable::merged(
            self.settings.highscore_limit.max(1),
            self.highscores.iter().cloned().map(HighScoreEntry::from),
        )
    }

    fn validate(&self) -> Result<(), ConfigError> {
        for (key, player) in &self.player {
            let player_number = key.parse::<usize>().unwrap_or_default();
            player.weapon_slots(player_number)?;
            player.active_weapon_index(player_number)?;
        }
        for item in &self.store {
            if let Some(weapon) = &item.weapon {
                if WeaponId::from_key(weapon).is_none() {
                    return Err(ConfigError::UnknownStoreWeapon {
                        item: item.id.clone(),
                        weapon: weapon.clone(),
                    });
                }
            }
        }
        Ok(())
    }
}

impl PlayerConfig {
    pub fn weapon_slots(&self, player: usize) -> Result<Vec<WeaponSlot>, ConfigError> {
        let mut slots = Vec::new();
        for slot in &self.weapons {
            let Some(weapon) = WeaponId::from_key(&slot.id) else {
                return Err(ConfigError::UnknownWeapon {
                    player,
                    weapon: slot.id.clone(),
                });
            };
            slots.push(WeaponSlot {
                weapon,
                ammo: slot.ammo,
            });
        }
        if slots.is_empty() {
            slots.push(WeaponSlot {
                weapon: WeaponId::ScannerBlaster,
                ammo: -1,
            });
        }
        Ok(slots)
    }

    pub fn active_weapon_index(&self, player: usize) -> Result<usize, ConfigError> {
        let active_weapon = WeaponId::from_key(&self.active_weapon).ok_or_else(|| ConfigError::UnknownWeapon {
            player,
            weapon: self.active_weapon.clone(),
        })?;
        Ok(self
            .weapon_slots(player)?
            .iter()
            .position(|slot| slot.weapon == active_weapon)
            .unwrap_or(0))
    }
}

impl Default for EutherDogsConfig {
    fn default() -> Self {
        let mut player = BTreeMap::new();
        player.insert("1".to_string(), PlayerConfig::default());
        Self {
            settings: ConfigSettings::default(),
            player,
            store: default_store_items(),
            scoring: ConfigScoring::default(),
            world: ConfigWorld::default(),
            highscores: Vec::new(),
        }
    }
}

impl Default for ConfigSettings {
    fn default() -> Self {
        Self {
            player_count: 1,
            starting_mission: 1,
            target_count: 6,
            object_count: 8,
            difficulty: "normal".to_string(),
            minimum_kills: 0,
            time_limit_ticks: 0,
            friendly_fire: false,
            highscore_limit: DEFAULT_HIGH_SCORE_LIMIT,
        }
    }
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            name: "Night Tech".to_string(),
            cash: 0,
            score: 0,
            armor: 100,
            lives: 3,
            active_weapon: WeaponId::ScannerBlaster.key().to_string(),
            weapons: vec![
                ConfigWeaponSlot {
                    id: WeaponId::ScannerBlaster.key().to_string(),
                    ammo: -1,
                },
                ConfigWeaponSlot {
                    id: WeaponId::RxCannon.key().to_string(),
                    ammo: 12,
                },
            ],
        }
    }
}

impl Default for ConfigStoreItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            price: 0,
            detail: String::new(),
            weapon: None,
            ammo: 0,
            armor: 0,
        }
    }
}

fn default_store_items() -> Vec<ConfigStoreItem> {
    vec![
        ConfigStoreItem {
            id: "label_printer".to_string(),
            label: "Label Printer".to_string(),
            price: 125,
            detail: "Fast short-range sticker burst".to_string(),
            weapon: Some(WeaponId::LabelPrinter.key().to_string()),
            ammo: 80,
            armor: 0,
        },
        ConfigStoreItem {
            id: "sterilizer_spray".to_string(),
            label: "Sterilizer Spray".to_string(),
            price: 175,
            detail: "Wide cone for queue control".to_string(),
            weapon: Some(WeaponId::SterilizerSpray.key().to_string()),
            ammo: 70,
            armor: 0,
        },
        ConfigStoreItem {
            id: "capsule_launcher".to_string(),
            label: "Capsule Launcher".to_string(),
            price: 250,
            detail: "Slow explosive capsule dose".to_string(),
            weapon: Some(WeaponId::CapsuleLauncher.key().to_string()),
            ammo: 12,
            armor: 0,
        },
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

impl Default for ConfigScoring {
    fn default() -> Self {
        ScoringRules::default().into()
    }
}

impl Default for ConfigWorld {
    fn default() -> Self {
        let params = WorldParams::default();
        Self {
            seed: 0xC0FFEE,
            wall_count: params.wall_count,
            wall_length: params.wall_length,
            room_count: params.room_count,
            detail_density: params.detail_density,
        }
    }
}

impl From<ConfigScoring> for ScoringRules {
    fn from(value: ConfigScoring) -> Self {
        Self {
            enemy_kill_score: value.enemy_kill_score,
            enemy_kill_cash: value.enemy_kill_cash,
            target_score: value.target_score,
            target_cash: value.target_cash,
            pickup_score: value.pickup_score,
            pickup_cash: value.pickup_cash,
            time_bonus_divisor: value.time_bonus_divisor.max(1),
        }
    }
}

impl From<ScoringRules> for ConfigScoring {
    fn from(value: ScoringRules) -> Self {
        Self {
            enemy_kill_score: value.enemy_kill_score,
            enemy_kill_cash: value.enemy_kill_cash,
            target_score: value.target_score,
            target_cash: value.target_cash,
            pickup_score: value.pickup_score,
            pickup_cash: value.pickup_cash,
            time_bonus_divisor: value.time_bonus_divisor,
        }
    }
}

impl From<ConfigHighScoreEntry> for HighScoreEntry {
    fn from(value: ConfigHighScoreEntry) -> Self {
        Self {
            name: value.name,
            score: value.score,
            cash: value.cash,
            mission: value.mission,
            kills: value.kills,
            targets_destroyed: value.targets_destroyed,
            objects_collected: value.objects_collected,
            elapsed_ticks: value.elapsed_ticks,
            completed: value.completed,
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Toml(err) => write!(f, "{err}"),
            Self::TomlSerialize(err) => write!(f, "{err}"),
            Self::UnknownWeapon { player, weapon } => {
                write!(f, "unknown weapon `{weapon}` in player {player} config")
            }
            Self::UnknownStoreWeapon { item, weapon } => {
                write!(f, "unknown weapon `{weapon}` in store item `{item}`")
            }
        }
    }
}

impl Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::EutherDogsConfig;
    use crate::{Game, WeaponId};

    #[test]
    fn parses_example_config() {
        let config = EutherDogsConfig::from_toml_str(include_str!("../../../config/eutherdogs.example.toml")).unwrap();

        assert_eq!(config.seed(), 0xC0FFEE);
        assert_eq!(config.mission_rules().player_count, 1);
        assert!(!config.store.is_empty());
        assert_eq!(config.high_score_table().entries()[0].name, "ANON");
    }

    #[test]
    fn config_can_start_a_mission_with_player_values() {
        let config = EutherDogsConfig::from_toml_str(include_str!("../../../config/eutherdogs.example.toml")).unwrap();
        let game = Game::new_mission_from_config(&config).unwrap();
        let player = game.characters().iter().find(|character| character.id == 0).unwrap();

        assert_eq!(player.armor, 100);
        assert_eq!(player.lives, 3);
        assert_eq!(player.weapons[0].weapon, WeaponId::ScannerBlaster);
    }

    #[test]
    fn rejects_unknown_weapon_ids() {
        let err = EutherDogsConfig::from_toml_str(
            r#"
            [player.1]
            active_weapon = "bogus"

            [[player.1.weapons]]
            id = "bogus"
            ammo = 1
            "#,
        )
        .unwrap_err();

        assert!(err.to_string().contains("unknown weapon"));
    }
}
