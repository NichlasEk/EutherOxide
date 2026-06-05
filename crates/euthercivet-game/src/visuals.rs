use bevy::prelude::*;
use bevy::window::PrimaryWindow;

use crate::actions::{run_action, select_civet_by_index};
use crate::localization::{civet_status_label, room_name, state_text, world_label};
use crate::model::{
    Action, BackgroundAssets, CharacterAssets, CivetBehavior, CivetClickTarget, DailyModifierKind,
    EnvironmentBackdrop, GameScreen, GameState, Helicopter, Language, MovingCivet, ParallaxLayer,
    PlantationRoom, PlayerAvatar, PlayerLabel, PlayerShadow, PropAssets, RandomEventKind,
    RetroSkyBand, SuspicionGlow, UiSkinAssets, WorldActionTarget, WorldVisual,
};
use crate::ui::{can_run, unavailable_reason};

const BACKDROP_TILE_SIZE: f32 = 627.0;
const BACKDROP_OVERSCAN: f32 = 1.04;

pub fn spawn_world(commands: &mut Commands, backgrounds: &BackgroundAssets) {
    spawn_retro_sky(commands, backgrounds);

    for phase in 0..4 {
        commands.spawn((
            Sprite::from_atlas_image(
                backgrounds.texture.clone(),
                TextureAtlas {
                    layout: backgrounds.atlas.clone(),
                    index: phase,
                },
            ),
            Transform::from_xyz(0.0, -25.0, -34.0).with_scale(Vec3::splat(2.38)),
            EnvironmentBackdrop { phase },
        ));
    }

    commands.spawn((
        Sprite::from_color(
            Color::srgba(0.76, 0.05, 0.04, 0.0),
            Vec2::new(2200.0, 900.0),
        ),
        Transform::from_xyz(0.0, -55.0, 8.0),
        SuspicionGlow,
    ));
}

fn spawn_retro_sky(commands: &mut Commands, backgrounds: &BackgroundAssets) {
    for (index, y, z, scale, speed, alpha) in [
        (0, 268.0, -33.4, 0.93, -8.0, 0.54),
        (1, 193.0, -32.8, 0.92, -18.0, 0.50),
        (2, 104.0, -31.9, 0.94, -34.0, 0.46),
    ] {
        spawn_parallax_image_strip(commands, backgrounds, index, y, z, scale, speed, alpha);
    }
}

fn spawn_parallax_image_strip(
    commands: &mut Commands,
    backgrounds: &BackgroundAssets,
    index: usize,
    y: f32,
    z: f32,
    scale: f32,
    speed: f32,
    alpha: f32,
) {
    let wrap_width = 1774.0 * scale;
    for tile in -1..=1 {
        let x = tile as f32 * wrap_width;
        let mut sprite = Sprite::from_atlas_image(
            backgrounds.parallax_texture.clone(),
            TextureAtlas {
                layout: backgrounds.parallax_atlas.clone(),
                index,
            },
        );
        sprite.color = Color::srgba(1.0, 1.0, 1.0, alpha);
        commands.spawn((
            sprite,
            Transform::from_xyz(x, y, z).with_scale(Vec3::splat(scale)),
            RetroSkyBand {
                base: Vec3::new(x, y, z),
                speed,
                wave: 0.0,
                wrap_width,
            },
        ));
    }
}

pub fn animate_world(
    time: Res<Time>,
    state: Res<GameState>,
    windows: Query<&Window, With<PrimaryWindow>>,
    mut backdrops: Query<
        (&EnvironmentBackdrop, &mut Sprite, &mut Transform),
        (Without<SuspicionGlow>, Without<PlayerAvatar>),
    >,
    mut parallax: Query<
        (&ParallaxLayer, &mut Transform),
        (
            Without<Helicopter>,
            Without<MovingCivet>,
            Without<PlayerAvatar>,
            Without<PlayerShadow>,
            Without<EnvironmentBackdrop>,
        ),
    >,
    mut sky: Query<
        (&RetroSkyBand, &mut Transform),
        (
            Without<ParallaxLayer>,
            Without<EnvironmentBackdrop>,
            Without<Helicopter>,
            Without<MovingCivet>,
            Without<PlayerAvatar>,
            Without<PlayerShadow>,
        ),
    >,
    mut helicopters: Query<
        (&Helicopter, &mut Transform),
        (
            Without<EnvironmentBackdrop>,
            Without<PlayerAvatar>,
            Without<PlayerShadow>,
            Without<MovingCivet>,
            Without<ParallaxLayer>,
        ),
    >,
    mut civets: Query<
        (&MovingCivet, &mut Transform),
        (
            Without<EnvironmentBackdrop>,
            Without<Helicopter>,
            Without<PlayerAvatar>,
            Without<PlayerShadow>,
            Without<ParallaxLayer>,
        ),
    >,
    mut players: Query<
        (&PlayerAvatar, &mut Transform),
        (
            Without<PlayerShadow>,
            Without<SuspicionGlow>,
            Without<EnvironmentBackdrop>,
            Without<Helicopter>,
            Without<MovingCivet>,
            Without<ParallaxLayer>,
        ),
    >,
    mut player_shadows: Query<
        &mut Transform,
        (
            With<PlayerShadow>,
            Without<EnvironmentBackdrop>,
            Without<PlayerAvatar>,
            Without<Helicopter>,
            Without<MovingCivet>,
            Without<ParallaxLayer>,
        ),
    >,
    mut glows: Query<
        &mut Sprite,
        (
            With<SuspicionGlow>,
            Without<PlayerAvatar>,
            Without<EnvironmentBackdrop>,
        ),
    >,
) {
    let t = time.elapsed_secs();
    let base = Vec3::new(
        315.0 + (t * 0.9).sin() * 42.0,
        240.0 + (t * 1.7).cos() * 7.0,
        3.0,
    );
    for (helicopter, mut transform) in &mut helicopters {
        transform.translation = base + helicopter.offset;
    }

    let cycle = (t / 96.0).fract();
    let backdrop_scale = windows
        .single()
        .map(|window| {
            (window.width() / BACKDROP_TILE_SIZE).max(window.height() / BACKDROP_TILE_SIZE)
                * BACKDROP_OVERSCAN
        })
        .unwrap_or(2.38);
    for (backdrop, mut sprite, mut transform) in &mut backdrops {
        let alpha = backdrop_alpha(cycle, backdrop.phase);
        let tint = world_modifier_tint(&state);
        sprite.color = tint.with_alpha(alpha);
        transform.scale = Vec3::splat(backdrop_scale);
    }
    for (layer, mut transform) in &mut parallax {
        let drift = (t * layer.speed * 0.04).sin() * layer.amplitude;
        transform.translation.x = layer.base.x + drift;
        transform.translation.y = layer.base.y + (t * layer.speed * 0.025).cos() * 3.0;
    }

    for (band, mut transform) in &mut sky {
        let offset = (t * band.speed + band.wave).rem_euclid(band.wrap_width);
        transform.translation.x = band.base.x + offset;
        transform.translation.y = band.base.y + (t * 0.55 + band.wave).sin() * 2.5;
    }

    for (civet, mut transform) in &mut civets {
        let (speed, walk_range, bob_range, scale_y) = match civet.behavior {
            CivetBehavior::Asleep => (0.28, 2.0, 1.0, 0.90),
            CivetBehavior::Hungry => (2.20, 24.0, 5.5, 1.02),
            CivetBehavior::Curious => (1.55, 18.0, 6.0, 1.04),
            CivetBehavior::Content => (1.05, 12.0, 3.0, 1.0),
        };
        let walk = (t * speed + civet.phase).sin();
        let bob = (t * speed * 1.8 + civet.phase).cos();
        transform.translation.x = civet.base.x + walk * walk_range;
        transform.translation.y = civet.base.y + bob * bob_range;
        transform.translation.z = ground_z(transform.translation.y) + 0.2;
        transform.rotation = Quat::from_rotation_z(walk * 0.035);
        transform.scale.y = transform.scale.x.abs() * scale_y;
    }

    for (avatar, mut transform) in &mut players {
        let stride = (t * 10.0).sin();
        let hop = if avatar.jumping { 20.0 } else { 0.0 };
        let lift = if avatar.moving {
            stride.abs() * 7.0 + hop
        } else {
            hop
        };
        let squash = if avatar.moving {
            stride.abs() * 0.015
        } else {
            0.0
        };
        transform.translation.y = state.player_y + lift;
        transform.translation.z = ground_z(state.player_y) + 0.8;
        transform.rotation =
            Quat::from_rotation_z(if avatar.moving { stride * 0.025 } else { 0.0 });
        transform.scale = Vec3::new(0.26 * avatar.facing, 0.26 + squash, 0.26);
    }

    for mut transform in &mut player_shadows {
        transform.translation.x = state.player_x;
        transform.translation.y = state.player_y - 68.0;
        transform.translation.z = ground_z(state.player_y) - 0.3;
        let width = if state.player_y < -185.0 { 1.10 } else { 0.96 };
        transform.scale = Vec3::new(width, 0.78, 1.0);
    }

    let pulse = 0.5 + 0.5 * (t * 4.0).sin();
    let alpha = if state.inspection {
        0.30 + pulse * 0.18
    } else if state
        .daily_modifier
        .as_ref()
        .is_some_and(|modifier| modifier.kind == DailyModifierKind::MarketRush)
    {
        (state.suspicion / 100.0) * (0.07 + pulse * 0.13)
    } else {
        (state.suspicion / 100.0) * (0.04 + pulse * 0.10)
    };
    for mut sprite in &mut glows {
        sprite.color = Color::srgba(0.90, 0.03, 0.02, alpha);
    }
}

