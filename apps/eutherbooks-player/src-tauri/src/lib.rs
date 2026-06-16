use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    startup_info("starting app");

    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_wake_lock,
            native_audio_play_queue,
            native_audio_pause,
            native_audio_seek,
            native_audio_stop,
            native_audio_status
        ])
        .plugin(native_audio_plugin())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            startup_info("setup: resolving app data dir");
            log_startup_diagnostics(app);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(err) = result {
        startup_error(&format!("tauri runtime returned error: {err}"));
    }
}

fn native_audio_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("eutherbooks-native-audio")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.nichlasek.eutherbooksplayer", "NativeAudioPlugin")?;
            Ok(())
        })
        .build()
}

#[tauri::command]
fn set_wake_lock(app: tauri::AppHandle, enabled: bool) -> Result<String, String> {
    recover_command("wake lock", || platform_set_wake_lock(&app, enabled))
}

#[tauri::command]
fn native_audio_play_queue(
    app: tauri::AppHandle,
    urls: Vec<String>,
    index: usize,
    position_seconds: f64,
    title: String,
    subtitle: String,
) -> Result<String, String> {
    recover_command("native audio play", || {
        platform_native_audio_play_queue(&app, urls, index, position_seconds, title, subtitle)
    })
}

#[tauri::command]
fn native_audio_pause(app: tauri::AppHandle) -> Result<String, String> {
    recover_command("native audio pause", || platform_native_audio_pause(&app))
}

#[tauri::command]
fn native_audio_seek(
    app: tauri::AppHandle,
    index: usize,
    position_seconds: f64,
) -> Result<String, String> {
    recover_command("native audio seek", || {
        platform_native_audio_seek(&app, index, position_seconds)
    })
}

#[tauri::command]
fn native_audio_stop(app: tauri::AppHandle) -> Result<String, String> {
    recover_command("native audio stop", || platform_native_audio_stop(&app))
}

#[tauri::command]
fn native_audio_status(app: tauri::AppHandle) -> Result<String, String> {
    recover_command("native audio status", || platform_native_audio_status(&app))
}

fn recover_command<F>(label: &str, action: F) -> Result<String, String>
where
    F: FnOnce() -> Result<String, String>,
{
    match panic::catch_unwind(AssertUnwindSafe(action)) {
        Ok(result) => result,
        Err(err) => {
            let message = if let Some(message) = err.downcast_ref::<&str>() {
                *message
            } else if let Some(message) = err.downcast_ref::<String>() {
                message.as_str()
            } else {
                "unknown panic"
            };
            startup_error(&format!("{label} command recovered from panic: {message}"));
            Err(format!("{label} failed safely: {message}"))
        }
    }
}

#[cfg(target_os = "android")]
fn platform_set_wake_lock(_app: &tauri::AppHandle, enabled: bool) -> Result<String, String> {
    Ok(if enabled {
        "wake lock handled by Android plugin"
    } else {
        "wake lock released by Android plugin"
    }
    .to_string())
}

#[cfg(target_os = "android")]
fn platform_native_audio_play_queue(
    _app: &tauri::AppHandle,
    _urls: Vec<String>,
    _index: usize,
    _position_seconds: f64,
    _title: String,
    _subtitle: String,
) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(target_os = "android")]
fn platform_native_audio_pause(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(target_os = "android")]
fn platform_native_audio_seek(
    _app: &tauri::AppHandle,
    _index: usize,
    _position_seconds: f64,
) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(target_os = "android")]
fn platform_native_audio_stop(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(target_os = "android")]
fn platform_native_audio_status(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_set_wake_lock(_app: &tauri::AppHandle, enabled: bool) -> Result<String, String> {
    Ok(if enabled {
        "wake lock unsupported on this platform"
    } else {
        "wake lock released"
    }
    .to_string())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_play_queue(
    _app: &tauri::AppHandle,
    _urls: Vec<String>,
    _index: usize,
    _position_seconds: f64,
    _title: String,
    _subtitle: String,
) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_pause(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_seek(
    _app: &tauri::AppHandle,
    _index: usize,
    _position_seconds: f64,
) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_stop(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_status(_app: &tauri::AppHandle) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

fn native_audio_unavailable() -> String {
    r#"{"available":false,"active":false,"playing":false,"ended":false,"index":0,"positionSeconds":0,"durationSeconds":0,"lastEvent":"Native audio unavailable","error":""}"#.to_string()
}

fn install_panic_logger() {
    let default_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        startup_error(&format!("rust panic during startup: {info}"));
        default_hook(info);
    }));
}

fn log_startup_diagnostics<R: tauri::Runtime>(app: &tauri::App<R>) {
    startup_info(&format!("platform: {}", platform_name()));

    let app_data_dir = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(err) => {
            startup_error(&format!("could not resolve app data dir: {err}"));
            return;
        }
    };
    ensure_dir("app data dir", &app_data_dir);
    ensure_file(
        "config",
        &app_data_dir.join("config.json"),
        br#"{"serverUrl":"http://192.168.32.186:8088"}"#,
    );
}

fn ensure_dir(label: &str, path: &Path) {
    if path.is_dir() {
        startup_info(&format!("{label} exists"));
        return;
    }
    match fs::create_dir_all(path) {
        Ok(()) => startup_info(&format!("created {label}: {}", path.display())),
        Err(err) => startup_error(&format!(
            "could not create {label} {}: {err}",
            path.display()
        )),
    }
}

fn ensure_file(label: &str, path: &Path, contents: &[u8]) {
    if path.exists() {
        startup_info(&format!("{label} exists: {}", path.display()));
        return;
    }
    match fs::write(path, contents) {
        Ok(()) => startup_info(&format!("created default {label}: {}", path.display())),
        Err(err) => startup_error(&format!(
            "could not create default {label} {}: {err}",
            path.display()
        )),
    }
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "ios")]
    {
        "ios"
    }
    #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
    {
        "desktop"
    }
}

fn startup_info(message: &str) {
    platform_log(4, message);
}

fn startup_error(message: &str) {
    platform_log(6, message);
}

#[cfg(target_os = "android")]
fn platform_log(priority: i32, message: &str) {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};

    unsafe extern "C" {
        fn __android_log_write(prio: c_int, tag: *const c_char, text: *const c_char) -> c_int;
    }

    let clean = message.replace('\0', "\\0");
    if let Ok(text) = CString::new(clean) {
        unsafe {
            __android_log_write(
                priority as c_int,
                c"EutherBooksPlayer".as_ptr(),
                text.as_ptr(),
            );
        }
    }
}

#[cfg(not(target_os = "android"))]
fn platform_log(_priority: i32, message: &str) {
    eprintln!("EutherBooksPlayer: {message}");
}
