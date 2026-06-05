use bevy::prelude::*;

use crate::actions::run_action;
use crate::localization::{care_item_name, civet_need_text, civet_status_label};
use crate::model::*;

const PANEL_PAPER: Color = Color::srgba(0.98, 0.84, 0.70, 0.10);
const SKIN_STATS_PANEL: usize = 0;
const SKIN_PAPER_PANEL: usize = 2;
const SKIN_BUTTON: usize = 3;

pub fn spawn_ui(commands: &mut Commands, skin: &UiSkinAssets) {
    commands
        .spawn((
            Node {
                width: percent(100),
                height: percent(100),
                ..default()
            },
            Pickable::IGNORE,
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(14),
                    right: px(14),
                    top: px(10),
                    min_height: px(72),
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    align_items: AlignItems::Center,
                    row_gap: px(6),
                    column_gap: px(10),
                    padding: UiRect::axes(px(14), px(8)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.04, 0.035, 0.025, 0.34)),
                BorderColor::all(Color::srgba(1.0, 0.78, 0.36, 0.24)),
            ))
            .with_children(|hud| {
                hud.spawn((
                    Text::new("EutherCivet"),
                    TextFont {
                        font_size: 27.0,
                        ..default()
                    },
                    TextColor(Color::srgb(1.0, 0.86, 0.42)),
                ));
                hud.spawn((
                    Text::new("Fair-trade coffee. Questionable optics."),
                    TextFont {
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.92, 0.86, 0.68, 0.86)),
                    LocalizedText("tagline"),
                ));

                spawn_bar(hud, "Suspicion", "suspicion", StatusKind::Suspicion);
                spawn_bar(hud, "Civets", "civets", StatusKind::Happiness);
                spawn_bar(hud, "Coffee", "coffee", StatusKind::CoffeePipeline);

                for kind in [
                    StatKind::Day,
                    StatKind::Clock,
                    StatKind::Fruit,
                    StatKind::Beans,
                    StatKind::Roasted,
                    StatKind::Money,
                    StatKind::Suspicion,
                    StatKind::Happiness,
                    StatKind::Reputation,
                    StatKind::Mailbox,
                    StatKind::Order,
                    StatKind::Modifier,
                    StatKind::Goal,
                ] {
                    hud.spawn((
                        Text::new("..."),
                        TextFont {
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::srgba(1.0, 0.94, 0.76, 0.94)),
                        StatText(kind),
                    ));
                }
                spawn_dynamic_button(hud, skin, "Speed x1", Action::CycleTimeScale, 86.0);
            });

            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(14),
                    top: px(92),
                    width: px(500),
                    max_height: px(174),
                    padding: UiRect::all(px(12)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(8)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(5),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.025, 0.022, 0.016, 0.72)),
                BorderColor::all(Color::srgba(1.0, 0.82, 0.48, 0.42)),
            ))
            .with_children(|debug| {
                debug.spawn((
                    Text::new("Logg"),
                    TextFont {
                        font_size: 11.0,
                        ..default()
                    },
                    TextColor(Color::srgba(1.0, 0.84, 0.48, 0.98)),
                    LocalizedText("log"),
                ));
                debug.spawn((
                    Node {
                        flex_direction: FlexDirection::Column,
                        row_gap: px(3),
                        ..default()
                    },
                    LogText,
                ));
            });

            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(145),
                    right: px(145),
                    bottom: px(14),
                    min_height: px(118),
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    row_gap: px(7),
                    column_gap: px(7),
                    padding: UiRect::all(px(10)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.045, 0.032, 0.018, 0.30)),
                BorderColor::all(Color::srgba(1.0, 0.72, 0.32, 0.22)),
            ))
            .with_children(|buttons| {
                for (label, action) in [
                    ("Sanctuary", Action::GoSanctuary),
                    ("Coffee Field", Action::GoCoffeeField),
                    ("Roastery", Action::GoRoastery),
                    ("Paperwork Office", Action::GoPaperworkOffice),
                ] {
                    spawn_dynamic_button(buttons, skin, label, action, 132.0);
                }
                for (label, action) in [
                    ("Care", Action::ShowCareTools),
                    ("Field", Action::ShowFieldTools),
                    ("Production", Action::ShowProductionTools),
                    ("Compliance", Action::ShowComplianceTools),
                    ("Upgrades", Action::ShowUpgradeTools),
                    ("System", Action::ShowSystemTools),
                ] {
                    spawn_dynamic_button(buttons, skin, label, action, 92.0);
                }
                for (label, action, group) in [
                    ("Feed civets", Action::FeedCivets, ToolGroup::Care),
                    (
                        "Improve enclosure",
                        Action::ImproveEnclosure,
                        ToolGroup::Care,
                    ),
                    ("Plant coffee", Action::PlantCoffee, ToolGroup::Field),
                    ("Harvest fruit", Action::HarvestFruit, ToolGroup::Field),
                    ("Collect beans", Action::CollectBeans, ToolGroup::Production),
                    ("Roast coffee", Action::RoastCoffee, ToolGroup::Production),
                    ("Sell coffee", Action::SellCoffee, ToolGroup::Production),
                    ("Deliver order", Action::DeliverOrder, ToolGroup::Production),
                    (
                        "Show paperwork to authorities",
                        Action::ShowPaperwork,
                        ToolGroup::Compliance,
                    ),
                    (
                        "Build legal office",
                        Action::BuildLegalOffice,
                        ToolGroup::Upgrades,
                    ),
                    ("Hire caretaker", Action::HireCaretaker, ToolGroup::Upgrades),
                    (
                        "Build fruit sorter",
                        Action::BuildFruitSorter,
                        ToolGroup::Upgrades,
                    ),
                    (
                        "Build roasting shed",
                        Action::BuildRoastingShed,
                        ToolGroup::Upgrades,
                    ),
                    (
                        "Open tasting room",
                        Action::BuildTastingRoom,
                        ToolGroup::Upgrades,
                    ),
                    ("Save", Action::Save, ToolGroup::System),
                    ("Load", Action::Load, ToolGroup::System),
                    ("Settings", Action::ShowSettings, ToolGroup::System),
                ] {
                    spawn_grouped_dynamic_button(buttons, skin, label, action, group);
                }
                spawn_dynamic_button(
                    buttons,
                    skin,
                    "Inventory sack",
                    Action::ToggleInventory,
                    150.0,
                );
                for (label, action) in [
                    ("Give coffee fruit", Action::GiveFruitFromInventory),
                    ("Pick up beans", Action::PickUpBeansToInventory),
                    ("Tiny brush", Action::UseTinyBrush),
                    ("Ribbon collar", Action::UseRibbonCollar),
                    ("Fruit puzzle", Action::UseFruitPuzzle),
                ] {
                    spawn_inventory_button(buttons, skin, label, action);
                }
            });
        });
}

pub fn apply_text_font(
    fonts: Res<GameFontAssets>,
    mut text_fonts: Query<&mut TextFont, Changed<TextFont>>,
) {
    for mut text_font in &mut text_fonts {
        text_font.font = fonts.regular.clone();
    }
}

fn ui_skin_node(skin: &UiSkinAssets, index: usize, color: Color) -> ImageNode {
    ImageNode::from_atlas_image(
        skin.texture.clone(),
        TextureAtlas {
            layout: skin.atlas.clone(),
            index,
        },
    )
    .with_color(color)
}

fn spawn_dynamic_button(
    parent: &mut ChildSpawnerCommands,
    skin: &UiSkinAssets,
    label: &str,
    action: Action,
    width: f32,
) {
    parent
        .spawn((
            Button,
            Node {
                width: px(width),
                height: px(34),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                padding: UiRect::horizontal(px(8)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(8)),
                ..default()
            },
            BackgroundColor(Color::NONE),
            ui_skin_node(skin, SKIN_BUTTON, button_base_color(action)),
            BorderColor::all(button_border_color(action)),
            ActionButton(action),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font_size: 12.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.92, 0.72)),
                DynamicButtonText(action),
            ));
        });
}

fn spawn_grouped_dynamic_button(
    parent: &mut ChildSpawnerCommands,
    skin: &UiSkinAssets,
    label: &str,
    action: Action,
    group: ToolGroup,
) {
    parent
        .spawn((
            Button,
            Node {
                width: px(210),
                height: px(34),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                padding: UiRect::horizontal(px(8)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(8)),
                ..default()
            },
            BackgroundColor(Color::NONE),
            ui_skin_node(skin, SKIN_BUTTON, button_base_color(action)),
            BorderColor::all(button_border_color(action)),
            ActionButton(action),
            ToolActionGroup(group),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font_size: 12.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.92, 0.72)),
                DynamicButtonText(action),
            ));
        });
}

fn spawn_inventory_button(
    parent: &mut ChildSpawnerCommands,
    skin: &UiSkinAssets,
    label: &str,
    action: Action,
) {
    parent
        .spawn((
            Button,
            Node {
                display: Display::None,
                width: px(138),
                height: px(34),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                padding: UiRect::horizontal(px(8)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(8)),
                ..default()
            },
            BackgroundColor(Color::NONE),
            ui_skin_node(skin, SKIN_BUTTON, button_base_color(action)),
            BorderColor::all(button_border_color(action)),
            ActionButton(action),
            InventoryAction,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font_size: 11.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.92, 0.72)),
                DynamicButtonText(action),
            ));
        });
}

fn spawn_button(
    parent: &mut ChildSpawnerCommands,
    skin: &UiSkinAssets,
    label: &str,
    action: Action,
) {
    parent
        .spawn((
            Button,
            Node {
                width: px(218),
                height: px(42),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                padding: UiRect::horizontal(px(8)),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(8)),
                ..default()
            },
            BackgroundColor(Color::NONE),
            ui_skin_node(skin, SKIN_BUTTON, button_base_color(action)),
            BorderColor::all(button_border_color(action)),
            ActionButton(action),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.92, 0.72)),
            ));
        });
}

fn spawn_bar(parent: &mut ChildSpawnerCommands, label: &str, key: &'static str, kind: StatusKind) {
    parent
        .spawn(Node {
            width: px(128),
            height: px(34),
            flex_direction: FlexDirection::Column,
            row_gap: px(3),
            ..default()
        })
        .with_children(|bar| {
            bar.spawn((
                Text::new(label),
                TextFont {
                    font_size: 11.0,
                    ..default()
                },
                TextColor(Color::srgb(0.88, 0.82, 0.66)),
                LocalizedText(key),
            ));
            bar.spawn((
                Node {
                    width: percent(100),
                    height: px(10),
                    padding: UiRect::all(px(2)),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(5)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.02, 0.025, 0.015, 0.62)),
                BorderColor::all(Color::srgba(1.0, 0.83, 0.42, 0.25)),
            ))
            .with_children(|track| {
                track.spawn((
                    Node {
                        width: percent(10),
                        height: percent(100),
                        ..default()
                    },
                    BackgroundColor(Color::srgb(0.60, 0.20, 0.12)),
                    StatusBar(kind),
                ));
            });
        });
}

