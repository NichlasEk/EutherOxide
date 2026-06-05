use bevy::{
    audio::{PlaybackMode, Volume},
    prelude::*,
};

use crate::model::{AudioCue, GameScreen, GameState, PlantationRoom};

const MUSIC_FADE_SECONDS: f32 = 1.2;

#[derive(Resource)]
pub struct EutherAudioAssets {
    sanctuary: Handle<AudioSource>,
    coffee_field: Handle<AudioSource>,
    roastery: Handle<AudioSource>,
    paperwork_office: Handle<AudioSource>,
    ui_click: Handle<AudioSource>,
    ui_hover: Handle<AudioSource>,
    order_accept: Handle<AudioSource>,
    order_decline: Handle<AudioSource>,
    event_notice: Handle<AudioSource>,
    day_report: Handle<AudioSource>,
    suspicion: Handle<AudioSource>,
    civet_chirp: Handle<AudioSource>,
    civet_purr: Handle<AudioSource>,
    goat_bleat: Handle<AudioSource>,
    paperwork_stamp: Handle<AudioSource>,
    coffee_roast: Handle<AudioSource>,
    cash: Handle<AudioSource>,
    rain: Handle<AudioSource>,
    camera: Handle<AudioSource>,
}

#[derive(Resource, Default)]
pub struct AudioRuntime {
    current_room: Option<PlantationRoom>,
}

#[derive(Component)]
pub(crate) struct RoomMusic;

#[derive(Component)]
pub(crate) struct FadeIn {
    timer: Timer,
    target_volume: f32,
}

#[derive(Component)]
pub(crate) struct FadeOut {
    timer: Timer,
    start_volume: f32,
}

pub fn setup_audio_assets(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.insert_resource(EutherAudioAssets {
        sanctuary: asset_server.load("audio/music/sunset_walk.ogg"),
        coffee_field: asset_server.load("audio/music/feel_good_island_loop.ogg"),
        roastery: asset_server.load("audio/music/sunset_walk.ogg"),
        paperwork_office: asset_server.load("audio/music/sunset_walk.ogg"),
        ui_click: asset_server.load("audio/sfx/ui_click.wav"),
        ui_hover: asset_server.load("audio/sfx/ui_hover.wav"),
        order_accept: asset_server.load("audio/sfx/order_accept.wav"),
        order_decline: asset_server.load("audio/sfx/order_decline.wav"),
        event_notice: asset_server.load("audio/sfx/event_notice.wav"),
        day_report: asset_server.load("audio/sfx/day_report.wav"),
        suspicion: asset_server.load("audio/sfx/suspicion.wav"),
        civet_chirp: asset_server.load("audio/sfx/civet_chirp.wav"),
        civet_purr: asset_server.load("audio/sfx/civet_purr.wav"),
        goat_bleat: asset_server.load("audio/sfx/goat_bleat.wav"),
        paperwork_stamp: asset_server.load("audio/sfx/paperwork_stamp.wav"),
        coffee_roast: asset_server.load("audio/sfx/coffee_roast.wav"),
        cash: asset_server.load("audio/sfx/cash.wav"),
        rain: asset_server.load("audio/sfx/rain.wav"),
        camera: asset_server.load("audio/sfx/camera.wav"),
    });
    commands.insert_resource(AudioRuntime::default());
}

pub fn manage_room_music(
    mut commands: Commands,
    assets: Res<EutherAudioAssets>,
    mut runtime: ResMut<AudioRuntime>,
    state: Res<GameState>,
    music: Query<(Entity, Option<&AudioSink>), With<RoomMusic>>,
) {
    let wanted_room = if state.screen == GameScreen::Playing && !state.audio_muted {
        Some(state.current_room)
    } else {
        None
    };

    if runtime.current_room == wanted_room {
        return;
    }

    for (entity, sink) in &music {
        let start_volume = sink.map_or(state.music_volume, |sink| sink.volume().to_linear());
        commands.entity(entity).insert(FadeOut {
            timer: Timer::from_seconds(MUSIC_FADE_SECONDS, TimerMode::Once),
            start_volume,
        });
    }

    if let Some(room) = wanted_room {
        let track = room_track(&assets, room);
        commands.spawn((
            AudioPlayer(track),
            PlaybackSettings {
                mode: PlaybackMode::Loop,
                volume: Volume::SILENT,
                ..default()
            },
            RoomMusic,
            FadeIn {
                timer: Timer::from_seconds(MUSIC_FADE_SECONDS, TimerMode::Once),
                target_volume: state.music_volume,
            },
        ));
    }

    runtime.current_room = wanted_room;
}

