pub const CX_MIN: i32 = 10;
pub const CX_MAX: i32 = 70;
pub const CY_MIN: i32 = 10;
pub const CY_MAX: i32 = 70;

pub const TILE_WIDTH: i32 = 32;
pub const TILE_HEIGHT: i32 = 24;
pub const CHARACTER_WIDTH: i32 = 15;
pub const CHARACTER_HEIGHT: i32 = 20;

use crate::rng::Lcg;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Tile {
    Floor,
    Wall,
    Door,
    SterileFloor,
    NeonFloor,
    WarningFloor,
    FanFloor,
    CorruptMedCabinet,
    HackedVendingUnit,
    RecallCrate,
    ShippingBox,
    ServiceElevator,
    Prescription,
    Folder,
    DataWafer,
    CircuitBoard,
    PillSample,
    LabCoatArmor,
    HazardSleeves,
    PillSplitter,
    ScorchMark,
    SpilledSyrup,
}

impl Tile {
    pub const fn blocks_walk(self) -> bool {
        matches!(
            self,
            Self::Wall
                | Self::Door
                | Self::CorruptMedCabinet
                | Self::HackedVendingUnit
                | Self::RecallCrate
                | Self::ShippingBox
        )
    }

    pub const fn is_pickup(self) -> bool {
        matches!(
            self,
            Self::Prescription
                | Self::Folder
                | Self::DataWafer
                | Self::CircuitBoard
                | Self::PillSample
                | Self::LabCoatArmor
                | Self::HazardSleeves
                | Self::PillSplitter
        )
    }

    pub const fn is_target(self) -> bool {
        matches!(self, Self::CorruptMedCabinet)
    }