pub fn move_player(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<GameState>,
    mut players: Query<
        (&mut Transform, &mut PlayerAvatar),
        (Without<PlayerLabel>, Without<PlayerShadow>),
    >,
    mut labels: Query<
        &mut Transform,
        (
            With<PlayerLabel>,
            Without<PlayerAvatar>,
            Without<PlayerShadow>,
        ),
    >,
    mut shadows: Query<
        &mut Transform,
        (
            With<PlayerShadow>,
            Without<PlayerAvatar>,
            Without<PlayerLabel>,
        ),
    >,
) {
    if state.screen != GameScreen::Playing
        || state.inspection
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        for (_, mut avatar) in &mut players {
            avatar.moving = false;
            avatar.jumping = false;
        }
        return;
    }

    let mut delta = Vec2::ZERO;
    if keys.pressed(KeyCode::ArrowLeft) || keys.pressed(KeyCode::KeyA) {
        delta.x -= 1.0;
    }
    if keys.pressed(KeyCode::ArrowRight) || keys.pressed(KeyCode::KeyD) {
        delta.x += 1.0;
    }
    let jumping = keys.pressed(KeyCode::Space);

    if delta == Vec2::ZERO && !jumping {
        for (_, mut avatar) in &mut players {
            avatar.moving = false;
            avatar.jumping = false;
        }
        return;
    }

    let speed = 205.0;
    let step = if delta == Vec2::ZERO {
        Vec2::ZERO
    } else {
        delta.normalize() * speed * time.delta_secs()
    };
    state.player_x += step.x;

    let floor = walkable_floor(state.current_room);
    if state.player_x < floor.min_x {
        let next_room = exit_left(state.current_room);
        walk_to_room(
            &mut state,
            next_room,
            walkable_floor(next_room).max_x - 20.0,
        );
    } else if state.player_x > floor.max_x {
        let next_room = exit_right(state.current_room);
        walk_to_room(
            &mut state,
            next_room,
            walkable_floor(next_room).min_x + 20.0,
        );
    } else {
        state.player_x = state.player_x.clamp(floor.min_x, floor.max_x);
    }
    clamp_player_to_floor(&mut state);

    for (mut transform, mut avatar) in &mut players {
        transform.translation.x = state.player_x;
        transform.translation.y = state.player_y;
        avatar.facing = if step.x < -0.1 {
            1.0
        } else if step.x > 0.1 {
            -1.0
        } else {
            avatar.facing
        };
        avatar.moving = step.x.abs() > 0.1;
        avatar.jumping = jumping;
    }
    for mut transform in &mut labels {
        transform.translation.x = state.player_x;
        transform.translation.y = state.player_y - 94.0;
    }
    for mut transform in &mut shadows {
        transform.translation.x = state.player_x;
        transform.translation.y = state.player_y - 68.0;
    }
}

fn walk_to_room(state: &mut GameState, room: PlantationRoom, player_x: f32) {
    if state.current_room == room {
        state.player_x = player_x;
        clamp_player_to_floor(state);
        return;
    }
    state.current_room = room;
    state.player_x = player_x;
    state.player_y = default_ground_y(room);
    clamp_player_to_floor(state);
    state.selected_civet = None;
    state.dirty_visuals = true;
    if state.language == crate::model::Language::Swedish {
        state.log_line(format!("Gick till {}.", room_name(room, state.language)));
    } else {
        state.log_line(format!("Walked to {}.", room_name(room, state.language)));
    }
}

fn exit_left(room: PlantationRoom) -> PlantationRoom {
    match room {
        PlantationRoom::Sanctuary => PlantationRoom::PaperworkOffice,
        PlantationRoom::CoffeeField => PlantationRoom::Sanctuary,
        PlantationRoom::Roastery => PlantationRoom::CoffeeField,
        PlantationRoom::PaperworkOffice => PlantationRoom::Roastery,
    }
}

fn exit_right(room: PlantationRoom) -> PlantationRoom {
    match room {
        PlantationRoom::Sanctuary => PlantationRoom::CoffeeField,
        PlantationRoom::CoffeeField => PlantationRoom::Roastery,
        PlantationRoom::Roastery => PlantationRoom::PaperworkOffice,
        PlantationRoom::PaperworkOffice => PlantationRoom::Sanctuary,
    }
}

#[derive(Clone, Copy)]
struct WalkableFloor {
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
}

#[derive(Clone, Copy)]
struct SurfaceAnchor {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Clone, Copy)]
struct RoomLayout {
    floor: WalkableFloor,
    left_sign: Vec2,
    right_sign: Vec2,
    main_table: SurfaceAnchor,
    side_table: SurfaceAnchor,
    perch: SurfaceAnchor,
}

#[derive(Clone, Copy)]
enum AnchorId {
    MainTable,
    SideTable,
    Perch,
}

fn room_layout(room: PlantationRoom) -> RoomLayout {
    let floor = WalkableFloor {
        min_x: -520.0,
        max_x: 520.0,
        min_y: -252.0,
        max_y: -240.0,
    };
    match room {
        PlantationRoom::Sanctuary => RoomLayout {
            floor,
            left_sign: Vec2::new(-455.0, -260.0),
            right_sign: Vec2::new(430.0, -260.0),
            main_table: SurfaceAnchor {
                x: 0.0,
                y: -203.0,
                width: 430.0,
                height: 28.0,
            },
            side_table: SurfaceAnchor {
                x: -330.0,
                y: -225.0,
                width: 170.0,
                height: 32.0,
            },
            perch: SurfaceAnchor {
                x: -6.0,
                y: -151.0,
                width: 300.0,
                height: 24.0,
            },
        },
        PlantationRoom::CoffeeField => RoomLayout {
            floor,
            left_sign: Vec2::new(-455.0, -260.0),
            right_sign: Vec2::new(430.0, -260.0),
            main_table: SurfaceAnchor {
                x: -246.0,
                y: -212.0,
                width: 455.0,
                height: 24.0,
            },
            side_table: SurfaceAnchor {
                x: 390.0,
                y: -185.0,
                width: 170.0,
                height: 30.0,
            },
            perch: SurfaceAnchor {
                x: -250.0,
                y: -174.0,
                width: 455.0,
                height: 30.0,
            },
        },
        PlantationRoom::Roastery => RoomLayout {
            floor,
            left_sign: Vec2::new(-455.0, -260.0),
            right_sign: Vec2::new(430.0, -260.0),
            main_table: SurfaceAnchor {
                x: -185.0,
                y: -170.0,
                width: 500.0,
                height: 42.0,
            },
            side_table: SurfaceAnchor {
                x: 235.0,
                y: -160.0,
                width: 260.0,
                height: 34.0,
            },
            perch: SurfaceAnchor {
                x: -330.0,
                y: -74.0,
                width: 190.0,
                height: 26.0,
            },
        },
        PlantationRoom::PaperworkOffice => RoomLayout {
            floor,
            left_sign: Vec2::new(-455.0, -260.0),
            right_sign: Vec2::new(430.0, -260.0),
            main_table: SurfaceAnchor {
                x: -110.0,
                y: -165.0,
                width: 520.0,
                height: 42.0,
            },
            side_table: SurfaceAnchor {
                x: 250.0,
                y: -150.0,
                width: 220.0,
                height: 32.0,
            },
            perch: SurfaceAnchor {
                x: -320.0,
                y: -72.0,
                width: 190.0,
                height: 26.0,
            },
        },
    }
}

fn walkable_floor(room: PlantationRoom) -> WalkableFloor {
    room_layout(room).floor
}

fn default_ground_y(room: PlantationRoom) -> f32 {
    let floor = walkable_floor(room);
    (floor.min_y + floor.max_y) * 0.5
}

fn clamp_player_to_floor(state: &mut GameState) {
    let floor = walkable_floor(state.current_room);
    state.player_x = state.player_x.clamp(floor.min_x, floor.max_x);
    state.player_y = state.player_y.clamp(floor.min_y, floor.max_y);
}

fn ground_z(y: f32) -> f32 {
    3.0 + (-y + 280.0) * 0.006
}