fn button_base_color(action: Action) -> Color {
    match action {
        Action::ShowPaperwork | Action::InspectPaperwork => Color::srgb(0.18, 0.34, 0.28),
        Action::SellCoffee | Action::RoastCoffee | Action::InspectTasting => {
            Color::srgb(0.48, 0.31, 0.10)
        }
        Action::Save
        | Action::Load
        | Action::StartNewRun
        | Action::CycleTimeScale
        | Action::ShowSettings
        | Action::CloseSettings
        | Action::ToggleLayoutGuides
        | Action::ToggleAudioMute
        | Action::MusicVolumeDown
        | Action::MusicVolumeUp
        | Action::SfxVolumeDown
        | Action::SfxVolumeUp
        | Action::SetLanguageEnglish
        | Action::SetLanguageSwedish => Color::srgb(0.18, 0.18, 0.18),
        Action::FeedSelectedCivet | Action::PetSelectedCivet | Action::InspectSelectedCivet => {
            Color::srgb(0.24, 0.34, 0.18)
        }
        Action::UseTinyBrush | Action::UseRibbonCollar | Action::UseFruitPuzzle => {
            Color::srgb(0.32, 0.28, 0.16)
        }
        Action::CloseAnimalPanel => Color::srgb(0.18, 0.18, 0.14),
        Action::StartGame
        | Action::ShowIntro
        | Action::ShowAnimalBook
        | Action::BackToMenu
        | Action::ContinueDay => Color::srgb(0.22, 0.38, 0.22),
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => Color::srgb(0.28, 0.18, 0.24),
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => Color::srgb(0.16, 0.22, 0.16),
        Action::DeliverOrder | Action::AcceptOrder => Color::srgb(0.33, 0.34, 0.12),
        Action::GiveFruitFromInventory
        | Action::PickUpBeansToInventory
        | Action::ToggleInventory => Color::srgb(0.36, 0.25, 0.11),
        Action::DeclineOrder => Color::srgb(0.32, 0.16, 0.12),
        Action::BuildLegalOffice
        | Action::HireCaretaker
        | Action::BuildFruitSorter
        | Action::BuildRoastingShed
        | Action::BuildTastingRoom => Color::srgb(0.20, 0.30, 0.18),
        Action::EventOptionA | Action::EventOptionB | Action::EventOptionC => {
            Color::srgb(0.26, 0.25, 0.13)
        }
        Action::InspectGoat => Color::srgb(0.48, 0.16, 0.12),
        _ => Color::srgb(0.33, 0.21, 0.10),
    }
}

fn button_border_color(action: Action) -> Color {
    match action {
        Action::ShowPaperwork | Action::InspectPaperwork => Color::srgba(0.56, 0.86, 0.72, 0.70),
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => Color::srgba(1.0, 0.70, 0.82, 0.56),
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => Color::srgba(0.78, 1.0, 0.64, 0.45),
        Action::Save
        | Action::Load
        | Action::StartNewRun
        | Action::CycleTimeScale
        | Action::ShowSettings
        | Action::CloseSettings
        | Action::ToggleLayoutGuides
        | Action::ToggleAudioMute
        | Action::MusicVolumeDown
        | Action::MusicVolumeUp
        | Action::SfxVolumeDown
        | Action::SfxVolumeUp
        | Action::SetLanguageEnglish
        | Action::SetLanguageSwedish => Color::srgba(0.88, 0.88, 0.78, 0.30),
        _ => Color::srgba(1.0, 0.76, 0.42, 0.50),
    }
}

fn button_lit_color(action: Action) -> Color {
    match action {
        Action::ShowPaperwork | Action::InspectPaperwork => Color::srgb(0.28, 0.52, 0.43),
        Action::SellCoffee | Action::RoastCoffee | Action::InspectTasting => {
            Color::srgb(0.72, 0.43, 0.16)
        }
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => Color::srgb(0.46, 0.26, 0.38),
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => Color::srgb(0.28, 0.43, 0.27),
        _ => Color::srgb(0.62, 0.39, 0.15),
    }
}

fn button_phase(action: Action) -> f32 {
    match action {
        Action::GoSanctuary => 0.0,
        Action::GoCoffeeField => 0.7,
        Action::GoRoastery => 1.4,
        Action::GoPaperworkOffice => 2.1,
        Action::ShowCareTools => 0.3,
        Action::ShowFieldTools => 0.9,
        Action::ShowProductionTools => 1.5,
        Action::ShowComplianceTools => 2.1,
        Action::ShowUpgradeTools => 2.7,
        Action::ShowSystemTools | Action::ShowSettings => 3.3,
        Action::PlantCoffee => 0.2,
        Action::HarvestFruit => 0.8,
        Action::FeedCivets => 1.2,
        Action::CollectBeans => 1.8,
        Action::RoastCoffee => 2.4,
        Action::SellCoffee => 3.0,
        _ => 0.5,
    }
}

fn mix_color(a: Color, b: Color, amount: f32) -> Color {
    let a = a.to_srgba();
    let b = b.to_srgba();
    let t = amount.clamp(0.0, 1.0);
    Color::srgba(
        a.red + (b.red - a.red) * t,
        a.green + (b.green - a.green) * t,
        a.blue + (b.blue - a.blue) * t,
        a.alpha + (b.alpha - a.alpha) * t,
    )
}

pub fn animate_buttons(
    time: Res<Time>,
    state: Res<GameState>,
    mut buttons: Query<
        (
            &ActionButton,
            &Interaction,
            &mut ImageNode,
            &mut BorderColor,
            &mut Node,
        ),
        With<Button>,
    >,
) {
    let t = time.elapsed_secs();
    for (button, interaction, mut image, mut border, mut node) in &mut buttons {
        let available = can_run(button.0, &state);
        let pulse_strength = if state.screen == GameScreen::Playing {
            1.0
        } else {
            0.0
        };
        let pulse = (0.5 + 0.5 * (t * 2.8 + button_phase(button.0)).sin()) * pulse_strength;

        if !available {
            image.color = Color::srgba(0.44, 0.40, 0.34, 0.72);
            *border = BorderColor::all(Color::srgba(0.48, 0.42, 0.32, 0.22));
            node.border = UiRect::all(px(1));
            continue;
        }

        let base = button_base_color(button.0);
        let lit = button_lit_color(button.0);
        let active = is_active_group_action(button.0, &state);
        let amount = match *interaction {
            Interaction::Pressed => 0.92,
            Interaction::Hovered => 0.55 + pulse * 0.18,
            Interaction::None if active => 0.32 + pulse * 0.18,
            Interaction::None => 0.08 + pulse * 0.04,
        };

        image.color = mix_color(base, lit, amount);
        *border = BorderColor::all(mix_color(
            button_border_color(button.0),
            Color::srgba(1.0, 0.92, 0.62, 0.92),
            if active {
                0.55 + pulse * 0.25
            } else {
                amount * 0.55
            },
        ));
        node.border = UiRect::all(px(
            if active || matches!(*interaction, Interaction::Hovered) {
                2
            } else {
                1
            },
        ));
    }
}

pub fn handle_buttons(
    interactions: Query<(&Interaction, &ActionButton), (Changed<Interaction>, With<Button>)>,
    mut state: ResMut<GameState>,
) {
    for (interaction, button) in &interactions {
        if !can_run(button.0, &state) {
            if matches!(*interaction, Interaction::Pressed) {
                let reason = unavailable_reason(button.0, &state);
                state.log_line(reason);
            }
            continue;
        }
        match *interaction {
            Interaction::Pressed => {
                run_action(&mut state, button.0);
            }
            Interaction::Hovered => state.cue_audio(AudioCue::UiHover),
            Interaction::None => {}
        }
    }
}

