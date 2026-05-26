pub use eutherdogs_core::{
    ConfigError, EutherDogsConfig, FixedStep, Game, MobileInput, PlayerCommand, PlayerInput,
    TouchButtons, VirtualStick,
    world::{MissionSpec, WorldParams},
};

pub fn demo_game() -> Game {
    Game::new_mission_from_config(&demo_config()).expect("bundled EutherDogs demo config is valid")
}

pub fn demo_config() -> EutherDogsConfig {
    EutherDogsConfig::from_toml_str(include_str!("../config/eutherdogs.example.toml"))
        .expect("bundled EutherDogs config parses")
}