fn anchor(room: PlantationRoom, id: AnchorId) -> SurfaceAnchor {
    let layout = room_layout(room);
    match id {
        AnchorId::MainTable => layout.main_table,
        AnchorId::SideTable => layout.side_table,
        AnchorId::Perch => layout.perch,
    }
}

fn anchor_slot(surface: SurfaceAnchor, index: u32, count: u32, y_offset: f32) -> Vec2 {
    let count = count.max(1);
    let spacing = if count == 1 {
        0.0
    } else {
        surface.width * 0.74 / (count - 1) as f32
    };
    let x = surface.x - surface.width * 0.37 + spacing * index as f32;
    Vec2::new(x, surface.y + surface.height * 0.45 + y_offset)
}

fn backdrop_alpha(cycle: f32, phase: usize) -> f32 {
    let centers = [0.08, 0.34, 0.62, 0.86];
    let mut weights = [0.0; 4];
    for (index, center) in centers.iter().enumerate() {
        let distance = circular_distance(cycle, *center);
        let weight = (1.0_f32 - distance / 0.28).clamp(0.0, 1.0);
        weights[index] = weight * weight;
    }
    let total: f32 = weights.iter().sum();
    if total <= 0.0 {
        if phase == 1 { 1.0 } else { 0.0 }
    } else {
        weights[phase] / total
    }
}

fn world_modifier_tint(state: &GameState) -> Color {
    match state.daily_modifier.as_ref().map(|modifier| modifier.kind) {
        Some(DailyModifierKind::RainyHarvest) => Color::srgb(0.76, 0.88, 1.0),
        Some(DailyModifierKind::QuietNewsDay) => Color::srgb(0.90, 0.96, 0.92),
        Some(DailyModifierKind::BureaucracyDay) => Color::srgb(0.92, 0.95, 1.0),
        Some(DailyModifierKind::MarketRush) => Color::srgb(1.0, 0.90, 0.70),
        None => Color::WHITE,
    }
}

fn circular_distance(a: f32, b: f32) -> f32 {
    let distance = (a - b).abs();
    distance.min(1.0 - distance)
}

pub fn refresh_world_visuals(
    mut commands: Commands,
    mut state: ResMut<GameState>,
    characters: Res<CharacterAssets>,
    props: Res<PropAssets>,
    skin: Res<UiSkinAssets>,
    visuals: Query<Entity, With<WorldVisual>>,
) {
    if !state.dirty_visuals {
        return;
    }
    for entity in &visuals {
        commands.entity(entity).despawn();
    }

    clamp_player_to_floor(&mut state);
    spawn_room_title(&mut commands, &state);
    spawn_walkable_floor(&mut commands, state.current_room);
    spawn_room_exits(&mut commands, &state);
    match state.current_room {
        PlantationRoom::Sanctuary => {
            spawn_sanctuary_room(&mut commands, &state, &characters, &props, &skin)
        }
        PlantationRoom::CoffeeField => spawn_coffee_field_room(&mut commands, &state, &props),
        PlantationRoom::Roastery => spawn_roastery_room(&mut commands, &state, &props, &skin),
        PlantationRoom::PaperworkOffice => {
            spawn_paperwork_office_room(&mut commands, &state, &props, &skin)
        }
    }
    spawn_world_context(&mut commands, &state);
    if state.show_layout_guides {
        spawn_layout_guides(&mut commands, state.current_room);
    }
    spawn_player(&mut commands, &characters, &state);

    state.dirty_visuals = false;
}

fn prop_sprite(props: &PropAssets, index: usize) -> Sprite {
    Sprite::from_atlas_image(
        props.texture.clone(),
        TextureAtlas {
            layout: props.atlas.clone(),
            index,
        },
    )
}

fn spawn_player(commands: &mut Commands, characters: &CharacterAssets, state: &GameState) {
    commands.spawn((
        Sprite::from_color(Color::srgba(0.05, 0.035, 0.02, 0.26), Vec2::new(86.0, 28.0)),
        Transform::from_xyz(
            state.player_x,
            state.player_y - 68.0,
            ground_z(state.player_y) - 0.3,
        ),
        PlayerShadow,
        WorldVisual,
    ));
    commands.spawn((
        Sprite::from_atlas_image(
            characters.texture.clone(),
            TextureAtlas {
                layout: characters.atlas.clone(),
                index: 3,
            },
        ),
        Transform::from_xyz(
            state.player_x,
            state.player_y,
            ground_z(state.player_y) + 0.8,
        )
        .with_scale(Vec3::splat(0.26)),
        PlayerAvatar {
            facing: 1.0,
            moving: false,
            jumping: false,
        },
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(world_label(state, "owner")),
        TextFont {
            font_size: 13.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.88, 0.62)),
        Transform::from_xyz(
            state.player_x,
            state.player_y - 94.0,
            ground_z(state.player_y) + 1.2,
        ),
        PlayerLabel,
        WorldVisual,
    ));
}

fn spawn_walkable_floor(commands: &mut Commands, room: PlantationRoom) {
    let floor = walkable_floor(room);
    let warmth = match room {
        PlantationRoom::Sanctuary => Color::srgba(0.55, 0.34, 0.12, 0.08),
        PlantationRoom::CoffeeField => Color::srgba(0.20, 0.45, 0.16, 0.07),
        PlantationRoom::Roastery => Color::srgba(0.42, 0.22, 0.10, 0.08),
        PlantationRoom::PaperworkOffice => Color::srgba(0.50, 0.32, 0.17, 0.07),
    };

    let center_x = (floor.min_x + floor.max_x) * 0.5;
    let center_y = (floor.min_y + floor.max_y) * 0.5;
    let width = floor.max_x - floor.min_x + 70.0;
    let height = floor.max_y - floor.min_y + 32.0;
    for (dy, alpha, scale) in [(-4.0, 0.05, 1.08), (0.0, 0.10, 1.0), (5.0, 0.06, 0.92)] {
        commands.spawn((
            Sprite::from_color(warmth.with_alpha(alpha), Vec2::new(width * scale, height)),
            Transform::from_xyz(center_x, center_y + dy, -3.6)
                .with_rotation(Quat::from_rotation_z(-0.015)),
            WorldVisual,
        ));
    }
}

fn spawn_room_title(commands: &mut Commands, state: &GameState) {
    let (title, subtitle, color) = match state.current_room {
        PlantationRoom::Sanctuary => (
            if state.language == crate::model::Language::Swedish {
                "FRISTAD"
            } else {
                "SANCTUARY ROOM"
            },
            if state.language == crate::model::Language::Swedish {
                "Mjuka tassar, snackbrickor och välfärdsoptik."
            } else {
                "Soft paws, snack trays, and welfare optics."
            },
            Color::srgb(1.0, 0.76, 0.64),
        ),
        PlantationRoom::CoffeeField => (
            if state.language == crate::model::Language::Swedish {
                "KAFFEFÄLT"
            } else {
                "COFFEE FIELD"
            },
            if state.language == crate::model::Language::Swedish {
                "Frukten växer snabbt. Frågorna också."
            } else {
                "Fruit grows fast. So do questions."
            },
            Color::srgb(0.78, 1.0, 0.46),
        ),
        PlantationRoom::Roastery => (
            if state.language == crate::model::Language::Swedish {
                "ROSTERI"
            } else {
                "ROASTERY"
            },
            if state.language == crate::model::Language::Swedish {
                "Hantverksrök med olyckliga silhuetter."
            } else {
                "Artisanal smoke with unfortunate silhouettes."
            },
            Color::srgb(1.0, 0.72, 0.38),
        ),
        PlantationRoom::PaperworkOffice => (
            if state.language == crate::model::Language::Swedish {
                "PAPPERSKONTOR"
            } else {
                "PAPERWORK OFFICE"
            },
            if state.language == crate::model::Language::Swedish {
                "Kvitton, tillstånd, hovavtryck och strategiskt lugn."
            } else {
                "Receipts, permits, hoofprints, and strategic calm."
            },
            Color::srgb(0.78, 0.92, 1.0),
        ),
    };

    commands.spawn((
        Text2d::new(title),
        TextFont {
            font_size: 23.0,
            ..default()
        },
        TextColor(color),
        Transform::from_xyz(10.0, 300.0, 2.0),
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(subtitle),
        TextFont {
            font_size: 18.0,
            ..default()
        },
        TextColor(Color::srgba(0.94, 0.86, 0.62, 0.86)),
        Transform::from_xyz(10.0, 270.0, 2.0),
        WorldVisual,
    ));
}

