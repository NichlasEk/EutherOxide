fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "eutherbooks-native-audio",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "play_queue",
                    "playQueue",
                    "update_queue",
                    "updateQueue",
                    "pause",
                    "stop",
                    "seek",
                    "status",
                    "set_wake_lock",
                    "setWakeLock",
                    "request_ignore_battery_optimizations",
                    "requestIgnoreBatteryOptimizations",
                    "ping",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri build");
}
