fn main() {
    println!("cargo:rerun-if-changed=../webview/build-info.ts");
    let build_info = std::fs::read_to_string("../webview/build-info.ts").unwrap_or_default();
    let build_id = build_info
        .split('"')
        .nth(1)
        .unwrap_or("dev")
        .to_string();
    println!("cargo:rustc-env=EUTHER_OXIDE_BUILD_ID={build_id}");
    tauri_build::build();
}
