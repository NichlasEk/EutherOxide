use crate::{
    assets::AssetId,
    collision::position_ok,
    command::PlayerCommand,
    direction::Direction,
    entity::{Bullet, Character, Faction},
    world::{MissionSpec, Tile, World, WorldParams, TILE_HEIGHT, TILE_WIDTH},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixedStep {
    pub ticks: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlayerInput {
    pub player_index: usize,
    pub command: PlayerCommand,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderSnapshot {
    pub characters: Vec<Character>,
    pub bullets: Vec<Bullet>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AudioEvent {
    Sfx(crate::assets::AssetId),
}

#[derive(Clone, Debug)]
pub struct Game {
    world: World,
    characters: Vec<Character>,
    bullets: Vec<Bullet>,
    audio_events: Vec<AudioEvent>,
    next_bullet_id: u32,
}

impl Default for Game {
    fn default() -> Self {
        Self {
            world: World::new(
                crate::world::world_width(),
                crate::world::world_height(),
                Tile::Floor,
            ),
            characters: Vec::new(),
            bullets: Vec::new(),
            audio_events: Vec::new(),
            next_bullet_id: 1,
        }
    }
}

impl Game {
    pub fn new_mission(seed: u64, params: WorldParams, mission: MissionSpec) -> Self {
        let world = World::build(seed, params, mission);
        let mut game = Self {
            world,
            characters: Vec::new(),
            bullets: Vec::new(),
            audio_events: Vec::new(),
            next_bullet_id: 1,
        };
        if let Some((x, y)) = first_spawn_point(&game.world) {
            game.characters
                .push(Character::player(0, x, y, AssetId::NightShiftTech));
        }
        game
    }

    pub fn tick(&mut self, input: &[PlayerInput], dt: FixedStep) {
        for character in &mut self.characters {
            character.weapon_cooldown = character.weapon_cooldown.saturating_sub(dt.ticks as u8);
        }
        for input in input {
            self.apply_player_input(*input, dt);
        }
        self.move_bullets(dt);
    }

    pub fn render_snapshot(&self) -> RenderSnapshot {
        RenderSnapshot {
            characters: self.characters.clone(),
            bullets: self.bullets.clone(),
        }
    }

    pub fn drain_audio_events(&mut self) -> Vec<AudioEvent> {
        self.audio_events.drain(..).collect()
    }

    pub const fn world(&self) -> &World {
        &self.world
    }

    pub fn characters(&self) -> &[Character] {
        &self.characters
    }

    pub fn bullets(&self) -> &[Bullet] {
        &self.bullets
    }

    fn apply_player_input(&mut self, input: PlayerInput, dt: FixedStep) {
        let Some(character_index) = self
            .characters
            .iter()
            .enumerate()
            .filter(|(_, character)| character.faction == Faction::Player)
            .nth(input.player_index)
            .map(|(index, _)| index)
        else {
            return;
        };

        if let Some(direction) = Direction::from_command(input.command) {
            self.move_character(character_index, direction, dt);
        }

        if input.command.has(PlayerCommand::SHOOT) {
            self.fire_weapon(character_index);
        }
    }

    fn move_character(&mut self, character_index: usize, direction: Direction, dt: FixedStep) {
        let character = &mut self.characters[character_index];
        character.direction = direction;
        let (dx, dy) = direction.delta();
        let distance = character.speed * dt.ticks as i32;
        let next_x = character.x + dx * distance;
        let next_y = character.y + dy * distance;

        if position_ok(&self.world, next_x, character.y) {
            character.x = next_x;
        }
        if position_ok(&self.world, character.x, next_y) {
            character.y = next_y;
        }
    }

    fn fire_weapon(&mut self, character_index: usize) {
        let character = &mut self.characters[character_index];
        if character.weapon_cooldown > 0 {
            return;
        }

        let weapon = character.weapon.data();
        let (dx, dy) = character.direction.delta();
        let bullet = Bullet {
            id: self.next_bullet_id,
            x: character.x + crate::world::CHARACTER_WIDTH / 2,
            y: character.y + crate::world::CHARACTER_HEIGHT / 2,
            dx: dx * weapon.speed,
            dy: dy * weapon.speed,
            range: weapon.range,
            owner: character.id,
            weapon: character.weapon,
        };
        self.next_bullet_id += 1;
        character.weapon_cooldown = weapon.rate;
        self.bullets.push(bullet);
        self.audio_events.push(AudioEvent::Sfx(weapon.sound));
    }

    fn move_bullets(&mut self, dt: FixedStep) {
        let mut kept = Vec::with_capacity(self.bullets.len());
        for mut bullet in self.bullets.drain(..) {
            bullet.x += bullet.dx * dt.ticks as i32;
            bullet.y += bullet.dy * dt.ticks as i32;
            bullet.range -= bullet.dx.abs().max(bullet.dy.abs()) * dt.ticks as i32;

            if bullet.range <= 0 || bullet_hits_wall(&self.world, &bullet) {
                self.audio_events
                    .push(AudioEvent::Sfx(AssetId::ImpactLight));
            } else {
                kept.push(bullet);
            }
        }
        self.bullets = kept;
    }
}

fn bullet_hits_wall(world: &World, bullet: &Bullet) -> bool {
    if bullet.x < 0 || bullet.y < 0 {
        return true;
    }
    world.blocks_walk(
        (bullet.x / TILE_WIDTH) as usize,
        (bullet.y / TILE_HEIGHT) as usize,
    )
}

fn first_spawn_point(world: &World) -> Option<(i32, i32)> {
    for y in 1..world.height() - 1 {
        for x in 1..world.width() - 1 {
            if !world.blocks_walk(x, y) {
                return Some((x as i32 * TILE_WIDTH + 8, y as i32 * TILE_HEIGHT + 2));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{FixedStep, Game, PlayerInput};
    use crate::{
        command::PlayerCommand,
        world::{MissionSpec, Tile, WorldParams, TILE_HEIGHT, TILE_WIDTH},
    };

    #[test]
    fn new_mission_spawns_player() {
        let game = Game::new_mission(7, WorldParams::default(), MissionSpec::default());
        assert_eq!(game.characters().len(), 1);
    }

    #[test]
    fn tick_moves_player() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        let before = game.characters()[0].x;
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT),
            }],
            FixedStep { ticks: 1 },
        );
        assert!(game.characters()[0].x > before);
    }

    #[test]
    fn tick_does_not_move_player_through_wall() {
        let mut game = Game::default();
        game.world.set_tile(2, 1, Tile::Wall);
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        let before = game.characters()[0].x;
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT),
            }],
            FixedStep { ticks: 10 },
        );
        assert_eq!(game.characters()[0].x, before);
    }

    #[test]
    fn shoot_spawns_bullet_and_audio_event() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT | PlayerCommand::SHOOT),
            }],
            FixedStep { ticks: 1 },
        );
        assert_eq!(game.bullets().len(), 1);
        assert_eq!(game.drain_audio_events().len(), 1);
    }

    #[test]
    fn bullet_is_removed_when_it_hits_wall() {
        let mut game = Game::default();
        game.world.set_tile(2, 1, Tile::Wall);
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT | PlayerCommand::SHOOT),
            }],
            FixedStep { ticks: 1 },
        );
        game.tick(&[], FixedStep { ticks: 2 });
        assert!(game.bullets().is_empty());
    }
}
