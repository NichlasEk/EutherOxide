#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetKind {
    Sprite,
    Tile,
    Ui,
    Sfx,
    Music,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum AssetId {
    NightShiftTech,
    NightShiftTechAlt,
    NightShiftTechArmor,
    NightShiftTechAltArmor,
    NeonPharmacist,
    NeonPharmacistAlt,
    NeonPharmacistArmor,
    NeonPharmacistAltArmor,
    ComplianceRunner,
    AngryCustomer,
    ClaimDenier,
    InventoryDrone,
    RecallEnforcer,
    BlackMarketCourier,
    DistrictManager,
    CustomerDefeated,
    ImpactHeavy,
    RxCannon,
    CapsuleLauncher,
    ScannerBlaster,
    LabelPrinterBurst,
    SterilizerSpray,
    NeonLaser,
    ImpactLight,
    WeaponSwitch,
    PortalReady,
    SterileTile,
    PharmacyWall,
    ServiceElevator,
    PickupRx,
}

impl AssetId {
    pub const fn manifest_key(self) -> &'static str {
        match self {
            Self::NightShiftTech => "night_shift_tech",
            Self::NightShiftTechAlt => "night_shift_tech_alt",
            Self::NightShiftTechArmor => "night_shift_tech_armor",
            Self::NightShiftTechAltArmor => "night_shift_tech_alt_armor",
            Self::NeonPharmacist => "neon_pharmacist",
            Self::NeonPharmacistAlt => "neon_pharmacist_alt",
            Self::NeonPharmacistArmor => "neon_pharmacist_armor",
            Self::NeonPharmacistAltArmor => "neon_pharmacist_alt_armor",
            Self::ComplianceRunner => "compliance_runner",
            Self::AngryCustomer => "angry_customer",
            Self::ClaimDenier => "claim_denier",
            Self::InventoryDrone => "inventory_drone",
            Self::RecallEnforcer => "recall_enforcer",
            Self::BlackMarketCourier => "black_market_courier",
            Self::DistrictManager => "district_manager",
            Self::CustomerDefeated => "customer_defeated",
            Self::ImpactHeavy => "impact_heavy",
            Self::RxCannon => "rx_cannon",
            Self::CapsuleLauncher => "capsule_launcher",
            Self::ScannerBlaster => "scanner_blaster",
            Self::LabelPrinterBurst => "label_printer_burst",
            Self::SterilizerSpray => "sterilizer_spray",
            Self::NeonLaser => "neon_laser",
            Self::ImpactLight => "impact_light",
            Self::WeaponSwitch => "weapon_switch",
            Self::PortalReady => "portal_ready",
            Self::SterileTile => "sterile_tile",
            Self::PharmacyWall => "pharmacy_wall",
            Self::ServiceElevator => "service_elevator",
            Self::PickupRx => "pickup_rx",
        }
    }

    pub fn player_from_key(key: &str) -> Option<Self> {
        match key {
            "night_shift_tech" => Some(Self::NightShiftTech),
            "night_shift_tech_alt" => Some(Self::NightShiftTechAlt),
            "night_shift_tech_armor" => Some(Self::NightShiftTechArmor),
            "night_shift_tech_alt_armor" => Some(Self::NightShiftTechAltArmor),
            "neon_pharmacist" => Some(Self::NeonPharmacist),
            "neon_pharmacist_alt" => Some(Self::NeonPharmacistAlt),
            "neon_pharmacist_armor" => Some(Self::NeonPharmacistArmor),
            "neon_pharmacist_alt_armor" => Some(Self::NeonPharmacistAltArmor),
            _ => None,
        }
    }

    pub const fn player_base_key(self) -> Option<&'static str> {
        match self {
            Self::NightShiftTech
            | Self::NightShiftTechAlt
            | Self::NightShiftTechArmor
            | Self::NightShiftTechAltArmor => Some("night_shift_tech"),
            Self::NeonPharmacist
            | Self::NeonPharmacistAlt
            | Self::NeonPharmacistArmor
            | Self::NeonPharmacistAltArmor => Some("neon_pharmacist"),
            _ => None,
        }
    }

    pub const fn with_player_armor(self, armored: bool) -> Self {
        match self {
            Self::NightShiftTech | Self::NightShiftTechArmor => {
                if armored { Self::NightShiftTechArmor } else { Self::NightShiftTech }
            }
            Self::NightShiftTechAlt | Self::NightShiftTechAltArmor => {
                if armored { Self::NightShiftTechAltArmor } else { Self::NightShiftTechAlt }
            }
            Self::NeonPharmacist | Self::NeonPharmacistArmor => {
                if armored { Self::NeonPharmacistArmor } else { Self::NeonPharmacist }
            }
            Self::NeonPharmacistAlt | Self::NeonPharmacistAltArmor => {
                if armored { Self::NeonPharmacistAltArmor } else { Self::NeonPharmacistAlt }
            }
            _ => self,
        }
    }
}
