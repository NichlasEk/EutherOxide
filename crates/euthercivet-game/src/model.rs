use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;

const SAVE_PATH: &str = "euther_civet_save.json";

#[derive(Resource, Serialize, Deserialize, Clone)]
pub struct GameState {
    #[serde(default)]
    pub screen: GameScreen,
    #[serde(default)]
    pub current_room: PlantationRoom,
    #[serde(default)]
    pub active_tool_group: ToolGroup,
    pub day: u32,
    #[serde(default)]
    pub day_progress: f32,
    #[serde(default)]
    pub time_scale: TimeScale,
    pub coffee_plants: u32,
    pub civets: u32,
    #[serde(default = "default_civet_names")]
    pub civet_names: Vec<String>,
    #[serde(default = "default_civet_profiles")]
    pub civet_profiles: Vec<CivetProfile>,
    #[serde(default)]
    pub selected_civet: Option<usize>,
    #[serde(default = "default_inventory")]
    pub inventory: Vec<InventoryItem>,
    #[serde(default = "default_player_x")]
    pub player_x: f32,
    #[serde(default = "default_player_y")]
    pub player_y: f32,
    #[serde(default)]
    pub inventory_open: bool,
    #[serde(default)]
    pub settings_open: bool,
    #[serde(default)]
    pub show_layout_guides: bool,
    #[serde(default)]
    pub audio_muted: bool,
    #[serde(default = "default_music_volume")]
    pub music_volume: f32,
    #[serde(default = "default_sfx_volume")]
    pub sfx_volume: f32,
    #[serde(default)]
    pub language: Language,
    pub coffee_fruit: f32,
    pub civet_feed: f32,
    pub processed_beans: f32,
    pub roasted_coffee: f32,
    pub money: i32,
    pub suspicion: f32,
    pub civet_happiness: f32,
    pub reputation: i32,
    pub enclosure_level: u32,
    pub paperwork_level: u32,
    #[serde(default)]
    pub legal_office: bool,
    #[serde(default)]
    pub caretaker: bool,
    #[serde(default)]
    pub fruit_sorter: bool,
    #[serde(default)]
    pub roasting_shed: bool,
    #[serde(default)]
    pub tasting_room: bool,
    pub binturong_home: bool,
    pub goat_present: bool,
    pub inspection: bool,
    #[serde(default)]
    pub daily_modifier: Option<DailyModifier>,
    #[serde(default)]
    pub event: Option<EventState>,
    #[serde(default)]
    pub pending_order: Option<OrderOffer>,
    #[serde(default)]
    pub active_order: Option<OrderOffer>,
    pub daily_sales: i32,
    pub daily_expenses: i32,
    pub day_report: Option<DayReport>,
    pub game_result: Option<GameResult>,
    pub rng_seed: u64,
    pub log: Vec<String>,
    #[serde(skip)]
    pub feedback: Vec<FeedbackToast>,
    #[serde(skip)]
    pub audio_cues: Vec<AudioCue>,
    pub dirty_visuals: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DayReport {
    pub day: u32,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub recommendation: String,
    pub upkeep: i32,
    pub reputation_delta: i32,
    pub suspicion_delta: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum GameResult {
    Won(String),
    Failed(String),
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub enum RandomEventKind {
    PoliceVisit,
    JournalistQuestions,
    WelfareInspection,
    HelicopterOverhead,
    BinturongEscape,
    PickyCivet,
    GoatAppearance,
    TouristGroup,
    VeterinarianOffer,
    Rainstorm,
    InfluencerVisit,
    PaperworkAudit,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EventState {
    pub kind: RandomEventKind,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub due_day: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OrderOffer {
    pub client: String,
    #[serde(default)]
    pub style: OrderStyle,
    pub bags: f32,
    pub payout: i32,
    pub reputation_reward: i32,
    pub suspicion_risk: f32,
    pub due_day: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum OrderStyle {
    #[default]
    Steady,
    Rush,
    Discreet,
    Reputation,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DailyModifier {
    pub kind: DailyModifierKind,
    pub title: String,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum DailyModifierKind {
    RainyHarvest,
    QuietNewsDay,
    BureaucracyDay,
    MarketRush,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CivetProfile {
    pub name: String,
    pub hunger: f32,
    pub mood: f32,
    pub favorite_fruit: String,
    #[serde(default = "default_favorite_care_item")]
    pub favorite_care_item: InventoryItem,
    pub note: String,
    #[serde(default)]
    pub note_sv: String,
}

#[derive(Clone)]
pub struct FeedbackToast {
    pub text: String,
    pub age: f32,
}

#[derive(Clone, Copy)]
pub enum AudioCue {
    UiClick,
    UiHover,
    OrderAccept,
    OrderDecline,
    EventNotice,
    DayReport,
    Suspicion,
    CivetChirp,
    CivetPurr,
    GoatBleat,
    PaperworkStamp,
    CoffeeRoast,
    Cash,
    Rain,
    Camera,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum InventoryItem {
    TinyBrush,
    RibbonCollar,
    FruitPuzzle,
}

fn default_favorite_care_item() -> InventoryItem {
    InventoryItem::TinyBrush
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum GameScreen {
    #[default]
    MainMenu,
    Intro,
    AnimalBook,
    Playing,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum PlantationRoom {
    #[default]
    Sanctuary,
    CoffeeField,
    Roastery,
    PaperworkOffice,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum ToolGroup {
    #[default]
    Care,
    Field,
    Production,
    Compliance,
    Upgrades,
    System,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    English,
    Swedish,
}

impl Default for Language {
    fn default() -> Self {
        Self::from_system_locale()
    }
}

impl Language {
    pub fn from_system_locale() -> Self {
        sys_locale::get_locale()
            .map(|locale| locale.to_ascii_lowercase())
            .filter(|locale| locale.starts_with("sv"))
            .map_or(Language::English, |_| Language::Swedish)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimeScale {
    #[default]
    Normal,
    Fast2,
    Fast4,
    Fast10,
}

impl TimeScale {
    pub fn multiplier(self) -> f32 {
        match self {
            TimeScale::Normal => 1.0,
            TimeScale::Fast2 => 2.0,
            TimeScale::Fast4 => 4.0,
            TimeScale::Fast10 => 10.0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            TimeScale::Normal => "x1",
            TimeScale::Fast2 => "x2",
            TimeScale::Fast4 => "x4",
            TimeScale::Fast10 => "x10",
        }
    }

    pub fn next(self) -> Self {
        match self {
            TimeScale::Normal => TimeScale::Fast2,
            TimeScale::Fast2 => TimeScale::Fast4,
            TimeScale::Fast4 => TimeScale::Fast10,
            TimeScale::Fast10 => TimeScale::Normal,
        }
    }
}

impl Default for GameState {
    fn default() -> Self {
        let language = Language::default();
        Self {
            screen: GameScreen::MainMenu,
            current_room: PlantationRoom::Sanctuary,
            active_tool_group: ToolGroup::Care,
            day: 1,
            day_progress: 0.0,
            time_scale: TimeScale::Normal,
            coffee_plants: 6,
            civets: 3,
            civet_names: default_civet_names(),
            civet_profiles: default_civet_profiles(),
            selected_civet: None,
            inventory: default_inventory(),
            player_x: default_player_x(),
            player_y: default_player_y(),
            inventory_open: false,
            settings_open: false,
            show_layout_guides: false,
            audio_muted: false,
            music_volume: default_music_volume(),
            sfx_volume: default_sfx_volume(),
            language,
            coffee_fruit: 8.0,
            civet_feed: 0.0,
            processed_beans: 0.0,
            roasted_coffee: 0.0,
            money: 160,
            suspicion: 18.0,
            civet_happiness: 72.0,
            reputation: 8,
            enclosure_level: 1,
            paperwork_level: 1,
            legal_office: false,
            caretaker: false,
            fruit_sorter: false,
            roasting_shed: false,
            tasting_room: false,
            binturong_home: true,
            goat_present: true,
            inspection: false,
            daily_modifier: None,
            event: None,
            pending_order: None,
            active_order: None,
            daily_sales: 0,
            daily_expenses: 0,
            day_report: None,
            game_result: None,
            rng_seed: 0xC1FE_CAFE_BA5E_BA11,
            log: initial_log(language),
            feedback: Vec::new(),
            audio_cues: Vec::new(),
            dirty_visuals: true,
        }
    }
}

fn initial_log(language: Language) -> Vec<String> {
    if language == Language::Swedish {
        vec![
            "Välkommen till EutherCivet: rättvist kaffe, misstänkta silhuetter.".to_string(),
            "Påminnelse: inga narkotika. Bara frukt, palmmårdar, bönor och byråkrati.".to_string(),
        ]
    } else {
        vec![
            "Welcome to EutherCivet: fair-trade coffee, suspicious silhouettes.".to_string(),
            "Reminder: no narcotics. Only fruit, civets, beans, and bureaucracy.".to_string(),
        ]
    }
}

pub fn default_civet_names() -> Vec<String> {
    ["Miso", "Kanel", "Beanie"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub fn default_civet_profiles() -> Vec<CivetProfile> {
    [
        (
            "Miso",
            24.0,
            78.0,
            "ruby coffee cherries",
            InventoryItem::TinyBrush,
            "chief fruit critic",
            "chefsgranskare av frukt",
        ),
        (
            "Kanel",
            32.0,
            72.0,
            "soft yellow fruit",
            InventoryItem::RibbonCollar,
            "night-shift bean philosopher",
            "nattskiftets bönfilosof",
        ),
        (
            "Beanie",
            27.0,
            80.0,
            "tiny overripe fruit",
            InventoryItem::FruitPuzzle,
            "small paws, large opinions",
            "små tassar, stora åsikter",
        ),
    ]
    .into_iter()
    .map(
        |(name, hunger, mood, favorite_fruit, favorite_care_item, note, note_sv)| CivetProfile {
            name: name.to_string(),
            hunger,
            mood,
            favorite_fruit: favorite_fruit.to_string(),
            favorite_care_item,
            note: note.to_string(),
            note_sv: note_sv.to_string(),
        },
    )
    .collect()
}

pub fn default_inventory() -> Vec<InventoryItem> {
    vec![
        InventoryItem::TinyBrush,
        InventoryItem::RibbonCollar,
        InventoryItem::FruitPuzzle,
    ]
}

pub fn default_player_x() -> f32 {
    -300.0
}

pub fn default_player_y() -> f32 {
    -244.0
}

pub fn default_music_volume() -> f32 {
    0.42
}

pub fn default_sfx_volume() -> f32 {
    0.70
}

fn short_feedback(line: &str) -> String {
    let first_sentence = line.split('.').next().unwrap_or(line).trim();
    let mut chars = first_sentence.chars();
    let mut text: String = chars.by_ref().take(54).collect();
    if chars.next().is_some() {
        text = text.chars().take(51).collect();
        text.push_str("...");
    }
    text
}

impl GameState {
    pub fn load() -> Option<Self> {
        let text = fs::read_to_string(SAVE_PATH).ok()?;
        let mut state: Self = serde_json::from_str(&text).ok()?;
        state.ensure_civet_profiles();
        if state.inventory.is_empty() {
            state.inventory = default_inventory();
        }
        if let Some(event) = &mut state.event {
            if event.due_day == 0 {
                event.due_day = (state.day + 2).min(7);
            }
        }
        state.log_line(match state.language {
            Language::Swedish => "Laddade plantageboken från disk.",
            Language::English => "Loaded plantation ledger from disk.",
        });
        state.dirty_visuals = true;
        Some(state)
    }

    pub fn save(&mut self) {
        match serde_json::to_string_pretty(self) {
            Ok(text) => {
                if fs::write(SAVE_PATH, text).is_ok() {
                    self.log_line(match self.language {
                        Language::Swedish => "Sparade en oroväckande prydlig plantagebok.",
                        Language::English => "Saved an alarmingly neat plantation ledger.",
                    });
                } else {
                    self.log_line(match self.language {
                        Language::Swedish => "Sparningen misslyckades. Papperslådan kärvade.",
                        Language::English => "Save failed. The paperwork drawer jammed.",
                    });
                }
            }
            _ => self.log_line(match self.language {
                Language::Swedish => "Sparningen misslyckades. Papperslådan kärvade.",
                Language::English => "Save failed. The paperwork drawer jammed.",
            }),
        }
    }

    pub fn log_line(&mut self, line: impl Into<String>) {
        let line = line.into();
        self.feedback.push(FeedbackToast {
            text: short_feedback(&line),
            age: 2.8,
        });
        while self.feedback.len() > 4 {
            self.feedback.remove(0);
        }
        self.log.push(line);
        while self.log.len() > 10 {
            self.log.remove(0);
        }
    }

    pub fn cue_audio(&mut self, cue: AudioCue) {
        self.audio_cues.push(cue);
        while self.audio_cues.len() > 12 {
            self.audio_cues.remove(0);
        }
    }

    pub fn near_civets(&self) -> bool {
        self.current_room == PlantationRoom::Sanctuary
            && (-230.0..=260.0).contains(&self.player_x)
            && (-252.0..=-236.0).contains(&self.player_y)
    }

    pub fn near_field_workbench(&self) -> bool {
        self.current_room == PlantationRoom::CoffeeField
            && (-500.0..=480.0).contains(&self.player_x)
            && (-252.0..=-236.0).contains(&self.player_y)
    }

    pub fn near_roastery(&self) -> bool {
        self.current_room == PlantationRoom::Roastery
            && (-430.0..=360.0).contains(&self.player_x)
            && (-252.0..=-236.0).contains(&self.player_y)
    }

    pub fn near_paperwork_desk(&self) -> bool {
        self.current_room == PlantationRoom::PaperworkOffice
            && (-420.0..=380.0).contains(&self.player_x)
            && (-252.0..=-236.0).contains(&self.player_y)
    }

    pub fn ensure_civet_profiles(&mut self) {
        if self.civet_profiles.is_empty() {
            self.civet_profiles = default_civet_profiles();
        }
        while self.civet_profiles.len() < self.civets as usize {
            let next = self.civet_profiles.len() + 1;
            self.civet_profiles.push(CivetProfile {
                name: format!("Civet {next}"),
                hunger: 35.0,
                mood: 68.0,
                favorite_fruit: "carefully documented coffee fruit".to_string(),
                favorite_care_item: InventoryItem::TinyBrush,
                note: "new sanctuary resident".to_string(),
                note_sv: "ny boende i fristaden".to_string(),
            });
        }
        for profile in &mut self.civet_profiles {
            if profile.note_sv.is_empty() {
                profile.note_sv = profile.note.clone();
            }
        }
        self.civet_names = self
            .civet_profiles
            .iter()
            .map(|profile| profile.name.clone())
            .collect();
        if self
            .selected_civet
            .is_some_and(|idx| idx >= self.civet_profiles.len())
        {
            self.selected_civet = None;
        }
    }

    pub fn clamp(&mut self) {
        self.ensure_civet_profiles();
        for profile in &mut self.civet_profiles {
            profile.hunger = profile.hunger.clamp(0.0, 100.0);
            profile.mood = profile.mood.clamp(0.0, 100.0);
        }
        self.suspicion = self.suspicion.clamp(0.0, 100.0);
        self.civet_happiness = self.civet_happiness.clamp(0.0, 100.0);
        self.music_volume = self.music_volume.clamp(0.0, 1.0);
        self.sfx_volume = self.sfx_volume.clamp(0.0, 1.0);
        if self.suspicion >= 100.0 {
            self.inspection = true;
            self.suspicion = 100.0;
            self.log_line(match self.language {
                Language::Swedish => "Operation Bitter Bean börjar.",
                Language::English => "Operation Bitter Bean begins.",
            });
        }
    }

    pub fn rand_index(&mut self, max: usize) -> usize {
        self.rng_seed = self
            .rng_seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.rng_seed >> 32) as usize) % max
    }
}

#[derive(Resource)]
pub struct GameTick(pub Timer);

#[derive(Resource)]
pub struct EventTick(pub Timer);

#[derive(Resource)]
pub struct DayTick(pub Timer);

#[derive(Resource)]
pub struct OrderTick(pub Timer);

#[cfg(test)]
mod tests {
    use super::short_feedback;

    #[test]
    fn short_feedback_truncates_utf8_safely() {
        let text = "Pappershögen kräver åäö åäö åäö åäö åäö åäö åäö åäö åäö åäö.";
        let feedback = short_feedback(text);
        assert!(feedback.ends_with("..."));
        assert!(feedback.chars().count() <= 54);
    }
}

#[derive(Resource, Clone)]
pub struct CharacterAssets {
    pub texture: Handle<Image>,
    pub atlas: Handle<TextureAtlasLayout>,
}

#[derive(Resource, Clone)]
pub struct PropAssets {
    pub texture: Handle<Image>,
    pub atlas: Handle<TextureAtlasLayout>,
}

#[derive(Resource, Clone)]
pub struct BackgroundAssets {
    pub texture: Handle<Image>,
    pub atlas: Handle<TextureAtlasLayout>,
    pub parallax_texture: Handle<Image>,
    pub parallax_atlas: Handle<TextureAtlasLayout>,
}

#[derive(Resource, Clone)]
pub struct UiSkinAssets {
    pub texture: Handle<Image>,
    pub atlas: Handle<TextureAtlasLayout>,
}

#[derive(Resource, Clone)]
pub struct GameFontAssets {
    pub regular: Handle<Font>,
}

#[derive(Component)]
pub struct StatText(pub StatKind);

#[derive(Component)]
pub struct StatusBar(pub StatusKind);

#[derive(Component)]
pub struct LogText;

#[derive(Component)]
pub struct LocalizedText(pub &'static str);

#[derive(Component)]
pub struct AudioSettingsText;

#[derive(Component)]
pub struct WorldVisual;

#[derive(Component)]
pub struct EnvironmentBackdrop {
    pub phase: usize,
}

#[derive(Component)]
pub struct ParallaxLayer {
    pub base: Vec3,
    pub speed: f32,
    pub amplitude: f32,
}

#[derive(Component)]
pub struct RetroSkyBand {
    pub base: Vec3,
    pub speed: f32,
    pub wave: f32,
    pub wrap_width: f32,
}

#[derive(Component)]
pub struct Helicopter {
    pub offset: Vec3,
}

#[derive(Component)]
pub struct SuspicionGlow;

#[derive(Component)]
pub struct InspectionModal;

#[derive(Component)]
pub struct DayModal;

#[derive(Component, Clone, Copy, PartialEq, Eq)]
pub enum DayModalKind {
    DayReport,
    FinalVerdict,
}

#[derive(Component)]
pub struct EventModal;

#[derive(Component)]
pub struct OrderModal;

#[derive(Component)]
pub struct SettingsModal;

#[derive(Component)]
pub struct ScreenModal;

#[derive(Component)]
pub struct AnimalPanel;

#[derive(Component)]
pub struct FeedbackPanel;

#[derive(Component)]
pub struct CivetClickTarget {
    pub index: usize,
}

#[derive(Component)]
pub struct MovingCivet {
    pub base: Vec3,
    pub phase: f32,
    pub behavior: CivetBehavior,
}

#[derive(Clone, Copy)]
pub enum CivetBehavior {
    Asleep,
    Hungry,
    Curious,
    Content,
}

#[derive(Component)]
pub struct PlayerAvatar {
    pub facing: f32,
    pub moving: bool,
    pub jumping: bool,
}

#[derive(Component)]
pub struct PlayerLabel;

#[derive(Component)]
pub struct PlayerShadow;

#[derive(Component)]
pub struct WorldActionTarget(pub Action);

#[derive(Component, Clone, Copy)]
pub struct ToolActionGroup(pub ToolGroup);

#[derive(Component)]
pub struct InventoryAction;

#[derive(Component, Clone, Copy)]
pub struct ActionButton(pub Action);

#[derive(Component, Clone, Copy)]
pub struct DynamicButtonText(pub Action);

#[allow(dead_code)]
#[derive(Clone, Copy)]
pub enum StatKind {
    Day,
    Clock,
    Plants,
    Civets,
    Fruit,
    Feed,
    Beans,
    Roasted,
    Money,
    Suspicion,
    Happiness,
    Reputation,
    Paperwork,
    Mailbox,
    Upgrades,
    Order,
    Modifier,
    Goal,
}

#[derive(Clone, Copy)]
pub enum StatusKind {
    Suspicion,
    Happiness,
    CoffeePipeline,
}

#[derive(Clone, Copy)]
pub enum Action {
    PlantCoffee,
    HarvestFruit,
    FeedCivets,
    CollectBeans,
    RoastCoffee,
    SellCoffee,
    ImproveEnclosure,
    ShowPaperwork,
    BuildLegalOffice,
    HireCaretaker,
    BuildFruitSorter,
    BuildRoastingShed,
    BuildTastingRoom,
    DeliverOrder,
    GiveFruitFromInventory,
    PickUpBeansToInventory,
    ToggleInventory,
    CycleTimeScale,
    ShowSettings,
    CloseSettings,
    ToggleLayoutGuides,
    ToggleAudioMute,
    MusicVolumeDown,
    MusicVolumeUp,
    SfxVolumeDown,
    SfxVolumeUp,
    SetLanguageEnglish,
    SetLanguageSwedish,
    Save,
    Load,
    StartNewRun,
    FeedSelectedCivet,
    PetSelectedCivet,
    InspectSelectedCivet,
    UseTinyBrush,
    UseRibbonCollar,
    UseFruitPuzzle,
    CloseAnimalPanel,
    GoSanctuary,
    GoCoffeeField,
    GoRoastery,
    GoPaperworkOffice,
    ShowCareTools,
    ShowFieldTools,
    ShowProductionTools,
    ShowComplianceTools,
    ShowUpgradeTools,
    ShowSystemTools,
    StartGame,
    ShowIntro,
    ShowAnimalBook,
    BackToMenu,
    ContinueDay,
    EventOptionA,
    EventOptionB,
    EventOptionC,
    AcceptOrder,
    DeclineOrder,
    InspectPaperwork,
    InspectTasting,
    InspectGoat,
}
