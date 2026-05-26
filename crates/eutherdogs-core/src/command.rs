#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PlayerCommand {
    bits: u8,
}

impl PlayerCommand {
    pub const DOWN: u8 = 0b0000_0001;
    pub const UP: u8 = 0b0000_0010;
    pub const LEFT: u8 = 0b0000_0100;
    pub const RIGHT: u8 = 0b0000_1000;
    pub const SHOOT: u8 = 0b0001_0000;
    pub const SWITCH: u8 = 0b0010_0000;
    pub const FREEZE: u8 = 0b0100_0000;
    pub const NO_TURN: u8 = 0b1000_0000;

    pub const fn empty() -> Self {
        Self { bits: 0 }
    }

    pub const fn from_bits(bits: u8) -> Self {
        Self { bits }
    }

    pub const fn bits(self) -> u8 {
        self.bits
    }

    pub const fn has(self, flag: u8) -> bool {
        self.bits & flag != 0
    }

    pub const fn movement_bits(self) -> u8 {
        self.bits & 0b0000_1111
    }
}

#[cfg(test)]
mod tests {
    use super::PlayerCommand;

    #[test]
    fn masks_movement_bits() {
        let cmd = PlayerCommand::from_bits(PlayerCommand::UP | PlayerCommand::SHOOT);
        assert_eq!(cmd.movement_bits(), PlayerCommand::UP);
        assert!(cmd.has(PlayerCommand::SHOOT));
    }
}
