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
    pub weapons: Vec<WeaponSlot>,
    pub active_weapon: usize,
    pub weapon_cooldown: u8,
    pub sprite: AssetId,
    pub is_target: bool,
    pub alive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeaponSlot {
    pub weapon: WeaponId,
    pub ammo: i32,
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
    pub owner_faction: Faction,
    pub weapon: WeaponId,
}

impl Character {
    pub fn player(id: u32, x: i32, y: i32, sprite: AssetId) -> Self {
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
            weapons: vec![
                WeaponSlot {
                    weapon: WeaponId::ScannerBlaster,
                    ammo: -1,
                },
                WeaponSlot {
                    weapon: WeaponId::RxCannon,
                    ammo: 12,
                },
            ],
            active_weapon: 0,
            weapon_cooldown: 0,
            sprite,
            is_target: false,
            alive: true,
        }
    }

    pub fn hostile_customer(id: u32, x: i32, y: i32, sprite: AssetId) -> Self {
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
            weapons: vec![WeaponSlot {
                weapon: WeaponId::CouponPistol,
                ammo: -1,
            }],
            active_weapon: 0,
            weapon_cooldown: 0,
            sprite,
            is_target: false,
            alive: true,
        }
    }

    pub fn active_weapon_id(&self) -> WeaponId {
        self.weapons
            .get(self.active_weapon)
            .map(|slot| slot.weapon)
            .unwrap_or(self.weapon)
    }

    pub fn switch_weapon(&mut self) {
        if self.weapons.len() <= 1 {
            return;
        }
        for offset in 1..=self.weapons.len() {
            let index = (self.active_weapon + offset) % self.weapons.len();
            if self.weapons[index].ammo != 0 {
                self.active_weapon = index;
                self.weapon = self.weapons[index].weapon;
                return;
            }
        }
    }

    pub fn consume_active_ammo(&mut self) -> bool {
        let Some(slot) = self.weapons.get_mut(self.active_weapon) else {
            return true;
        };
        if slot.ammo == 0 {
            return false;
        }
        if slot.ammo > 0 {
            slot.ammo -= 1;
        }
        true
    }

    pub fn add_weapon_ammo(&mut self, weapon: WeaponId, ammo: i32) {
        if let Some(slot) = self
            .weapons
            .iter_mut()
            .find(|slot| slot.weapon == weapon)
        {
            if slot.ammo >= 0 {
                slot.ammo += ammo;
            }
            return;
        }
        self.weapons.push(WeaponSlot { weapon, ammo });
    }
}
