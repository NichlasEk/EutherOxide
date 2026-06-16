use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    startup_info("starting app");

    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_wake_lock])
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

#[tauri::command]
fn set_wake_lock(enabled: bool) -> Result<String, String> {
    match panic::catch_unwind(AssertUnwindSafe(|| platform_set_wake_lock(enabled))) {
        Ok(result) => result,
        Err(err) => {
            let message = if let Some(message) = err.downcast_ref::<&str>() {
                *message
            } else if let Some(message) = err.downcast_ref::<String>() {
                message.as_str()
            } else {
                "unknown panic"
            };
            startup_error(&format!(
                "wake lock command recovered from panic: {message}"
            ));
            Err(format!("wake lock failed safely: {message}"))
        }
    }
}

#[cfg(target_os = "android")]
fn platform_set_wake_lock(enabled: bool) -> Result<String, String> {
    android_wake_lock::set_enabled(enabled)
}

#[cfg(not(target_os = "android"))]
fn platform_set_wake_lock(enabled: bool) -> Result<String, String> {
    Ok(if enabled {
        "wake lock unsupported on this platform"
    } else {
        "wake lock released"
    }
    .to_string())
}

#[cfg(target_os = "android")]
mod android_wake_lock {
    use std::mem::ManuallyDrop;
    use std::ptr;
    use std::sync::{Mutex, OnceLock};

    use jni::JavaVM;
    use jni::objects::{Global, JObject, JValue};
    use jni::sys::jobject;
    use jni::{jni_sig, jni_str};

    type WakeLock = Global<JObject<'static>>;

    static WAKE_LOCK: OnceLock<Mutex<Option<WakeLock>>> = OnceLock::new();

    pub fn set_enabled(enabled: bool) -> Result<String, String> {
        let store = WAKE_LOCK.get_or_init(|| Mutex::new(None));
        let mut guard = store.lock().map_err(|err| err.to_string())?;
        if enabled {
            if guard.is_some() {
                return Ok("wake lock already held".to_string());
            }
            let wake_lock = acquire_partial_wake_lock()?;
            *guard = Some(wake_lock);
            Ok("partial wake lock acquired".to_string())
        } else {
            if let Some(wake_lock) = guard.take() {
                release_wake_lock(&wake_lock)?;
            }
            Ok("wake lock released".to_string())
        }
    }

    fn java_vm() -> Result<JavaVM, String> {
        let ctx = ndk_context::android_context();
        let vm = ctx.vm();
        if vm.is_null() {
            return Err("Android JavaVM pointer is null".to_string());
        }
        Ok(unsafe { JavaVM::from_raw(vm.cast()) })
    }

    fn acquire_partial_wake_lock() -> Result<WakeLock, String> {
        let ctx = ndk_context::android_context();
        let context = ctx.context();
        if context.is_null() {
            return Err("Android context pointer is null".to_string());
        }
        let vm = java_vm()?;
        vm.attach_current_thread(|env| {
            let context = unsafe { ManuallyDrop::new(JObject::from_raw(env, context as jobject)) };
            if context.as_raw() == ptr::null_mut() {
                return Err(jni::errors::Error::NullPtr("android context"));
            }
            let context_class = env.find_class(jni_str!("android/content/Context"))?;
            let power_service = env
                .get_static_field(
                    &context_class,
                    jni_str!("POWER_SERVICE"),
                    jni_sig!("Ljava/lang/String;"),
                )?
                .l()?;
            let power_manager = env
                .call_method(
                    &*context,
                    jni_str!("getSystemService"),
                    jni_sig!("(Ljava/lang/String;)Ljava/lang/Object;"),
                    &[JValue::Object(&power_service)],
                )?
                .l()?;

            let tag = env.new_string("EutherBooksPlayer:AudioPlayback")?;
            let tag = JObject::from(tag);
            let wake_lock = env
                .call_method(
                    &power_manager,
                    jni_str!("newWakeLock"),
                    jni_sig!("(ILjava/lang/String;)Landroid/os/PowerManager$WakeLock;"),
                    &[JValue::Int(1), JValue::Object(&tag)],
                )?
                .l()?;

            env.call_method(&wake_lock, jni_str!("acquire"), jni_sig!("()V"), &[])?;
            env.new_global_ref(wake_lock)
        })
        .map_err(|err| err.to_string())
    }

    fn release_wake_lock(wake_lock: &WakeLock) -> Result<(), String> {
        let vm = java_vm()?;
        vm.attach_current_thread(|env| {
            let held = env
                .call_method(wake_lock.as_ref(), jni_str!("isHeld"), jni_sig!("()Z"), &[])?
                .z()?;
            if held {
                env.call_method(
                    wake_lock.as_ref(),
                    jni_str!("release"),
                    jni_sig!("()V"),
                    &[],
                )?;
            }
            Ok::<(), jni::errors::Error>(())
        })
        .map_err(|err| err.to_string())
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
