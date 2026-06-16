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
    recover_command("wake lock", || platform_set_wake_lock(enabled))
}

#[tauri::command]
fn native_audio_play_queue(
    urls: Vec<String>,
    index: usize,
    position_seconds: f64,
    title: String,
    subtitle: String,
) -> Result<String, String> {
    recover_command("native audio play", || {
        platform_native_audio_play_queue(urls, index, position_seconds, title, subtitle)
    })
}

#[tauri::command]
fn native_audio_pause() -> Result<String, String> {
    recover_command("native audio pause", platform_native_audio_pause)
}

#[tauri::command]
fn native_audio_seek(index: usize, position_seconds: f64) -> Result<String, String> {
    recover_command("native audio seek", || {
        platform_native_audio_seek(index, position_seconds)
    })
}

#[tauri::command]
fn native_audio_stop() -> Result<String, String> {
    recover_command("native audio stop", platform_native_audio_stop)
}

#[tauri::command]
fn native_audio_status() -> Result<String, String> {
    recover_command("native audio status", platform_native_audio_status)
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
fn platform_set_wake_lock(enabled: bool) -> Result<String, String> {
    android_wake_lock::set_enabled(enabled)
}

#[cfg(target_os = "android")]
fn platform_native_audio_play_queue(
    urls: Vec<String>,
    index: usize,
    position_seconds: f64,
    title: String,
    subtitle: String,
) -> Result<String, String> {
    android_native_audio::play_queue(urls, index, position_seconds, title, subtitle)
}

#[cfg(target_os = "android")]
fn platform_native_audio_pause() -> Result<String, String> {
    android_native_audio::pause()
}

#[cfg(target_os = "android")]
fn platform_native_audio_seek(index: usize, position_seconds: f64) -> Result<String, String> {
    android_native_audio::seek(index, position_seconds)
}

#[cfg(target_os = "android")]
fn platform_native_audio_stop() -> Result<String, String> {
    android_native_audio::stop()
}

#[cfg(target_os = "android")]
fn platform_native_audio_status() -> Result<String, String> {
    android_native_audio::status()
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

#[cfg(not(target_os = "android"))]
fn platform_native_audio_play_queue(
    _urls: Vec<String>,
    _index: usize,
    _position_seconds: f64,
    _title: String,
    _subtitle: String,
) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_pause() -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_seek(_index: usize, _position_seconds: f64) -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_stop() -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn platform_native_audio_status() -> Result<String, String> {
    Ok(native_audio_unavailable())
}

#[cfg(not(target_os = "android"))]
fn native_audio_unavailable() -> String {
    r#"{"available":false,"active":false,"playing":false,"ended":false,"index":0,"positionSeconds":0,"durationSeconds":0,"lastEvent":"Native audio unavailable","error":""}"#.to_string()
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

#[cfg(target_os = "android")]
mod android_native_audio {
    use std::mem::ManuallyDrop;
    use std::ptr;

    use jni::JavaVM;
    use jni::objects::{JObject, JValue};
    use jni::sys::jobject;
    use jni::{jni_sig, jni_str};

    const BRIDGE_CLASS: &jni::strings::JNIStr =
        jni_str!("com/nichlasek/eutherbooksplayer/NativeAudioBridge");

    pub fn play_queue(
        urls: Vec<String>,
        index: usize,
        position_seconds: f64,
        title: String,
        subtitle: String,
    ) -> Result<String, String> {
        let urls_json = serde_json::to_string(&urls).map_err(|err| err.to_string())?;
        with_context(|env, context| {
            let urls_json = env.new_string(urls_json)?;
            let title = env.new_string(title)?;
            let subtitle = env.new_string(subtitle)?;
            let result = env
                .call_static_method(
                    BRIDGE_CLASS,
                    jni_str!("playQueue"),
                    jni_sig!(
                        "(Landroid/content/Context;Ljava/lang/String;IDLjava/lang/String;Ljava/lang/String;)Ljava/lang/String;"
                    ),
                    &[
                        JValue::Object(context),
                        JValue::Object(&JObject::from(urls_json)),
                        JValue::Int(index.min(i32::MAX as usize) as i32),
                        JValue::Double(position_seconds.max(0.0)),
                        JValue::Object(&JObject::from(title)),
                        JValue::Object(&JObject::from(subtitle)),
                    ],
                )?
                .l()?;
            java_string_to_rust(env, result)
        })
    }

    pub fn pause() -> Result<String, String> {
        context_command(
            jni_str!("pause"),
            jni_sig!("(Landroid/content/Context;)Ljava/lang/String;"),
        )
    }

    pub fn stop() -> Result<String, String> {
        context_command(
            jni_str!("stop"),
            jni_sig!("(Landroid/content/Context;)Ljava/lang/String;"),
        )
    }

    pub fn status() -> Result<String, String> {
        context_command(
            jni_str!("status"),
            jni_sig!("(Landroid/content/Context;)Ljava/lang/String;"),
        )
    }

    pub fn seek(index: usize, position_seconds: f64) -> Result<String, String> {
        with_context(|env, context| {
            let result = env
                .call_static_method(
                    BRIDGE_CLASS,
                    jni_str!("seek"),
                    jni_sig!("(Landroid/content/Context;ID)Ljava/lang/String;"),
                    &[
                        JValue::Object(context),
                        JValue::Int(index.min(i32::MAX as usize) as i32),
                        JValue::Double(position_seconds.max(0.0)),
                    ],
                )?
                .l()?;
            java_string_to_rust(env, result)
        })
    }

    fn context_command(
        name: impl AsRef<jni::strings::JNIStr>,
        signature: impl AsRef<jni::signature::MethodSignature<'static, 'static>>,
    ) -> Result<String, String> {
        with_context(|env, context| {
            let result = env
                .call_static_method(BRIDGE_CLASS, name, signature, &[JValue::Object(context)])?
                .l()?;
            java_string_to_rust(env, result)
        })
    }

    fn java_vm() -> Result<JavaVM, String> {
        let ctx = ndk_context::android_context();
        let vm = ctx.vm();
        if vm.is_null() {
            return Err("Android JavaVM pointer is null".to_string());
        }
        Ok(unsafe { JavaVM::from_raw(vm.cast()) })
    }

    fn with_context<T, F>(action: F) -> Result<T, String>
    where
        F: FnOnce(&mut jni::Env<'_>, &JObject<'_>) -> Result<T, jni::errors::Error>,
    {
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
            action(env, &context)
        })
        .map_err(|err| err.to_string())
    }

    fn java_string_to_rust(
        env: &mut jni::Env<'_>,
        value: JObject<'_>,
    ) -> Result<String, jni::errors::Error> {
        let value = env.cast_local::<jni::objects::JString>(value)?;
        value.try_to_string(env)
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
