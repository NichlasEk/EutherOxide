//! Opaque, owner-only BongoLogg vault transport. No passwords or decryption keys.
use super::*;
use base64::Engine as _;
use std::io::Write;

const PREFIX: &str = "/api/bongologg/stam/vault";
const MAX_OBJECT: usize = 16 * 1024 * 1024 + 28;
static LOCK: Mutex<()> = Mutex::new(());

fn root(user: &str) -> PathBuf { host_user_data_dir(user).join("bongologg-vault-v1") }
pub(super) fn active(user: &str) -> bool { root(user).join("state.json").is_file() }
fn id_valid(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i,b)| {
        if [8,13,18,23].contains(&i) { b == b'-' } else { b.is_ascii_digit() || (b'a'..=b'f').contains(&b) }
    })
}
fn private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}
fn atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    private_dir(path.parent().unwrap())?;
    let tmp = path.with_extension("tmp");
    let mut f = fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(&tmp)?;
    f.write_all(bytes)?; f.sync_all()?;
    fs::rename(tmp, path)?;
    fs::File::open(path.parent().unwrap())?.sync_all()
}
fn state_at(dir: &Path) -> io::Result<serde_json::Value> {
    match fs::read(dir.join("state.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(serde_json::json!({"revision":0,"envelope":null})),
        Err(e) => Err(e)
    }
}
fn commit_state(dir: &Path, input: &serde_json::Value) -> io::Result<Result<serde_json::Value, serde_json::Value>> {
    let current = state_at(dir)?;
    let revision = current["revision"].as_u64().ok_or_else(|| invalid_request("invalid revision"))?;
    if input["baseRevision"].as_u64() != Some(revision) { return Ok(Err(current)); }
    let envelope = &input["envelope"];
    let header = &envelope["header"];
    let id = header["id"].as_str().unwrap_or_default();
    if !id_valid(id) || header["version"].as_u64() != Some(1)
        || header["kdf"].as_str() != Some("argon2id-65536-3-1")
        || header.to_string().len() > 4096 {
        return Err(invalid_request("invalid vault header"));
    }
    if revision > 0 && current["envelope"]["header"]["id"] != header["id"] {
        return Err(invalid_request("vault identity cannot change"));
    }
    for field in ["salt", "wrapped", "recovery"] {
        let value = header[field].as_str().ok_or_else(|| invalid_request("invalid key envelope"))?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(value).map_err(|_| invalid_request("invalid base64"))?;
        if bytes.len() != if field == "salt" {16} else {60} { return Err(invalid_request("invalid key envelope size")); }
    }
    let index = envelope["index"].as_str().ok_or_else(|| invalid_request("missing encrypted index"))?;
    let encrypted = base64::engine::general_purpose::STANDARD.decode(index).map_err(|_| invalid_request("invalid encrypted index"))?;
    if !(28..=4*1024*1024+28).contains(&encrypted.len()) { return Err(invalid_request("invalid index size")); }
    let objects = envelope["objects"].as_array().ok_or_else(|| invalid_request("missing object list"))?;
    if objects.len() > 20000 { return Err(invalid_request("too many objects")); }
    for item in objects {
        let id = item.as_str().unwrap_or_default();
        if !id_valid(id) || !dir.join("objects").join(id).is_file() { return Err(invalid_request("vault object missing")); }
    }
    let next = serde_json::json!({"revision": revision.checked_add(1).ok_or_else(|| invalid_request("revision overflow"))?, "envelope": envelope});
    atomic(&dir.join("state.json"), &serde_json::to_vec(&next).map_err(io::Error::other)?)?;
    Ok(Ok(next))
}

pub(super) fn handle(stream: &mut TcpStream, state: &HostState, request: &HttpRequest) -> io::Result<()> {
    let user = match require_bongologg_user(state, request) {
        Ok(user) => user,
        Err(_) => return send_error(stream, 401, "Bongologg login required"),
    };
    let result = handle_authenticated(stream, &user, request);
    match result {
        Err(e) if e.kind() == io::ErrorKind::InvalidInput => send_error(stream, 400, &e.to_string()),
        result => result,
    }
}
fn handle_authenticated(stream: &mut TcpStream, user: &str, request: &HttpRequest) -> io::Result<()> {
    let path = request.path.split('?').next().unwrap_or_default();
    let dir = root(user);
    let _guard = LOCK.lock().map_err(|_| io::Error::other("vault lock poisoned"))?;
    if path == format!("{PREFIX}/state") {
        return match request.method.as_str() {
            "GET" => send_json(stream, &state_at(&dir)?),
            "POST" => {
                if request.body.len() > 6*1024*1024 { return send_error(stream, 413, "index too large"); }
                let input = serde_json::from_slice(&request.body).map_err(|_| invalid_request("invalid state"))?;
                let _stam = BONGOLOGG_STAM_LOCK.lock().map_err(|_| io::Error::other("stam lock poisoned"))?;
                match commit_state(&dir, &input)? {
                    Ok(value) => send_json(stream, &value),
                    Err(value) => send_json_status(stream, 409, &value),
                }
            },
            _ => send_error(stream, 405, "method not allowed"),
        };
    }
    if let Some(id) = path.strip_prefix(&format!("{PREFIX}/objects/")) {
        if !id_valid(id) { return send_error(stream, 400, "invalid object ID"); }
        let file = dir.join("objects").join(id);
        return match request.method.as_str() {
            "GET" => match fs::read(file) {
                Ok(bytes) => send_response(stream, 200, "application/octet-stream", &bytes),
                Err(e) if e.kind()==io::ErrorKind::NotFound => send_error(stream,404,"object missing"),
                Err(e)=>Err(e),
            },
            "POST" => {
                if !(28..=MAX_OBJECT).contains(&request.body.len()) { return send_error(stream,413,"object size out of range"); }
                if file.exists() {
                    if fs::read(&file)? != request.body { return send_error(stream,409,"object is immutable"); }
                } else {
                    // Bound abandoned uploads as well as committed data per account.
                    let objects = dir.join("objects");
                    let used: u64 = if objects.exists() { fs::read_dir(&objects)?.filter_map(Result::ok).filter_map(|e| e.metadata().ok()).map(|m|m.len()).sum() } else {0};
                    if used + request.body.len() as u64 > 2*1024*1024*1024 { return send_error(stream,413,"vault quota reached (2 GiB)"); }
                    atomic(&file, &request.body)?;
                }
                send_json(stream, &serde_json::json!({"ok":true}))
            },
            _ => send_error(stream,405,"method not allowed"),
        };
    }
    if request.method == "POST" && path == format!("{PREFIX}/retire-legacy") {
        if !active(user) { return send_error(stream,409,"sync encrypted vault first"); }
        let input: serde_json::Value = serde_json::from_slice(&request.body).map_err(|_| invalid_request("invalid retirement request"))?;
        let checksums = input["files"].as_object().ok_or_else(|| invalid_request("missing verified files"))?;
        // Serialize with both generations of the old Stam API.
        let _stam = BONGOLOGG_STAM_LOCK.lock().map_err(|_| io::Error::other("stam lock poisoned"))?;
        let metas = load_bongologg_document_metas(user)?;
        if metas.iter().any(|m| !m.shared_with.is_empty()) { return send_error(stream,409,"remove legacy sharing before retiring plaintext"); }
        let old = bongologg_stam_dir(user);
        let mut files = Vec::new();
        if old.is_dir() {
            for entry in fs::read_dir(&old)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if validate_bongologg_stam_name(&name).is_ok() && entry.file_type()?.is_file() {
                    if checksums.get(&name).and_then(|v| v.as_str()) != Some(sha256_hex(&fs::read(entry.path())?).as_str()) {
                        return send_error(stream,409,"legacy files changed; import and verify again");
                    }
                    files.push(entry.path());
                }
            }
        }
        let count = files.len();
        for file in files { fs::remove_file(file)?; }
        if old.join(".documents.json").exists() { fs::remove_file(old.join(".documents.json"))?; }
        return send_json(stream,&serde_json::json!({"removed":count}));
    }
    send_error(stream,404,"vault route not found")
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn ids_cannot_escape_user_directory() {
        assert!(id_valid("12345678-abcd-1234-abcd-123456789abc"));
        for id in ["../../users.toml", "12345678-abcd-1234-abcd-123456789ab/", "", "UPPERCASE"] { assert!(!id_valid(id)); }
    }
    #[test] fn compare_and_swap_and_missing_objects() {
        let dir = std::env::temp_dir().join(format!("bongo-vault-test-{}-{}", std::process::id(), unix_ms_now()));
        private_dir(&dir).unwrap();
        let b64 = |n| base64::engine::general_purpose::STANDARD.encode(vec![1u8;n]);
        let mut input = serde_json::json!({"baseRevision":0,"envelope":{"header":{"id":"12345678-abcd-1234-abcd-123456789abc","version":1,"kdf":"argon2id-65536-3-1","salt":b64(16),"wrapped":b64(60),"recovery":b64(60)},"index":b64(28),"objects":[]}});
        assert_eq!(commit_state(&dir,&input).unwrap().unwrap()["revision"],1);
        assert!(commit_state(&dir,&input).unwrap().is_err());
        input["baseRevision"] = serde_json::json!(1);
        input["envelope"]["objects"] = serde_json::json!(["11111111-abcd-1234-abcd-123456789abc"]);
        assert!(commit_state(&dir,&input).is_err());
        assert_eq!(state_at(&dir).unwrap()["revision"],1);
        fs::remove_dir_all(dir).unwrap();
    }
}