pub fn update_button_labels(
    state: Res<GameState>,
    mut labels: Query<(&DynamicButtonText, &mut Text)>,
    mut grouped_actions: Query<(&ToolActionGroup, &mut Node)>,
    mut inventory_actions: Query<&mut Node, (With<InventoryAction>, Without<ToolActionGroup>)>,
) {
    if !state.is_changed() {
        return;
    }

    for (dynamic, mut text) in &mut labels {
        **text = action_label(dynamic.0, &state);
    }

    for (group, mut node) in &mut grouped_actions {
        node.display = if group.0 == state.active_tool_group {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in &mut inventory_actions {
        node.display = if state.inventory_open {
            Display::Flex
        } else {
            Display::None
        };
    }
}

fn is_active_group_action(action: Action, state: &GameState) -> bool {
    matches!(
        (action, state.active_tool_group),
        (Action::ShowCareTools, ToolGroup::Care)
            | (Action::ShowFieldTools, ToolGroup::Field)
            | (Action::ShowProductionTools, ToolGroup::Production)
            | (Action::ShowComplianceTools, ToolGroup::Compliance)
            | (Action::ShowUpgradeTools, ToolGroup::Upgrades)
            | (Action::ShowSystemTools, ToolGroup::System)
    )
}

fn tr(state: &GameState, key: &'static str) -> &'static str {
    if state.language == Language::Swedish {
        match key {
            "tagline" => "Rättvis kaffe. Tveksam optik.",
            "suspicion" => "Misstanke",
            "civets" => "Palmmårdar",
            "coffee" => "Kaffe",
            "care" => "Omsorg",
            "field" => "Fält",
            "production" => "Produktion",
            "compliance" => "Papper",
            "upgrades" => "Byggen",
            "system" => "System",
            "settings" => "Inställningar",
            "log" => "Logg",
            "save" => "Spara",
            "load" => "Ladda",
            "plant_coffee" => "Plantera kaffe",
            "harvest_fruit" => "Skörda frukt",
            "feed_civets" => "Mata palmmårdar",
            "collect_beans" => "Samla bönor",
            "sell_coffee" => "Sälj kaffe",
            "deliver_order" => "Leverera order",
            "show_paperwork" => "Visa papper",
            "inventory" => "Inventariesäck",
            "needs_fruit" => "behöver frukt",
            "use_beans_roaster" => "Använd bönor vid rostaren",
            "close_sack" => "Stäng säcken",
            "near_civets" => "nära palmmårdar",
            "near_roastery" => "nära rosteriet",
            "near_field" => "nära fältet",
            "near_office" => "nära kontoret",
            "walk_closer" => "gå närmare",
            "offer_fruit" => "Erbjud frukt från säcken",
            "beans_into_sack" => "Samla bönor i säcken",
            "start_new_run" => "Starta ny omgång",
            "speed" => "Hastighet",
            "close" => "Stäng",
            "hide_layout_guides" => "Dölj layoutguider",
            "show_layout_guides" => "Visa layoutguider",
            "feed_tray" => "Mata med fruktbricka",
            "pet_gently" => "Klappa försiktigt",
            "inspect_notes" => "Granska anteckningar",
            "tiny_brush" => "Liten borste",
            "ribbon_collar" => "Rosetthalsband",
            "fruit_puzzle" => "Fruktpussel",
            "built" => "byggt",
            "final_report" => "Slutrapport",
            "day" => "Dag",
            "plants" => "Plantor",
            "fruit" => "Frukt",
            "feed" => "Foder",
            "beans" => "Bönor",
            "roast" => "Rostat",
            "happy" => "Nöjda",
            "rep" => "Rykte",
            "paper" => "Papper",
            "mail" => "Post",
            "order" => "Order",
            "modifier" => "Läge",
            "missing" => "saknas",
            "days_left" => "Dagar kvar",
            "offer" => "erbjudande",
            "none" => "ingen",
            "settings_language" => "Språk: Svenska",
            "audio" => "Ljud",
            "music" => "Musik",
            "sfx" => "Effekter",
            "audio_mute" => "Stäng av ljud",
            "audio_enable" => "Slå på ljud",
            "volume_down" => "-",
            "volume_up" => "+",
            "english" => "Engelska",
            "swedish" => "Svenska",
            "paperwork_inbox" => "Pappersinkorg",
            "no_letters" => "Inga brev. Kontoret doftar svagt av frimärken.",
            "operation_bitter_bean" => "Operation Bitter Bean",
            "show_paperwork_btn" => "Visa papper",
            "coffee_tasting" => "Erbjud kaffeprovning",
            "blame_goat" => "Skyll på geten",
            "begin_next_day" => "Börja nästa dag",
            "view_final_verdict" => "Visa slutomdöme",
            "load_save" => "Ladda sparfil",
            "back_to_menu" => "Till huvudmeny",
            "sanctuary" => "Fristad",
            "coffee_field" => "Kaffefält",
            "roastery" => "Rosteri",
            "paperwork_office" => "Papperskontor",
            "legal_office" => "Juridiskt kontor",
            "caretaker" => "Djurskötare",
            "fruit_sorter" => "Fruktsorterare",
            "roasting_shed" => "Rostningsskjul",
            "tasting_room" => "Provsmakningsrum",
            "inspection_body" => {
                "Myndigheterna gör razzia på plantagen i väntan på narkotika. De hittar kaffe, palmmårdar, extremt detaljerade papper och en misstänkt get."
            }
            "upkeep_charged" => "Drift debiterad",
            "official_memo" => "Officiellt memo: alla bönor är fortfarande juridiskt bönor.",
            "weekly_won" => "Veckoomdöme: Operativt legitimt",
            "weekly_failed" => "Veckoomdöme: Styrelsen är oroad",
            "archive_result" => {
                "Arkivera resultatet, ladda en sparfil eller börja om med rena böcker."
            }
            "premium_contract" => "Premiumkontrakt för kaffe",
            "accept_contract" => "Acceptera kontrakt",
            "decline_politely" => "Avböj artigt",
            "order_wants" => "vill ha",
            "roasted_bags_by_day" => "rostade säckar till dag",
            "payout" => "Utbetalning",
            "reputation" => "rykte",
            "legitimate_contract" => "Legitimt kontrakt. Ordet 'diskret' förekommer sju gånger.",
            "mood" => "Humör",
            "hunger" => "Hunger",
            "favorite" => "Favorit",
            "favorite_care" => "Favoritomsorg",
            "status" => "Status",
            "need" => "Behov",
            "goal" => "Mål",
            "goal_inspection" => "Hantera Operation Bitter Bean",
            "goal_reduce_suspicion" => "Sänk misstanken med papper eller provsmakning",
            "goal_read_report" => "Läs dagsrapporten",
            "goal_check_mail" => "Gå till kontoret och hantera posten",
            "goal_feed_civets" => "Mata palmmårdarna",
            "goal_roast_order" => "Rosta kaffe till ordern",
            "goal_deliver_order" => "Leverera den aktiva ordern",
            "goal_roast_beans" => "Rosta processade bönor",
            "goal_sell_coffee" => "Sälj rostat kaffe",
            "goal_feed_or_harvest" => "Mata djuren eller skörda mer frukt",
            "goal_grow_pipeline" => "Bygg upp kaffeproduktionen",
            "recommendation" => "Rekommendation",
            _ => key,
        }
    } else {
        match key {
            "tagline" => "Fair-trade coffee. Questionable optics.",
            "suspicion" => "Suspicion",
            "civets" => "Civets",
            "coffee" => "Coffee",
            "care" => "Care",
            "field" => "Field",
            "production" => "Production",
            "compliance" => "Compliance",
            "upgrades" => "Upgrades",
            "system" => "System",
            "settings" => "Settings",
            "log" => "Log",
            "save" => "Save",
            "load" => "Load",
            "plant_coffee" => "Plant coffee",
            "harvest_fruit" => "Harvest fruit",
            "feed_civets" => "Feed civets",
            "collect_beans" => "Collect beans",
            "sell_coffee" => "Sell coffee",
            "deliver_order" => "Deliver order",
            "show_paperwork" => "Show paperwork",
            "inventory" => "Inventory sack",
            "needs_fruit" => "needs fruit",
            "use_beans_roaster" => "Use beans at roaster",
            "close_sack" => "Close sack",
            "near_civets" => "near civets",
            "near_roastery" => "near roastery",
            "near_field" => "near field",
            "near_office" => "near office",
            "walk_closer" => "walk closer",
            "offer_fruit" => "Offer fruit from sack",
            "beans_into_sack" => "Collect beans into sack",
            "start_new_run" => "Start new run",
            "speed" => "Speed",
            "close" => "Close",
            "hide_layout_guides" => "Hide layout guides",
            "show_layout_guides" => "Show layout guides",
            "feed_tray" => "Feed fruit tray",
            "pet_gently" => "Pet gently",
            "inspect_notes" => "Inspect notes",
            "tiny_brush" => "Tiny brush",
            "ribbon_collar" => "Ribbon collar",
            "fruit_puzzle" => "Fruit puzzle",
            "built" => "built",
            "final_report" => "Final report",
            "day" => "Day",
            "plants" => "Plants",
            "fruit" => "Fruit",
            "feed" => "Feed",
            "beans" => "Beans",
            "roast" => "Roast",
            "happy" => "Happy",
            "rep" => "Rep",
            "paper" => "Paper",
            "mail" => "Mail",
            "order" => "Order",
            "modifier" => "Modifier",
            "missing" => "missing",
            "days_left" => "Days left",
            "offer" => "offer",
            "none" => "none",
            "settings_language" => "Language: English",
            "audio" => "Audio",
            "music" => "Music",
            "sfx" => "SFX",
            "audio_mute" => "Mute audio",
            "audio_enable" => "Enable audio",
            "volume_down" => "-",
            "volume_up" => "+",
            "english" => "English",
            "swedish" => "Svenska",
            "paperwork_inbox" => "Paperwork Inbox",
            "no_letters" => "No letters. The office smells faintly of stamps.",
            "operation_bitter_bean" => "Operation Bitter Bean",
            "show_paperwork_btn" => "Show paperwork",
            "coffee_tasting" => "Offer coffee tasting",
            "blame_goat" => "Blame the goat",
            "begin_next_day" => "Begin next day",
            "view_final_verdict" => "View final verdict",
            "load_save" => "Load save",
            "back_to_menu" => "Back to menu",
            "sanctuary" => "Sanctuary",
            "coffee_field" => "Coffee Field",
            "roastery" => "Roastery",
            "paperwork_office" => "Paperwork Office",
            "legal_office" => "Legal office",
            "caretaker" => "Caretaker",
            "fruit_sorter" => "Fruit sorter",
            "roasting_shed" => "Roasting shed",
            "tasting_room" => "Tasting room",
            "inspection_body" => {
                "Authorities raid the plantation expecting narcotics. They find coffee, civets, extremely detailed paperwork, and one suspicious goat."
            }
            "upkeep_charged" => "Upkeep charged",
            "official_memo" => "Official memo: all beans remain legally beans.",
            "weekly_won" => "Weekly Verdict: Operationally Legitimate",
            "weekly_failed" => "Weekly Verdict: Board-Level Concern",
            "archive_result" => {
                "Archive the result, load a save, or begin again with clean ledgers."
            }
            "premium_contract" => "Premium Coffee Contract",
            "accept_contract" => "Accept contract",
            "decline_politely" => "Decline politely",
            "order_wants" => "wants",
            "roasted_bags_by_day" => "roasted bags by day",
            "payout" => "Payout",
            "reputation" => "reputation",
            "legitimate_contract" => {
                "Legitimate contract. The word 'discreet' appears seven times."
            }
            "mood" => "Mood",
            "hunger" => "Hunger",
            "favorite" => "Favorite",
            "favorite_care" => "Favorite care",
            "status" => "Status",
            "need" => "Need",
            "goal" => "Goal",
            "goal_inspection" => "Handle Operation Bitter Bean",
            "goal_reduce_suspicion" => "Lower suspicion with paperwork or a tasting",
            "goal_read_report" => "Read the day report",
            "goal_check_mail" => "Go to the office and handle mail",
            "goal_feed_civets" => "Feed the civets",
            "goal_roast_order" => "Roast coffee for the order",
            "goal_deliver_order" => "Deliver the active order",
            "goal_roast_beans" => "Roast processed beans",
            "goal_sell_coffee" => "Sell roasted coffee",
            "goal_feed_or_harvest" => "Feed the animals or harvest more fruit",
            "goal_grow_pipeline" => "Build the coffee pipeline",
            "recommendation" => "Recommendation",
            _ => key,
        }
    }
}

fn room_tr(state: &GameState, room: PlantationRoom) -> &'static str {
    match room {
        PlantationRoom::Sanctuary => tr(state, "sanctuary"),
        PlantationRoom::CoffeeField => tr(state, "coffee_field"),
        PlantationRoom::Roastery => tr(state, "roastery"),
        PlantationRoom::PaperworkOffice => tr(state, "paperwork_office"),
    }
}

fn action_label(action: Action, state: &GameState) -> String {
    match action {
        Action::PlantCoffee => format!("{} ($14)", tr(state, "plant_coffee")),
        Action::HarvestFruit => {
            format!(
                "{} (+{:.0})",
                tr(state, "harvest_fruit"),
                state.coffee_plants as f32 * 1.6
            )
        }
        Action::FeedCivets => format!(
            "{} ({})",
            tr(state, "feed_civets"),
            tr(state, "needs_fruit")
        ),
        Action::CollectBeans => tr(state, "collect_beans").to_string(),
        Action::RoastCoffee => {
            let rate = if state.roasting_shed { "96%" } else { "82%" };
            format!("{} ({rate})", tr(state, "use_beans_roaster"))
        }
        Action::SellCoffee => {
            let bonus = if state.tasting_room { "+ tasting" } else { "" };
            format!("{} {bonus}", tr(state, "sell_coffee"))
        }
        Action::DeliverOrder => tr(state, "deliver_order").to_string(),
        Action::ToggleInventory => {
            let where_hint = if state.near_civets() {
                tr(state, "near_civets")
            } else if state.near_roastery() {
                tr(state, "near_roastery")
            } else if state.near_field_workbench() {
                tr(state, "near_field")
            } else if state.near_paperwork_desk() {
                tr(state, "near_office")
            } else {
                tr(state, "walk_closer")
            };
            if state.inventory_open {
                format!("{} ({where_hint})", tr(state, "close_sack"))
            } else {
                format!(
                    "{} ({:.0} fruit, {:.1} beans, {where_hint})",
                    tr(state, "inventory"),
                    state.coffee_fruit,
                    state.processed_beans
                )
            }
        }
        Action::GiveFruitFromInventory => {
            format!("{} ({:.0})", tr(state, "offer_fruit"), state.coffee_fruit)
        }
        Action::PickUpBeansToInventory => {
            format!(
                "{} ({:.1})",
                tr(state, "beans_into_sack"),
                state.processed_beans
            )
        }
        Action::ImproveEnclosure => {
            format!(
                "Improve enclosure (${})",
                45 + state.enclosure_level as i32 * 20
            )
        }
        Action::ShowPaperwork => {
            let cost = if state.legal_office {
                8 + state.paperwork_level as i32 * 2
            } else {
                16 + state.paperwork_level as i32 * 3
            };
            format!("{} (${cost})", tr(state, "show_paperwork"))
        }
        Action::BuildLegalOffice => upgrade_label(state, "legal_office", 110, state.legal_office),
        Action::HireCaretaker => upgrade_label(state, "caretaker", 85, state.caretaker),
        Action::BuildFruitSorter => upgrade_label(state, "fruit_sorter", 95, state.fruit_sorter),
        Action::BuildRoastingShed => {
            upgrade_label(state, "roasting_shed", 125, state.roasting_shed)
        }
        Action::BuildTastingRoom => upgrade_label(state, "tasting_room", 140, state.tasting_room),
        Action::Save => tr(state, "save").to_string(),
        Action::Load => tr(state, "load").to_string(),
        Action::StartNewRun => tr(state, "start_new_run").to_string(),
        Action::CycleTimeScale => format!("{} {}", tr(state, "speed"), state.time_scale.label()),
        Action::ShowSettings => tr(state, "settings").to_string(),
        Action::CloseSettings => tr(state, "close").to_string(),
        Action::ToggleLayoutGuides => {
            if state.show_layout_guides {
                tr(state, "hide_layout_guides").to_string()
            } else {
                tr(state, "show_layout_guides").to_string()
            }
        }
        Action::ToggleAudioMute => {
            if state.audio_muted {
                tr(state, "audio_enable").to_string()
            } else {
                tr(state, "audio_mute").to_string()
            }
        }
        Action::MusicVolumeDown => format!("{} {}", tr(state, "music"), tr(state, "volume_down")),
        Action::MusicVolumeUp => format!("{} {}", tr(state, "music"), tr(state, "volume_up")),
        Action::SfxVolumeDown => format!("{} {}", tr(state, "sfx"), tr(state, "volume_down")),
        Action::SfxVolumeUp => format!("{} {}", tr(state, "sfx"), tr(state, "volume_up")),
        Action::SetLanguageEnglish => tr(state, "english").to_string(),
        Action::SetLanguageSwedish => tr(state, "swedish").to_string(),
        Action::FeedSelectedCivet => tr(state, "feed_tray").to_string(),
        Action::PetSelectedCivet => tr(state, "pet_gently").to_string(),
        Action::InspectSelectedCivet => tr(state, "inspect_notes").to_string(),
        Action::UseTinyBrush => tr(state, "tiny_brush").to_string(),
        Action::UseRibbonCollar => tr(state, "ribbon_collar").to_string(),
        Action::UseFruitPuzzle => tr(state, "fruit_puzzle").to_string(),
        Action::GoSanctuary => room_label(
            room_tr(state, PlantationRoom::Sanctuary),
            PlantationRoom::Sanctuary,
            state,
        ),
        Action::GoCoffeeField => room_label(
            room_tr(state, PlantationRoom::CoffeeField),
            PlantationRoom::CoffeeField,
            state,
        ),
        Action::GoRoastery => room_label(
            room_tr(state, PlantationRoom::Roastery),
            PlantationRoom::Roastery,
            state,
        ),
        Action::GoPaperworkOffice => room_label(
            room_tr(state, PlantationRoom::PaperworkOffice),
            PlantationRoom::PaperworkOffice,
            state,
        ),
        Action::ShowCareTools => group_label(tr(state, "care"), ToolGroup::Care, state),
        Action::ShowFieldTools => group_label(tr(state, "field"), ToolGroup::Field, state),
        Action::ShowProductionTools => {
            group_label(tr(state, "production"), ToolGroup::Production, state)
        }
        Action::ShowComplianceTools => {
            group_label(tr(state, "compliance"), ToolGroup::Compliance, state)
        }
        Action::ShowUpgradeTools => group_label(tr(state, "upgrades"), ToolGroup::Upgrades, state),
        Action::ShowSystemTools => group_label(tr(state, "system"), ToolGroup::System, state),
        _ => "Action".to_string(),
    }
}

fn room_label(name: &str, room: PlantationRoom, state: &GameState) -> String {
    if state.current_room == room {
        format!("{name} *")
    } else {
        name.to_string()
    }
}

fn group_label(name: &str, group: ToolGroup, state: &GameState) -> String {
    if state.active_tool_group == group {
        format!("v {name}")
    } else {
        format!("> {name}")
    }
}

fn upgrade_label(state: &GameState, key: &'static str, cost: i32, bought: bool) -> String {
    let name = tr(state, key);
    if bought {
        format!("{name} ({})", tr(state, "built"))
    } else {
        format!("{name} (${cost})")
    }
}

pub(crate) fn can_run(action: Action, state: &GameState) -> bool {
    match action {
        Action::PlantCoffee => state.money >= 14 && state.near_field_workbench(),
        Action::HarvestFruit => state.coffee_plants > 0 && state.near_field_workbench(),
        Action::FeedCivets => state.coffee_fruit > 0.0 && state.near_civets(),
        Action::CollectBeans => state.near_civets(),
        Action::RoastCoffee => state.processed_beans >= 1.0 && state.near_roastery(),
        Action::SellCoffee => state.roasted_coffee >= 1.0 && state.near_roastery(),
        Action::DeliverOrder => {
            state
                .active_order
                .as_ref()
                .is_some_and(|order| state.roasted_coffee >= order.bags)
                && state.near_roastery()
        }
        Action::ToggleInventory | Action::CycleTimeScale => true,
        Action::GiveFruitFromInventory => {
            state.current_room == PlantationRoom::Sanctuary
                && state.coffee_fruit >= 1.0
                && state.near_civets()
        }
        Action::PickUpBeansToInventory => {
            state.current_room == PlantationRoom::Sanctuary && state.near_civets()
        }
        Action::ImproveEnclosure => state.money >= 45 + state.enclosure_level as i32 * 20,
        Action::ShowPaperwork => {
            let cost = if state.legal_office {
                8 + state.paperwork_level as i32 * 2
            } else {
                16 + state.paperwork_level as i32 * 3
            };
            state.money >= cost && state.near_paperwork_desk()
        }
        Action::BuildLegalOffice => !state.legal_office && state.money >= 110,
        Action::HireCaretaker => !state.caretaker && state.money >= 85,
        Action::BuildFruitSorter => !state.fruit_sorter && state.money >= 95,
        Action::BuildRoastingShed => !state.roasting_shed && state.money >= 125,
        Action::BuildTastingRoom => !state.tasting_room && state.money >= 140,
        Action::FeedSelectedCivet => state.selected_civet.is_some() && state.coffee_fruit >= 2.0,
        Action::PetSelectedCivet
        | Action::InspectSelectedCivet
        | Action::UseTinyBrush
        | Action::UseRibbonCollar
        | Action::UseFruitPuzzle
        | Action::CloseAnimalPanel => state.selected_civet.is_some(),
        Action::GoSanctuary
        | Action::GoCoffeeField
        | Action::GoRoastery
        | Action::GoPaperworkOffice => state.screen == GameScreen::Playing,
        Action::ShowCareTools
        | Action::ShowFieldTools
        | Action::ShowProductionTools
        | Action::ShowComplianceTools
        | Action::ShowUpgradeTools
        | Action::ShowSystemTools => state.screen == GameScreen::Playing,
        Action::ShowSettings => state.screen == GameScreen::Playing,
        Action::CloseSettings
        | Action::ToggleLayoutGuides
        | Action::ToggleAudioMute
        | Action::MusicVolumeDown
        | Action::MusicVolumeUp
        | Action::SfxVolumeDown
        | Action::SfxVolumeUp
        | Action::SetLanguageEnglish
        | Action::SetLanguageSwedish
        | Action::StartNewRun => true,
        Action::AcceptOrder | Action::DeclineOrder => state.pending_order.is_some(),
        Action::EventOptionA | Action::EventOptionB | Action::EventOptionC => state.event.is_some(),
        Action::InspectPaperwork | Action::InspectTasting | Action::InspectGoat => state.inspection,
        _ => true,
    }
}

pub(crate) fn unavailable_reason(action: Action, state: &GameState) -> String {
    match action {
        Action::PlantCoffee => {
            if state.money < 14 {
                need_money(state, 14)
            } else {
                need_place(state, "Kaffefältets arbetsbord", "Coffee Field workbench")
            }
        }
        Action::HarvestFruit => need_place(state, "Kaffefältets plantor", "Coffee Field plants"),
        Action::FeedCivets => {
            if state.coffee_fruit <= 0.0 {
                need_resource(state, "kaffefrukt", "coffee fruit")
            } else {
                need_place(
                    state,
                    "palmmårdarna i fristaden",
                    "the civets in the Sanctuary",
                )
            }
        }
        Action::CollectBeans => need_place(
            state,
            "palmmårdarnas arbetsyta",
            "the civet enclosure work area",
        ),
        Action::RoastCoffee => {
            if state.processed_beans < 1.0 {
                need_resource(state, "processade bönor", "processed beans")
            } else {
                need_place(state, "rostaren", "the roaster")
            }
        }
        Action::SellCoffee => {
            if state.roasted_coffee < 1.0 {
                need_resource(state, "rostat kaffe", "roasted coffee")
            } else {
                need_place(state, "rosteriets packbord", "the roastery packing table")
            }
        }
        Action::DeliverOrder => {
            if let Some(order) = &state.active_order {
                if state.roasted_coffee < order.bags {
                    if state.language == Language::Swedish {
                        format!(
                            "Ordern kräver {:.1} rostade säckar. Du har {:.1}.",
                            order.bags, state.roasted_coffee
                        )
                    } else {
                        format!(
                            "Order needs {:.1} roasted bags. You have {:.1}.",
                            order.bags, state.roasted_coffee
                        )
                    }
                } else {
                    need_place(
                        state,
                        "rosteriets leveransbord",
                        "the roastery delivery table",
                    )
                }
            } else {
                local_text(
                    state,
                    "Det finns ingen aktiv order.",
                    "No active order to deliver.",
                )
            }
        }
        Action::GiveFruitFromInventory => {
            if state.coffee_fruit < 1.0 {
                need_resource(state, "kaffefrukt i säcken", "coffee fruit in the sack")
            } else {
                need_place(
                    state,
                    "palmmårdarna i fristaden",
                    "the civets in the Sanctuary",
                )
            }
        }
        Action::PickUpBeansToInventory => need_place(
            state,
            "palmmårdarnas arbetsyta",
            "the civet enclosure work area",
        ),
        Action::ShowPaperwork => {
            let cost = if state.legal_office {
                8 + state.paperwork_level as i32 * 2
            } else {
                16 + state.paperwork_level as i32 * 3
            };
            if state.money < cost {
                need_money(state, cost)
            } else {
                need_place(state, "pappersdisken", "the paperwork desk")
            }
        }
        Action::ImproveEnclosure => need_money(state, 45 + state.enclosure_level as i32 * 20),
        Action::BuildLegalOffice => upgrade_reason(state, state.legal_office, 110),
        Action::HireCaretaker => upgrade_reason(state, state.caretaker, 85),
        Action::BuildFruitSorter => upgrade_reason(state, state.fruit_sorter, 95),
        Action::BuildRoastingShed => upgrade_reason(state, state.roasting_shed, 125),
        Action::BuildTastingRoom => upgrade_reason(state, state.tasting_room, 140),
        Action::FeedSelectedCivet => {
            if state.selected_civet.is_none() {
                local_text(state, "Välj en palmmård först.", "Select a civet first.")
            } else {
                local_text(
                    state,
                    "En personlig fruktbricka kräver 2 kaffefrukter.",
                    "A personal fruit tray needs 2 coffee fruit.",
                )
            }
        }
        Action::PetSelectedCivet
        | Action::InspectSelectedCivet
        | Action::CloseAnimalPanel
        | Action::UseTinyBrush
        | Action::UseRibbonCollar
        | Action::UseFruitPuzzle => {
            local_text(state, "Välj en palmmård först.", "Select a civet first.")
        }
        _ => local_text(
            state,
            "Den handlingen är inte tillgänglig just nu.",
            "That action is unavailable right now.",
        ),
    }
}

fn local_text(state: &GameState, sv: &'static str, en: &'static str) -> String {
    if state.language == Language::Swedish {
        sv.to_string()
    } else {
        en.to_string()
    }
}

fn need_money(state: &GameState, cost: i32) -> String {
    if state.language == Language::Swedish {
        format!("Behöver ${cost}. Du har ${}.", state.money)
    } else {
        format!("Needs ${cost}. You have ${}.", state.money)
    }
}

fn need_resource(state: &GameState, sv: &'static str, en: &'static str) -> String {
    if state.language == Language::Swedish {
        format!("Behöver {sv}.")
    } else {
        format!("Needs {en}.")
    }
}

fn need_place(state: &GameState, sv: &'static str, en: &'static str) -> String {
    if state.language == Language::Swedish {
        format!("Gå till {sv}.")
    } else {
        format!("Go to {en}.")
    }
}

fn upgrade_reason(state: &GameState, bought: bool, cost: i32) -> String {
    if bought {
        local_text(
            state,
            "Uppgraderingen är redan byggd.",
            "Upgrade is already built.",
        )
    } else {
        need_money(state, cost)
    }
}

fn game_clock_label(day_progress: f32) -> String {
    let minutes_total = (6.0 * 60.0 + day_progress.clamp(0.0, 1.0) * 16.0 * 60.0).round() as u32;
    let hour = minutes_total / 60;
    let minute = minutes_total % 60;
    format!("{hour:02}:{minute:02}")
}

pub fn update_stats(
    state: Res<GameState>,
    mut stats: Query<(&StatText, &mut Text, &mut TextColor), Without<AudioSettingsText>>,
    mut localized: Query<
        (&LocalizedText, &mut Text),
        (Without<StatText>, Without<AudioSettingsText>),
    >,
    mut audio_settings: Query<
        &mut Text,
        (
            With<AudioSettingsText>,
            Without<StatText>,
            Without<LocalizedText>,
        ),
    >,
) {
    if !state.is_changed() {
        return;
    }
    for (localized, mut text) in &mut localized {
        **text = tr(&state, localized.0).to_string();
    }
    for mut text in &mut audio_settings {
        **text = audio_settings_summary(&state);
    }
    for (stat, mut text, mut color) in &mut stats {
        let value = match stat.0 {
            StatKind::Day => {
                if state.game_result.is_some() {
                    tr(&state, "final_report").to_string()
                } else {
                    format!("{} {}/7", tr(&state, "day"), state.day)
                }
            }
            StatKind::Clock => format!(
                "{} {}",
                game_clock_label(state.day_progress),
                state.time_scale.label()
            ),
            StatKind::Plants => format!("{} {}", tr(&state, "plants"), state.coffee_plants),
            StatKind::Civets => format!("{} {}", tr(&state, "civets"), state.civets),
            StatKind::Fruit => format!("{} {:.0}", tr(&state, "fruit"), state.coffee_fruit),
            StatKind::Feed => format!("{} {:.0}", tr(&state, "feed"), state.civet_feed),
            StatKind::Beans => format!("{} {:.1}", tr(&state, "beans"), state.processed_beans),
            StatKind::Roasted => format!("{} {:.1}", tr(&state, "roast"), state.roasted_coffee),
            StatKind::Money => format!("${}", state.money),
            StatKind::Suspicion => format!("{} {:.0}%", tr(&state, "suspicion"), state.suspicion),
            StatKind::Happiness => format!("{} {:.0}%", tr(&state, "happy"), state.civet_happiness),
            StatKind::Reputation => format!("{} {}", tr(&state, "rep"), state.reputation),
            StatKind::Paperwork => format!("{} {}", tr(&state, "paper"), state.paperwork_level),
            StatKind::Mailbox => mailbox_summary(&state),
            StatKind::Upgrades => {
                format!("{}: {}", tr(&state, "upgrades"), upgrade_summary(&state))
            }
            StatKind::Order => order_summary(&state),
            StatKind::Modifier => modifier_summary(&state),
            StatKind::Goal => current_goal(&state),
        };
        **text = value;
        color.0 = match stat.0 {
            StatKind::Suspicion if state.suspicion >= 75.0 => Color::srgb(1.0, 0.18, 0.12),
            StatKind::Suspicion if state.suspicion >= 45.0 => Color::srgb(1.0, 0.58, 0.24),
            StatKind::Happiness if state.civet_happiness < 40.0 => Color::srgb(1.0, 0.28, 0.18),
            StatKind::Money if state.money < 20 => Color::srgb(1.0, 0.38, 0.22),
            StatKind::Mailbox if state.event.is_some() || state.pending_order.is_some() => {
                Color::srgb(1.0, 0.82, 0.42)
            }
            StatKind::Modifier => Color::srgb(0.72, 0.92, 1.0),
            StatKind::Goal => Color::srgb(1.0, 0.84, 0.42),
            _ => Color::srgb(0.97, 0.92, 0.78),
        };
    }
}

fn audio_settings_summary(state: &GameState) -> String {
    format!(
        "{}: {} {:.0}% / {} {:.0}%",
        tr(state, "audio"),
        tr(state, "music"),
        state.music_volume * 100.0,
        tr(state, "sfx"),
        state.sfx_volume * 100.0
    )
}

fn current_goal(state: &GameState) -> String {
    let goal = if state.inspection {
        tr(state, "goal_inspection")
    } else if state.suspicion >= 72.0 {
        tr(state, "goal_reduce_suspicion")
    } else if state.day_report.is_some() {
        tr(state, "goal_read_report")
    } else if state.event.is_some() || state.pending_order.is_some() {
        tr(state, "goal_check_mail")
    } else if state.civet_happiness < 45.0 || state.civet_feed < state.civets as f32 * 2.0 {
        tr(state, "goal_feed_civets")
    } else if state.active_order.is_some() && state.roasted_coffee < active_order_bags(state) {
        tr(state, "goal_roast_order")
    } else if state.active_order.is_some() {
        tr(state, "goal_deliver_order")
    } else if state.processed_beans >= 1.0 && state.roasted_coffee < 4.0 {
        tr(state, "goal_roast_beans")
    } else if state.roasted_coffee >= 1.0 {
        tr(state, "goal_sell_coffee")
    } else if state.coffee_fruit >= 4.0 {
        tr(state, "goal_feed_or_harvest")
    } else {
        tr(state, "goal_grow_pipeline")
    };
    format!("{}: {goal}", tr(state, "goal"))
}

fn active_order_bags(state: &GameState) -> f32 {
    state.active_order.as_ref().map_or(0.0, |order| order.bags)
}

fn mailbox_summary(state: &GameState) -> String {
    let mut letters = 0;
    if state.event.is_some() {
        letters += 1;
    }
    if state.pending_order.is_some() {
        letters += 1;
    }
    if letters == 0 {
        format!("{} 0", tr(state, "mail"))
    } else {
        format!("{} {letters}", tr(state, "mail"))
    }
}

fn order_summary(state: &GameState) -> String {
    if let Some(order) = &state.active_order {
        let missing = (order.bags - state.roasted_coffee).max(0.0);
        format!(
            "{} {} {:.1} d{} - {} {:.1}",
            tr(state, "order"),
            order_style_short(order.style, state.language),
            order.bags,
            order.due_day,
            tr(state, "missing"),
            missing
        )
    } else if let Some(order) = &state.pending_order {
        format!(
            "{} {} {}",
            tr(state, "order"),
            tr(state, "offer"),
            order_style_short(order.style, state.language)
        )
    } else {
        format!("{} {}", tr(state, "order"), tr(state, "none"))
    }
}

fn modifier_summary(state: &GameState) -> String {
    if let Some(modifier) = &state.daily_modifier {
        format!(
            "{}: {} ({})",
            tr(state, "modifier"),
            modifier.title,
            modifier_effect_short(modifier.kind, state.language)
        )
    } else {
        format!("{}: {}", tr(state, "modifier"), tr(state, "none"))
    }
}

fn upgrade_summary(state: &GameState) -> String {
    let mut names = Vec::new();
    if state.legal_office {
        names.push(tr(state, "legal_office"));
    }
    if state.caretaker {
        names.push(tr(state, "caretaker"));
    }
    if state.fruit_sorter {
        names.push(tr(state, "fruit_sorter"));
    }
    if state.roasting_shed {
        names.push(tr(state, "roasting_shed"));
    }
    if state.tasting_room {
        names.push(tr(state, "tasting_room"));
    }

    if names.is_empty() {
        tr(state, "none").to_string()
    } else {
        names.join(", ")
    }
}

pub fn update_status_bars(
    state: Res<GameState>,
    mut bars: Query<(&StatusBar, &mut Node, &mut BackgroundColor)>,
) {
    if !state.is_changed() {
        return;
    }

    for (bar, mut node, mut color) in &mut bars {
        let value = match bar.0 {
            StatusKind::Suspicion => state.suspicion,
            StatusKind::Happiness => state.civet_happiness,
            StatusKind::CoffeePipeline => {
                let stock = state.coffee_fruit
                    + state.civet_feed
                    + state.processed_beans * 2.0
                    + state.roasted_coffee * 4.0;
                (stock / 2.4).clamp(0.0, 100.0)
            }
        };

        node.width = percent(value.max(2.0));
        color.0 = match bar.0 {
            StatusKind::Suspicion if value >= 80.0 => Color::srgb(1.0, 0.10, 0.06),
            StatusKind::Suspicion if value >= 50.0 => Color::srgb(1.0, 0.48, 0.14),
            StatusKind::Suspicion => Color::srgb(0.68, 0.24, 0.12),
            StatusKind::Happiness if value < 35.0 => Color::srgb(0.90, 0.15, 0.10),
            StatusKind::Happiness => Color::srgb(0.20, 0.74, 0.35),
            StatusKind::CoffeePipeline => Color::srgb(0.86, 0.62, 0.20),
        };
    }
}

pub fn update_log(
    mut commands: Commands,
    state: Res<GameState>,
    logs: Query<Entity, With<LogText>>,
) {
    if !state.is_changed() {
        return;
    }
    for entity in &logs {
        commands.entity(entity).despawn_related::<Children>();
        commands.entity(entity).with_children(|log| {
            for line in state.log.iter().rev().take(7) {
                let (prefix, color) = log_line_style(line);
                log.spawn((
                    Text::new(format!("{prefix} {line}")),
                    TextFont {
                        font_size: 12.5,
                        ..default()
                    },
                    TextColor(color),
                ));
            }
        });
    }
}

fn log_line_style(line: &str) -> (&'static str, Color) {
    let lower = line.to_lowercase();
    if lower.contains("misstanke")
        || lower.contains("suspicion")
        || lower.contains("myndighet")
        || lower.contains("authorit")
        || lower.contains("inspekt")
        || lower.contains("inspection")
        || lower.contains("revision")
        || lower.contains("audit")
        || lower.contains("straff")
        || lower.contains("penalt")
        || lower.contains("missade")
        || lower.contains("missed")
    {
        ("[!]", Color::srgba(1.0, 0.47, 0.28, 0.98))
    } else if lower.contains("order")
        || lower.contains("kontrakt")
        || lower.contains("contract")
        || lower.contains("brev")
        || lower.contains("letter")
        || lower.contains("post")
        || lower.contains("mail")
    {
        ("[@]", Color::srgba(1.0, 0.82, 0.42, 0.98))
    } else if lower.contains("sålde")
        || lower.contains("sold")
        || lower.contains("bygg")
        || lower.contains("built")
        || lower.contains("anställde")
        || lower.contains("hired")
        || lower.contains("rykte")
        || lower.contains("reputation")
    {
        ("[+]", Color::srgba(0.62, 1.0, 0.70, 0.98))
    } else if lower.contains("palmmård")
        || lower.contains("civet")
        || lower.contains("frukt")
        || lower.contains("fruit")
    {
        ("[*]", Color::srgba(0.78, 0.94, 1.0, 0.96))
    } else {
        ("[-]", Color::srgba(1.0, 0.96, 0.82, 0.94))
    }
}

pub fn update_feedback(time: Res<Time>, mut state: ResMut<GameState>) {
    if state.feedback.is_empty() {
        return;
    }
    for feedback in &mut state.feedback {
        feedback.age -= time.delta_secs();
    }
    state.feedback.retain(|feedback| feedback.age > 0.0);
}

pub fn refresh_feedback_panel(
    mut commands: Commands,
    state: Res<GameState>,
    panel: Query<Entity, With<FeedbackPanel>>,
) {
    for entity in &panel {
        commands.entity(entity).despawn();
    }
    if state.feedback.is_empty() || state.screen != GameScreen::Playing {
        return;
    }

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: percent(34),
                right: percent(34),
                bottom: px(154),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                row_gap: px(4),
                ..default()
            },
            Pickable::IGNORE,
            GlobalZIndex(7),
            FeedbackPanel,
        ))
        .with_children(|panel| {
            for feedback in state.feedback.iter().rev() {
                let alpha = (feedback.age / 2.8).clamp(0.0, 1.0);
                panel.spawn((
                    Text::new(feedback.text.clone()),
                    TextFont {
                        font_size: 15.0,
                        ..default()
                    },
                    TextColor(Color::srgba(1.0, 0.92, 0.58, alpha)),
                    BackgroundColor(Color::srgba(0.04, 0.03, 0.018, alpha * 0.42)),
                ));
            }
        });
}

