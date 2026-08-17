use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const CATALOG_VERSION: u32 = 1;
pub const PACKAGE_NAME: &str = "se.euther.euthersurfer";
const PROVIDER: &str = "google_play";
const MAX_BODY_BYTES: usize = 32 * 1024;
const MAX_TOKEN_BYTES: usize = 4 * 1024;
const RATE_WINDOW_MS: u64 = 60_000;
const RATE_MAX_REQUESTS: usize = 12;
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE: &str = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_API_ROOT: &str = "https://androidpublisher.googleapis.com/";
const MAX_PROVIDER_BODY_BYTES: u64 = 64 * 1024;
const ACCESS_TOKEN_REFRESH_MARGIN_SECS: u64 = 60;
const GOOGLE_TOKEN_INFO_URI: &str = "https://oauth2.googleapis.com/tokeninfo";
const MAX_RTDN_MESSAGE_IDS: usize = 4_096;
const MAX_OIDC_TOKEN_BYTES: usize = 8 * 1024;
const MAX_OIDC_CACHE_ENTRIES: usize = 32;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RtdnAuthError {
    Invalid,
    Unavailable,
}

trait RtdnAuthenticator: Send + Sync {
    fn configured(&self) -> bool;
    fn verify(&self, token: &str, now_epoch_secs: u64) -> Result<(), RtdnAuthError>;
}

struct DisabledRtdnAuthenticator;

impl RtdnAuthenticator for DisabledRtdnAuthenticator {
    fn configured(&self) -> bool {
        false
    }

    fn verify(&self, _token: &str, _now_epoch_secs: u64) -> Result<(), RtdnAuthError> {
        Err(RtdnAuthError::Unavailable)
    }
}

struct GooglePubSubAuthenticator {
    client: reqwest::blocking::Client,
    expected_audience: String,
    expected_email: String,
    verified_tokens: Mutex<HashMap<String, u64>>,
}

impl GooglePubSubAuthenticator {
    fn new(expected_audience: String, expected_email: String) -> Result<Self, RtdnAuthError> {
        if !expected_audience.starts_with("https://")
            || expected_audience.len() > 2_048
            || expected_audience.chars().any(char::is_control)
            || !expected_email.ends_with(".gserviceaccount.com")
            || expected_email.len() > 320
            || expected_email.chars().any(char::is_control)
        {
            return Err(RtdnAuthError::Invalid);
        }
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .user_agent("EutherOxide-Sakura-RTDN/1")
            .build()
            .map_err(|_| RtdnAuthError::Unavailable)?;
        Ok(Self {
            client,
            expected_audience,
            expected_email,
            verified_tokens: Mutex::new(HashMap::new()),
        })
    }

    fn validate_claims(
        &self,
        claims: &serde_json::Value,
        now_epoch_secs: u64,
    ) -> Result<u64, RtdnAuthError> {
        let string_claim = |name: &str| {
            claims
                .get(name)
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
        };
        let number_claim = |name: &str| {
            claims.get(name).and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_str().and_then(|value| value.parse::<u64>().ok()))
            })
        };
        let email_verified = claims
            .get("email_verified")
            .is_some_and(|value| value == true || value.as_str() == Some("true"));
        let issuer = string_claim("iss").ok_or(RtdnAuthError::Invalid)?;
        let issued_at = number_claim("iat").ok_or(RtdnAuthError::Invalid)?;
        let expires_at = number_claim("exp").ok_or(RtdnAuthError::Invalid)?;
        if string_claim("aud") != Some(self.expected_audience.as_str())
            || string_claim("email") != Some(self.expected_email.as_str())
            || !email_verified
            || !matches!(
                issuer,
                "accounts.google.com" | "https://accounts.google.com"
            )
            || string_claim("sub").is_none()
            || issued_at > now_epoch_secs.saturating_add(60)
            || now_epoch_secs.saturating_sub(issued_at) > 3_700
            || expires_at <= now_epoch_secs
            || expires_at.saturating_sub(issued_at) > 3_700
        {
            return Err(RtdnAuthError::Invalid);
        }
        Ok(expires_at)
    }
}

impl RtdnAuthenticator for GooglePubSubAuthenticator {
    fn configured(&self) -> bool {
        true
    }

    fn verify(&self, token: &str, now_epoch_secs: u64) -> Result<(), RtdnAuthError> {
        if token.is_empty()
            || token.len() > MAX_OIDC_TOKEN_BYTES
            || token.chars().any(char::is_control)
            || token.split('.').count() != 3
        {
            return Err(RtdnAuthError::Invalid);
        }
        let fingerprint = token_fingerprint(token);
        {
            let mut cache = self
                .verified_tokens
                .lock()
                .map_err(|_| RtdnAuthError::Unavailable)?;
            cache.retain(|_, expires_at| *expires_at > now_epoch_secs);
            if cache
                .get(&fingerprint)
                .is_some_and(|expires_at| *expires_at > now_epoch_secs.saturating_add(30))
            {
                return Ok(());
            }
        }
        let mut response = self
            .client
            .get(GOOGLE_TOKEN_INFO_URI)
            .query(&[("id_token", token)])
            .send()
            .map_err(|_| RtdnAuthError::Unavailable)?;
        let status = response.status();
        if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED {
            let _ = read_bounded_rtdn_auth_body(&mut response);
            return Err(RtdnAuthError::Invalid);
        }
        if status != StatusCode::OK {
            let _ = read_bounded_rtdn_auth_body(&mut response);
            return Err(RtdnAuthError::Unavailable);
        }
        let body = read_bounded_rtdn_auth_body(&mut response)?;
        let claims: serde_json::Value =
            serde_json::from_slice(&body).map_err(|_| RtdnAuthError::Invalid)?;
        let expires_at = self.validate_claims(&claims, now_epoch_secs)?;
        let mut cache = self
            .verified_tokens
            .lock()
            .map_err(|_| RtdnAuthError::Unavailable)?;
        if cache.len() >= MAX_OIDC_CACHE_ENTRIES
            && let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, expires_at)| **expires_at)
                .map(|(fingerprint, _)| fingerprint.clone())
        {
            cache.remove(&oldest);
        }
        cache.insert(fingerprint, expires_at);
        Ok(())
    }
}