fn spawn_world_context(commands: &mut Commands, state: &GameState) {
    if state.daily_modifier.as_ref().is_some_and(|modifier| {
        modifier.kind == DailyModifierKind::RainyHarvest
            && state.current_room == PlantationRoom::CoffeeField
    }) {
        for i in 0..18 {
            let x = -520.0 + i as f32 * 62.0;
            let y = 255.0 - (i % 5) as f32 * 34.0;
            commands.spawn((
                Sprite::from_color(Color::srgba(0.62, 0.78, 1.0, 0.34), Vec2::new(4.0, 54.0)),
                Transform::from_xyz(x, y, 4.7).with_rotation(Quat::from_rotation_z(-0.28)),
                WorldVisual,
            ));
        }
    }

    if state.daily_modifier.as_ref().is_some_and(|modifier| {
        modifier.kind == DailyModifierKind::BureaucracyDay
            && state.current_room == PlantationRoom::PaperworkOffice
    }) {
        spawn_context_badge(
            commands,
            if state.language == crate::model::Language::Swedish {
                "Medvind i pappren"
            } else {
                "Paperwork tailwind"
            },
            -318.0,
            -104.0,
            Color::srgba(0.66, 0.84, 1.0, 0.28),
        );
    }

    if state.daily_modifier.as_ref().is_some_and(|modifier| {
        modifier.kind == DailyModifierKind::MarketRush
            && state.current_room == PlantationRoom::Roastery
    }) {
        spawn_context_badge(
            commands,
            if state.language == crate::model::Language::Swedish {
                "Köpare väntar"
            } else {
                "Buyers waiting"
            },
            332.0,
            -96.0,
            Color::srgba(1.0, 0.74, 0.26, 0.30),
        );
    }

    let event_kind = state.event.as_ref().map(|event| event.kind);
    match (state.current_room, event_kind) {
        (PlantationRoom::Sanctuary, Some(RandomEventKind::TouristGroup)) => {
            spawn_context_badge(
                commands,
                if state.language == crate::model::Language::Swedish {
                    "Turister vid grindarna"
                } else {
                    "Tourists at gate"
                },
                -308.0,
                -92.0,
                Color::srgba(0.95, 0.86, 0.48, 0.30),
            );
        }
        (PlantationRoom::Roastery, Some(RandomEventKind::InfluencerVisit)) => {
            spawn_context_badge(
                commands,
                if state.language == crate::model::Language::Swedish {
                    "Kamera på"
                } else {
                    "Camera rolling"
                },
                0.0,
                -88.0,
                Color::srgba(0.92, 0.54, 1.0, 0.28),
            );
        }
        (PlantationRoom::PaperworkOffice, Some(RandomEventKind::PaperworkAudit)) => {
            spawn_context_badge(
                commands,
                if state.language == crate::model::Language::Swedish {
                    "Revision pågår"
                } else {
                    "Audit pending"
                },
                -54.0,
                -88.0,
                Color::srgba(0.72, 0.90, 1.0, 0.32),
            );
        }
        (PlantationRoom::CoffeeField, Some(RandomEventKind::Rainstorm)) => {
            spawn_context_badge(
                commands,
                if state.language == crate::model::Language::Swedish {
                    "Skyfall"
                } else {
                    "Rainstorm"
                },
                210.0,
                -96.0,
                Color::srgba(0.56, 0.72, 1.0, 0.30),
            );
        }
        _ => {}
    }
}

fn spawn_context_badge(commands: &mut Commands, label: &str, x: f32, y: f32, color: Color) {
    commands.spawn((
        Sprite::from_color(color, Vec2::new(190.0, 34.0)),
        Transform::from_xyz(x, y, 6.2),
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(label),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.94, 0.74)),
        Transform::from_xyz(x, y, 6.6),
        WorldVisual,
    ));
}

fn spawn_layout_guides(commands: &mut Commands, room: PlantationRoom) {
    let layout = room_layout(room);
    let floor = layout.floor;
    let center_x = (floor.min_x + floor.max_x) * 0.5;
    let center_y = (floor.min_y + floor.max_y) * 0.5;
    spawn_debug_rect(
        commands,
        center_x,
        center_y,
        floor.max_x - floor.min_x,
        floor.max_y - floor.min_y + 8.0,
        Color::srgba(0.20, 0.72, 1.0, 0.16),
        "walk lane",
        -2.4,
    );
    for (surface, label, color) in [
        (
            layout.main_table,
            "main surface",
            Color::srgba(1.0, 0.78, 0.22, 0.18),
        ),
        (
            layout.side_table,
            "side surface",
            Color::srgba(0.52, 1.0, 0.42, 0.16),
        ),
        (layout.perch, "perch", Color::srgba(1.0, 0.42, 0.82, 0.16)),
    ] {
        spawn_debug_rect(
            commands,
            surface.x,
            surface.y + surface.height * 0.38,
            surface.width * 0.82,
            surface.height + 12.0,
            color,
            label,
            ground_z(surface.y) + 0.55,
        );
    }
}

fn spawn_debug_rect(
    commands: &mut Commands,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    color: Color,
    label: &str,
    z: f32,
) {
    commands.spawn((
        Sprite::from_color(color, Vec2::new(width, height)),
        Transform::from_xyz(x, y, z),
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(label),
        TextFont {
            font_size: 10.0,
            ..default()
        },
        TextColor(Color::srgba(0.96, 0.98, 0.84, 0.72)),
        Transform::from_xyz(x, y + height * 0.5 + 9.0, z + 0.05),
        WorldVisual,
    ));
}

fn spawn_room_exits(commands: &mut Commands, state: &GameState) {
    let layout = room_layout(state.current_room);
    let left = exit_left(state.current_room);
    let right = exit_right(state.current_room);
    spawn_exit_sign(
        commands,
        layout.left_sign.x,
        layout.left_sign.y,
        format!("< {}", room_name(left, state.language)),
        room_action(left),
    );
    spawn_exit_sign(
        commands,
        layout.right_sign.x,
        layout.right_sign.y,
        format!("{} >", room_name(right, state.language)),
        room_action(right),
    );
}

fn spawn_exit_sign(commands: &mut Commands, x: f32, y: f32, label: String, action: Action) {
    let z = 8.1;
    let plank = Color::srgba(0.42, 0.23, 0.09, 0.92);
    let plank_hover = Color::srgba(0.58, 0.34, 0.13, 0.96);
    let plank_dark = Color::srgba(0.16, 0.08, 0.035, 0.80);
    let bamboo = Color::srgba(0.64, 0.39, 0.15, 0.88);
    let highlight = Color::srgba(0.95, 0.68, 0.30, 0.42);

    for dx in [-78.0, 78.0] {
        commands.spawn((
            Sprite::from_color(plank_dark, Vec2::new(14.0, 92.0)),
            Transform::from_xyz(x + dx + 3.0, y - 34.0, z - 0.25),
            WorldVisual,
        ));
        commands.spawn((
            Sprite::from_color(bamboo, Vec2::new(12.0, 88.0)),
            Transform::from_xyz(x + dx, y - 34.0, z - 0.2),
            WorldVisual,
        ));
        commands.spawn((
            Sprite::from_color(highlight, Vec2::new(3.0, 78.0)),
            Transform::from_xyz(x + dx - 3.0, y - 31.0, z - 0.1),
            WorldVisual,
        ));
    }

    commands.spawn((
        Sprite::from_color(plank_dark, Vec2::new(206.0, 56.0)),
        Transform::from_xyz(x + 4.0, y - 5.0, z - 0.05),
        WorldVisual,
    ));
    commands
        .spawn((
            Sprite::from_color(plank, Vec2::new(198.0, 48.0)),
            Transform::from_xyz(x, y, z),
            Pickable::default(),
            WorldActionTarget(action),
            WorldVisual,
        ))
        .observe(world_action_on_click)
        .observe(tint_sprite_on_hover(plank_hover))
        .observe(tint_sprite_on_out(plank));
    commands.spawn((
        Sprite::from_color(highlight, Vec2::new(178.0, 4.0)),
        Transform::from_xyz(x - 2.0, y + 15.0, z + 0.1),
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(label),
        TextFont {
            font_size: 13.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.92, 0.70)),
        Transform::from_xyz(x, y + 1.0, z + 0.4),
        WorldVisual,
    ));
}

fn room_action(room: PlantationRoom) -> Action {
    match room {
        PlantationRoom::Sanctuary => Action::GoSanctuary,
        PlantationRoom::CoffeeField => Action::GoCoffeeField,
        PlantationRoom::Roastery => Action::GoRoastery,
        PlantationRoom::PaperworkOffice => Action::GoPaperworkOffice,
    }
}