pub fn refresh_inspection_modal(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    modal: Query<Entity, With<InspectionModal>>,
) {
    let exists = !modal.is_empty();
    if state.inspection && !exists {
        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: percent(23),
                    top: percent(14),
                    width: percent(54),
                    padding: UiRect::all(px(22)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(12),
                    border: UiRect::all(px(2)),
                    border_radius: BorderRadius::all(px(14)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.42, 0.03, 0.02, 0.90)),
                ui_skin_node(&skin, SKIN_STATS_PANEL, Color::srgba(1.0, 0.64, 0.54, 0.85)),
                BorderColor::all(Color::srgba(1.0, 0.68, 0.40, 0.72)),
                GlobalZIndex(10),
                InspectionModal,
            ))
            .with_children(|modal| {
                modal.spawn((
                    Text::new(tr(&state, "operation_bitter_bean")),
                    TextFont {
                        font_size: 36.0,
                        ..default()
                    },
                    TextColor(Color::srgb(1.0, 0.88, 0.56)),
                ));
                modal.spawn((
                    Text::new(tr(&state, "inspection_body")),
                    TextFont {
                        font_size: 18.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
                spawn_button(
                    modal,
                    &skin,
                    tr(&state, "show_paperwork_btn"),
                    Action::InspectPaperwork,
                );
                spawn_button(
                    modal,
                    &skin,
                    tr(&state, "coffee_tasting"),
                    Action::InspectTasting,
                );
                spawn_button(modal, &skin, tr(&state, "blame_goat"), Action::InspectGoat);
            });
    } else if !state.inspection && exists {
        for entity in &modal {
            commands.entity(entity).despawn();
        }
    }
}

pub fn refresh_day_modal(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    modal: Query<(Entity, &DayModalKind), With<DayModal>>,
) {
    let should_show = state.screen == GameScreen::Playing
        && (state.day_report.is_some() || state.game_result.is_some());
    let desired_kind = if state.day_report.is_some() {
        Some(DayModalKind::DayReport)
    } else if state.game_result.is_some() {
        Some(DayModalKind::FinalVerdict)
    } else {
        None
    };
    let mut exists = false;

    if should_show {
        let desired_kind = desired_kind.expect("modal kind checked by should_show");
        for (entity, kind) in &modal {
            exists = true;
            if *kind != desired_kind {
                commands.entity(entity).despawn();
                exists = false;
            }
        }
        if exists {
            return;
        }
        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: percent(28),
                    top: percent(17),
                    width: percent(44),
                    padding: UiRect::all(px(22)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(12),
                    border: UiRect::all(px(2)),
                    border_radius: BorderRadius::all(px(14)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.05, 0.08, 0.055, 0.91)),
                ui_skin_node(&skin, SKIN_STATS_PANEL, Color::srgba(0.88, 1.0, 0.74, 0.82)),
                BorderColor::all(Color::srgba(0.84, 1.0, 0.62, 0.55)),
                GlobalZIndex(9),
                DayModal,
                desired_kind,
            ))
            .with_children(|modal| {
                if let Some(report) = &state.day_report {
                    modal.spawn((
                        Text::new(report.title.clone()),
                        TextFont {
                            font_size: 30.0,
                            ..default()
                        },
                        TextColor(Color::srgb(1.0, 0.84, 0.42)),
                    ));
                    modal.spawn((
                        Text::new(report.summary.clone()),
                        TextFont {
                            font_size: 17.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.95, 0.91, 0.78)),
                    ));
                    modal.spawn((
                        Text::new(format!(
                            "{}: ${}. {}",
                            tr(&state, "upkeep_charged"),
                            report.upkeep,
                            tr(&state, "official_memo")
                        )),
                        TextFont {
                            font_size: 15.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.78, 0.88, 0.70)),
                    ));
                    if !report.recommendation.is_empty() {
                        modal.spawn((
                            Text::new(format!(
                                "{}: {}",
                                tr(&state, "recommendation"),
                                report.recommendation
                            )),
                            TextFont {
                                font_size: 16.0,
                                ..default()
                            },
                            TextColor(Color::srgb(1.0, 0.86, 0.50)),
                        ));
                    }

                    if state.game_result.is_none() {
                        spawn_button(
                            modal,
                            &skin,
                            tr(&state, "begin_next_day"),
                            Action::ContinueDay,
                        );
                    } else {
                        spawn_button(
                            modal,
                            &skin,
                            tr(&state, "view_final_verdict"),
                            Action::ContinueDay,
                        );
                    }
                } else if let Some(result) = &state.game_result {
                    let (title, body, color) = match result {
                        GameResult::Won(body) => {
                            (tr(&state, "weekly_won"), body, Color::srgb(0.46, 1.0, 0.48))
                        }
                        GameResult::Failed(body) => (
                            tr(&state, "weekly_failed"),
                            body,
                            Color::srgb(1.0, 0.26, 0.18),
                        ),
                    };
                    modal.spawn((
                        Text::new(title),
                        TextFont {
                            font_size: 31.0,
                            ..default()
                        },
                        TextColor(color),
                    ));
                    modal.spawn((
                        Text::new(body.clone()),
                        TextFont {
                            font_size: 18.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.95, 0.91, 0.78)),
                    ));
                    modal.spawn((
                        Text::new(tr(&state, "archive_result")),
                        TextFont {
                            font_size: 15.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.78, 0.88, 0.70)),
                    ));
                    spawn_button(
                        modal,
                        &skin,
                        tr(&state, "start_new_run"),
                        Action::StartNewRun,
                    );
                    spawn_button(modal, &skin, tr(&state, "load_save"), Action::Load);
                    spawn_button(modal, &skin, tr(&state, "back_to_menu"), Action::BackToMenu);
                }
            });
    } else {
        for (entity, _) in &modal {
            commands.entity(entity).despawn();
        }
    }
}