fn read_bounded_rtdn_auth_body(
    response: &mut reqwest::blocking::Response,
) -> Result<Vec<u8>, RtdnAuthError> {
    let mut body = Vec::new();
    response
        .take(MAX_PROVIDER_BODY_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|_| RtdnAuthError::Unavailable)?;
    if body.len() as u64 > MAX_PROVIDER_BODY_BYTES {
        return Err(RtdnAuthError::Unavailable);
    }
    Ok(body)
}

#[derive(Deserialize)]
struct GoogleServiceAccountFile {
    #[serde(rename = "type")]
    account_type: String,
    client_email: String,
    private_key: String,
    #[serde(default)]
    private_key_id: Option<String>,
    token_uri: String,
}

#[derive(Serialize)]
struct GoogleJwtClaims<'a> {
    iss: &'a str,
    scope: &'static str,
    aud: &'static str,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
}

struct CachedAccessToken {
    value: String,
    expires_at_epoch_secs: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleProductPurchaseV2 {
    #[serde(default)]
    product_line_item: Vec<GoogleProductLineItem>,
    purchase_state_context: Option<GooglePurchaseStateContext>,
    acknowledgement_state: Option<String>,
    purchase_completion_time: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleProductLineItem {
    product_id: String,
    product_offer_details: Option<GoogleProductOfferDetails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleProductOfferDetails {
    quantity: Option<i64>,
    refundable_quantity: Option<i64>,
    consumption_state: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GooglePurchaseStateContext {
    purchase_state: Option<String>,
}

pub struct GooglePlayPurchaseProvider {
    client: reqwest::blocking::Client,
    client_email: String,
    private_key_id: Option<String>,
    encoding_key: EncodingKey,
    access_token: Mutex<Option<CachedAccessToken>>,
}

impl GooglePlayPurchaseProvider {
    fn from_file(path: &PathBuf) -> Result<Self, PlayProviderError> {
        let bytes = fs::read(path).map_err(|_| PlayProviderError::Unavailable)?;
        if bytes.len() > MAX_PROVIDER_BODY_BYTES as usize {
            return Err(PlayProviderError::Rejected);
        }
        let account: GoogleServiceAccountFile =
            serde_json::from_slice(&bytes).map_err(|_| PlayProviderError::Rejected)?;
        if account.account_type != "service_account"
            || account.token_uri != GOOGLE_TOKEN_URI
            || account.client_email.len() > 320
            || !account.client_email.contains('@')
            || account.client_email.chars().any(char::is_control)
            || account.private_key.len() > MAX_PROVIDER_BODY_BYTES as usize
            || account.private_key_id.as_deref().is_some_and(|key_id| {
                key_id.is_empty() || key_id.len() > 256 || key_id.chars().any(char::is_control)
            })
        {
            return Err(PlayProviderError::Rejected);
        }
        let encoding_key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())
            .map_err(|_| PlayProviderError::Rejected)?;
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .user_agent("EutherOxide-Sakura-Commerce/1")
            .build()
            .map_err(|_| PlayProviderError::Unavailable)?;
        Ok(Self {
            client,
            client_email: account.client_email,
            private_key_id: account.private_key_id,
            encoding_key,
            access_token: Mutex::new(None),
        })
    }

    fn now_epoch_secs() -> Result<u64, PlayProviderError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .map_err(|_| PlayProviderError::Unavailable)
    }

    fn access_token(&self, force_refresh: bool) -> Result<String, PlayProviderError> {
        let now = Self::now_epoch_secs()?;
        if !force_refresh {
            let cache = self
                .access_token
                .lock()
                .map_err(|_| PlayProviderError::Unavailable)?;
            if let Some(token) = cache.as_ref()
                && token.expires_at_epoch_secs
                    > now.saturating_add(ACCESS_TOKEN_REFRESH_MARGIN_SECS)
            {
                return Ok(token.value.clone());
            }
        }

        let mut header = Header::new(Algorithm::RS256);
        header.kid = self.private_key_id.clone();
        let claims = GoogleJwtClaims {
            iss: &self.client_email,
            scope: GOOGLE_SCOPE,
            aud: GOOGLE_TOKEN_URI,
            iat: now,
            exp: now.saturating_add(3_300),
        };
        let assertion = encode(&header, &claims, &self.encoding_key)
            .map_err(|_| PlayProviderError::Unavailable)?;
        let mut response = self
            .client
            .post(GOOGLE_TOKEN_URI)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .map_err(|_| PlayProviderError::Unavailable)?;
        if response.status() != StatusCode::OK {
            return Err(PlayProviderError::Unavailable);
        }
        let body = read_bounded_body(&mut response)?;
        let token: GoogleTokenResponse =
            serde_json::from_slice(&body).map_err(|_| PlayProviderError::Unavailable)?;
        if !token.token_type.eq_ignore_ascii_case("bearer")
            || token.access_token.is_empty()
            || token.access_token.len() > 8 * 1024
            || token.access_token.chars().any(char::is_control)
            || !(120..=3_600).contains(&token.expires_in)
        {
            return Err(PlayProviderError::Unavailable);
        }
        let expires_at_epoch_secs = now.saturating_add(token.expires_in);
        let value = token.access_token;
        let mut cache = self
            .access_token
            .lock()
            .map_err(|_| PlayProviderError::Unavailable)?;
        *cache = Some(CachedAccessToken {
            value: value.clone(),
            expires_at_epoch_secs,
        });
        Ok(value)
    }

    fn purchase_url(
        package_name: &str,
        purchase_token: &str,
    ) -> Result<reqwest::Url, PlayProviderError> {
        let mut url =
            reqwest::Url::parse(GOOGLE_API_ROOT).map_err(|_| PlayProviderError::Unavailable)?;
        url.path_segments_mut()
            .map_err(|_| PlayProviderError::Unavailable)?
            .extend([
                "androidpublisher",
                "v3",
                "applications",
                package_name,
                "purchases",
                "productsv2",
                "tokens",
                purchase_token,
            ]);
        Ok(url)
    }

    fn acknowledge_url(
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
    ) -> Result<reqwest::Url, PlayProviderError> {
        let mut url =
            reqwest::Url::parse(GOOGLE_API_ROOT).map_err(|_| PlayProviderError::Unavailable)?;
        url.path_segments_mut()
            .map_err(|_| PlayProviderError::Unavailable)?
            .extend([
                "androidpublisher",
                "v3",
                "applications",
                package_name,
                "purchases",
                "products",
                product_id,
                "tokens",
                purchase_token,
            ]);
        let with_action = format!("{}:acknowledge", url.as_str());
        reqwest::Url::parse(&with_action).map_err(|_| PlayProviderError::Unavailable)
    }

    fn verify_once(
        &self,
        package_name: &str,
        purchase_token: &str,
        force_refresh: bool,
    ) -> Result<(StatusCode, Option<GoogleProductPurchaseV2>), PlayProviderError> {
        let token = self.access_token(force_refresh)?;
        let mut response = self
            .client
            .get(Self::purchase_url(package_name, purchase_token)?)
            .bearer_auth(token)
            .send()
            .map_err(|_| PlayProviderError::Unavailable)?;
        let status = response.status();
        if status == StatusCode::OK {
            let body = read_bounded_body(&mut response)?;
            let purchase =
                serde_json::from_slice(&body).map_err(|_| PlayProviderError::Rejected)?;
            return Ok((status, Some(purchase)));
        }
        let _ = read_bounded_body(&mut response);
        Ok((status, None))
    }

    fn acknowledge_once(
        &self,
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
        force_refresh: bool,
    ) -> Result<StatusCode, PlayProviderError> {
        let token = self.access_token(force_refresh)?;
        let mut response = self
            .client
            .post(Self::acknowledge_url(
                package_name,
                product_id,
                purchase_token,
            )?)
            .bearer_auth(token)
            .json(&serde_json::json!({}))
            .send()
            .map_err(|_| PlayProviderError::Unavailable)?;
        let status = response.status();
        let _ = read_bounded_body(&mut response);
        Ok(status)
    }
}

impl PlayPurchaseProvider for GooglePlayPurchaseProvider {
    fn configured(&self) -> bool {
        true
    }

    fn verify(
        &self,
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
    ) -> Result<PlayPurchaseState, PlayProviderError> {
        if package_name != PACKAGE_NAME || product(product_id).is_none() {
            return Err(PlayProviderError::Rejected);
        }
        let (mut status, mut purchase) = self.verify_once(package_name, purchase_token, false)?;
        if status == StatusCode::UNAUTHORIZED {
            (status, purchase) = self.verify_once(package_name, purchase_token, true)?;
        }
        if status == StatusCode::OK {
            return classify_purchase(
                purchase.as_ref().ok_or(PlayProviderError::Rejected)?,
                product_id,
            );
        }
        if matches!(status.as_u16(), 400 | 404 | 410) {
            Err(PlayProviderError::Rejected)
        } else {
            Err(PlayProviderError::Unavailable)
        }
    }

    fn acknowledge(
        &self,
        package_name: &str,
        product_id: &str,
        purchase_token: &str,
    ) -> Result<(), PlayProviderError> {
        if package_name != PACKAGE_NAME || product(product_id).is_none() {
            return Err(PlayProviderError::Rejected);
        }
        let mut status = self.acknowledge_once(package_name, product_id, purchase_token, false)?;
        if status == StatusCode::UNAUTHORIZED {
            status = self.acknowledge_once(package_name, product_id, purchase_token, true)?;
        }
        if status.is_success() {
            Ok(())
        } else if matches!(status.as_u16(), 400 | 404 | 410) {
            Err(PlayProviderError::Rejected)
        } else {
            Err(PlayProviderError::Unavailable)
        }
    }
}

fn read_bounded_body(
    response: &mut reqwest::blocking::Response,
) -> Result<Vec<u8>, PlayProviderError> {
    let mut body = Vec::new();
    response
        .take(MAX_PROVIDER_BODY_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|_| PlayProviderError::Unavailable)?;
    if body.len() as u64 > MAX_PROVIDER_BODY_BYTES {
        return Err(PlayProviderError::Unavailable);
    }
    Ok(body)
}

fn classify_purchase(
    purchase: &GoogleProductPurchaseV2,
    expected_product_id: &str,
) -> Result<PlayPurchaseState, PlayProviderError> {
    let state = purchase
        .purchase_state_context
        .as_ref()
        .and_then(|context| context.purchase_state.as_deref())
        .ok_or(PlayProviderError::Rejected)?;
    match state {
        "PENDING" => return Ok(PlayPurchaseState::Pending),
        "CANCELLED" | "PURCHASE_STATE_UNSPECIFIED" => {
            return Ok(PlayPurchaseState::NotPurchased);
        }
        "PURCHASED" => {}
        _ => return Err(PlayProviderError::Rejected),
    }
    if purchase
        .purchase_completion_time
        .as_deref()
        .is_none_or(str::is_empty)
        || purchase.product_line_item.len() != 1
    {
        return Err(PlayProviderError::Rejected);
    }
    let item = &purchase.product_line_item[0];
    let offer = item
        .product_offer_details
        .as_ref()
        .ok_or(PlayProviderError::Rejected)?;
    if item.product_id != expected_product_id
        || offer.quantity != Some(1)
        || offer.refundable_quantity != Some(1)
        || offer.consumption_state.as_deref() != Some("CONSUMPTION_STATE_YET_TO_BE_CONSUMED")
    {
        return Ok(PlayPurchaseState::NotPurchased);
    }
    match purchase.acknowledgement_state.as_deref() {
        Some("ACKNOWLEDGEMENT_STATE_PENDING") => Ok(PlayPurchaseState::Purchased {
            acknowledged: false,
        }),
        Some("ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") => {
            Ok(PlayPurchaseState::Purchased { acknowledged: true })
        }
        _ => Err(PlayProviderError::Rejected),
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PubSubPushEnvelope {
    message: PubSubMessage,
    subscription: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PubSubMessage {
    data: String,
    message_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeveloperNotification {
    version: String,
    package_name: String,
    event_time_millis: String,
    one_time_product_notification: Option<OneTimeProductNotification>,
    voided_purchase_notification: Option<VoidedPurchaseNotification>,
    test_notification: Option<serde_json::Value>,
    subscription_notification: Option<serde_json::Value>,
    pending_refund_review_notification: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OneTimeProductNotification {
    version: String,
    notification_type: u8,
    purchase_token: String,
    sku: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoidedPurchaseNotification {
    purchase_token: String,
    product_type: u8,
    refund_type: u8,
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
    #[serde(default)]
    processed_rtdn_message_fingerprints: Vec<String>,
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
    rtdn_authenticator: Arc<dyn RtdnAuthenticator>,
    ledger_path: PathBuf,
    ledger_lock: Mutex<()>,
    rtdn_lock: Mutex<()>,
    attempts: Mutex<HashMap<String, VecDeque<u64>>>,
}

impl EutherSurferCommerce {
    pub fn new(
        enabled: bool,
        ledger_path: PathBuf,
        service_account_path: Option<PathBuf>,
        rtdn_audience: Option<String>,
        rtdn_service_account_email: Option<String>,
    ) -> Self {
        let provider: Arc<dyn PlayPurchaseProvider> = service_account_path
            .as_ref()
            .and_then(|path| GooglePlayPurchaseProvider::from_file(path).ok())
            .map(|provider| Arc::new(provider) as Arc<dyn PlayPurchaseProvider>)
            .unwrap_or_else(|| Arc::new(DisabledPlayPurchaseProvider));
        let rtdn_authenticator: Arc<dyn RtdnAuthenticator> = rtdn_audience
            .zip(rtdn_service_account_email)
            .and_then(|(audience, email)| GooglePubSubAuthenticator::new(audience, email).ok())
            .map(|authenticator| Arc::new(authenticator) as Arc<dyn RtdnAuthenticator>)
            .unwrap_or_else(|| Arc::new(DisabledRtdnAuthenticator));
        Self::with_provider_and_rtdn_auth(enabled, ledger_path, provider, rtdn_authenticator)
    }

    #[cfg(test)]
    fn new_disabled(enabled: bool, ledger_path: PathBuf) -> Self {
        Self::with_provider_and_rtdn_auth(
            enabled,
            ledger_path,
            Arc::new(DisabledPlayPurchaseProvider),
            Arc::new(DisabledRtdnAuthenticator),
        )
    }

    #[cfg(test)]
    fn with_provider(
        enabled: bool,
        ledger_path: PathBuf,
        provider: Arc<dyn PlayPurchaseProvider>,
    ) -> Self {
        Self::with_provider_and_rtdn_auth(
            enabled,
            ledger_path,
            provider,
            Arc::new(DisabledRtdnAuthenticator),
        )
    }

    fn with_provider_and_rtdn_auth(
        enabled: bool,
        ledger_path: PathBuf,
        provider: Arc<dyn PlayPurchaseProvider>,
        rtdn_authenticator: Arc<dyn RtdnAuthenticator>,
    ) -> Self {
        Self {
            enabled,
            provider,
            rtdn_authenticator,
            ledger_path,
            ledger_lock: Mutex::new(()),
            rtdn_lock: Mutex::new(()),
            attempts: Mutex::new(HashMap::new()),
        }
    }

    pub fn status(&self) -> CommerceHttpResponse {
        CommerceHttpResponse::ok(serde_json::json!({
            "enabled": self.enabled,
            "providerConfigured": self.provider.configured(),
            "rtdnConfigured": self.rtdn_authenticator.configured(),
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

    pub fn rtdn(
        &self,
        body: &[u8],
        authorization: Option<&str>,
        now_ms: u64,
    ) -> CommerceHttpResponse {
        if !self.enabled {
            return CommerceHttpResponse::error(
                503,
                "commerce_disabled",
                "Sakura Sprint commerce is not enabled",
            );
        }
        if !self.provider.configured() {
            return CommerceHttpResponse::error(
                503,
                "provider_not_configured",
                "Google Play verification is not configured",
            );
        }
        if !self.rtdn_authenticator.configured() {
            return CommerceHttpResponse::error(
                503,
                "rtdn_not_configured",
                "Google Pub/Sub verification is not configured",
            );
        }
        if body.len() > MAX_BODY_BYTES {
            return CommerceHttpResponse::error(
                413,
                "request_too_large",
                "RTDN request is too large",
            );
        }
        let token = match authorization.and_then(parse_bearer_token) {
            Some(token) => token,
            None => {
                return CommerceHttpResponse::error(
                    401,
                    "rtdn_unauthorized",
                    "RTDN authentication failed",
                );
            }
        };
        match self.rtdn_authenticator.verify(token, now_ms / 1_000) {
            Ok(()) => {}
            Err(RtdnAuthError::Invalid) => {
                return CommerceHttpResponse::error(
                    401,
                    "rtdn_unauthorized",
                    "RTDN authentication failed",
                );
            }
            Err(RtdnAuthError::Unavailable) => {
                return CommerceHttpResponse::error(
                    503,
                    "rtdn_auth_unavailable",
                    "RTDN authentication is temporarily unavailable",
                );
            }
        }
        let _guard = match self.rtdn_lock.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return CommerceHttpResponse::error(
                    503,
                    "rtdn_unavailable",
                    "RTDN processing is temporarily unavailable",
                );
            }
        };
        let envelope: PubSubPushEnvelope = match serde_json::from_slice(body) {
            Ok(envelope) => envelope,
            Err(_) => return invalid_rtdn(),
        };
        if !valid_pubsub_envelope(&envelope) {
            return invalid_rtdn();
        }
        let message_fingerprint = token_fingerprint(&envelope.message.message_id);
        match self.rtdn_was_processed(&message_fingerprint) {
            Ok(true) => return rtdn_accepted(true),
            Ok(false) => {}
            Err(_) => return provider_error_response(PlayProviderError::Unavailable),
        }
        let decoded = match BASE64_STANDARD.decode(envelope.message.data.as_bytes()) {
            Ok(decoded) if decoded.len() <= MAX_BODY_BYTES => decoded,
            _ => return invalid_rtdn(),
        };
        let notification: DeveloperNotification = match serde_json::from_slice(&decoded) {
            Ok(notification) => notification,
            Err(_) => return invalid_rtdn(),
        };
        if !valid_developer_notification(&notification) {
            return invalid_rtdn();
        }

        let result = if let Some(one_time) = notification.one_time_product_notification.as_ref() {
            self.process_rtdn_one_time(one_time, now_ms)
        } else if let Some(voided) = notification.voided_purchase_notification.as_ref() {
            self.process_rtdn_voided(voided, now_ms)
        } else {
            Ok(())
        };
        if let Err(error) = result {
            return provider_error_response(error);
        }
        if self.mark_rtdn_processed(message_fingerprint).is_err() {
            return provider_error_response(PlayProviderError::Unavailable);
        }
        rtdn_accepted(false)
    }

    fn process_rtdn_one_time(
        &self,
        notification: &OneTimeProductNotification,
        now_ms: u64,
    ) -> Result<(), PlayProviderError> {
        if notification.version != "1.0"
            || !matches!(notification.notification_type, 1 | 2)
            || validate_evidence(&notification.sku, &notification.purchase_token).is_err()
        {
            return Err(PlayProviderError::Rejected);
        }
        self.process_purchase(
            &PurchaseEvidence {
                product_id: notification.sku.clone(),
                purchase_token: notification.purchase_token.clone(),
            },
            now_ms,
        )?;
        Ok(())
    }

    fn process_rtdn_voided(
        &self,
        notification: &VoidedPurchaseNotification,
        now_ms: u64,
    ) -> Result<(), PlayProviderError> {
        if notification.product_type != 2
            || !matches!(notification.refund_type, 1 | 2)
            || notification.purchase_token.len() < 8
            || notification.purchase_token.len() > MAX_TOKEN_BYTES
            || notification.purchase_token.chars().any(char::is_control)
        {
            return Err(PlayProviderError::Rejected);
        }
        self.revoke_by_token(&notification.purchase_token, now_ms)
            .map_err(|_| PlayProviderError::Unavailable)
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
        if ledger.purchases.iter().any(|existing| {
            existing.token_fingerprint == record.token_fingerprint
                && existing.product_id != record.product_id
        }) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "purchase token already belongs to another product",
            ));
        }
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

    fn revoke_by_token(&self, purchase_token: &str, now_ms: u64) -> io::Result<()> {
        let _guard = self
            .ledger_lock
            .lock()
            .map_err(|_| io::Error::other("purchase ledger lock poisoned"))?;
        let mut ledger = self.read_ledger()?;
        let fingerprint = token_fingerprint(purchase_token);
        for record in ledger
            .purchases
            .iter_mut()
            .filter(|record| record.token_fingerprint == fingerprint)
        {
            record.active = false;
            record.verified_at_epoch_ms = now_ms;
        }
        self.write_ledger(&ledger)
    }

    fn rtdn_was_processed(&self, message_fingerprint: &str) -> io::Result<bool> {
        let _guard = self
            .ledger_lock
            .lock()
            .map_err(|_| io::Error::other("purchase ledger lock poisoned"))?;
        Ok(self
            .read_ledger()?
            .processed_rtdn_message_fingerprints
            .iter()
            .any(|fingerprint| fingerprint == message_fingerprint))
    }

    fn mark_rtdn_processed(&self, message_fingerprint: String) -> io::Result<()> {
        let _guard = self
            .ledger_lock
            .lock()
            .map_err(|_| io::Error::other("purchase ledger lock poisoned"))?;
        let mut ledger = self.read_ledger()?;
        if !ledger
            .processed_rtdn_message_fingerprints
            .iter()
            .any(|fingerprint| fingerprint == &message_fingerprint)
        {
            ledger
                .processed_rtdn_message_fingerprints
                .push(message_fingerprint);
            let overflow = ledger
                .processed_rtdn_message_fingerprints
                .len()
                .saturating_sub(MAX_RTDN_MESSAGE_IDS);
            if overflow > 0 {
                ledger
                    .processed_rtdn_message_fingerprints
                    .drain(0..overflow);
            }
        }
        self.write_ledger(&ledger)
    }

    fn read_ledger(&self) -> io::Result<PurchaseLedger> {
        if !self.ledger_path.exists() {
            return Ok(PurchaseLedger {
                schema_version: 2,
                purchases: Vec::new(),
                processed_rtdn_message_fingerprints: Vec::new(),
            });
        }
        let bytes = fs::read(&self.ledger_path)?;
        let mut ledger: PurchaseLedger = serde_json::from_slice(&bytes)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid purchase ledger"))?;
        if !matches!(ledger.schema_version, 1 | 2) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsupported purchase ledger schema",
            ));
        }
        ledger.schema_version = 2;
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

fn parse_bearer_token(authorization: &str) -> Option<&str> {
    authorization
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty() && !token.contains(char::is_whitespace))
}

fn valid_pubsub_envelope(envelope: &PubSubPushEnvelope) -> bool {
    !envelope.subscription.is_empty()
        && envelope.subscription.len() <= 1_024
        && !envelope.subscription.chars().any(char::is_control)
        && !envelope.message.message_id.is_empty()
        && envelope.message.message_id.len() <= 128
        && envelope
            .message
            .message_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        && !envelope.message.data.is_empty()
}

fn valid_developer_notification(notification: &DeveloperNotification) -> bool {
    let notification_count = [
        notification.one_time_product_notification.is_some(),
        notification.voided_purchase_notification.is_some(),
        notification.test_notification.is_some(),
        notification.subscription_notification.is_some(),
        notification.pending_refund_review_notification.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    notification.version == "1.0"
        && notification.package_name == PACKAGE_NAME
        && notification_count == 1
        && notification
            .event_time_millis
            .parse::<u64>()
            .is_ok_and(|value| value > 0)
}

fn invalid_rtdn() -> CommerceHttpResponse {
    CommerceHttpResponse::error(400, "invalid_rtdn", "Invalid Google Pub/Sub notification")
}

fn rtdn_accepted(duplicate: bool) -> CommerceHttpResponse {
    CommerceHttpResponse::ok(serde_json::json!({
        "accepted": true,
        "duplicate": duplicate,
    }))
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
        verifications: AtomicUsize,
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
            self.verifications.fetch_add(1, Ordering::Relaxed);
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

    struct FakeRtdnAuthenticator {
        result: Result<(), RtdnAuthError>,
        calls: AtomicUsize,
    }

    impl RtdnAuthenticator for FakeRtdnAuthenticator {
        fn configured(&self) -> bool {
            true
        }

        fn verify(&self, token: &str, _now_epoch_secs: u64) -> Result<(), RtdnAuthError> {
            assert_eq!(token, "signed.oidc.token");
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.result
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
        verify_body_for("sakura_sprint.supporter.sakura.v1", token)
    }

    fn verify_body_for(product_id: &str, token: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "provider": PROVIDER,
            "packageName": PACKAGE_NAME,
            "catalogVersion": CATALOG_VERSION,
            "productId": product_id,
            "purchaseToken": token,
        }))
        .unwrap()
    }

    fn google_purchase(
        purchase_state: &str,
        product_id: &str,
        acknowledgement_state: &str,
        quantity: i64,
        refundable_quantity: i64,
        consumption_state: &str,
    ) -> GoogleProductPurchaseV2 {
        serde_json::from_value(serde_json::json!({
            "productLineItem": [{
                "productId": product_id,
                "productOfferDetails": {
                    "quantity": quantity,
                    "refundableQuantity": refundable_quantity,
                    "consumptionState": consumption_state,
                }
            }],
            "purchaseStateContext": { "purchaseState": purchase_state },
            "acknowledgementState": acknowledgement_state,
            "purchaseCompletionTime": "2026-08-17T12:00:00Z",
        }))
        .unwrap()
    }

    fn rtdn_body(message_id: &str, notification: serde_json::Value) -> Vec<u8> {
        let data = BASE64_STANDARD.encode(serde_json::to_vec(&notification).unwrap());
        serde_json::to_vec(&serde_json::json!({
            "message": {
                "data": data,
                "messageId": message_id,
            },
            "subscription": "projects/sakura/subscriptions/play-rtdn",
        }))
        .unwrap()
    }

    fn one_time_notification(product_id: &str, purchase_token: &str) -> serde_json::Value {
        serde_json::json!({
            "version": "1.0",
            "packageName": PACKAGE_NAME,
            "eventTimeMillis": "1786980000000",
            "oneTimeProductNotification": {
                "version": "1.0",
                "notificationType": 1,
                "purchaseToken": purchase_token,
                "sku": product_id,
            }
        })
    }

    fn voided_notification(purchase_token: &str) -> serde_json::Value {
        serde_json::json!({
            "version": "1.0",
            "packageName": PACKAGE_NAME,
            "eventTimeMillis": "1786980001000",
            "voidedPurchaseNotification": {
                "purchaseToken": purchase_token,
                "orderId": "GS.0000-1111-2222-33333",
                "productType": 2,
                "refundType": 1,
            }
        })
    }

    fn rtdn_commerce(
        path: PathBuf,
        provider: Arc<FakeProvider>,
        authenticator: Arc<FakeRtdnAuthenticator>,
    ) -> EutherSurferCommerce {
        EutherSurferCommerce::with_provider_and_rtdn_auth(true, path, provider, authenticator)
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
            verifications: AtomicUsize::new(0),
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
            verifications: AtomicUsize::new(0),
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
            verifications: AtomicUsize::new(0),
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

    #[test]
    fn google_contract_grants_only_exact_active_unconsumed_product() {
        let product_id = "sakura_sprint.supporter.sakura.v1";
        let pending_ack = google_purchase(
            "PURCHASED",
            product_id,
            "ACKNOWLEDGEMENT_STATE_PENDING",
            1,
            1,
            "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
        );
        assert_eq!(
            classify_purchase(&pending_ack, product_id),
            Ok(PlayPurchaseState::Purchased {
                acknowledged: false
            })
        );
        let acknowledged = GoogleProductPurchaseV2 {
            acknowledgement_state: Some("ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED".to_string()),
            ..pending_ack
        };
        assert_eq!(
            classify_purchase(&acknowledged, product_id),
            Ok(PlayPurchaseState::Purchased { acknowledged: true })
        );
    }

    #[test]
    fn google_contract_rejects_wrong_product_refund_consumption_and_unknown_state() {
        let product_id = "sakura_sprint.supporter.sakura.v1";
        for purchase in [
            google_purchase(
                "PURCHASED",
                "sakura_sprint.supporter.moonlight.v1",
                "ACKNOWLEDGEMENT_STATE_PENDING",
                1,
                1,
                "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
            ),
            google_purchase(
                "PURCHASED",
                product_id,
                "ACKNOWLEDGEMENT_STATE_PENDING",
                1,
                0,
                "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
            ),
            google_purchase(
                "PURCHASED",
                product_id,
                "ACKNOWLEDGEMENT_STATE_PENDING",
                1,
                1,
                "CONSUMPTION_STATE_CONSUMED",
            ),
        ] {
            assert_eq!(
                classify_purchase(&purchase, product_id),
                Ok(PlayPurchaseState::NotPurchased)
            );
        }
        let unknown = google_purchase(
            "FUTURE_STATE",
            product_id,
            "ACKNOWLEDGEMENT_STATE_PENDING",
            1,
            1,
            "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
        );
        assert_eq!(
            classify_purchase(&unknown, product_id),
            Err(PlayProviderError::Rejected)
        );
    }

    #[test]
    fn google_contract_preserves_pending_and_cancelled_without_entitlements() {
        let product_id = "sakura_sprint.supporter.sakura.v1";
        for (state, expected) in [
            ("PENDING", PlayPurchaseState::Pending),
            ("CANCELLED", PlayPurchaseState::NotPurchased),
        ] {
            let purchase = google_purchase(
                state,
                product_id,
                "ACKNOWLEDGEMENT_STATE_PENDING",
                1,
                1,
                "CONSUMPTION_STATE_YET_TO_BE_CONSUMED",
            );
            assert_eq!(classify_purchase(&purchase, product_id), Ok(expected));
        }
    }

    #[test]
    fn google_urls_encode_untrusted_path_segments() {
        let purchase = GooglePlayPurchaseProvider::purchase_url(PACKAGE_NAME, "token/with spaces")
            .unwrap()
            .to_string();
        assert!(purchase.contains("token%2Fwith%20spaces"));
        assert!(!purchase.contains("token/with spaces"));
        let acknowledge = GooglePlayPurchaseProvider::acknowledge_url(
            PACKAGE_NAME,
            "sakura_sprint.supporter.sakura.v1",
            "token/with spaces",
        )
        .unwrap()
        .to_string();
        assert!(acknowledge.ends_with("token%2Fwith%20spaces:acknowledge"));
    }

    #[test]
    fn one_purchase_token_cannot_claim_two_products() {
        let path = test_path("token-product-conflict");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased { acknowledged: true },
            verifications: AtomicUsize::new(0),
            acknowledgements: AtomicUsize::new(0),
        });
        let commerce = EutherSurferCommerce::with_provider(true, path.clone(), provider);
        assert_eq!(
            commerce
                .verify(
                    &verify_body_for("sakura_sprint.supporter.sakura.v1", "shared-token"),
                    "client-a",
                    10,
                )
                .status,
            200
        );
        let conflict = commerce.verify(
            &verify_body_for("sakura_sprint.supporter.moonlight.v1", "shared-token"),
            "client-a",
            11,
        );
        assert_eq!(conflict.status, 503);
        assert!(!fs::read_to_string(&path).unwrap().contains("shared-token"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rtdn_requires_authenticated_pubsub_before_parsing_body() {
        let path = test_path("rtdn-auth");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased { acknowledged: true },
            verifications: AtomicUsize::new(0),
            acknowledgements: AtomicUsize::new(0),
        });
        let authenticator = Arc::new(FakeRtdnAuthenticator {
            result: Ok(()),
            calls: AtomicUsize::new(0),
        });
        let commerce = rtdn_commerce(path, provider, authenticator.clone());
        let response = commerce.rtdn(b"not-json", None, 1_786_980_000_000);
        assert_eq!(response.status, 401);
        assert_eq!(response.body["error"]["code"], "rtdn_unauthorized");
        assert_eq!(authenticator.calls.load(Ordering::Relaxed), 0);
        assert!(!response.body.to_string().contains("not-json"));
    }

    #[test]
    fn rtdn_purchase_is_reverified_deduplicated_and_token_redacted() {
        let path = test_path("rtdn-purchase");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased {
                acknowledged: false,
            },
            verifications: AtomicUsize::new(0),
            acknowledgements: AtomicUsize::new(0),
        });
        let authenticator = Arc::new(FakeRtdnAuthenticator {
            result: Ok(()),
            calls: AtomicUsize::new(0),
        });
        let commerce = rtdn_commerce(path.clone(), provider.clone(), authenticator);
        let body = rtdn_body(
            "message-100",
            one_time_notification("sakura_sprint.supporter.sakura.v1", "rtdn-secret-token"),
        );
        let first = commerce.rtdn(&body, Some("Bearer signed.oidc.token"), 1_786_980_000_000);
        assert_eq!(first.status, 200);
        assert_eq!(first.body["duplicate"], false);
        let duplicate = commerce.rtdn(&body, Some("Bearer signed.oidc.token"), 1_786_980_000_100);
        assert_eq!(duplicate.status, 200);
        assert_eq!(duplicate.body["duplicate"], true);
        assert_eq!(provider.verifications.load(Ordering::Relaxed), 1);
        assert_eq!(provider.acknowledgements.load(Ordering::Relaxed), 1);
        let stored = fs::read_to_string(&path).unwrap();
        assert!(!stored.contains("rtdn-secret-token"));
        assert!(!stored.contains("message-100"));
        assert!(stored.contains("processedRtdnMessageFingerprints"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn authenticated_voided_rtdn_revokes_without_storing_order_or_token() {
        let path = test_path("rtdn-voided");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased { acknowledged: true },
            verifications: AtomicUsize::new(0),
            acknowledgements: AtomicUsize::new(0),
        });
        let authenticator = Arc::new(FakeRtdnAuthenticator {
            result: Ok(()),
            calls: AtomicUsize::new(0),
        });
        let commerce = rtdn_commerce(path.clone(), provider, authenticator);
        assert_eq!(
            commerce
                .verify(&verify_body("voided-secret-token"), "client-a", 100)
                .status,
            200
        );
        let response = commerce.rtdn(
            &rtdn_body("message-voided", voided_notification("voided-secret-token")),
            Some("Bearer signed.oidc.token"),
            1_786_980_001_000,
        );
        assert_eq!(response.status, 200);
        let stored = fs::read_to_string(&path).unwrap();
        assert!(stored.contains("\"active\": false"));
        assert!(!stored.contains("voided-secret-token"));
        assert!(!stored.contains("GS.0000-1111-2222-33333"));
        assert!(!stored.contains("message-voided"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rtdn_auth_outage_is_retryable_and_does_not_touch_ledger() {
        let path = test_path("rtdn-auth-outage");
        let provider = Arc::new(FakeProvider {
            state: PlayPurchaseState::Purchased { acknowledged: true },
            verifications: AtomicUsize::new(0),
            acknowledgements: AtomicUsize::new(0),
        });
        let authenticator = Arc::new(FakeRtdnAuthenticator {
            result: Err(RtdnAuthError::Unavailable),
            calls: AtomicUsize::new(0),
        });
        let commerce = rtdn_commerce(path.clone(), provider.clone(), authenticator);
        let response = commerce.rtdn(
            &rtdn_body(
                "message-outage",
                one_time_notification("sakura_sprint.supporter.sakura.v1", "outage-secret-token"),
            ),
            Some("Bearer signed.oidc.token"),
            1_786_980_000_000,
        );
        assert_eq!(response.status, 503);
        assert_eq!(response.body["error"]["code"], "rtdn_auth_unavailable");
        assert_eq!(provider.verifications.load(Ordering::Relaxed), 0);
        assert!(!path.exists());
    }

    #[test]
    fn pubsub_claims_require_exact_audience_email_issuer_and_freshness() {
        let authenticator = GooglePubSubAuthenticator::new(
            "https://apothictech.se/api/euthersurfer/purchases/rtdn".to_string(),
            "sakura-rtdn@example.iam.gserviceaccount.com".to_string(),
        )
        .unwrap();
        let now = 1_786_980_000;
        let valid = serde_json::json!({
            "aud": "https://apothictech.se/api/euthersurfer/purchases/rtdn",
            "email": "sakura-rtdn@example.iam.gserviceaccount.com",
            "email_verified": true,
            "iss": "https://accounts.google.com",
            "sub": "1234567890",
            "iat": now - 60,
            "exp": now + 3_000,
        });
        assert_eq!(authenticator.validate_claims(&valid, now), Ok(now + 3_000));
        for (field, value) in [
            ("aud", serde_json::json!("https://evil.example/rtdn")),
            ("email", serde_json::json!("attacker@example.com")),
            ("email_verified", serde_json::json!(false)),
            ("iss", serde_json::json!("https://evil.example")),
            ("exp", serde_json::json!(now - 1)),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert_eq!(
                authenticator.validate_claims(&invalid, now),
                Err(RtdnAuthError::Invalid)
            );
        }
    }
}