fn spawn_coffee_field_room(commands: &mut Commands, state: &GameState, props: &PropAssets) {
    let field = anchor(PlantationRoom::CoffeeField, AnchorId::Perch);
    let pots = anchor(PlantationRoom::CoffeeField, AnchorId::MainTable);
    let seedlings = anchor(PlantationRoom::CoffeeField, AnchorId::SideTable);
    spawn_wood_platform(
        commands,
        field.x,
        field.y,
        field.width,
        field.height,
        ground_z(field.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        pots.x,
        pots.y,
        pots.width,
        pots.height,
        ground_z(pots.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        seedlings.x,
        seedlings.y,
        seedlings.width,
        seedlings.height,
        ground_z(seedlings.y) - 0.3,
    );

    let plant_count = state.coffee_plants.min(12);
    for i in 0..plant_count {
        let slot = anchor_slot(pots, i, plant_count, 0.0);
        let x = slot.x;
        let y = slot.y;
        spawn_contact_shadow(commands, x, y - 15.0, 34.0, 9.0, ground_z(y) - 0.35);
        commands
            .spawn((
                prop_sprite(props, 1),
                Transform::from_xyz(x, y, ground_z(y)).with_scale(Vec3::splat(0.13)),
                Pickable::default(),
                WorldActionTarget(Action::HarvestFruit),
                WorldVisual,
            ))
            .observe(world_action_on_click)
            .observe(tint_sprite_on_hover(Color::srgb(0.10, 0.64, 0.25)))
            .observe(tint_sprite_on_out(Color::srgb(0.05, 0.48, 0.19)));
        commands.spawn((
            Sprite::from_color(Color::srgb(0.88, 0.12, 0.08), Vec2::new(7.0, 7.0)),
            Transform::from_xyz(x + 6.0, y + 6.0, ground_z(y) + 0.4),
            WorldVisual,
        ));
    }

    for i in 0..5 {
        let slot = anchor_slot(field, i, 5, 0.0);
        let x = slot.x;
        let y = slot.y + (i % 2) as f32 * 4.0;
        spawn_contact_shadow(commands, x, y - 20.0, 70.0, 16.0, ground_z(y) - 0.35);
        commands
            .spawn((
                prop_sprite(props, 2),
                Transform::from_xyz(x, y, ground_z(y)).with_scale(Vec3::splat(0.22)),
                Pickable::default(),
                WorldActionTarget(Action::HarvestFruit),
                WorldVisual,
            ))
            .observe(world_action_on_click)
            .observe(tint_sprite_on_hover(Color::srgb(0.72, 0.48, 0.20)))
            .observe(tint_sprite_on_out(Color::srgb(0.58, 0.38, 0.16)));
        commands.spawn((
            Text2d::new(world_label(state, "fruit")),
            TextFont {
                font_size: 12.0,
                ..default()
            },
            TextColor(Color::srgb(1.0, 0.78, 0.52)),
            Transform::from_xyz(x, y, ground_z(y) + 0.6),
            WorldVisual,
        ));
    }

    let seed_slot = anchor_slot(seedlings, 0, 1, 0.0);
    spawn_contact_shadow(
        commands,
        seed_slot.x,
        seed_slot.y - 18.0,
        76.0,
        18.0,
        ground_z(seed_slot.y) - 0.35,
    );
    commands
        .spawn((
            prop_sprite(props, 0),
            Transform::from_xyz(seed_slot.x, seed_slot.y, ground_z(seed_slot.y))
                .with_scale(Vec3::splat(0.26)),
            Pickable::default(),
            WorldActionTarget(Action::PlantCoffee),
            WorldVisual,
        ))
        .observe(world_action_on_click)
        .observe(tint_sprite_on_hover(Color::srgb(0.36, 0.55, 0.22)))
        .observe(tint_sprite_on_out(Color::srgb(0.28, 0.42, 0.18)));
    commands.spawn((
        Text2d::new(world_label(state, "seedlings")),
        TextFont {
            font_size: 15.0,
            ..default()
        },
        TextColor(Color::srgb(0.92, 1.0, 0.72)),
        Transform::from_xyz(seed_slot.x, seed_slot.y, ground_z(seed_slot.y) + 0.6),
        WorldVisual,
    ));

    commands.spawn((
        Text2d::new(format!(
            "{}: {:.0}",
            world_label(state, "fruit_on_hand"),
            state.coffee_fruit
        )),
        TextFont {
            font_size: 20.0,
            ..default()
        },
        TextColor(Color::srgb(0.95, 1.0, 0.74)),
        Transform::from_xyz(205.0, -128.0, 5.0),
        WorldVisual,
    ));
    spawn_action_plaque(
        commands,
        world_label(state, "field_harvest_sign"),
        Action::HarvestFruit,
        pots.x,
        pots.y - 58.0,
        126.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "field_plant_sign"),
        Action::PlantCoffee,
        seedlings.x,
        seedlings.y - 58.0,
        118.0,
    );

    spawn_prop(commands, props, 15, 525.0, -170.0, 0.34, ground_z(-170.0));
    if state.goat_present {
        spawn_goat(
            commands,
            props,
            496.0,
            -224.0,
            world_label(state, "field_goat"),
        );
    }

    spawn_room_hint(commands, &field_hint(state));
}

fn spawn_sanctuary_room(
    commands: &mut Commands,
    state: &GameState,
    characters: &CharacterAssets,
    props: &PropAssets,
    _skin: &UiSkinAssets,
) {
    spawn_civet_perch(commands);
    let main_perch = anchor(PlantationRoom::Sanctuary, AnchorId::MainTable);
    let high_perch = anchor(PlantationRoom::Sanctuary, AnchorId::Perch);
    let snack_table = anchor(PlantationRoom::Sanctuary, AnchorId::SideTable);

    for i in 0..14 {
        let surface = if i < 7 { main_perch } else { high_perch };
        let slot = anchor_slot(surface, i % 7, 7, 0.0);
        let x = slot.x;
        let y = slot.y + (i / 7) as f32 * 6.0 + (i % 2) as f32 * 4.0;
        spawn_prop(commands, props, 15, x, y, 0.18, ground_z(y) - 0.2);
    }
    for (x, y) in [
        (-245.0, -188.0),
        (-220.0, -235.0),
        (245.0, -188.0),
        (220.0, -236.0),
    ] {
        spawn_prop(commands, props, 0, x, y, 0.13, ground_z(y) - 0.1);
    }
    commands.spawn((
        Text2d::new(world_label(state, "civet_garden")),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.86, 0.56)),
        Transform::from_xyz(40.0, -160.0, 5.0),
        WorldVisual,
    ));

    for i in 0..state.civets.min(10) {
        let surface = if i < 5 { main_perch } else { high_perch };
        let slot = anchor_slot(surface, i % 5, 5, -2.0);
        let x = slot.x;
        let y = slot.y + (i / 5) as f32 * 4.0;
        spawn_contact_shadow(commands, x, y - 13.0, 45.0, 14.0, 2.7);
        commands
            .spawn((
                Sprite::from_atlas_image(
                    characters.texture.clone(),
                    TextureAtlas {
                        layout: characters.atlas.clone(),
                        index: i as usize % 3,
                    },
                ),
                Transform::from_xyz(x, y + 2.0, 3.0).with_scale(Vec3::splat(0.105)),
                Pickable::default(),
                CivetClickTarget { index: i as usize },
                MovingCivet {
                    base: Vec3::new(x, y + 2.0, ground_z(y) + 0.2),
                    phase: i as f32 * 1.7,
                    behavior: state
                        .civet_profiles
                        .get(i as usize)
                        .map(civet_behavior)
                        .unwrap_or(CivetBehavior::Content),
                },
                WorldVisual,
            ))
            .observe(select_civet_on_click)
            .observe(tint_sprite_on_hover(Color::srgb(1.0, 0.92, 0.74)))
            .observe(tint_sprite_on_out(Color::WHITE));
        if let Some(profile) = state.civet_profiles.get(i as usize) {
            let selected = state.selected_civet == Some(i as usize);
            let label = if selected {
                format!(
                    "{}  {}  {:.0}%",
                    profile.name,
                    civet_status_label(profile, state.language),
                    profile.mood
                )
            } else {
                format!(
                    "{} {}",
                    profile.name,
                    civet_status_label(profile, state.language)
                )
            };
            commands.spawn((
                Text2d::new(label),
                TextFont {
                    font_size: 11.0,
                    ..default()
                },
                TextColor(if selected {
                    Color::srgb(1.0, 0.95, 0.46)
                } else {
                    Color::srgb(1.0, 0.86, 0.64)
                }),
                Transform::from_xyz(x, y - 21.0, 5.0),
                WorldVisual,
            ));
        }
    }

    if state.binturong_home {
        spawn_contact_shadow(commands, 118.0, -154.0, 88.0, 24.0, 2.7);
        spawn_prop(
            commands,
            props,
            11,
            118.0,
            -144.0,
            0.28,
            ground_z(-144.0) + 0.1,
        );
        commands.spawn((
            Text2d::new(world_label(state, "binturong")),
            TextFont {
                font_size: 13.0,
                ..default()
            },
            TextColor(Color::srgb(0.95, 0.87, 0.68)),
            Transform::from_xyz(118.0, -115.0, 5.0),
            WorldVisual,
        ));
    }

    if state.goat_present {
        spawn_goat(commands, props, -292.0, -224.0, world_label(state, "goat"));
    }

    let snack_slot = anchor_slot(snack_table, 0, 1, 0.0);
    spawn_prop(
        commands,
        props,
        12,
        snack_slot.x,
        snack_slot.y,
        0.42,
        ground_z(snack_slot.y),
    );
    commands.spawn((
        Text2d::new(world_label(state, "snack_trays")),
        TextFont {
            font_size: 15.0,
            ..default()
        },
        TextColor(Color::srgb(0.22, 0.11, 0.08)),
        Transform::from_xyz(snack_slot.x, snack_slot.y, 5.0),
        WorldVisual,
    ));
    spawn_action_plaque(
        commands,
        world_label(state, "sanctuary_feed_sign"),
        Action::FeedCivets,
        snack_slot.x,
        snack_slot.y - 46.0,
        116.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "sanctuary_beans_sign"),
        Action::CollectBeans,
        0.0,
        -241.0,
        122.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "care_brush_sign"),
        Action::UseTinyBrush,
        -176.0,
        -241.0,
        82.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "care_collar_sign"),
        Action::UseRibbonCollar,
        -88.0,
        -241.0,
        86.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "care_puzzle_sign"),
        Action::UseFruitPuzzle,
        88.0,
        -241.0,
        86.0,
    );

    spawn_room_hint(commands, &sanctuary_hint(state));
}