pub fn sync_music_volume(
    state: Res<GameState>,
    mut music: Query<&mut AudioSink, (With<RoomMusic>, Without<FadeIn>, Without<FadeOut>)>,
) {
    if !state.is_changed() {
        return;
    }
    let volume = if state.audio_muted {
        Volume::SILENT
    } else {
        Volume::Linear(state.music_volume)
    };
    for mut sink in &mut music {
        sink.set_volume(volume);
    }
}

pub fn fade_audio(
    time: Res<Time>,
    mut commands: Commands,
    mut fades: ParamSet<(
        Query<(&mut AudioSink, &mut FadeIn, Entity), Without<FadeOut>>,
        Query<(&mut AudioSink, &mut FadeOut, Entity), Without<FadeIn>>,
    )>,
) {
    for (mut sink, mut fade, entity) in &mut fades.p0() {
        fade.timer.tick(time.delta());
        let factor = fade.timer.fraction();
        sink.set_volume(Volume::Linear(fade.target_volume * factor));
        if fade.timer.is_finished() {
            sink.set_volume(Volume::Linear(fade.target_volume));
            commands.entity(entity).remove::<FadeIn>();
        }
    }

    for (mut sink, mut fade, entity) in &mut fades.p1() {
        fade.timer.tick(time.delta());
        let factor = 1.0 - fade.timer.fraction();
        sink.set_volume(Volume::Linear(fade.start_volume * factor));
        if fade.timer.is_finished() {
            commands.entity(entity).despawn();
        }
    }
}

pub fn play_audio_cues(
    mut commands: Commands,
    assets: Res<EutherAudioAssets>,
    mut state: ResMut<GameState>,
) {
    let cues = std::mem::take(&mut state.audio_cues);
    if cues.is_empty() || state.audio_muted || state.sfx_volume <= 0.0 {
        return;
    }

    let volume = state.sfx_volume;
    for cue in cues {
        let (handle, gain) = cue_sound(&assets, cue);
        commands.spawn((
            AudioPlayer(handle),
            PlaybackSettings {
                mode: PlaybackMode::Despawn,
                volume: Volume::Linear((volume * gain).clamp(0.0, 1.0)),
                ..default()
            },
        ));
    }
}

fn room_track(assets: &EutherAudioAssets, room: PlantationRoom) -> Handle<AudioSource> {
    match room {
        PlantationRoom::Sanctuary => assets.sanctuary.clone(),
        PlantationRoom::CoffeeField => assets.coffee_field.clone(),
        PlantationRoom::Roastery => assets.roastery.clone(),
        PlantationRoom::PaperworkOffice => assets.paperwork_office.clone(),
    }
}

fn cue_sound(assets: &EutherAudioAssets, cue: AudioCue) -> (Handle<AudioSource>, f32) {
    match cue {
        AudioCue::UiClick => (assets.ui_click.clone(), 0.45),
        AudioCue::UiHover => (assets.ui_hover.clone(), 0.30),
        AudioCue::OrderAccept => (assets.order_accept.clone(), 0.78),
        AudioCue::OrderDecline => (assets.order_decline.clone(), 0.70),
        AudioCue::EventNotice => (assets.event_notice.clone(), 0.72),
        AudioCue::DayReport => (assets.day_report.clone(), 0.80),
        AudioCue::Suspicion => (assets.suspicion.clone(), 0.82),
        AudioCue::CivetChirp => (assets.civet_chirp.clone(), 0.70),
        AudioCue::CivetPurr => (assets.civet_purr.clone(), 0.64),
        AudioCue::GoatBleat => (assets.goat_bleat.clone(), 0.76),
        AudioCue::PaperworkStamp => (assets.paperwork_stamp.clone(), 0.70),
        AudioCue::CoffeeRoast => (assets.coffee_roast.clone(), 0.72),
        AudioCue::Cash => (assets.cash.clone(), 0.66),
        AudioCue::Rain => (assets.rain.clone(), 0.70),
        AudioCue::Camera => (assets.camera.clone(), 0.72),
    }
}
