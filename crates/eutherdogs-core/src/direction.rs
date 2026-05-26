use crate::command::PlayerCommand;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Direction {
    Up = 0,
    UpRight = 1,
    Right = 2,
    DownRight = 3,
    Down = 4,
    DownLeft = 5,
    Left = 6,
    UpLeft = 7,
}

impl Direction {
    pub const fn from_command(command: PlayerCommand) -> Option<Self> {
        match command.movement_bits() {
            PlayerCommand::DOWN => Some(Self::Down),
            PlayerCommand::UP => Some(Self::Up),
            PlayerCommand::LEFT => Some(Self::Left),
            bits if bits == PlayerCommand::DOWN | PlayerCommand::LEFT => Some(Self::DownLeft),
            bits if bits == PlayerCommand::UP | PlayerCommand::LEFT => Some(Self::UpLeft),
            PlayerCommand::RIGHT => Some(Self::Right),
            bits if bits == PlayerCommand::DOWN | PlayerCommand::RIGHT => Some(Self::DownRight),
            bits if bits == PlayerCommand::UP | PlayerCommand::RIGHT => Some(Self::UpRight),
            _ => None,
        }
    }

    pub const fn command_bits(self) -> u8 {
        match self {
            Self::Up => PlayerCommand::UP,
            Self::UpRight => PlayerCommand::UP | PlayerCommand::RIGHT,
            Self::Right => PlayerCommand::RIGHT,
            Self::DownRight => PlayerCommand::DOWN | PlayerCommand::RIGHT,
            Self::Down => PlayerCommand::DOWN,
            Self::DownLeft => PlayerCommand::DOWN | PlayerCommand::LEFT,
            Self::Left => PlayerCommand::LEFT,
            Self::UpLeft => PlayerCommand::UP | PlayerCommand::LEFT,
        }
    }

    pub const fn delta(self) -> (i32, i32) {
        match self {
            Self::Up => (0, -1),
            Self::UpRight => (1, -1),
            Self::Right => (1, 0),
            Self::DownRight => (1, 1),
            Self::Down => (0, 1),
            Self::DownLeft => (-1, 1),
            Self::Left => (-1, 0),
            Self::UpLeft => (-1, -1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Direction;
    use crate::command::PlayerCommand;

    #[test]
    fn maps_original_direction_table() {
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(2)),
            Some(Direction::Up)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(10)),
            Some(Direction::UpRight)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(8)),
            Some(Direction::Right)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(9)),
            Some(Direction::DownRight)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(1)),
            Some(Direction::Down)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(5)),
            Some(Direction::DownLeft)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(4)),
            Some(Direction::Left)
        );
        assert_eq!(
            Direction::from_command(PlayerCommand::from_bits(6)),
            Some(Direction::UpLeft)
        );
    }
}