fn civet_behavior(profile: &crate::model::CivetProfile) -> CivetBehavior {
    if profile.hunger > 76.0 {
        CivetBehavior::Hungry
    } else if profile.mood < 35.0 {
        CivetBehavior::Asleep
    } else if profile.mood > 78.0 {
        CivetBehavior::Curious
    } else {
        CivetBehavior::Content
    }
}

fn spawn_roastery_room(
    commands: &mut Commands,
    state: &GameState,
    props: &PropAssets,
    _skin: &UiSkinAssets,
) {
    let main_table = anchor(PlantationRoom::Roastery, AnchorId::MainTable);
    let bag_table = anchor(PlantationRoom::Roastery, AnchorId::SideTable);
    let bean_table = anchor(PlantationRoom::Roastery, AnchorId::Perch);
    spawn_wood_platform(
        commands,
        main_table.x,
        main_table.y,
        main_table.width,
        main_table.height,
        ground_z(main_table.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        bag_table.x,
        bag_table.y,
        bag_table.width,
        bag_table.height,
        ground_z(bag_table.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        bean_table.x,
        bean_table.y,
        bean_table.width,
        bean_table.height,
        ground_z(bean_table.y) - 0.3,
    );
    let bean_slot = anchor_slot(bean_table, 0, 1, 0.0);
    let accessory_a = anchor_slot(main_table, 2, 5, 0.0);
    let accessory_b = anchor_slot(main_table, 3, 5, 16.0);
    spawn_prop(
        commands,
        props,
        4,
        bean_slot.x,
        bean_slot.y,
        0.22,
        ground_z(bean_slot.y),
    );
    spawn_prop(
        commands,
        props,
        3,
        accessory_a.x,
        accessory_a.y,
        0.20,
        ground_z(accessory_a.y),
    );
    spawn_prop(
        commands,
        props,
        14,
        accessory_b.x,
        accessory_b.y,
        0.24,
        ground_z(accessory_b.y),
    );
    let roaster_slot = anchor_slot(main_table, 1, 5, 0.0);
    spawn_contact_shadow(
        commands,
        roaster_slot.x,
        roaster_slot.y - 20.0,
        112.0,
        22.0,
        ground_z(roaster_slot.y) - 0.35,
    );
    commands
        .spawn((
            prop_sprite(props, 6),
            Transform::from_xyz(roaster_slot.x, roaster_slot.y, ground_z(roaster_slot.y))
                .with_scale(Vec3::splat(0.42)),
            Pickable::default(),
            WorldActionTarget(Action::RoastCoffee),
            WorldVisual,
        ))
        .observe(world_action_on_click)
        .observe(tint_sprite_on_hover(Color::srgb(0.70, 0.39, 0.16)))
        .observe(tint_sprite_on_out(Color::srgb(0.56, 0.30, 0.12)));
    commands.spawn((
        Text2d::new(world_label(state, "roaster")),
        TextFont {
            font_size: 18.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.78, 0.45)),
        Transform::from_xyz(
            roaster_slot.x,
            roaster_slot.y,
            ground_z(roaster_slot.y) + 0.4,
        ),
        WorldVisual,
    ));
    spawn_action_plaque(
        commands,
        world_label(state, "roast_sign"),
        Action::RoastCoffee,
        roaster_slot.x,
        roaster_slot.y - 58.0,
        88.0,
    );
    for i in 0..6 {
        let slot = anchor_slot(bag_table, i % 3, 3, (i / 3) as f32 * 22.0);
        let x = slot.x;
        let y = slot.y;
        spawn_contact_shadow(commands, x, y - 16.0, 42.0, 12.0, ground_z(y) - 0.35);
        commands
            .spawn((
                prop_sprite(props, 5),
                Transform::from_xyz(x, y, ground_z(y)).with_scale(Vec3::splat(0.23)),
                Pickable::default(),
                WorldActionTarget(Action::SellCoffee),
                WorldVisual,
            ))
            .observe(world_action_on_click)
            .observe(tint_sprite_on_hover(Color::srgb(0.72, 0.49, 0.24)))
            .observe(tint_sprite_on_out(Color::srgb(0.58, 0.39, 0.18)));
        commands.spawn((
            Text2d::new(world_label(state, "coffee")),
            TextFont {
                font_size: 11.0,
                ..default()
            },
            TextColor(Color::srgb(0.22, 0.12, 0.05)),
            Transform::from_xyz(x, y, ground_z(y) + 0.4),
            WorldVisual,
        ));
    }
    spawn_contact_shadow(
        commands,
        bean_slot.x,
        bean_slot.y - 16.0,
        74.0,
        16.0,
        ground_z(bean_slot.y) - 0.35,
    );
    commands
        .spawn((
            prop_sprite(props, 3),
            Transform::from_xyz(bean_slot.x, bean_slot.y, ground_z(bean_slot.y))
                .with_scale(Vec3::splat(0.30)),
            Pickable::default(),
            WorldActionTarget(Action::CollectBeans),
            WorldVisual,
        ))
        .observe(world_action_on_click)
        .observe(tint_sprite_on_hover(Color::srgb(0.28, 0.16, 0.09)))
        .observe(tint_sprite_on_out(Color::srgb(0.20, 0.12, 0.07)));
    commands.spawn((
        Text2d::new(world_label(state, "bean_crate")),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.78, 0.54)),
        Transform::from_xyz(bean_slot.x, bean_slot.y, ground_z(bean_slot.y) + 0.4),
        WorldVisual,
    ));

    commands.spawn((
        Text2d::new(format!(
            "{} {:.1}  |  {} {:.1}",
            world_label(state, "processed_beans"),
            state.processed_beans,
            world_label(state, "roasted_bags"),
            state.roasted_coffee
        )),
        TextFont {
            font_size: 20.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.84, 0.58)),
        Transform::from_xyz(135.0, -50.0, 4.0),
        WorldVisual,
    ));
    spawn_action_plaque(
        commands,
        world_label(state, "sell_sign"),
        Action::SellCoffee,
        bag_table.x - 76.0,
        bag_table.y - 58.0,
        82.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "deliver_sign"),
        Action::DeliverOrder,
        bag_table.x + 54.0,
        bag_table.y - 58.0,
        132.0,
    );

    spawn_room_hint(commands, &roastery_hint(state));
}