pub fn refresh_event_modal(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    modal: Query<Entity, With<EventModal>>,
) {
    let should_show = state.screen == GameScreen::Playing
        && state.current_room == PlantationRoom::PaperworkOffice;
    let exists = !modal.is_empty();

    if should_show && (!exists || state.is_changed()) {
        for entity in &modal {
            commands.entity(entity).despawn();
        }
        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    right: percent(2),
                    top: percent(11),
                    width: percent(32),
                    padding: UiRect::all(px(14)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(10),
                    border: UiRect::all(px(1)),
                    border_radius: BorderRadius::all(px(10)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.04, 0.05, 0.035, 0.62)),
                BorderColor::all(Color::srgba(0.92, 0.74, 0.38, 0.28)),
                GlobalZIndex(8),
                EventModal,
            ))
            .with_children(|modal| {
                modal.spawn((
                    Text::new(tr(&state, "paperwork_inbox")),
                    TextFont {
                        font_size: 24.0,
                        ..default()
                    },
                    TextColor(Color::srgb(1.0, 0.82, 0.40)),
                ));

                if let Some(event) = state.event.as_ref() {
                    let days_left = event.due_day.saturating_sub(state.day);
                    let body = if state.language == Language::Swedish {
                        format!(
                            "{}\n\nPrioritet: incident. Dagar kvar: {days_left}. Rekommendation: välj ett svar innan dagens rapport.",
                            event.body
                        )
                    } else {
                        format!(
                            "{}\n\nPriority: incident. Days left: {days_left}. Recommendation: choose a response before the day report.",
                            event.body
                        )
                    };
                    spawn_inbox_card(modal, &event.title, &body, |card| {
                        let (a, b, c) = event_option_labels(event.kind, state.language);
                        spawn_button(card, &skin, a, Action::EventOptionA);
                        spawn_button(card, &skin, b, Action::EventOptionB);
                        spawn_button(card, &skin, c, Action::EventOptionC);
                    });
                }

                if let Some(order) = state.pending_order.as_ref() {
                    let days_left = order.due_day.saturating_sub(state.day);
                    let missing = (order.bags - state.roasted_coffee).max(0.0);
                    let body = if state.language == Language::Swedish {
                        format!(
                            "{}: {}.\n{} {} {:.1} {} {}. {} ${}, {} +{}, {} +{:.1}%.\n{}: {}. {} {:.1}.\n{}\n{}",
                            order_style_label(order.style, state.language),
                            order_style_body(order.style, state.language),
                            order.client,
                            tr(&state, "order_wants"),
                            order.bags,
                            tr(&state, "roasted_bags_by_day"),
                            order.due_day,
                            tr(&state, "payout"),
                            order.payout,
                            tr(&state, "reputation"),
                            order.reputation_reward,
                            tr(&state, "suspicion"),
                            order.suspicion_risk,
                            tr(&state, "days_left"),
                            days_left,
                            tr(&state, "missing"),
                            missing,
                            tr(&state, "legitimate_contract"),
                            order_guidance(order.style, state.language)
                        )
                    } else {
                        format!(
                            "{}: {}.\n{} wants {:.1} roasted bags by day {}. Payout ${}, reputation +{}, suspicion +{:.1}%.\n{}: {}. {} {:.1}.\n{}\n{}",
                            order_style_label(order.style, state.language),
                            order_style_body(order.style, state.language),
                            order.client,
                            order.bags,
                            order.due_day,
                            order.payout,
                            order.reputation_reward,
                            order.suspicion_risk,
                            tr(&state, "days_left"),
                            days_left,
                            tr(&state, "missing"),
                            missing,
                            tr(&state, "legitimate_contract"),
                            order_guidance(order.style, state.language)
                        )
                    };
                    spawn_inbox_card(modal, tr(&state, "premium_contract"), &body, |card| {
                        spawn_button(card, &skin, tr(&state, "accept_contract"), Action::AcceptOrder);
                        spawn_button(card, &skin, tr(&state, "decline_politely"), Action::DeclineOrder);
                    });
                }

                if state.event.is_none() && state.pending_order.is_none() {
                    modal.spawn((
                        Text::new(tr(&state, "no_letters")),
                        TextFont {
                            font_size: 15.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.94, 0.91, 0.75)),
                    ));
                }
            });
    } else if !should_show && exists {
        for entity in &modal {
            commands.entity(entity).despawn();
        }
    }
}

