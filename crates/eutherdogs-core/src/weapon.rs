use crate::assets::AssetId;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AnimationMode {
    None,
    Random,
    Sequence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WeaponId {
    RxCannon,
    ScannerBlaster,
    LabelPrinter,
    SterilizerSpray,
    CapsuleLauncher,
    CouponPistol,
    ReceiptGun,
    NeonPriorAuth,
    TurboPriorAuth,
    FormularyZapper,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Weapon {
    pub id: WeaponId,
    pub name: &'static str,
    pub range: i32,
    pub rate: u8,
    pub power: u8,
    pub speed: i32,
    pub radius: i32,
    pub bullet_style: u8,
    pub animation: AnimationMode,
    pub sound: AssetId,
}

pub const WEAPONS: [Weapon; 10] = [
    Weapon::new(
        WeaponId::RxCannon,
        "Rx Cannon",
        70,
        40,
        60,
        10,
        5,
        7,
        AnimationMode::None,
        AssetId::RxCannon,
    ),
    Weapon::new(
        WeaponId::ScannerBlaster,
        "Scanner Blaster",
        50,
        12,
        10,
        8,
        4,
        0,
        AnimationMode::None,
        AssetId::ScannerBlaster,
    ),
    Weapon::new(
        WeaponId::LabelPrinter,
        "Label Printer",
        30,
        7,
        6,
        12,
        3,
        2,
        AnimationMode::None,
        AssetId::LabelPrinterBurst,
    ),
    Weapon::new(
        WeaponId::SterilizerSpray,
        "Sterilizer Spray",
        25,
        7,
        10,
        3,
        10,
        3,
        AnimationMode::Random,
        AssetId::SterilizerSpray,
    ),
    Weapon::new(
        WeaponId::CapsuleLauncher,
        "Capsule Launcher",
        50,
        30,
        40,
        4,
        1,
        4,
        AnimationMode::Sequence,
        AssetId::CapsuleLauncher,
    ),
    Weapon::new(
        WeaponId::CouponPistol,
        "Coupon Pistol",
        110,
        40,
        5,
        4,
        0,
        1,
        AnimationMode::None,
        AssetId::ScannerBlaster,
    ),
    Weapon::new(
        WeaponId::ReceiptGun,
        "Receipt Gun",
        110,
        30,
        3,
        8,
        0,
        6,
        AnimationMode::None,
        AssetId::ScannerBlaster,
    ),
    Weapon::new(
        WeaponId::NeonPriorAuth,
        "Neon Prior Auth",
        100,
        65,
        10,
        10,
        0,
        5,
        AnimationMode::None,
        AssetId::NeonLaser,
    ),
    Weapon::new(
        WeaponId::TurboPriorAuth,
        "Turbo Prior Auth",
        100,
        35,
        8,
        10,
        0,
        5,
        AnimationMode::None,
        AssetId::NeonLaser,
    ),
    Weapon::new(
        WeaponId::FormularyZapper,
        "Formulary Zapper",
        30,
        7,
        10,
        12,
        6,
        8,
        AnimationMode::Sequence,
        AssetId::NeonLaser,
    ),
];

impl Weapon {
    pub const fn new(
        id: WeaponId,
        name: &'static str,
        range: i32,
        rate: u8,
        power: u8,
        speed: i32,
        radius: i32,
        bullet_style: u8,
        animation: AnimationMode,
        sound: AssetId,
    ) -> Self {
        Self {
            id,
            name,
            range,
            rate,
            power,
            speed,
            radius,
            bullet_style,
            animation,
            sound,
        }
    }
}

impl WeaponId {
    pub const fn key(self) -> &'static str {
        match self {
            Self::RxCannon => "rx_cannon",
            Self::ScannerBlaster => "scanner_blaster",
            Self::LabelPrinter => "label_printer",
            Self::SterilizerSpray => "sterilizer_spray",
            Self::CapsuleLauncher => "capsule_launcher",
            Self::CouponPistol => "coupon_pistol",
            Self::ReceiptGun => "receipt_gun",
            Self::NeonPriorAuth => "neon_prior_auth",
            Self::TurboPriorAuth => "turbo_prior_auth",
            Self::FormularyZapper => "formulary_zapper",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "rx_cannon" => Some(Self::RxCannon),
            "scanner_blaster" => Some(Self::ScannerBlaster),
            "label_printer" => Some(Self::LabelPrinter),
            "sterilizer_spray" => Some(Self::SterilizerSpray),
            "capsule_launcher" => Some(Self::CapsuleLauncher),
            "coupon_pistol" => Some(Self::CouponPistol),
            "receipt_gun" => Some(Self::ReceiptGun),
            "neon_prior_auth" => Some(Self::NeonPriorAuth),
            "turbo_prior_auth" => Some(Self::TurboPriorAuth),
            "formulary_zapper" => Some(Self::FormularyZapper),
            _ => None,
        }
    }

    pub const fn index(self) -> usize {
        match self {
            Self::RxCannon => 0,
            Self::ScannerBlaster => 1,
            Self::LabelPrinter => 2,
            Self::SterilizerSpray => 3,
            Self::CapsuleLauncher => 4,
            Self::CouponPistol => 5,
            Self::ReceiptGun => 6,
            Self::NeonPriorAuth => 7,
            Self::TurboPriorAuth => 8,
            Self::FormularyZapper => 9,
        }
    }

    pub const fn data(self) -> &'static Weapon {
        &WEAPONS[self.index()]
    }
}