fn spawn_paperwork_office_room(
    commands: &mut Commands,
    state: &GameState,
    props: &PropAssets,
    _skin: &UiSkinAssets,
) {
    let desk = anchor(PlantationRoom::PaperworkOffice, AnchorId::MainTable);
    let office_table = anchor(PlantationRoom::PaperworkOffice, AnchorId::SideTable);
    let plant_shelf = anchor(PlantationRoom::PaperworkOffice, AnchorId::Perch);
    spawn_wood_platform(
        commands,
        desk.x,
        desk.y,
        desk.width,
        desk.height,
        ground_z(desk.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        office_table.x,
        office_table.y,
        office_table.width,
        office_table.height,
        ground_z(office_table.y) - 0.3,
    );
    spawn_wood_platform(
        commands,
        plant_shelf.x,
        plant_shelf.y,
        plant_shelf.width,
        plant_shelf.height,
        ground_z(plant_shelf.y) - 0.3,
    );
    let shelf_slot = anchor_slot(plant_shelf, 0, 1, 0.0);
    let office_plant = anchor_slot(office_table, 0, 2, 0.0);
    let clipboard = anchor_slot(office_table, 1, 2, 0.0);
    spawn_prop(
        commands,
        props,
        15,
        shelf_slot.x,
        shelf_slot.y,
        0.24,
        ground_z(shelf_slot.y),
    );
    spawn_prop(
        commands,
        props,
        15,
        office_plant.x,
        office_plant.y,
        0.22,
        ground_z(office_plant.y),
    );
    spawn_prop(
        commands,
        props,
        13,
        clipboard.x,
        clipboard.y,
        0.22,
        ground_z(clipboard.y),
    );
    for i in 0..7 {
        let slot = anchor_slot(desk, i, 7, (i % 2) as f32 * 8.0);
        let x = slot.x;
        let y = slot.y;
        spawn_contact_shadow(commands, x, y - 15.0, 38.0, 10.0, ground_z(y) - 0.35);
        commands
            .spawn((
                prop_sprite(props, 7),
                Transform::from_xyz(x, y, ground_z(y)).with_scale(Vec3::splat(0.20)),
                Pickable::default(),
                WorldActionTarget(Action::ShowPaperwork),
                WorldVisual,
            ))
            .observe(world_action_on_click)
            .observe(tint_sprite_on_hover(Color::srgb(1.0, 0.96, 0.78)))
            .observe(tint_sprite_on_out(Color::srgb(0.92, 0.86, 0.70)));
    }
    commands.spawn((
        Text2d::new(paperwork_desk_label(state)),
        TextFont {
            font_size: 20.0,
            ..default()
        },
        TextColor(Color::srgb(0.82, 0.96, 1.0)),
        Transform::from_xyz(30.0, -84.0, 4.0),
        WorldVisual,
    ));
    spawn_action_plaque(
        commands,
        world_label(state, "paperwork_sign"),
        Action::ShowPaperwork,
        desk.x,
        desk.y - 56.0,
        126.0,
    );

    let stamp_slot = anchor_slot(desk, 6, 7, 0.0);
    spawn_prop(
        commands,
        props,
        8,
        stamp_slot.x + 48.0,
        stamp_slot.y,
        0.28,
        ground_z(stamp_slot.y),
    );
    spawn_upgrade_buildings(commands, state);
    spawn_action_plaque(
        commands,
        world_label(state, "legal_plan_sign"),
        Action::BuildLegalOffice,
        -410.0,
        -241.0,
        78.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "caretaker_plan_sign"),
        Action::HireCaretaker,
        -310.0,
        -241.0,
        94.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "sorter_plan_sign"),
        Action::BuildFruitSorter,
        -202.0,
        -241.0,
        90.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "shed_plan_sign"),
        Action::BuildRoastingShed,
        -94.0,
        -241.0,
        94.0,
    );
    spawn_action_plaque(
        commands,
        world_label(state, "tasting_plan_sign"),
        Action::BuildTastingRoom,
        18.0,
        -241.0,
        96.0,
    );
    spawn_helicopter(commands, props, state);
    if state.goat_present {
        spawn_goat(
            commands,
            props,
            360.0,
            -150.0,
            world_label(state, "witness"),
        );
    }

    spawn_room_hint(commands, &office_hint(state));
}

fn paperwork_desk_label(state: &GameState) -> String {
    let base_cost = if state.legal_office {
        8 + state.paperwork_level as i32 * 2
    } else {
        16 + state.paperwork_level as i32 * 3
    };
    let cost = if state
        .daily_modifier
        .as_ref()
        .is_some_and(|modifier| modifier.kind == DailyModifierKind::BureaucracyDay)
    {
        (base_cost as f32 * 0.72).round() as i32
    } else {
        base_cost
    };
    let reduction = 18.0
        + if state.legal_office { 8.0 } else { 0.0 }
        + if state
            .daily_modifier
            .as_ref()
            .is_some_and(|modifier| modifier.kind == DailyModifierKind::BureaucracyDay)
        {
            6.0
        } else {
            0.0
        }
        + (state.paperwork_level + 1) as f32;

    if state.language == Language::Swedish {
        format!(
            "{} {}  |  Kostnad ${cost}  |  Misstanke -{reduction:.0}%",
            world_label(state, "paperwork_level"),
            state.paperwork_level
        )
    } else {
        format!(
            "{} {}  |  Cost ${cost}  |  Suspicion -{reduction:.0}%",
            world_label(state, "paperwork_level"),
            state.paperwork_level
        )
    }
}

fn spawn_helicopter(commands: &mut Commands, props: &PropAssets, state: &GameState) {
    commands.spawn((
        prop_sprite(props, 9),
        Transform::from_xyz(325.0, 245.0, 3.0).with_scale(Vec3::splat(0.38)),
        Helicopter {
            offset: Vec3::new(0.0, 0.0, 0.0),
        },
        WorldVisual,
    ));
    commands.spawn((
        Text2d::new(world_label(state, "police_helicopter")),
        TextFont {
            font_size: 13.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.76, 0.66)),
        Transform::from_xyz(325.0, 220.0, 4.0),
        WorldVisual,
    ));
}

fn spawn_prop(
    commands: &mut Commands,
    props: &PropAssets,
    index: usize,
    x: f32,
    y: f32,
    scale: f32,
    z: f32,
) {
    commands.spawn((
        prop_sprite(props, index),
        Transform::from_xyz(x, y, z).with_scale(Vec3::splat(scale)),
        WorldVisual,
    ));
}

fn spawn_wood_platform(commands: &mut Commands, x: f32, y: f32, width: f32, height: f32, z: f32) {
    let shadow = Color::srgba(0.05, 0.03, 0.015, 0.24);
    let dark = Color::srgba(0.30, 0.16, 0.06, 0.92);
    let wood = Color::srgba(0.52, 0.29, 0.10, 0.95);
    let wood_mid = Color::srgba(0.60, 0.34, 0.13, 0.86);
    let trim = Color::srgba(0.86, 0.58, 0.22, 0.76);
    let surface = Color::srgba(0.96, 0.72, 0.34, 0.42);
    commands.spawn((
        Sprite::from_color(shadow, Vec2::new(width + 42.0, 25.0)),
        Transform::from_xyz(x + 6.0, y - height * 0.5 - 16.0, z - 0.25),
        WorldVisual,
    ));
    for dx in [-(width * 0.42), width * 0.42] {
        commands.spawn((
            Sprite::from_color(dark, Vec2::new(12.0, 72.0)),
            Transform::from_xyz(x + dx + 4.0, y - 42.0, z - 0.05),
            WorldVisual,
        ));
        commands.spawn((
            Sprite::from_color(wood, Vec2::new(10.0, 68.0)),
            Transform::from_xyz(x + dx, y - 40.0, z),
            WorldVisual,
        ));
    }
    commands.spawn((
        Sprite::from_color(dark, Vec2::new(width + 12.0, height + 10.0)),
        Transform::from_xyz(x + 5.0, y - 4.0, z + 0.05),
        WorldVisual,
    ));
    commands.spawn((
        Sprite::from_color(wood, Vec2::new(width, height)),
        Transform::from_xyz(x, y, z + 0.1),
        WorldVisual,
    ));
    commands.spawn((
        Sprite::from_color(wood_mid, Vec2::new(width - 16.0, (height * 0.48).max(10.0))),
        Transform::from_xyz(x, y + height * 0.05, z + 0.12),
        WorldVisual,
    ));
    for dx in [-(width * 0.5), width * 0.5] {
        commands.spawn((
            Sprite::from_color(dark, Vec2::new(8.0, height + 12.0)),
            Transform::from_xyz(x + dx, y - 2.0, z + 0.16),
            WorldVisual,
        ));
        commands.spawn((
            Sprite::from_color(trim, Vec2::new(5.0, height + 6.0)),
            Transform::from_xyz(x + dx * 0.995, y + 1.0, z + 0.22),
            WorldVisual,
        ));
    }
    commands.spawn((
        Sprite::from_color(trim, Vec2::new(width - 22.0, 4.0)),
        Transform::from_xyz(x, y + height * 0.28, z + 0.2),
        WorldVisual,
    ));
    commands.spawn((
        Sprite::from_color(surface, Vec2::new(width - 34.0, 3.0)),
        Transform::from_xyz(x, y + height * 0.48, z + 0.3),
        WorldVisual,
    ));
    let cap_count = (width / 82.0).round().clamp(2.0, 8.0) as u32;
    for i in 0..cap_count {
        let t = if cap_count == 1 {
            0.5
        } else {
            i as f32 / (cap_count - 1) as f32
        };
        let cap_x = x - width * 0.42 + width * 0.84 * t;
        commands.spawn((
            Sprite::from_color(Color::srgba(0.90, 0.62, 0.25, 0.58), Vec2::new(4.0, 7.0)),
            Transform::from_xyz(cap_x, y + height * 0.28, z + 0.32),
            WorldVisual,
        ));
    }
}

fn spawn_civet_perch(commands: &mut Commands) {
    spawn_wood_platform(commands, 0.0, -203.0, 430.0, 28.0, ground_z(-203.0) - 0.35);
    spawn_wood_platform(commands, -6.0, -151.0, 300.0, 24.0, ground_z(-151.0) - 0.35);
    let trunk = Color::srgba(0.39, 0.21, 0.08, 0.94);
    for x in [-170.0, 0.0, 170.0] {
        commands.spawn((
            Sprite::from_color(trunk, Vec2::new(18.0, 118.0)),
            Transform::from_xyz(x, -188.0, ground_z(-188.0) - 0.45),
            WorldVisual,
        ));
    }
}

