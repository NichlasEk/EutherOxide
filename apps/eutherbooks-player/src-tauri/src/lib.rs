use std::fs;
use std::panic;
use std::path::Path;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    startup_info("starting app");

    let result = tauri::Builder::default()
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
            __android_log_write(priority as c_int, c"EutherBooksPlayer".as_ptr(), text.as_ptr());
        }
    }
}

#[cfg(not(target_os = "android"))]
fn platform_log(_priority: i32, message: &str) {
    eprintln!("EutherBooksPlayer: {message}");
}
