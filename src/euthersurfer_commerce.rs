use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const CATALOG_VERSION: u32 = 1;
pub const PACKAGE_NAME: &str = "se.euther.euthersurfer";
const PROVIDER: &str = "google_play";
const MAX_BODY_BYTES: usize = 32 * 1024;
const MAX_TOKEN_BYTES: usize = 4 * 1024;
const RATE_WINDOW_MS: u64 = 60_000;
const RATE_MAX_REQUESTS: usize = 12;

#[derive(Clone, Copy)]
struct ProductDefinition {
    product_id: &'static str,
    entitlements: &'static [&'static str],
}

const PRODUCTS: &[ProductDefinition] = &[
    ProductDefinition {
        product_id: "sakura_sprint.supporter.sakura.v1",
        entitlements: &["bundle_supporter_sakura_v1"],
    },
    ProductDefinition {
        product_id: "sakura_sprint.supporter.moonlight.v1",
        entitlements: &["bundle_supporter_moonlight_v1"],
    },
    ProductDefinition {
        product_id: "sakura_sprint.premium.one_time.v1",
        entitlements: &["premium_supporter_v1", "supporter_badge_v1"],
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayPurchaseState {
    Purchased { acknowledged: bool },
    Pending,
    NotPurchased,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayProviderError {
    Unavailable,
    Rejected,
}

pub trait PlayPurchaseProvider: Send + Sync {
    fn configured(&self) -> bool;
    fn verify(
        &self,
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
    ) -> Result<PlayPurchaseState, PlayProviderError>;
    fn acknowledge(
        &self,
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
    ) -> Result<(), PlayProviderError>;
}

pub struct DisabledPlayPurchaseProvider;

impl PlayPurchaseProvider for DisabledPlayPurchaseProvider {
    fn configured(&self) -> bool {
        false
    }

    fn verify(
        &self,
        _package_name: &str,
        _product_id: &str,
        _purchase_token: &str,
    ) -> Result<PlayPurchaseState, PlayProviderError> {
        Err(PlayProviderError::Unavailable)
    }

    fn acknowledge(
        &self,
        _package_name: &str,
        _product_id: &str,
        _purchase_token: &str,
    ) -> Result<(), PlayProviderError> {
        Err(PlayProviderError::Unavailable)
    }
}

#[derive(Debug)]
pub struct CommerceHttpResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

impl CommerceHttpResponse {
    fn ok(body: serde_json::Value) -> Self {
        Self { status: 200, body }
    }

    fn error(status: u16, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            body: serde_json::json!({ "error": { "code": code, "message": message } }),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifyRequest {
    provider: String,
    package_name: String,
    catalog_version: u32,
    product_id: String,
    purchase_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreRequest {
    provider: String,
    package_name: String,
    catalog_version: u32,
    purchases: Vec<PurchaseEvidence>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PurchaseEvidence {
    product_id: String,
    purchase_token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementResponse {
    id: String,
    source_product_id: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseLedger {
    schema_version: u32,
    purchases: Vec<PurchaseRecord>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseRecord {
    token_fingerprint: String,
    product_id: String,
    entitlements: Vec<String>,
    active: bool,
    acknowledged: bool,
    verified_at_epoch_ms: u64,
}

pub struct EutherSurferCommerce {
    enabled: bool,
    provider: Arc<dyn PlayPurchaseProvider>,
    ledger_path: PathBuf,
    ledger_lock: Mutex<()>,
    attempts: Mutex<HashMap<String, VecDeque<u64>>>,
}

impl EutherSurferCommerce {
    pub fn new_disabled(enabled: bool, ledger_path: PathBuf) -> Self {
        Self::with_provider(enabled, ledger_path, Arc::new(DisabledPlayPurchaseProvider))
    }

    pub fn with_provider(
        enabled: bool,
        ledger_path: PathBuf,
        provider: Arc<dyn PlayPurchaseProvider>,
    ) -> Self {
        Self {
            enabled,
            provider,
            ledger_path,
            ledger_lock: Mutex::new(()),
            attempts: Mutex::new(HashMap::new()),
        }
    }

    pub fn status(&self) -> CommerceHttpResponse {
        CommerceHttpResponse::ok(serde_json::json!({
            "enabled": self.enabled,
            "providerConfigured": self.provider.configured(),
            "catalogVersion": CATALOG_VERSION,
            "salesEnabled": false,
            "restoresEnabled": false,
        }))
    }

    pub fn verify(&self, body: &[u8], remote: &str, now_ms: u64) -> CommerceHttpResponse {
        if let Some(response) = self.preflight(body, remote, now_ms) {
            return response;
        }
        let request: VerifyRequest = match serde_json::from_slice(body) {
            Ok(request) => request,
            Err(_) => return invalid_payload(),
        };
        if !valid_request_header(
            &request.provider,
            &request.package_name,
            request.catalog_version,
        ) || validate_evidence(&request.product_id, &request.purchase_token).is_err()
        {
            return invalid_payload();
        }
        match self.process_purchase(
            &PurchaseEvidence {
                product_id: request.product_id,
                purchase_token: request.purchase_token,
            },
            now_ms,
        ) {
            Ok(Some(entitlements)) => success_response(entitlements, now_ms),
            Ok(None) => CommerceHttpResponse::error(
                422,
                "purchase_not_active",
                "Google Play reports no active purchase",
            ),
            Err(error) => provider_error_response(error),
        }
    }

    pub fn restore(&self, body: &[u8], remote: &str, now_ms: u64) -> CommerceHttpResponse {
        if let Some(response) = self.preflight(body, remote, now_ms) {
            return response;
        }
        let request: RestoreRequest = match serde_json::from_slice(body) {
            Ok(request) => request,
            Err(_) => return invalid_payload(),
        };
        if !valid_request_header(
            &request.provider,
            &request.package_name,
            request.catalog_version,
        ) {
            return invalid_payload();
        }
        let mut seen = HashSet::new();
        let purchases = request
            .purchases
            .into_iter()
            .filter(|purchase| {
                seen.insert((
                    purchase.product_id.clone(),
                    token_fingerprint(&purchase.purchase_token),
                ))
            })
            .collect::<Vec<_>>();
        if purchases.len() > PRODUCTS.len()
            || purchases.iter().any(|purchase| {
                validate_evidence(&purchase.product_id, &purchase.purchase_token).is_err()
            })
        {
            return invalid_payload();
        }
        let mut entitlements = Vec::new();
        for purchase in &purchases {
            match self.process_purchase(purchase, now_ms) {
                Ok(Some(found)) => entitlements.extend(found),
                Ok(None) => {}
                Err(error) => return provider_error_response(error),
            }
        }
        success_response(entitlements, now_ms)
    }

    fn preflight(&self, body: &[u8], remote: &str, now_ms: u64) -> Option<CommerceHttpResponse> {
        if !self.enabled {
            return Some(CommerceHttpResponse::error(
                503,
                "commerce_disabled",
                "Sakura Sprint commerce is not enabled",
            ));
        }
        if !self.provider.configured() {
            return Some(CommerceHttpResponse::error(
                503,
                "provider_not_configured",
                "Google Play verification is not configured",
            ));
        }
        if body.len() > MAX_BODY_BYTES {
            return Some(CommerceHttpResponse::error(
                413,
                "request_too_large",
                "Purchase request is too large",
            ));
        }
        if !self.allow_request(remote, now_ms) {
            return Some(CommerceHttpResponse::error(
                429,
                "rate_limited",
                "Too many purchase verification requests",
            ));
        }
        None
    }

    fn allow_request(&self, remote: &str, now_ms: u64) -> bool {
        let Ok(mut attempts) = self.attempts.lock() else {
            return false;
        };
        attempts.retain(|_, values| {
            values.retain(|seen| now_ms.saturating_sub(*seen) <= RATE_WINDOW_MS);
            !values.is_empty()
        });
        let values = attempts.entry(remote.to_string()).or_default();
        if values.len() >= RATE_MAX_REQUESTS {
            return false;
        }
        values.push_back(now_ms);
        true
    }

    fn process_purchase(
        &self,
        purchase: &PurchaseEvidence,
        now_ms: u64,
    ) -> Result<Option<Vec<EntitlementResponse>>, PlayProviderError> {
        let product = product(&purchase.product_id).ok_or(PlayProviderError::Rejected)?;
        let fingerprint = token_fingerprint(&purchase.purchase_token);
        match self
            .provider
            .verify(PACKAGE_NAME, product.product_id, &purchase.purchase_token)?
        {
            PlayPurchaseState::Pending => Err(PlayProviderError::Rejected),
            PlayPurchaseState::NotPurchased => {
                self.store_record(PurchaseRecord {
                    token_fingerprint: fingerprint,
                    product_id: product.product_id.to_string(),
                    entitlements: product
                        .entitlements
                        .iter()
                        .map(|id| (*id).to_string())
                        .collect(),
                    active: false,
                    acknowledged: false,
                    verified_at_epoch_ms: now_ms,
                })
                .map_err(|_| PlayProviderError::Unavailable)?;
                Ok(None)
            }
            PlayPurchaseState::Purchased { acknowledged } => {
                self.store_record(PurchaseRecord {
                    token_fingerprint: fingerprint.clone(),
                    product_id: product.product_id.to_string(),
                    entitlements: product
                        .entitlements
                        .iter()
                        .map(|id| (*id).to_string())
                        .collect(),
                    active: true,
                    acknowledged,
                    verified_at_epoch_ms: now_ms,
                })
                .map_err(|_| PlayProviderError::Unavailable)?;
                if !acknowledged {
                    self.provider.acknowledge(
                        PACKAGE_NAME,
                        product.product_id,
                        &purchase.purchase_token,
                    )?;
                    self.mark_acknowledged(&fingerprint, product.product_id, now_ms)
                        .map_err(|_| PlayProviderError::Unavailable)?;
                }
                Ok(Some(
                    product
                        .entitlements
                        .iter()
                        .map(|id| EntitlementResponse {
                            id: (*id).to_string(),
                            source_product_id: product.product_id.to_string(),
                        })
                        .collect(),
                ))
            }
        }
    }

    fn store_record(&self, record: PurchaseRecord) -> io::Result<()> {
        let _guard = self
            .ledger_lock
            .lock()
            .map_err(|_| io::Error::other("purchase ledger lock poisoned"))?;
        let mut ledger = self.read_ledger()?;
        if let Some(existing) = ledger.purchases.iter_mut().find(|existing| {
            existing.token_fingerprint == record.token_fingerprint
                && existing.product_id == record.product_id
        }) {
            *existing = record;
        } else {
            ledger.purchases.push(record);
        }
        self.write_ledger(&ledger)
    }

    fn mark_acknowledged(
        &self,
        fingerprint: &str,
        product_id: &str,
        now_ms: u64,
    ) -> io::Result<()> {
        let _guard = self
            .ledger_lock
            .lock()
            .map_err(|_| io::Error::other("purchase ledger lock poisoned"))?;
        let mut ledger = self.read_ledger()?;
        let record = ledger
            .purchases
            .iter_mut()
            .find(|record| {
                record.token_fingerprint == fingerprint && record.product_id == product_id
            })
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "purchase record missing"))?;
        record.acknowledged = true;
        record.verified_at_epoch_ms = now_ms;
        self.write_ledger(&ledger)
    }

    fn read_ledger(&self) -> io::Result<PurchaseLedger> {
        if !self.ledger_path.exists() {
            return Ok(PurchaseLedger {
                schema_version: 1,
                purchases: Vec::new(),
            });
        }
        let bytes = fs::read(&self.ledger_path)?;
        let ledger: PurchaseLedger = serde_json::from_slice(&bytes)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid purchase ledger"))?;
        if ledger.schema_version != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsupported purchase ledger schema",
            ));
        }
        Ok(ledger)
    }

    fn write_ledger(&self, ledger: &PurchaseLedger) -> io::Result<()> {
        if let Some(parent) = self.ledger_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temporary = self.ledger_path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(ledger).map_err(io::Error::other)?;
        let mut file = File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(temporary, &self.ledger_path)
    }
}

fn valid_request_header(provider: &str, package_name: &str, catalog_version: u32) -> bool {
    provider == PROVIDER && package_name == PACKAGE_NAME && catalog_version == CATALOG_VERSION
}

fn validate_evidence(product_id: &str, token: &str) -> Result<(), ()> {
    if product(product_id).is_none()
        || token.len() < 8
        || token.len() > MAX_TOKEN_BYTES
        || token.chars().any(char::is_control)
    {
        return Err(());
    }
    Ok(())
}

fn product(product_id: &str) -> Option<ProductDefinition> {
    PRODUCTS
        .iter()
        .copied()
        .find(|product| product.product_id == product_id)
}

fn token_fingerprint(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn verification_id(entitlements: &[EntitlementResponse], now_ms: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(now_ms.to_be_bytes());
    for entitlement in entitlements {
        hasher.update(entitlement.id.as_bytes());
        hasher.update(entitlement.source_product_id.as_bytes());
    }
    let digest = hasher.finalize();
    let short = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("verify-{now_ms}-{short}")
}

fn success_response(
    mut entitlements: Vec<EntitlementResponse>,
    now_ms: u64,
) -> CommerceHttpResponse {
    entitlements.sort_by(|left, right| {
        left.source_product_id
            .cmp(&right.source_product_id)
            .then_with(|| left.id.cmp(&right.id))
    });
    entitlements.dedup_by(|left, right| {
        left.id == right.id && left.source_product_id == right.source_product_id
    });
    CommerceHttpResponse::ok(serde_json::json!({
        "verificationId": verification_id(&entitlements, now_ms),
        "verifiedAtEpochMs": now_ms,
        "entitlements": entitlements,
    }))
}

fn invalid_payload() -> CommerceHttpResponse {
    CommerceHttpResponse::error(
        400,
        "invalid_request",
        "Invalid purchase verification request",
    )
}

fn provider_error_response(error: PlayProviderError) -> CommerceHttpResponse {
    match error {
        PlayProviderError::Unavailable => CommerceHttpResponse::error(
            503,
            "provider_unavailable",
            "Google Play verification is temporarily unavailable",
        ),
        PlayProviderError::Rejected => CommerceHttpResponse::error(
            409,
            "purchase_pending_or_rejected",
            "Purchase is not ready for entitlement delivery",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeProvider {
        state: PlayPurchaseState,
        acknowledgements: AtomicUsize,
    }

    impl PlayPurchaseProvider for FakeProvider {
        fn configured(&self) -> bool {
            true
        }

        fn verify(
            &self,
            package_name: &str,
            product_id: &str,
            _purchase_token: &str,
        ) -> Result<PlayPurchaseState, PlayProviderError> {
            assert_eq!(package_name, PACKAGE_NAME);
            assert!(product(product_id).is_some());
            Ok(self.state)
        }

        fn acknowledge(
            &self,
            package_name: &str,
            product_id: &str,
            _purchase_token: &str,
        ) -> Result<(), PlayProviderError> {
            assert_eq!(package_name, PACKAGE_NAME);
            assert!(product(product_id).is_some());
            self.acknowledgements.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
    }

    fn test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "euthersurfer-commerce-{name}-{}-{}.json",
            std::process::id(),
            crate::unix_ms_now(),
        ))
    }

    fn verify_body(token: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "provider": PROVIDER,
            "packageName": PACKAGE_NAME,
            "catalogVersion": CATALOG_VERSION,
            "productId": "sakura_sprint.supporter.sakura.v1",
            "purchaseToken": token,
        }))
        .unwrap()
    }

    #[test]
    fn disabled_status_and_endpoint_are_fail_closed() {
        let commerce = EutherSurferCommerce::new_disabled(false, test_path("disabled"));
        assert_eq!(commerce.status().body["enabled"], false);
        assert_eq!(commerce.status().body["providerConfigured"], false);
        let response = commerce.verify(&verify_body("secret-token"), "127.0.0.1", 1);
        assert_eq!(response.status, 503);
        assert_eq!(response.body["error"]["code"], "commerce_disabled");
        assert!(!response.body.to_string().contains("secret-token"));
    }

    #[test]
    fn successful_purchase_persists_only_fingerprint_then_acknowledges() {
        let path = test_path("success");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased {
                acknowledged: false,
            },
            acknowledgements: AtomicUsize::new(0),
        });
        let commerce = EutherSurferCommerce::with_provider(true, path.clone(), provider.clone());
        let response = commerce.verify(&verify_body("secret-token"), "127.0.0.1", 10_000);
        assert_eq!(response.status, 200);
        assert_eq!(response.body["entitlements"].as_array().unwrap().len(), 1);
        assert_eq!(provider.acknowledgements.load(Ordering::Relaxed), 1);
        let stored = fs::read_to_string(&path).unwrap();
        assert!(!stored.contains("secret-token"));
        assert!(stored.contains("tokenFingerprint"));
        assert!(stored.contains("\"acknowledged\": true"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn unknown_fields_and_pending_purchases_never_grant_entitlements() {
        let path = test_path("pending");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Pending,
            acknowledgements: AtomicUsize::new(0),
        });
        let commerce = EutherSurferCommerce::with_provider(true, path, provider);
        let mut unknown: serde_json::Value =
            serde_json::from_slice(&verify_body("secret-token")).unwrap();
        unknown["playerName"] = serde_json::json!("Momo");
        let invalid = commerce.verify(&serde_json::to_vec(&unknown).unwrap(), "127.0.0.1", 1);
        assert_eq!(invalid.status, 400);
        let pending = commerce.verify(&verify_body("secret-token"), "127.0.0.1", 2);
        assert_eq!(pending.status, 409);
        assert!(pending.body.get("entitlements").is_none());
    }

    #[test]
    fn rate_limit_is_per_remote_and_has_a_stable_error() {
        let path = test_path("rate");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::NotPurchased,
            acknowledgements: AtomicUsize::new(0),
        });
        let commerce = EutherSurferCommerce::with_provider(true, path.clone(), provider);
        for offset in 0..RATE_MAX_REQUESTS {
            assert_eq!(
                commerce
                    .verify(&verify_body("secret-token"), "client-a", offset as u64)
                    .status,
                422,
            );
        }
        let limited = commerce.verify(&verify_body("secret-token"), "client-a", 20);
        assert_eq!(limited.status, 429);
        assert_eq!(limited.body["error"]["code"], "rate_limited");
        assert_eq!(
            commerce
                .verify(&verify_body("secret-token"), "client-b", 20)
                .status,
            422,
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn catalog_is_gameplay_neutral_and_matches_android_contract() {
        assert_eq!(PRODUCTS.len(), 3);
        let forbidden = [
            "life", "score", "speed", "ammo", "damage", "currency", "energy",
        ];
        assert!(PRODUCTS.iter().all(|product| {
            !product.entitlements.is_empty()
                && product
                    .entitlements
                    .iter()
                    .all(|id| !forbidden.iter().any(|word| id.contains(word)))
        }));
    }
}