fn spawn_contact_shadow(commands: &mut Commands, x: f32, y: f32, width: f32, height: f32, z: f32) {
    commands.spawn((
        Sprite::from_color(
            Color::srgba(0.04, 0.028, 0.015, 0.24),
            Vec2::new(width, height),
        ),
        Transform::from_xyz(x, y, z),
        WorldVisual,
    ));
}

fn spawn_goat(commands: &mut Commands, props: &PropAssets, x: f32, y: f32, label: &str) {
    spawn_contact_shadow(commands, x, y - 18.0, 66.0, 18.0, ground_z(y) - 0.35);
    spawn_prop(commands, props, 10, x, y, 0.25, ground_z(y));
    commands.spawn((
        Text2d::new(label),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgb(0.17, 0.12, 0.08)),
        Transform::from_xyz(x, y + 1.0, ground_z(y) + 0.5),
        WorldVisual,
    ));
}

fn field_hint(state: &GameState) -> String {
    if state.coffee_fruit < state.civets as f32 * 2.0 {
        state_text(
            state,
            "Click fruit or plants to harvest enough coffee fruit for the civets.",
            "Klicka frukt eller plantor för att skörda nog med kaffefrukt åt palmmårdarna.",
        )
    } else if state.money >= 14 {
        state_text(
            state,
            "Click the seedling sign to plant more coffee, or harvest fruit from the field.",
            "Klicka plant-skylten för mer kaffe, eller skörda frukt från fältet.",
        )
    } else {
        state_text(
            state,
            "Harvest fruit here, then turn it into care, beans, roasted coffee, and money.",
            "Skörda frukt här och gör den till omsorg, bönor, rostat kaffe och pengar.",
        )
    }
    .to_string()
}

fn sanctuary_hint(state: &GameState) -> String {
    if state.selected_civet.is_none() {
        state_text(
            state,
            "Click a civet first, then use the care plaques for food, affection, and enrichment.",
            "Klicka på en palmmård först, använd sedan omsorgsskyltarna för mat, närhet och berikning.",
        )
    } else if state.coffee_fruit >= 2.0 {
        state_text(
            state,
            "Use the feed tray or a favorite care item to improve this civet's status.",
            "Använd matbrickan eller favoritomsorgen för att förbättra palmmårdens status.",
        )
    } else {
        state_text(
            state,
            "This room needs coffee fruit from the field before feeding gets serious.",
            "Det här rummet behöver kaffefrukt från fältet innan matningen kommer igång.",
        )
    }
    .to_string()
}

fn roastery_hint(state: &GameState) -> String {
    if state.active_order.is_some()
        && state
            .active_order
            .as_ref()
            .is_some_and(|order| state.roasted_coffee >= order.bags)
    {
        state_text(
            state,
            "The order is ready. Click Deliver order at the packing table.",
            "Ordern är redo. Klicka Leverera order vid packbordet.",
        )
    } else if state.processed_beans >= 1.0 {
        state_text(
            state,
            "Click the roaster to turn processed beans into sellable coffee.",
            "Klicka rostaren för att göra processade bönor till säljbart kaffe.",
        )
    } else if state.roasted_coffee >= 1.0 {
        state_text(
            state,
            "Click coffee bags to sell, or save stock for an active contract.",
            "Klicka kaffesäckar för att sälja, eller spara lager till ett aktivt kontrakt.",
        )
    } else {
        state_text(
            state,
            "Bring processed beans from the sanctuary, then roast and sell here.",
            "Ta processade bönor från fristaden, rosta och sälj dem här.",
        )
    }
    .to_string()
}

fn office_hint(state: &GameState) -> String {
    if state.event.is_some() || state.pending_order.is_some() {
        state_text(
            state,
            "Mailbox work is waiting. Handle letters before deadlines turn into penalties.",
            "Post väntar. Hantera brev innan deadlines blir straff.",
        )
    } else if state.suspicion >= 55.0 {
        state_text(
            state,
            "Suspicion is warm. Click paperwork before the helicopter gets ideas.",
            "Misstanken är varm. Klicka papper innan helikoptern får idéer.",
        )
    } else {
        state_text(
            state,
            "Use office plaques for paperwork and upgrades that make the plantation safer.",
            "Använd kontorsskyltarna för papper och uppgraderingar som gör plantagen tryggare.",
        )
    }
    .to_string()
}

fn spawn_room_hint(commands: &mut Commands, text: &str) {
    commands.spawn((
        Text2d::new(text),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgba(1.0, 0.90, 0.66, 0.80)),
        Transform::from_xyz(-20.0, -315.0, 3.0),
        WorldVisual,
    ));
}

fn spawn_action_plaque(
    commands: &mut Commands,
    label: &str,
    action: Action,
    x: f32,
    y: f32,
    width: f32,
) {
    let base = Color::srgb(0.40, 0.22, 0.09);
    let hover = Color::srgb(0.62, 0.36, 0.14);
    commands
        .spawn((
            Sprite::from_color(base, Vec2::new(width, 28.0)),
            Transform::from_xyz(x, y, ground_z(y) + 0.55),
            Pickable::default(),
            WorldActionTarget(action),
            WorldVisual,
        ))
        .observe(world_action_on_click)
        .observe(tint_sprite_on_hover(hover))
        .observe(tint_sprite_on_out(base));
    commands.spawn((
        Text2d::new(label),
        TextFont {
            font_size: 12.0,
            ..default()
        },
        TextColor(Color::srgb(1.0, 0.91, 0.68)),
        Transform::from_xyz(x, y, ground_z(y) + 0.9),
        WorldVisual,
    ));
}

fn select_civet_on_click(
    click: On<Pointer<Click>>,
    targets: Query<&CivetClickTarget>,
    mut state: ResMut<GameState>,
) {
    if state.screen != GameScreen::Playing
        || state.inspection
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        return;
    }

    let Ok(target) = targets.get(click.event_target()) else {
        return;
    };
    select_civet_by_index(&mut state, target.index);
    state.dirty_visuals = true;
}

fn world_action_on_click(
    click: On<Pointer<Click>>,
    targets: Query<&WorldActionTarget>,
    mut state: ResMut<GameState>,
) {
    if state.screen != GameScreen::Playing
        || state.inspection
        || state.day_report.is_some()
        || state.game_result.is_some()
    {
        return;
    }

    let Ok(target) = targets.get(click.event_target()) else {
        return;
    };
    if !can_run(target.0, &state) {
        let reason = unavailable_reason(target.0, &state);
        state.log_line(reason);
        return;
    }
    run_action(&mut state, target.0);
}

fn tint_sprite_on_hover(color: Color) -> impl Fn(On<Pointer<Over>>, Query<&mut Sprite>) {
    move |event, mut sprites| {
        if let Ok(mut sprite) = sprites.get_mut(event.event_target()) {
            sprite.color = color;
        }
    }
}

fn tint_sprite_on_out(color: Color) -> impl Fn(On<Pointer<Out>>, Query<&mut Sprite>) {
    move |event, mut sprites| {
        if let Ok(mut sprite) = sprites.get_mut(event.event_target()) {
            sprite.color = color;
        }
    }
}

fn spawn_upgrade_buildings(commands: &mut Commands, state: &GameState) {
    let buildings = [
        (
            state.legal_office,
            -545.0,
            -255.0,
            "LEGAL",
            Color::srgb(0.16, 0.28, 0.32),
        ),
        (
            state.caretaker,
            -455.0,
            -255.0,
            "CARE",
            Color::srgb(0.24, 0.35, 0.18),
        ),
        (
            state.fruit_sorter,
            -365.0,
            -255.0,
            "SORT",
            Color::srgb(0.42, 0.31, 0.10),
        ),
        (
            state.roasting_shed,
            -275.0,
            -255.0,
            "ROAST",
            Color::srgb(0.33, 0.19, 0.11),
        ),
        (
            state.tasting_room,
            -185.0,
            -255.0,
            "TASTE",
            Color::srgb(0.38, 0.24, 0.30),
        ),
    ];

    for (enabled, x, y, label, color) in buildings {
        if !enabled {
            continue;
        }
        commands.spawn((
            Sprite::from_color(color, Vec2::new(72.0, 48.0)),
            Transform::from_xyz(x, y, 2.0),
            WorldVisual,
        ));
        commands.spawn((
            Sprite::from_color(Color::srgb(0.74, 0.57, 0.30), Vec2::new(82.0, 10.0)),
            Transform::from_xyz(x, y + 29.0, 3.0),
            WorldVisual,
        ));
        commands.spawn((
            Text2d::new(label),
            TextFont {
                font_size: 12.0,
                ..default()
            },
            TextColor(Color::srgb(1.0, 0.90, 0.65)),
            Transform::from_xyz(x, y, 4.0),
            WorldVisual,
        ));
    }
}
