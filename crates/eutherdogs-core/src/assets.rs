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
    NeonPharmacist,
    ComplianceRunner,
    AngryCustomer,
    ClaimDenier,
    InventoryDrone,
    RxCannon,
    CapsuleLauncher,
    ScannerBlaster,
    LabelPrinterBurst,
    SterilizerSpray,
    NeonLaser,
    ImpactLight,
    SterileTile,
    PharmacyWall,
    ServiceElevator,
    PickupRx,
}

impl AssetId {
    pub const fn manifest_key(self) -> &'static str {
        match self {
            Self::NightShiftTech => "night_shift_tech",
            Self::NeonPharmacist => "neon_pharmacist",
            Self::ComplianceRunner => "compliance_runner",
            Self::AngryCustomer => "angry_customer",
            Self::ClaimDenier => "claim_denier",
            Self::InventoryDrone => "inventory_drone",
            Self::RxCannon => "rx_cannon",
            Self::CapsuleLauncher => "capsule_launcher",
            Self::ScannerBlaster => "scanner_blaster",
            Self::LabelPrinterBurst => "label_printer_burst",
            Self::SterilizerSpray => "sterilizer_spray",
            Self::NeonLaser => "neon_laser",
            Self::ImpactLight => "impact_light",
            Self::SterileTile => "sterile_tile",
            Self::PharmacyWall => "pharmacy_wall",
            Self::ServiceElevator => "service_elevator",
            Self::PickupRx => "pickup_rx",
        }
    }
}