fn order_guidance(style: OrderStyle, language: Language) -> &'static str {
    if language == Language::Swedish {
        match style {
            OrderStyle::Rush => "Råd: acceptera bara om rosteriet redan har fart.",
            OrderStyle::Discreet => "Råd: bra pengar, men höj pappersnivån efteråt.",
            OrderStyle::Reputation => "Råd: svagare betalt, starkt för ryktet.",
            OrderStyle::Steady => "Råd: trygg order om produktionen är stabil.",
        }
    } else {
        match style {
            OrderStyle::Rush => "Advice: accept only if the roastery is already moving.",
            OrderStyle::Discreet => "Advice: good money, but raise paperwork afterward.",
            OrderStyle::Reputation => "Advice: weaker payout, strong reputation play.",
            OrderStyle::Steady => "Advice: safe order if production is stable.",
        }
    }
}

fn spawn_inbox_card(
    parent: &mut ChildSpawnerCommands,
    title: &str,
    body: &str,
    add_buttons: impl FnOnce(&mut ChildSpawnerCommands),
) {
    parent
        .spawn((
            Node {
                width: percent(100),
                padding: UiRect::all(px(12)),
                flex_direction: FlexDirection::Column,
                row_gap: px(8),
                border: UiRect::all(px(1)),
                border_radius: BorderRadius::all(px(8)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.11, 0.075, 0.035, 0.52)),
            BorderColor::all(Color::srgba(1.0, 0.78, 0.42, 0.24)),
        ))
        .with_children(|card| {
            card.spawn((
                Text::new(title.to_string()),
                TextFont {
                    font_size: 20.0,
                    ..default()
                },
                TextColor(Color::srgb(1.0, 0.86, 0.42)),
            ));
            card.spawn((
                Text::new(body.to_string()),
                TextFont {
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgb(0.94, 0.89, 0.72)),
            ));
            add_buttons(card);
        });
}

