use crate::PlayerCommand;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VirtualStick {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TouchButtons {
    pub shoot: bool,
    pub switch_weapon: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MobileInput {
    pub stick: VirtualStick,
    pub buttons: TouchButtons,
    pub dead_zone: f32,
}

impl Default for MobileInput {
    fn default() -> Self {
        Self {
            stick: VirtualStick::default(),
            buttons: TouchButtons::default(),
            dead_zone: 0.35,
        }
    }
}

impl MobileInput {
    pub fn to_command(self) -> PlayerCommand {
        let mut bits = 0;

        if self.stick.y < -self.dead_zone {
            bits |= PlayerCommand::UP;
        } else if self.stick.y > self.dead_zone {
            bits |= PlayerCommand::DOWN;
        }

        if self.stick.x < -self.dead_zone {
            bits |= PlayerCommand::LEFT;
        } else if self.stick.x > self.dead_zone {
            bits |= PlayerCommand::RIGHT;
        }

        if self.buttons.shoot {
            bits |= PlayerCommand::SHOOT;
        }
        if self.buttons.switch_weapon {
            bits |= PlayerCommand::SWITCH;
        }

        PlayerCommand::from_bits(bits)
    }
}

#[cfg(test)]
mod tests {
    use super::{MobileInput, TouchButtons, VirtualStick};
    use crate::PlayerCommand;

    #[test]
    fn converts_virtual_stick_to_diagonal_command() {
        let command = MobileInput {
            stick: VirtualStick { x: 0.8, y: -0.9 },
            buttons: TouchButtons {
                shoot: true,
                switch_weapon: false,
            },
            dead_zone: 0.35,
        }
        .to_command();

        assert!(command.has(PlayerCommand::RIGHT));
        assert!(command.has(PlayerCommand::UP));
        assert!(command.has(PlayerCommand::SHOOT));
    }

    #[test]
    fn ignores_stick_inside_dead_zone() {
        let command = MobileInput {
            stick: VirtualStick { x: 0.1, y: -0.1 },
            ..MobileInput::default()
        }
        .to_command();

        assert_eq!(command.movement_bits(), 0);
    }
}
