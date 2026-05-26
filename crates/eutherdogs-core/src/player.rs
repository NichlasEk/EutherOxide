use crate::weapon::WeaponId;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Score {
    pub score: i64,
    pub kills: i64,
    pub targets: i64,
    pub objects: i64,
    pub close_combat: i64,
    pub demolition: i64,
    pub shots_fired: i64,
    pub hits: i64,
    pub hits_taken: i64,
    pub time: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Player {
    pub mission: Score,
    pub total: Score,
    pub cash: i64,
    pub armor: i32,
    pub lives: i32,
    pub close_combat: i32,
    pub weapons: Vec<(WeaponId, i32)>,
    pub playing: bool,
    pub completed: bool,
}