    pub const fn is_destructible(self) -> bool {
        matches!(
            self,
            Self::CorruptMedCabinet
                | Self::HackedVendingUnit
                | Self::RecallCrate
                | Self::ShippingBox
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorldParams {
    pub wall_count: i32,
    pub wall_length: i32,
    pub room_count: i32,
    pub detail_density: i32,
}

impl Default for WorldParams {
    fn default() -> Self {
        Self {
            wall_count: 28,
            wall_length: 12,
            room_count: 14,
            detail_density: 24,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MissionSpec {
    pub mission: i32,
    pub targets: i32,
    pub objects: i32,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MissionBuildStats {
    pub targets_left: i32,
    pub objects_to_collect: i32,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Structure {
    pub durability: i32,
    pub wreckage: Option<Tile>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct World {
    width: usize,
    height: usize,
    tiles: Vec<Tile>,
    structures: Vec<Structure>,
    stats: MissionBuildStats,
}

impl World {
    pub fn new(width: usize, height: usize, fill: Tile) -> Self {
        Self {
            width,
            height,
            tiles: vec![fill; width * height],
            structures: vec![Structure::default(); width * height],
            stats: MissionBuildStats::default(),
        }
    }

    pub fn build(seed: u64, params: WorldParams, mission: MissionSpec) -> Self {
        let mut rng = Lcg::new(seed);
        let mut world = Self::new(world_width(), world_height(), Tile::Floor);

        world.add_border();
        for _ in 0..params.room_count {
            world.build_room(&mut rng);
        }
        for _ in 0..=params.wall_count {
            world.build_wall(&mut rng, params.wall_length);
        }
        world.add_exit(&mut rng);
        world.add_targets(&mut rng, mission.targets);
        world.add_details(&mut rng, params.detail_density.max(9));
        world.add_objects(&mut rng, mission.mission, mission.objects);
        world
    }

    pub const fn width(&self) -> usize {
        self.width
    }

    pub const fn height(&self) -> usize {
        self.height
    }

    pub fn tile(&self, x: usize, y: usize) -> Option<Tile> {
        (x < self.width && y < self.height).then(|| self.tiles[y * self.width + x])
    }

    pub fn tiles(&self) -> &[Tile] {
        &self.tiles
    }

    pub fn set_tile(&mut self, x: usize, y: usize, tile: Tile) -> bool {
        if let Some(index) = self.index(x, y) {
            self.tiles[index] = tile;
            true
        } else {
            false
        }
    }

    pub fn structure(&self, x: usize, y: usize) -> Option<Structure> {
        self.index(x, y).map(|index| self.structures[index])
    }

    pub const fn stats(&self) -> MissionBuildStats {
        self.stats
    }

    pub fn collect_tile(&mut self, x: usize, y: usize) -> Option<Tile> {
        let tile = self.tile(x, y)?;
        if tile.is_pickup() {
            self.set_tile(x, y, Tile::Floor);
            if self.stats.objects_to_collect > 0
                && matches!(
                    tile,
                    Tile::Prescription
                        | Tile::Folder
                        | Tile::DataWafer
                        | Tile::CircuitBoard
                        | Tile::PillSample
                )
            {
                self.stats.objects_to_collect -= 1;
            }
            Some(tile)
        } else {
            None
        }
    }

    pub fn damage_structure_at_pixel(&mut self, x: i32, y: i32, damage: i32) -> Option<Tile> {
        if x < 0 || y < 0 {
            return None;
        }
        let tile_x = (x / TILE_WIDTH) as usize;
        let tile_y = (y / TILE_HEIGHT) as usize;
        let tile = self.tile(tile_x, tile_y)?;
        if !tile.is_destructible() {
            return None;
        }

        let index = self.index(tile_x, tile_y)?;
        let structure = &mut self.structures[index];
        structure.durability -= damage;
        if structure.durability > 0 {
            return Some(tile);
        }

        let wreckage = structure.wreckage.unwrap_or(Tile::ScorchMark);
        self.tiles[index] = wreckage;
        self.structures[index] = Structure::default();
        if tile.is_target() && self.stats.targets_left > 0 {
            self.stats.targets_left -= 1;
        }
        Some(tile)
    }

    pub fn blocks_walk(&self, x: usize, y: usize) -> bool {
        self.tile(x, y).map_or(true, Tile::blocks_walk)
    }

    pub fn tile_at_pixel(&self, x: i32, y: i32) -> Option<Tile> {
        if x < 0 || y < 0 {
            return None;
        }
        self.tile((x / TILE_WIDTH) as usize, (y / TILE_HEIGHT) as usize)
    }

    fn index(&self, x: usize, y: usize) -> Option<usize> {
        (x < self.width && y < self.height).then_some(y * self.width + x)
    }

    fn set_structure(&mut self, x: usize, y: usize, structure: Structure) {
        if let Some(index) = self.index(x, y) {
            self.structures[index] = structure;
        }
    }

    fn add_border(&mut self) {
        for x in 0..self.width {
            self.set_tile(x, 0, Tile::Wall);
            self.set_tile(x, self.height - 1, Tile::Wall);
        }
        for y in 0..self.height {
            self.set_tile(0, y, Tile::Wall);
            self.set_tile(self.width - 1, y, Tile::Wall);
        }
    }

    fn build_room(&mut self, rng: &mut Lcg) {
        let mut x = rng.range((self.width as i32 - 10).max(1)) as usize;
        let mut y = rng.range((self.height as i32 - 10).max(1)) as usize;
        if x % 2 == 1 {
            x += 1;
        }
        if y % 2 == 1 {
            y += 1;
        }
        let width = (2 * rng.range(2) + 4) as usize;
        let height = (2 * rng.range(2) + 4) as usize;
        if x < 2
            || y < 2
            || x + width >= self.width - 2
            || y + height >= self.height - 2
            || !self.area_clear(x, y, width, height)
        {
            return;
        }

        for yy in y..=y + height {
            self.set_tile(x, yy, Tile::Wall);
            self.set_tile(x + width, yy, Tile::Wall);
        }
        for xx in x + 1..x + width {
            self.set_tile(xx, y, Tile::Wall);
            self.set_tile(xx, y + height, Tile::Wall);
        }

        let doors = rng.range(15) + 1;
        if doors & 1 != 0 {
            self.set_tile(x, y + height / 2, Tile::Floor);
        }
        if doors & 2 != 0 {
            self.set_tile(x + width, y + height / 2, Tile::Floor);
        }
        if doors & 4 != 0 {
            self.set_tile(x + width / 2, y, Tile::Floor);
        }
        if doors & 8 != 0 {
            self.set_tile(x + width / 2, y + height, Tile::Floor);
        }
    }

    fn build_wall(&mut self, rng: &mut Lcg, wall_length: i32) {
        let x = rng.range((self.width - 2) as i32) + 1;
        let y = rng.range((self.height - 2) as i32) + 1;
        let direction = rng.range(4);
        self.extend_wall(rng, x / 2, y / 2, direction, wall_length);
    }

    fn extend_wall(
        &mut self,
        rng: &mut Lcg,
        mut x: i32,
        mut y: i32,
        direction: i32,
        mut length: i32,
    ) {
        if length <= 0 {
            return;
        }

        let (dx, dy) = match direction {
            0 => (-1, 0),
            1 => (1, 0),
            2 => (0, -1),
            _ => (0, 1),
        };

        while length > 0 {
            let nx = 2 * (x + dx);
            let ny = 2 * (y + dy);
            let mid_x = nx - dx;
            let mid_y = ny - dy;
            if !self.in_bounds(2 * x, 2 * y)
                || !self.in_bounds(nx, ny)
                || !self.in_bounds(mid_x, mid_y)
                || self.tile_i32(nx, ny) != Some(Tile::Floor)
            {
                return;
            }

            self.set_tile_i32(2 * x, 2 * y, Tile::Wall);
            self.set_tile_i32(mid_x, mid_y, Tile::Wall);
            self.set_tile_i32(nx, ny, Tile::Wall);
            x += dx;
            y += dy;
            length -= 1;

            if length > 0 && rng.range(4) == 0 {
                let branch_len = rng.range(length.max(1));
                let branch_direction = rng.range(4);
                self.extend_wall(rng, x, y, branch_direction, branch_len);
                length -= branch_len;
            }
        }
    }

    fn add_exit(&mut self, rng: &mut Lcg) {
        if !self.add_one_object(rng, Tile::ServiceElevator, Structure::default()) {
            let x = 2;
            let y = 2;
            self.set_tile(x, y, Tile::ServiceElevator);
        }
    }

    fn add_targets(&mut self, rng: &mut Lcg, targets: i32) {
        for _ in 0..targets {
            if self.add_one_object(
                rng,
                Tile::CorruptMedCabinet,
                Structure {
                    durability: 250,
                    wreckage: Some(Tile::ScorchMark),
                },
            ) {
                self.stats.targets_left += 1;
            }
        }
    }

    fn add_details(&mut self, rng: &mut Lcg, density: i32) {
        for y in 1..self.height - 1 {
            for x in 1..self.width - 1 {
                if self.tile(x, y) != Some(Tile::Floor) {
                    continue;
                }

                let tile = match rng.range(density) {
                    1 => Some(Tile::SpilledSyrup),
                    2 => Some(Tile::ScorchMark),
                    3 if (x % 2) == (y % 2) => Some(Tile::FanFloor),
                    4 => Some(Tile::HackedVendingUnit),
                    5 => Some(Tile::RecallCrate),
                    6 => Some(Tile::ShippingBox),
                    7 => Some(Tile::NeonFloor),
                    8 => Some(Tile::WarningFloor),
                    _ => None,
                };

                if let Some(tile) = tile {
                    self.set_tile(x, y, tile);
                    if tile.blocks_walk() {
                        self.set_structure(
                            x,
                            y,
                            Structure {
                                durability: 25,
                                wreckage: Some(Tile::ScorchMark),
                            },
                        );
                    }
                }
            }
        }
    }

    fn add_objects(&mut self, rng: &mut Lcg, mission: i32, objects: i32) {
        let mut count = 0;
        let collectible_attempts = (3 * objects).max(10);
        for _ in 0..collectible_attempts {
            let tile = match rng.range(5) {
                0 => Tile::Prescription,
                1 => Tile::Folder,
                2 => Tile::DataWafer,
                3 => Tile::CircuitBoard,
                _ => Tile::PillSample,
            };
            if self.add_one_object(rng, tile, Structure::default()) {
                count += 1;
            }
        }

        self.stats.objects_to_collect = if count > objects * 2 {
            objects
        } else {
            count / 2
        };

        for _ in 0..4 {
            let tile = match rng.range(5) {
                0 => Tile::Prescription,
                1 => Tile::Folder,
                2 => Tile::DataWafer,
                3 => Tile::CircuitBoard,
                _ => Tile::PillSample,
            };
            self.add_one_object(rng, tile, Structure::default());
        }

        for _ in 0..=mission {
            self.add_one_object(rng, Tile::LabCoatArmor, Structure::default());
        }
        self.add_one_object(rng, Tile::HazardSleeves, Structure::default());
        self.add_one_object(rng, Tile::HazardSleeves, Structure::default());
        self.add_one_object(rng, Tile::PillSplitter, Structure::default());
        self.add_one_object(rng, Tile::PillSplitter, Structure::default());
    }

    fn add_one_object(&mut self, rng: &mut Lcg, tile: Tile, structure: Structure) -> bool {
        for _ in 0..100 {
            let x = rng.range(self.width as i32) as usize;
            let y = rng.range(self.height as i32) as usize;
            if self.tile(x, y) == Some(Tile::Floor) {
                self.set_tile(x, y, tile);
                self.set_structure(x, y, structure);
                return true;
            }
        }
        false
    }

    fn area_clear(&self, x_origin: usize, y_origin: usize, width: usize, height: usize) -> bool {
        (x_origin..=x_origin + width)
            .all(|x| (y_origin..=y_origin + height).all(|y| self.tile(x, y) == Some(Tile::Floor)))
    }

    fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height
    }

    fn tile_i32(&self, x: i32, y: i32) -> Option<Tile> {
        self.in_bounds(x, y)
            .then(|| self.tiles[y as usize * self.width + x as usize])
    }

    fn set_tile_i32(&mut self, x: i32, y: i32, tile: Tile) -> bool {
        if self.in_bounds(x, y) {
            self.set_tile(x as usize, y as usize, tile)
        } else {
            false
        }
    }
}

pub const fn world_width() -> usize {
    (CX_MAX - CX_MIN + 1) as usize
}

pub const fn world_height() -> usize {
    (CY_MAX - CY_MIN + 1) as usize
}

#[cfg(test)]
mod tests {
    use super::{MissionSpec, Tile, World, WorldParams, TILE_HEIGHT, TILE_WIDTH};

    #[test]
    fn generated_world_is_deterministic() {
        let a = World::build(
            1234,
            WorldParams::default(),
            MissionSpec {
                mission: 1,
                targets: 4,
                objects: 6,
            },
        );
        let b = World::build(
            1234,
            WorldParams::default(),
            MissionSpec {
                mission: 1,
                targets: 4,
                objects: 6,
            },
        );
        assert_eq!(a, b);
    }

    #[test]
    fn generated_world_has_required_mission_content() {
        let world = World::build(
            42,
            WorldParams::default(),
            MissionSpec {
                mission: 2,
                targets: 5,
                objects: 8,
            },
        );
        let mut tiles = Vec::new();
        for y in 0..world.height() {
            for x in 0..world.width() {
                if let Some(tile) = world.tile(x, y) {
                    tiles.push(tile);
                }
            }
        }

        assert!(tiles.contains(&Tile::ServiceElevator));
        assert!(world.stats().targets_left > 0);
        assert!(world.stats().objects_to_collect > 0);
        assert!(tiles.iter().any(|tile| tile.blocks_walk()));
        assert!(tiles.iter().any(|tile| tile.is_pickup()));
    }

    #[test]
    fn damaging_destructible_tile_leaves_wreckage() {
        let mut world = World::new(4, 4, Tile::Floor);
        world.set_tile(1, 1, Tile::CorruptMedCabinet);
        assert_eq!(
            world.damage_structure_at_pixel(TILE_WIDTH + 1, TILE_HEIGHT + 1, 10),
            Some(Tile::CorruptMedCabinet)
        );
        assert_eq!(world.tile(1, 1), Some(Tile::ScorchMark));
    }
}
