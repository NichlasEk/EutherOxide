use crate::{assets::AssetId, direction::Direction, weapon::WeaponId};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Faction {
    Player,
    HostileCustomer,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Character {
    pub id: u32,
    pub faction: Faction,
    pub x: i32,
    pub y: i32,
    pub speed: i32,
    pub direction: Direction,
    pub armor: i32,
    pub lives: i32,
    pub weapon: WeaponId,
    pub weapon_cooldown: u8,
    pub sprite: AssetId,
    pub is_target: bool,
    pub alive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bullet {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub dx: i32,
    pub dy: i32,
    pub range: i32,
    pub owner: u32,
    pub weapon: WeaponId,
}

impl Character {
    pub const fn player(id: u32, x: i32, y: i32, sprite: AssetId) -> Self {
        Self {
            id,
            faction: Faction::Player,
            x,
            y,
            speed: 3,
            direction: Direction::Down,
            armor: 100,
            lives: 3,
            weapon: WeaponId::ScannerBlaster,
            weapon_cooldown: 0,
            sprite,
            is_target: false,
            alive: true,
        }
    }

    pub const fn hostile_customer(id: u32, x: i32, y: i32, sprite: AssetId) -> Self {
        Self {
            id,
            faction: Faction::HostileCustomer,
            x,
            y,
            speed: 2,
            direction: Direction::Down,
            armor: 35,
            lives: 1,
            weapon: WeaponId::CouponPistol,
            weapon_cooldown: 0,
            sprite,
            is_target: false,
            alive: true,
        }
    }
}