pub fn refresh_order_modal(
    mut commands: Commands,
    _state: Res<GameState>,
    _skin: Res<UiSkinAssets>,
    modal: Query<Entity, With<OrderModal>>,
) {
    for entity in &modal {
        commands.entity(entity).despawn();
    }
}

pub fn refresh_settings_modal(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    modal: Query<Entity, With<SettingsModal>>,
) {
    let should_show = state.screen == GameScreen::Playing && state.settings_open;
    let exists = !modal.is_empty();

    if should_show && !exists {
        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    right: percent(8),
                    top: percent(16),
                    width: percent(32),
                    padding: UiRect::all(px(18)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(12),
                    border: UiRect::all(px(2)),
                    border_radius: BorderRadius::all(px(14)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.05, 0.06, 0.045, 0.92)),
                ui_skin_node(
                    &skin,
                    SKIN_STATS_PANEL,
                    Color::srgba(0.86, 0.96, 0.74, 0.82),
                ),
                BorderColor::all(Color::srgba(0.84, 1.0, 0.62, 0.48)),
                GlobalZIndex(10),
                SettingsModal,
            ))
            .with_children(|modal| {
                modal.spawn((
                    Text::new(tr(&state, "settings")),
                    TextFont {
                        font_size: 30.0,
                        ..default()
                    },
                    TextColor(Color::srgb(1.0, 0.84, 0.42)),
                ));
                let language = tr(&state, "settings_language");
                modal.spawn((
                    Text::new(language),
                    TextFont {
                        font_size: 16.0,
                        ..default()
                    },
                    TextColor(Color::srgb(0.94, 0.91, 0.75)),
                ));
                spawn_button(
                    modal,
                    &skin,
                    tr(&state, "english"),
                    Action::SetLanguageEnglish,
                );
                spawn_button(
                    modal,
                    &skin,
                    tr(&state, "swedish"),
                    Action::SetLanguageSwedish,
                );
                let guide_label = if state.show_layout_guides {
                    tr(&state, "hide_layout_guides")
                } else {
                    tr(&state, "show_layout_guides")
                };
                spawn_button(modal, &skin, guide_label, Action::ToggleLayoutGuides);
                modal.spawn((
                    Text::new(audio_settings_summary(&state)),
                    TextFont {
                        font_size: 16.0,
                        ..default()
                    },
                    TextColor(Color::srgb(0.94, 0.91, 0.75)),
                    AudioSettingsText,
                ));
                spawn_button(
                    modal,
                    &skin,
                    &action_label(Action::ToggleAudioMute, &state),
                    Action::ToggleAudioMute,
                );
                modal
                    .spawn((
                        Node {
                            flex_direction: FlexDirection::Row,
                            column_gap: px(8),
                            ..default()
                        },
                        Pickable::IGNORE,
                    ))
                    .with_children(|row| {
                        spawn_dynamic_button(
                            row,
                            &skin,
                            &action_label(Action::MusicVolumeDown, &state),
                            Action::MusicVolumeDown,
                            92.0,
                        );
                        spawn_dynamic_button(
                            row,
                            &skin,
                            &action_label(Action::MusicVolumeUp, &state),
                            Action::MusicVolumeUp,
                            92.0,
                        );
                        spawn_dynamic_button(
                            row,
                            &skin,
                            &action_label(Action::SfxVolumeDown, &state),
                            Action::SfxVolumeDown,
                            92.0,
                        );
                        spawn_dynamic_button(
                            row,
                            &skin,
                            &action_label(Action::SfxVolumeUp, &state),
                            Action::SfxVolumeUp,
                            92.0,
                        );
                    });
                spawn_button(modal, &skin, tr(&state, "close"), Action::CloseSettings);
            });
    } else if !should_show && exists {
        for entity in &modal {
            commands.entity(entity).despawn();
        }
    }
}

pub fn refresh_animal_panel(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    panel: Query<Entity, With<AnimalPanel>>,
) {
    let should_show = state.screen == GameScreen::Playing
        && state.selected_civet.is_some()
        && !state.inspection
        && state.day_report.is_none()
        && state.game_result.is_none();
    let exists = !panel.is_empty();

    if should_show && !exists {
        let index = state.selected_civet.expect("selected checked above");
        let Some(profile) = state.civet_profiles.get(index) else {
            return;
        };

        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    right: px(360),
                    top: px(48),
                    width: px(300),
                    padding: UiRect::all(px(16)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(9),
                    border: UiRect::all(px(2)),
                    border_radius: BorderRadius::all(px(14)),
                    ..default()
                },
                BackgroundColor(Color::srgba(1.0, 0.78, 0.72, 0.90)),
                ui_skin_node(&skin, SKIN_PAPER_PANEL, Color::srgba(1.0, 0.88, 0.82, 0.93)),
                BorderColor::all(Color::srgba(0.55, 0.24, 0.16, 0.50)),
                GlobalZIndex(5),
                AnimalPanel,
            ))
            .with_children(|panel| {
                panel.spawn((
                    Text::new(profile.name.clone()),
                    TextFont {
                        font_size: 28.0,
                        ..default()
                    },
                    TextColor(Color::srgb(0.25, 0.15, 0.10)),
                ));
                panel.spawn((
                    Text::new(format!(
                        "{}.",
                        if state.language == Language::Swedish {
                            &profile.note_sv
                        } else {
                            &profile.note
                        }
                    )),
                    TextFont {
                        font_size: 15.0,
                        ..default()
                    },
                    TextColor(Color::srgb(0.36, 0.23, 0.18)),
                ));
                panel.spawn((
                    Text::new(format!(
                        "{}: {}\n{} {:.0}%  {} {:.0}%\n{}: {}\n{}: {}\n{}: {}",
                        tr(&state, "status"),
                        civet_status_label(profile, state.language),
                        tr(&state, "mood"),
                        profile.mood,
                        tr(&state, "hunger"),
                        profile.hunger,
                        tr(&state, "favorite"),
                        profile.favorite_fruit,
                        tr(&state, "favorite_care"),
                        care_item_name(profile.favorite_care_item, state.language),
                        tr(&state, "need"),
                        civet_need_text(profile, state.language)
                    )),
                    TextFont {
                        font_size: 15.0,
                        ..default()
                    },
                    TextColor(Color::srgb(0.30, 0.20, 0.14)),
                ));

                spawn_button(
                    panel,
                    &skin,
                    tr(&state, "feed_tray"),
                    Action::FeedSelectedCivet,
                );
                spawn_button(
                    panel,
                    &skin,
                    tr(&state, "pet_gently"),
                    Action::PetSelectedCivet,
                );
                spawn_button(
                    panel,
                    &skin,
                    tr(&state, "inspect_notes"),
                    Action::InspectSelectedCivet,
                );
                spawn_button(panel, &skin, tr(&state, "tiny_brush"), Action::UseTinyBrush);
                spawn_button(
                    panel,
                    &skin,
                    tr(&state, "ribbon_collar"),
                    Action::UseRibbonCollar,
                );
                spawn_button(
                    panel,
                    &skin,
                    tr(&state, "fruit_puzzle"),
                    Action::UseFruitPuzzle,
                );
                spawn_button(panel, &skin, tr(&state, "close"), Action::CloseAnimalPanel);
            });
    } else if !should_show && exists {
        for entity in &panel {
            commands.entity(entity).despawn();
        }
    }
}

