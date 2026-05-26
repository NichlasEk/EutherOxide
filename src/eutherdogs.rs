pub use eutherdogs_core::{
    FixedStep, Game, MobileInput, PlayerCommand, PlayerInput, TouchButtons, VirtualStick,
    world::{MissionSpec, WorldParams},
};

pub fn demo_game() -> Game {
    Game::new_mission(
        0xC0FFEE,
        WorldParams::default(),
        MissionSpec {
            mission: 1,
            targets: 6,
            objects: 8,
        },
    )
}
