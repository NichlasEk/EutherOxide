use bevy::pbr::PbrPlugin;
use bevy::prelude::*;

mod actions;
mod audio;
mod localization;
mod model;
mod simulation;
mod ui;
mod visuals;

use audio::{
    fade_audio, manage_room_music, play_audio_cues, setup_audio_assets, sync_music_volume,
};
use model::*;
use simulation::{advance_day, generate_order_offers, tick_game, trigger_random_events};
use ui::{
    animate_buttons, apply_text_font, handle_buttons, refresh_animal_panel, refresh_day_modal,
    refresh_event_modal, refresh_feedback_panel, refresh_inspection_modal, refresh_order_modal,
    refresh_screen_modal, refresh_settings_modal, spawn_ui, update_button_labels, update_feedback,
    update_log, update_stats, update_status_bars,
};
use visuals::{animate_world, move_player, refresh_world_visuals, spawn_world};

fn main() {
    App::new()
        .insert_resource(ClearColor(Color::srgb(0.10, 0.21, 0.17)))
        .insert_resource(GameState::load().unwrap_or_default())
        .insert_resource(GameTick(Timer::from_seconds(4.0, TimerMode::Repeating)))
        .insert_resource(EventTick(Timer::from_seconds(36.0, TimerMode::Repeating)))
        .insert_resource(DayTick(Timer::from_seconds(180.0, TimerMode::Repeating)))
        .insert_resource(OrderTick(Timer::from_seconds(128.0, TimerMode::Repeating)))
        .add_plugins(
            DefaultPlugins
                .build()
                .disable::<PbrPlugin>()
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "EutherCivet".to_string(),
                        resolution: (1280, 720).into(),
                        canvas: Some("#euthercivet-bevy-canvas".to_string()),
                        fit_canvas_to_parent: true,
                        prevent_default_event_handling: true,
                        ..default()
                    }),
                    ..default()
                }),
        )
        .add_systems(Startup, setup)
        .add_systems(Startup, setup_audio_assets)
        .add_systems(
            Update,
            (
                handle_buttons,
                tick_game,
                trigger_random_events,
                generate_order_offers,
                advance_day,
                update_button_labels,
                animate_buttons,
                update_stats,
                update_status_bars,
                update_log,
                update_feedback,
                apply_text_font,
                play_audio_cues,
            ),
        )
        .add_systems(
            Update,
            (
                manage_room_music,
                sync_music_volume,
                fade_audio,
                move_player,
                animate_world,
                refresh_world_visuals,
                refresh_inspection_modal,
                refresh_event_modal,
                refresh_order_modal,
                refresh_animal_panel,
                refresh_day_modal,
                refresh_settings_modal,
                refresh_feedback_panel,
                refresh_screen_modal,
            ),
        )
        .run();
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut texture_atlas_layouts: ResMut<Assets<TextureAtlasLayout>>,
) {
    let character_atlas = texture_atlas_layouts.add(TextureAtlasLayout::from_grid(
        UVec2::new(627, 627),
        2,
        2,
        None,
        None,
    ));
    let prop_atlas = texture_atlas_layouts.add(TextureAtlasLayout::from_grid(
        UVec2::new(256, 256),
        4,
        4,
        None,
        None,
    ));
    let background_atlas = texture_atlas_layouts.add(TextureAtlasLayout::from_grid(
        UVec2::new(627, 627),
        2,
        2,
        None,
        None,
    ));
    let parallax_atlas = texture_atlas_layouts.add(TextureAtlasLayout::from_grid(
        UVec2::new(1774, 295),
        1,
        3,
        None,
        None,
    ));
    let ui_skin_atlas = texture_atlas_layouts.add(TextureAtlasLayout::from_grid(
        UVec2::new(627, 627),
        2,
        2,
        None,
        None,
    ));
    commands.insert_resource(CharacterAssets {
        texture: asset_server.load("sprites/euther_civet_character_sheet.png"),
        atlas: character_atlas,
    });
    commands.insert_resource(PropAssets {
        texture: asset_server.load("sprites/euther_civet_prop_sheet.png"),
        atlas: prop_atlas,
    });
    let background_assets = BackgroundAssets {
        texture: asset_server.load("sprites/euther_civet_neutral_background_atlas.png"),
        atlas: background_atlas,
        parallax_texture: asset_server.load("sprites/euther_civet_parallax_atlas.png"),
        parallax_atlas,
    };
    commands.insert_resource(background_assets.clone());
    let ui_skin_assets = UiSkinAssets {
        texture: asset_server.load("sprites/euther_civet_ui_atlas.png"),
        atlas: ui_skin_atlas,
    };
    commands.insert_resource(ui_skin_assets.clone());
    commands.insert_resource(GameFontAssets {
        regular: asset_server.load("fonts/NotoSans-Regular.ttf"),
    });

    commands.spawn(Camera2d);
    spawn_world(&mut commands, &background_assets);
    spawn_ui(&mut commands, &ui_skin_assets);
}
