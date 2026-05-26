use crate::world::{World, CHARACTER_HEIGHT, CHARACTER_WIDTH, TILE_HEIGHT, TILE_WIDTH};

pub fn position_ok(world: &World, x: i32, y: i32) -> bool {
    let left = x;
    let right = x + CHARACTER_WIDTH;
    let top = y + 10;
    let bottom = y + CHARACTER_HEIGHT;

    !blocks_pixel(world, left, top)
        && !blocks_pixel(world, right, top)
        && !blocks_pixel(world, left, bottom)
        && !blocks_pixel(world, right, bottom)
}

fn blocks_pixel(world: &World, x: i32, y: i32) -> bool {
    if x < 0 || y < 0 {
        return true;
    }

    let tile_x = (x / TILE_WIDTH) as usize;
    let tile_y = (y / TILE_HEIGHT) as usize;
    world.blocks_walk(tile_x, tile_y)
}

#[cfg(test)]
mod tests {
    use super::position_ok;
    use crate::world::{Tile, World};

    #[test]
    fn blocks_positions_outside_world() {
        let world = World::new(4, 4, Tile::Floor);
        assert!(!position_ok(&world, -1, 10));
    }

    #[test]
    fn blocks_positions_intersecting_walls() {
        let mut world = World::new(4, 4, Tile::Floor);
        world.set_tile(1, 1, Tile::Wall);
        assert!(!position_ok(&world, 32, 24));
    }
}
