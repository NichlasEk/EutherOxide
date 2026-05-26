use crate::{
    assets::AssetId,
    collision::position_ok,
    command::PlayerCommand,
    direction::Direction,
    entity::{Bullet, Character, Faction},
    rng::Lcg,
    weapon::WeaponId,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MissionStatus {
    Running,
    Won,
    Lost,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MissionProgress {
    pub elapsed_ticks: u32,
    pub score: i32,
    pub cash: i32,
    pub kills: i32,
    pub targets_destroyed: i32,
    pub objects_collected: i32,
    pub shots_fired: i32,
    pub hits: i32,
    pub damage_taken: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MissionRules {
    pub player_count: usize,
    pub minimum_kills: i32,
    pub time_limit_ticks: Option<u32>,
    pub scoring: ScoringRules,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScoringRules {
    pub enemy_kill_score: i32,
    pub enemy_kill_cash: i32,
    pub target_score: i32,
    pub target_cash: i32,
    pub pickup_score: i32,
    pub pickup_cash: i32,
    pub time_bonus_divisor: i32,
}

impl Default for MissionRules {
    fn default() -> Self {
        Self {
            player_count: 1,
            minimum_kills: 0,
            time_limit_ticks: None,
            scoring: ScoringRules::default(),
        }
    }
}

impl Default for ScoringRules {
    fn default() -> Self {
        Self {
            enemy_kill_score: 100,
            enemy_kill_cash: 25,
            target_score: 250,
            target_cash: 50,
            pickup_score: 25,
            pickup_cash: 5,
            time_bonus_divisor: 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MissionSummary {
    pub status: MissionStatus,
    pub progress: MissionProgress,
    pub targets_left: i32,
    pub objects_left: i32,
    pub minimum_kills: i32,
    pub time_remaining_ticks: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct Game {
    world: World,
    characters: Vec<Character>,
    bullets: Vec<Bullet>,
    audio_events: Vec<AudioEvent>,
    next_bullet_id: u32,
    next_character_id: u32,
    rng: Lcg,
    status: MissionStatus,
    progress: MissionProgress,
    mission_goal_count: i32,
    rules: MissionRules,
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
            next_character_id: 1,
            rng: Lcg::new(1),
            status: MissionStatus::Running,
            progress: MissionProgress::default(),
            mission_goal_count: 0,
            rules: MissionRules::default(),
        }
    }
}

impl Game {
    pub fn new_mission(seed: u64, params: WorldParams, mission: MissionSpec) -> Self {
        Self::new_mission_with_rules(seed, params, mission, MissionRules::default())
    }

    pub fn new_mission_with_rules(
        seed: u64,
        params: WorldParams,
        mission: MissionSpec,
        rules: MissionRules,
    ) -> Self {
        let world = World::build(seed, params, mission);
        let mut game = Self {
            world,
            characters: Vec::new(),
            bullets: Vec::new(),
            audio_events: Vec::new(),
            next_bullet_id: 1,
            next_character_id: 1,
            rng: Lcg::new(seed ^ 0xE07A_D065),
            status: MissionStatus::Running,
            progress: MissionProgress::default(),
            mission_goal_count: 0,
            rules,
        };
        game.mission_goal_count =
            game.world.stats().targets_left + game.world.stats().objects_to_collect;
        let player_count = game.rules.player_count.clamp(1, 2);
        for player in 0..player_count {
            if let Some((x, y)) = spawn_point_at(&game.world, player) {
                let sprite = if player == 0 {
                    AssetId::NightShiftTech
                } else {
                    AssetId::NeonPharmacist
                };
                game.characters
                    .push(Character::player(player as u32, x, y, sprite));
                game.next_character_id = player as u32 + 1;
            }
        }
        game.spawn_hostiles((mission.mission + 4).max(4) as usize);
        game
    }

    pub fn new_mission_from_config(config: &crate::config::EutherDogsConfig) -> Result<Self, crate::config::ConfigError> {
        let mut game = Self::new_mission_with_rules(
            config.seed(),
            config.world_params(),
            config.mission_spec(),
            config.mission_rules(),
        );
        game.apply_player_config(config)?;
        Ok(game)
    }

    pub fn spawn_hostiles(&mut self, count: usize) {
        for _ in 0..count {
            if let Some((x, y)) = random_spawn_point(&self.world, &mut self.rng) {
                let sprite = match self.rng.range(4) {
                    0 => AssetId::AngryCustomer,
                    1 => AssetId::ClaimDenier,
                    2 => AssetId::InventoryDrone,
                    _ => AssetId::AngryCustomer,
                };
                self.characters.push(Character::hostile_customer(
                    self.next_character_id,
                    x,
                    y,
                    sprite,
                ));
                self.next_character_id += 1;
            }
        }
    }

    pub fn tick(&mut self, input: &[PlayerInput], dt: FixedStep) {
        if self.status != MissionStatus::Running {
            return;
        }
        self.progress.elapsed_ticks = self.progress.elapsed_ticks.saturating_add(dt.ticks);
        for character in &mut self.characters {
            character.weapon_cooldown = character.weapon_cooldown.saturating_sub(dt.ticks as u8);
        }
        for input in input {
            self.apply_player_input(*input, dt);
        }
        self.move_hostiles(dt);
        self.move_bullets(dt);
        self.collect_pickups();
        self.remove_dead_characters();
        self.update_status();
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

    pub const fn status(&self) -> MissionStatus {
        self.status
    }

    pub const fn progress(&self) -> MissionProgress {
        self.progress
    }

    pub fn summary(&self) -> MissionSummary {
        MissionSummary {
            status: self.status,
            progress: self.progress,
            targets_left: self.world.stats().targets_left,
            objects_left: self.world.stats().objects_to_collect,
            minimum_kills: self.rules.minimum_kills,
            time_remaining_ticks: self
                .rules
                .time_limit_ticks
                .map(|limit| limit.saturating_sub(self.progress.elapsed_ticks)),
        }
    }

    pub fn high_score_entry(&self, name: impl Into<String>, mission: i32) -> crate::HighScoreEntry {
        crate::HighScoreEntry::new(name, mission, self.summary())
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

        if input.command.has(PlayerCommand::SWITCH) {
            self.characters[character_index].switch_weapon();
            self.audio_events.push(AudioEvent::Sfx(AssetId::WeaponSwitch));
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

        let weapon_id = character.active_weapon_id();
        if !character.consume_active_ammo() {
            self.audio_events
                .push(AudioEvent::Sfx(AssetId::ImpactLight));
            return;
        }

        let weapon = weapon_id.data();
        let (dx, dy) = character.direction.delta();
        if dx == 0 && dy == 0 {
            return;
        }
        let bullet = Bullet {
            id: self.next_bullet_id,
            x: character.x + crate::world::CHARACTER_WIDTH / 2,
            y: character.y + crate::world::CHARACTER_HEIGHT / 2,
            dx: dx * weapon.speed,
            dy: dy * weapon.speed,
            range: weapon.range,
            owner: character.id,
            owner_faction: character.faction,
            weapon: weapon_id,
        };
        self.next_bullet_id += 1;
        character.weapon_cooldown = weapon.rate;
        self.bullets.push(bullet);
        self.progress.shots_fired += 1;
        self.audio_events.push(AudioEvent::Sfx(weapon.sound));
    }

    fn move_bullets(&mut self, dt: FixedStep) {
        let bullets = std::mem::take(&mut self.bullets);
        let mut kept = Vec::with_capacity(bullets.len());
        for mut bullet in bullets {
            bullet.x += bullet.dx * dt.ticks as i32;
            bullet.y += bullet.dy * dt.ticks as i32;
            bullet.range -= bullet.dx.abs().max(bullet.dy.abs()) * dt.ticks as i32;

            let weapon = bullet.weapon.data();
            if bullet.range <= 0 {
                self.audio_events
                    .push(AudioEvent::Sfx(AssetId::ImpactLight));
            } else if let Some(hit_index) = bullet_hits_character(&self.characters, &bullet) {
                let damage = weapon.power as i32;
                self.damage_character(hit_index, damage);
                self.apply_area_damage(
                    bullet.x,
                    bullet.y,
                    weapon.radius,
                    damage / 2,
                    bullet.owner_faction,
                );
            } else if bullet_hits_wall(&self.world, &bullet) {
                let old_targets = self.world.stats().targets_left;
                let hit_tile = self
                    .world
                    .damage_structure_at_pixel(bullet.x, bullet.y, weapon.power as i32);
                let new_targets = self.world.stats().targets_left;
                self.progress.targets_destroyed += old_targets - new_targets;
                if old_targets > new_targets {
                    let destroyed = old_targets - new_targets;
                    self.progress.score += self.rules.scoring.target_score * destroyed;
                    self.progress.cash += self.rules.scoring.target_cash * destroyed;
                }
                self.apply_area_damage(
                    bullet.x,
                    bullet.y,
                    weapon.radius,
                    weapon.power as i32 / 2,
                    bullet.owner_faction,
                );
                self.audio_events.push(AudioEvent::Sfx(match hit_tile {
                    Some(tile) if tile.is_destructible() => AssetId::ImpactHeavy,
                    _ => AssetId::ImpactLight,
                }));
            } else {
                kept.push(bullet);
            }
        }
        self.bullets = kept;
    }

    fn move_hostiles(&mut self, dt: FixedStep) {
        let hostile_indices = self
            .characters
            .iter()
            .enumerate()
            .filter(|(_, character)| character.faction == Faction::HostileCustomer && character.alive)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();

        for index in hostile_indices {
            let (x, y) = (self.characters[index].x, self.characters[index].y);
            let Some((player_index, player_x, player_y)) = self.nearest_living_player(x, y) else {
                return;
            };
            if (x - player_x).abs() <= crate::world::CHARACTER_WIDTH
                && (y - player_y).abs() <= crate::world::CHARACTER_HEIGHT
            {
                self.hurt_player_index(player_index, 2 * dt.ticks as i32);
                continue;
            }

            let direction = direction_toward(x, y, player_x, player_y);
            self.characters[index].direction = direction;
            if (x - player_x).abs().max((y - player_y).abs()) < 220
                && self.has_line_of_sight(x, y, player_x, player_y)
            {
                self.fire_weapon(index);
            } else {
                self.move_character(index, direction, dt);
            }
        }
    }

    fn damage_character(&mut self, character_index: usize, damage: i32) {
        let hit = &mut self.characters[character_index];
        hit.armor -= damage;
        self.progress.hits += 1;
        if hit.armor <= 0 {
            hit.alive = false;
            self.progress.kills += i32::from(hit.faction == Faction::HostileCustomer);
            if hit.faction == Faction::HostileCustomer {
                self.progress.score += self.rules.scoring.enemy_kill_score;
                self.progress.cash += self.rules.scoring.enemy_kill_cash;
            }
            self.audio_events
                .push(AudioEvent::Sfx(AssetId::CustomerDefeated));
        } else {
            self.audio_events.push(AudioEvent::Sfx(AssetId::ImpactHeavy));
        }
    }

    fn apply_area_damage(
        &mut self,
        x: i32,
        y: i32,
        radius: i32,
        damage: i32,
        owner_faction: Faction,
    ) {
        if radius <= 0 || damage <= 0 {
            return;
        }
        let radius_px = radius * 4;
        let hit_indices = self
            .characters
            .iter()
            .enumerate()
            .filter(|(_, character)| {
                character.alive
                    && character.faction != owner_faction
                    && (character.x + crate::world::CHARACTER_WIDTH / 2 - x).abs() <= radius_px
                    && (character.y + crate::world::CHARACTER_HEIGHT / 2 - y).abs() <= radius_px
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        for index in hit_indices {
            self.damage_character(index, damage);
        }
    }

    fn hurt_player_index(&mut self, character_index: usize, damage: i32) {
        let Some(character) = self
            .characters
            .get_mut(character_index)
            .filter(|character| character.faction == Faction::Player && character.alive)
        else {
            return;
        };
        character.armor -= damage;
        self.progress.damage_taken += damage;
        if character.armor <= 0 {
            character.lives -= 1;
            if character.lives <= 0 {
                character.alive = false;
            } else {
                character.armor = 100;
            }
        }
    }

    fn collect_pickups(&mut self) {
        for character in &mut self.characters {
            if character.faction != Faction::Player || !character.alive {
                continue;
            }
            let tile_x = ((character.x + crate::world::CHARACTER_WIDTH / 2) / TILE_WIDTH) as usize;
            let tile_y = ((character.y + crate::world::CHARACTER_HEIGHT / 2) / TILE_HEIGHT) as usize;
            let Some(tile) = self.world.collect_tile(tile_x, tile_y) else {
                continue;
            };
            match tile {
                Tile::LabCoatArmor => character.armor += 25,
                Tile::HazardSleeves => character.armor += 50,
                Tile::PillSplitter => {
                    character.add_weapon_ammo(crate::weapon::WeaponId::LabelPrinter, 80);
                    character.switch_weapon();
                }
                Tile::Prescription => {
                    character.add_weapon_ammo(crate::weapon::WeaponId::RxCannon, 4)
                }
                Tile::Folder => {
                    character.add_weapon_ammo(crate::weapon::WeaponId::CapsuleLauncher, 3)
                }
                Tile::DataWafer => {
                    character.add_weapon_ammo(crate::weapon::WeaponId::NeonPriorAuth, 8)
                }
                _ => {
                    self.progress.objects_collected += 1;
                    self.progress.score += self.rules.scoring.pickup_score;
                    self.progress.cash += self.rules.scoring.pickup_cash;
                }
            }
            if matches!(tile, Tile::Prescription | Tile::Folder | Tile::DataWafer) {
                self.progress.objects_collected += 1;
                self.progress.score += self.rules.scoring.pickup_score;
                self.progress.cash += self.rules.scoring.pickup_cash;
            }
            self.audio_events.push(AudioEvent::Sfx(AssetId::PickupRx));
        }
    }

    fn remove_dead_characters(&mut self) {
        self.characters
            .retain(|character| character.alive || character.faction == Faction::Player);
    }

    fn update_status(&mut self) {
        if self
            .rules
            .time_limit_ticks
            .is_some_and(|limit| self.progress.elapsed_ticks >= limit)
        {
            self.status = MissionStatus::Lost;
            return;
        }
        if self
            .characters
            .iter()
            .filter(|character| character.faction == Faction::Player)
            .all(|character| !character.alive)
        {
            self.status = MissionStatus::Lost;
        } else if self.mission_goal_count > 0
            && self.world.stats().targets_left == 0
            && self.world.stats().objects_to_collect == 0
            && self.progress.kills >= self.rules.minimum_kills
            && self.players_on_exit()
        {
            let time_bonus = self.summary().time_remaining_ticks.unwrap_or(0) as i32;
            let divisor = self.rules.scoring.time_bonus_divisor.max(1);
            self.progress.score += time_bonus / divisor;
            self.status = MissionStatus::Won;
        }
    }

    fn apply_player_config(&mut self, config: &crate::config::EutherDogsConfig) -> Result<(), crate::config::ConfigError> {
        for (player_index, character) in self
            .characters
            .iter_mut()
            .filter(|character| character.faction == Faction::Player)
            .enumerate()
        {
            let Some(player) = config.player_config(player_index + 1) else {
                continue;
            };
            character.armor = player.armor.max(1);
            character.lives = player.lives.max(1);
            character.weapons = player.weapon_slots(player_index + 1)?;
            character.active_weapon = player.active_weapon_index(player_index + 1)?;
            character.weapon = character
                .weapons
                .get(character.active_weapon)
                .map(|slot| slot.weapon)
                .unwrap_or(WeaponId::ScannerBlaster);
            if player.score != 0 || player.cash != 0 {
                self.progress.score += player.score;
                self.progress.cash += player.cash;
            }
        }
        Ok(())
    }

    fn players_on_exit(&self) -> bool {
        self.characters
            .iter()
            .filter(|character| character.faction == Faction::Player && character.alive)
            .any(|character| {
                self.world.tile_at_pixel(
                    character.x + crate::world::CHARACTER_WIDTH / 2,
                    character.y + crate::world::CHARACTER_HEIGHT / 2,
                ) == Some(Tile::ServiceElevator)
            })
    }

    fn has_line_of_sight(&self, x: i32, y: i32, target_x: i32, target_y: i32) -> bool {
        let steps = ((target_x - x).abs().max((target_y - y).abs()) / TILE_WIDTH.max(1)).max(1);
        for step in 1..steps {
            let px = x + (target_x - x) * step / steps;
            let py = y + (target_y - y) * step / steps;
            if self.world.tile_at_pixel(px, py).is_some_and(Tile::blocks_walk) {
                return false;
            }
        }
        true
    }

    fn nearest_living_player(&self, x: i32, y: i32) -> Option<(usize, i32, i32)> {
        self.characters
            .iter()
            .enumerate()
            .filter(|(_, character)| character.faction == Faction::Player && character.alive)
            .min_by_key(|(_, character)| (character.x - x).abs() + (character.y - y).abs())
            .map(|(index, character)| (index, character.x, character.y))
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

fn bullet_hits_character(characters: &[Character], bullet: &Bullet) -> Option<usize> {
    characters
        .iter()
        .enumerate()
        .find(|(_, character)| {
            character.alive
                && character.id != bullet.owner
                && character.faction != bullet.owner_faction
                && (character.x + crate::world::CHARACTER_WIDTH / 2 - bullet.x).abs()
                    <= crate::world::CHARACTER_WIDTH
                && (character.y + crate::world::CHARACTER_HEIGHT / 2 - bullet.y).abs()
                    <= crate::world::CHARACTER_HEIGHT
        })
        .map(|(index, _)| index)
}

fn direction_toward(x: i32, y: i32, target_x: i32, target_y: i32) -> Direction {
    match ((target_x - x).signum(), (target_y - y).signum()) {
        (0, -1) => Direction::Up,
        (1, -1) => Direction::UpRight,
        (1, 0) => Direction::Right,
        (1, 1) => Direction::DownRight,
        (0, 1) => Direction::Down,
        (-1, 1) => Direction::DownLeft,
        (-1, 0) => Direction::Left,
        (-1, -1) => Direction::UpLeft,
        _ => Direction::Down,
    }
}

fn spawn_point_at(world: &World, offset: usize) -> Option<(i32, i32)> {
    let mut found = 0;
    for y in 1..world.height() - 1 {
        for x in 1..world.width() - 1 {
            if !world.blocks_walk(x, y) {
                if found == offset {
                    return Some((x as i32 * TILE_WIDTH + 8, y as i32 * TILE_HEIGHT + 2));
                }
                found += 1;
            }
        }
    }
    None
}

fn random_spawn_point(world: &World, rng: &mut Lcg) -> Option<(i32, i32)> {
    for _ in 0..200 {
        let x = rng.range(world.width() as i32) as usize;
        let y = rng.range(world.height() as i32) as usize;
        if x > 1 && y > 1 && x < world.width() - 1 && y < world.height() - 1 && !world.blocks_walk(x, y)
        {
            return Some((x as i32 * TILE_WIDTH + 8, y as i32 * TILE_HEIGHT + 2));
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
        assert!(game.characters().iter().any(|character| character.faction == crate::entity::Faction::Player));
        assert!(game.characters().iter().any(|character| character.faction == crate::entity::Faction::HostileCustomer));
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

    #[test]
    fn bullet_damage_kills_hostile_customer() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        let mut hostile = crate::entity::Character::hostile_customer(
            1,
            TILE_WIDTH + 32,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::AngryCustomer,
        );
        hostile.armor = 10;
        game.characters.push(hostile);
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT | PlayerCommand::SHOOT),
            }],
            FixedStep { ticks: 1 },
        );
        for _ in 0..4 {
            game.tick(&[], FixedStep { ticks: 1 });
        }
        assert!(game.progress().hits > 0);
        assert!(game.progress().kills > 0);
    }

    #[test]
    fn collecting_pickup_updates_progress() {
        let mut game = Game::default();
        game.world.set_tile(1, 1, Tile::Prescription);
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.progress().objects_collected, 1);
        assert_eq!(game.world.tile(1, 1), Some(Tile::Floor));
    }

    #[test]
    fn hostile_contact_damages_player() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.characters.push(crate::entity::Character::hostile_customer(
            1,
            TILE_WIDTH + 10,
            TILE_HEIGHT + 3,
            crate::assets::AssetId::AngryCustomer,
        ));
        let armor = game.characters()[0].armor;
        game.tick(&[], FixedStep { ticks: 1 });
        assert!(game.characters()[0].armor < armor);
        assert!(game.progress().damage_taken > 0);
    }

    #[test]
    fn switch_weapon_changes_active_slot_and_consumes_ammo() {
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
                command: PlayerCommand::from_bits(PlayerCommand::SWITCH),
            }],
            FixedStep { ticks: 1 },
        );
        assert_eq!(
            game.characters()[0].active_weapon_id(),
            crate::weapon::WeaponId::RxCannon
        );
        let ammo = game.characters()[0].weapons[1].ammo;
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT | PlayerCommand::SHOOT),
            }],
            FixedStep { ticks: 1 },
        );
        assert_eq!(game.characters()[0].weapons[1].ammo, ammo - 1);
    }

    #[test]
    fn hostile_with_line_of_sight_fires_at_player() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.characters.push(crate::entity::Character::hostile_customer(
            1,
            TILE_WIDTH * 4 + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::AngryCustomer,
        ));
        game.tick(&[], FixedStep { ticks: 1 });
        assert!(game.progress().shots_fired > 0);
    }

    #[test]
    fn area_damage_hits_nearby_enemy() {
        let mut game = Game::default();
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.characters.push(crate::entity::Character::hostile_customer(
            1,
            TILE_WIDTH * 3,
            TILE_HEIGHT,
            crate::assets::AssetId::AngryCustomer,
        ));
        game.characters.push(crate::entity::Character::hostile_customer(
            2,
            TILE_WIDTH * 3 + 16,
            TILE_HEIGHT,
            crate::assets::AssetId::ClaimDenier,
        ));
        let nearby_armor = game.characters()[2].armor;
        game.bullets.push(crate::entity::Bullet {
            id: 1,
            x: game.characters()[1].x + crate::world::CHARACTER_WIDTH / 2,
            y: game.characters()[1].y + crate::world::CHARACTER_HEIGHT / 2,
            dx: 0,
            dy: 0,
            range: 10,
            owner: 0,
            owner_faction: crate::entity::Faction::Player,
            weapon: crate::weapon::WeaponId::SterilizerSpray,
        });
        game.tick(&[], FixedStep { ticks: 1 });
        assert!(game.characters()[2].armor < nearby_armor);
    }

    #[test]
    fn mission_win_requires_exit_after_goals() {
        let mut game = Game::default();
        game.mission_goal_count = 1;
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Running);

        game.world.set_tile(1, 1, Tile::ServiceElevator);
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Won);
    }

    #[test]
    fn new_mission_can_spawn_two_players() {
        let game = Game::new_mission_with_rules(
            99,
            WorldParams::default(),
            MissionSpec::default(),
            super::MissionRules {
                player_count: 2,
                ..super::MissionRules::default()
            },
        );
        assert_eq!(
            game.characters()
                .iter()
                .filter(|character| character.faction == crate::entity::Faction::Player)
                .count(),
            2
        );
    }

    #[test]
    fn mission_timer_can_fail_running_mission() {
        let mut game = Game::new_mission_with_rules(
            5,
            WorldParams::default(),
            MissionSpec::default(),
            super::MissionRules {
                time_limit_ticks: Some(2),
                ..super::MissionRules::default()
            },
        );
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Running);
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Lost);
        assert_eq!(game.summary().time_remaining_ticks, Some(0));
    }

    #[test]
    fn minimum_kills_gate_mission_win() {
        let mut game = Game::default();
        game.mission_goal_count = 1;
        game.rules.minimum_kills = 1;
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        game.world.set_tile(1, 1, Tile::ServiceElevator);
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Running);

        game.progress.kills = 1;
        game.tick(&[], FixedStep { ticks: 1 });
        assert_eq!(game.status(), super::MissionStatus::Won);
    }

    #[test]
    fn scoring_tracks_kills_and_pickups() {
        let mut game = Game::default();
        game.world.set_tile(1, 1, Tile::Prescription);
        game.characters.push(crate::entity::Character::player(
            0,
            TILE_WIDTH + 8,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::NightShiftTech,
        ));
        let mut hostile = crate::entity::Character::hostile_customer(
            1,
            TILE_WIDTH + 32,
            TILE_HEIGHT + 2,
            crate::assets::AssetId::AngryCustomer,
        );
        hostile.armor = 10;
        game.characters.push(hostile);
        game.tick(&[], FixedStep { ticks: 1 });
        game.tick(
            &[PlayerInput {
                player_index: 0,
                command: PlayerCommand::from_bits(PlayerCommand::RIGHT | PlayerCommand::SHOOT),
            }],
            FixedStep { ticks: 1 },
        );
        for _ in 0..4 {
            game.tick(&[], FixedStep { ticks: 1 });
        }
        assert!(game.progress().score >= 125);
        assert!(game.progress().cash >= 30);
    }

    #[test]
    fn high_score_entry_uses_mission_summary() {
        let mut game = Game::default();
        game.progress.score = 1234;
        game.progress.kills = 7;
        game.progress.elapsed_ticks = 88;
        let entry = game.high_score_entry("Tech", 3);

        assert_eq!(entry.name, "Tech");
        assert_eq!(entry.score, 1234);
        assert_eq!(entry.kills, 7);
        assert_eq!(entry.mission, 3);
        assert!(!entry.completed);
    }
}
