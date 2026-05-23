use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Controller {
    pub port_a: u8,
    pub port_b: u8,
    data: u8,
    control: u8,
}

impl Default for Controller {
    fn default() -> Self {
        Self::new()
    }
}

impl Controller {
    pub const UP: u8 = 0x01;
    pub const DOWN: u8 = 0x02;
    pub const LEFT: u8 = 0x04;
    pub const RIGHT: u8 = 0x08;
    pub const BUTTON_A: u8 = 0x10;
    pub const BUTTON_B: u8 = 0x20;
    pub const BUTTON_C: u8 = 0x40;
    pub const START: u8 = 0x80;

    pub fn new() -> Self {
        let mut controller = Self {
            port_a: 0xff,
            port_b: 0xff,
            data: 0x40,
            control: 0x00,
        };
        controller.reset();
        controller
    }

    pub fn reset(&mut self) {
        self.port_a = 0xff;
        self.port_b = 0xff;
        self.data = 0x40;
        self.control = 0x00;
    }

    pub fn set_pressed(&mut self, button: u8, pressed: bool) {
        if pressed {
            self.port_a &= !button;
        } else {
            self.port_a |= button;
        }
    }

    pub fn read_data(&self) -> u8 {
        if self.th_high() {
            self.read_high_th()
        } else {
            self.read_low_th()
        }
    }

    pub fn write_data(&mut self, value: u8) {
        self.data = value & 0x7f;
    }

    pub fn read_control(&self) -> u8 {
        self.control
    }

    pub fn write_control(&mut self, value: u8) {
        self.control = value & 0x7f;
    }

    fn th_high(&self) -> bool {
        (self.data & 0x40) != 0
    }

    fn pressed(&self, button: u8) -> bool {
        (self.port_a & button) == 0
    }

    fn read_high_th(&self) -> u8 {
        let mut value = 0xff;
        if self.pressed(Self::UP) {
            value &= !0x01;
        }
        if self.pressed(Self::DOWN) {
            value &= !0x02;
        }
        if self.pressed(Self::LEFT) {
            value &= !0x04;
        }
        if self.pressed(Self::RIGHT) {
            value &= !0x08;
        }
        if self.pressed(Self::BUTTON_B) {
            value &= !0x10;
        }
        if self.pressed(Self::BUTTON_C) {
            value &= !0x20;
        }
        value | 0x40
    }

    fn read_low_th(&self) -> u8 {
        let mut value = 0xff;
        if self.pressed(Self::UP) {
            value &= !0x01;
        }
        if self.pressed(Self::DOWN) {
            value &= !0x02;
        }
        if self.pressed(Self::BUTTON_A) {
            value &= !0x10;
        }
        if self.pressed(Self::START) {
            value &= !0x20;
        }
        value &= 0xf3;
        value & !0x40
    }
}