pub fn refresh_screen_modal(
    mut commands: Commands,
    state: Res<GameState>,
    skin: Res<UiSkinAssets>,
    modal: Query<Entity, With<ScreenModal>>,
) {
    let should_show = state.screen != GameScreen::Playing;
    let exists = !modal.is_empty();

    if should_show && !exists {
        commands
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: percent(18),
                    top: percent(10),
                    width: percent(64),
                    padding: UiRect::all(px(24)),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(14),
                    border: UiRect::all(px(2)),
                    border_radius: BorderRadius::all(px(16)),
                    ..default()
                },
                BackgroundColor(PANEL_PAPER),
                ui_skin_node(&skin, SKIN_PAPER_PANEL, Color::srgba(1.0, 0.92, 0.82, 0.94)),
                BorderColor::all(Color::srgba(0.48, 0.23, 0.14, 0.42)),
                GlobalZIndex(20),
                ScreenModal,
            ))
            .with_children(|modal| match state.screen {
                GameScreen::MainMenu => spawn_main_menu(modal, &skin, &state),
                GameScreen::Intro => spawn_intro(modal, &skin, &state),
                GameScreen::AnimalBook => spawn_animal_book(modal, &skin, &state),
                GameScreen::Playing => {}
            });
    } else if !should_show && exists {
        for entity in &modal {
            commands.entity(entity).despawn();
        }
    }
}

fn spawn_main_menu(parent: &mut ChildSpawnerCommands, skin: &UiSkinAssets, state: &GameState) {
    parent.spawn((
        Text::new("EutherCivet"),
        TextFont {
            font_size: 48.0,
            ..default()
        },
        TextColor(Color::srgb(0.25, 0.18, 0.11)),
    ));
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "En gullig palmmårdsfristad med utmärkt kaffe, mjuka tassar och extremt misstänkta papper."
        } else {
            "A cute civet coffee sanctuary with excellent beans, soft paws, and extremely suspicious paperwork."
        }),
        TextFont {
            font_size: 19.0,
            ..default()
        },
        TextColor(Color::srgb(0.36, 0.23, 0.18)),
    ));
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Starta plantagen"
        } else {
            "Start plantation"
        },
        Action::StartGame,
    );
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Vad är det här företaget?"
        } else {
            "What is this company?"
        },
        Action::ShowIntro,
    );
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Möt djuren"
        } else {
            "Meet the animals"
        },
        Action::ShowAnimalBook,
    );
}

fn spawn_intro(parent: &mut ChildSpawnerCommands, skin: &UiSkinAssets, state: &GameState) {
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "Vad EutherCivet står för"
        } else {
            "What EutherCivet Stands For"
        }),
        TextFont {
            font_size: 36.0,
            ..default()
        },
        TextColor(Color::srgb(0.25, 0.18, 0.11)),
    ));
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "Du driver en rättvis palmmårdskaffeplantage. Uppdraget är enkelt: odla kaffefrukt, ta hand om djuren, samla processade bönor, rosta premiumkaffe och bevisa varje dag att en söt djurfristad inte är ett internationellt brottssyndikat."
        } else {
            "You run a fair-trade palm civet coffee plantation. The mission is simple: grow coffee fruit, care for the animals, collect processed beans, roast premium coffee, and prove every day that a sweet wildlife sanctuary is not an international criminal enterprise."
        }),
        TextFont {
            font_size: 18.0,
            ..default()
        },
        TextColor(Color::srgb(0.36, 0.23, 0.18)),
    ));
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "Tonen är varm mot djuren, torr mot byråkratin och blodigt allvarlig när det gäller gott kaffe."
        } else {
            "The tone is gentle on the animals, dry about bureaucracy, and deadly serious about good coffee."
        }),
        TextFont {
            font_size: 17.0,
            ..default()
        },
        TextColor(Color::srgb(0.40, 0.28, 0.20)),
    ));
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Starta plantagen"
        } else {
            "Start plantation"
        },
        Action::StartGame,
    );
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Möt djuren"
        } else {
            "Meet the animals"
        },
        Action::ShowAnimalBook,
    );
    spawn_button(parent, skin, tr(state, "back_to_menu"), Action::BackToMenu);
}

fn spawn_animal_book(parent: &mut ChildSpawnerCommands, skin: &UiSkinAssets, state: &GameState) {
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "Möt djuren"
        } else {
            "Meet the Animals"
        }),
        TextFont {
            font_size: 36.0,
            ..default()
        },
        TextColor(Color::srgb(0.25, 0.18, 0.11)),
    ));
    let profiles = if state.civet_profiles.is_empty() {
        default_civet_profiles()
    } else {
        state.civet_profiles.clone()
    };
    for profile in profiles.iter() {
        parent.spawn((
            Text::new(format!(
                "{}: {}, {} {}",
                profile.name,
                profile.note,
                if state.language == Language::Swedish {
                    "favorit"
                } else {
                    "favorite"
                },
                profile.favorite_fruit
            )),
            TextFont {
                font_size: 20.0,
                ..default()
            },
            TextColor(Color::srgb(0.36, 0.23, 0.18)),
        ));
    }
    parent.spawn((
        Text::new(if state.language == Language::Swedish {
            "Binturong: sover som en styrelseledamot. Geten: dyker upp utan portfölj."
        } else {
            "Binturong: sleeps like a board member. Goat: appears without portfolio."
        }),
        TextFont {
            font_size: 18.0,
            ..default()
        },
        TextColor(Color::srgb(0.40, 0.28, 0.20)),
    ));
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Starta plantagen"
        } else {
            "Start plantation"
        },
        Action::StartGame,
    );
    spawn_button(
        parent,
        skin,
        if state.language == Language::Swedish {
            "Företagets uppdrag"
        } else {
            "Company mission"
        },
        Action::ShowIntro,
    );
    spawn_button(parent, skin, tr(state, "back_to_menu"), Action::BackToMenu);
}

fn event_option_labels(
    kind: RandomEventKind,
    language: Language,
) -> (&'static str, &'static str, &'static str) {
    if language == Language::Swedish {
        match kind {
            RandomEventKind::PoliceVisit => {
                ("Visa bönpapper", "Erbjud kaffeprovning", "Svara vagt")
            }
            RandomEventKind::JournalistQuestions => {
                ("Bjud på hel rundtur", "Styr rundturen", "Ingen kommentar")
            }
            RandomEventKind::WelfareInspection => {
                ("Köp berikning nu", "Öppna alla hägn", "Boka om artigt")
            }
            RandomEventKind::HelicopterOverhead => {
                ("Lägg ut kaffepresenningar", "Vinka glatt", "Göm alla")
            }
            RandomEventKind::BinturongEscape => {
                ("Anställ djurskötare", "Låt berömmelsen ske", "Skicka geten")
            }
            RandomEventKind::PickyCivet => (
                "Servera bästa frukten",
                "Importera bättre frukt",
                "Insistera på att den duger",
            ),
            RandomEventKind::GoatAppearance => (
                "Sätt geten på lönelistan",
                "Ta bort geten diskret",
                "Skyll på geten tidigt",
            ),
            RandomEventKind::TouristGroup => (
                "Öppna hela rundturen",
                "Visa bara rosteriet",
                "Stäng grindarna",
            ),
            RandomEventKind::VeterinarianOffer => {
                ("Betala hälsorond", "Byt mot kaffe", "Avböj bestämt")
            }
            RandomEventKind::Rainstorm => ("Skörda i regnet", "Skydda djuren", "Sortera papper"),
            RandomEventKind::InfluencerVisit => {
                ("Låt filma allt", "Visa bara koppar", "Förbjud mobiler")
            }
            RandomEventKind::PaperworkAudit => {
                ("Förbered juridiskt", "Dränk i bilagor", "Improvisera")
            }
        }
    } else {
        match kind {
            RandomEventKind::PoliceVisit => (
                "Show bean paperwork",
                "Offer coffee tasting",
                "Answer vaguely",
            ),
            RandomEventKind::JournalistQuestions => (
                "Invite full civet tour",
                "Control the tour route",
                "No comment",
            ),
            RandomEventKind::WelfareInspection => (
                "Buy enrichment now",
                "Open every enclosure",
                "Reschedule politely",
            ),
            RandomEventKind::HelicopterOverhead => {
                ("Deploy coffee tarps", "Wave cheerfully", "Hide everyone")
            }
            RandomEventKind::BinturongEscape => {
                ("Hire caretaker", "Let fame happen", "Send the goat")
            }
            RandomEventKind::PickyCivet => (
                "Serve best fruit",
                "Import better fruit",
                "Insist it is fine",
            ),
            RandomEventKind::GoatAppearance => (
                "Put goat on payroll",
                "Remove goat quietly",
                "Blame goat early",
            ),
            RandomEventKind::TouristGroup => {
                ("Open full tour", "Show roastery only", "Close the gate")
            }
            RandomEventKind::VeterinarianOffer => {
                ("Pay health round", "Barter coffee", "Decline firmly")
            }
            RandomEventKind::Rainstorm => ("Harvest in rain", "Shelter animals", "Sort paperwork"),
            RandomEventKind::InfluencerVisit => {
                ("Let them film all", "Show cups only", "Ban phones")
            }
            RandomEventKind::PaperworkAudit => ("Prepare legally", "Drown in annexes", "Improvise"),
        }
    }
}

fn order_style_short(style: OrderStyle, language: Language) -> &'static str {
    if language == Language::Swedish {
        match style {
            OrderStyle::Steady => "standard",
            OrderStyle::Rush => "akut",
            OrderStyle::Discreet => "diskret",
            OrderStyle::Reputation => "PR",
        }
    } else {
        match style {
            OrderStyle::Steady => "steady",
            OrderStyle::Rush => "rush",
            OrderStyle::Discreet => "discreet",
            OrderStyle::Reputation => "PR",
        }
    }
}

fn order_style_label(style: OrderStyle, language: Language) -> &'static str {
    if language == Language::Swedish {
        match style {
            OrderStyle::Steady => "Stabil beställning",
            OrderStyle::Rush => "Akutorder",
            OrderStyle::Discreet => "Diskret kund",
            OrderStyle::Reputation => "Ryktesbyggare",
        }
    } else {
        match style {
            OrderStyle::Steady => "Steady order",
            OrderStyle::Rush => "Rush order",
            OrderStyle::Discreet => "Discreet client",
            OrderStyle::Reputation => "Reputation builder",
        }
    }
}

fn order_style_body(style: OrderStyle, language: Language) -> &'static str {
    if language == Language::Swedish {
        match style {
            OrderStyle::Steady => "Normal betalning, normal deadline och begripliga risker",
            OrderStyle::Rush => "Kort deadline, högre betalt och mer uppmärksamhet",
            OrderStyle::Discreet => "Bättre marginal, men kontraktet drar blickar",
            OrderStyle::Reputation => "Lägre betalt, men mycket bättre PR",
        }
    } else {
        match style {
            OrderStyle::Steady => "Normal pay, normal deadline, and understandable risk",
            OrderStyle::Rush => "Short deadline, higher pay, and more attention",
            OrderStyle::Discreet => "Better margin, but the contract draws eyes",
            OrderStyle::Reputation => "Lower pay, but much stronger PR",
        }
    }
}

fn modifier_effect_short(kind: DailyModifierKind, language: Language) -> &'static str {
    if language == Language::Swedish {
        match kind {
            DailyModifierKind::RainyHarvest => "+28% frukt",
            DailyModifierKind::QuietNewsDay => "misstanke svalnar",
            DailyModifierKind::BureaucracyDay => "billigare papper",
            DailyModifierKind::MarketRush => "+18% försäljning",
        }
    } else {
        match kind {
            DailyModifierKind::RainyHarvest => "+28% fruit",
            DailyModifierKind::QuietNewsDay => "suspicion cools",
            DailyModifierKind::BureaucracyDay => "cheaper paperwork",
            DailyModifierKind::MarketRush => "+18% sales",
        }
    }
}
