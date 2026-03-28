//! Geographic routing — redirect to the closest federation node.
//!
//! Reads region headers from Cloudflare, Fly.io, or CloudFront and
//! selects the nearest active peer node by comparing AWS-style region strings.
//!
//! Region proximity is approximated by major geographic area (same continent/ocean
//! basin). This is intentionally coarse — precision geolocation is not worth the
//! complexity for a volunteer-operated network.
//!
//! Blocked nodes are never selected as redirect targets.

use axum::http::HeaderMap;
use tracing::debug;

/// Infer the client's AWS-style region from request headers.
pub fn infer_client_region(headers: &HeaderMap) -> Option<String> {
    // Fly.io — most precise (actual PoP code)
    if let Some(v) = headers.get("fly-region").and_then(|v| v.to_str().ok()) {
        return Some(fly_region_to_aws(v));
    }
    // Cloudflare — country code
    if let Some(cc) = headers.get("cf-ipcountry").and_then(|v| v.to_str().ok()) {
        return Some(country_to_aws_region(cc));
    }
    // CloudFront
    if let Some(cc) = headers.get("cloudfront-viewer-country").and_then(|v| v.to_str().ok()) {
        return Some(country_to_aws_region(cc));
    }
    None
}

/// Select the closest peer node domain for a given client region.
///
/// Queries the `nodes` table for active peers and picks the one in the
/// nearest region. Returns None if the local node is already closest,
/// if there are no peers, or if geo routing is disabled.
///
/// The caller should issue a 302 redirect to `https://{returned_domain}{original_path}`.
pub async fn select_closest_node(
    local_region: &str,
    client_region: &str,
    peers: &[PeerInfo],
) -> Option<String> {
    if peers.is_empty() { return None; }

    // Score each peer by proximity to the client region
    let best = peers.iter()
        .filter(|p| p.status == "active")
        .min_by_key(|p| region_distance(client_region, &p.region));

    let best = best?;
    let local_score  = region_distance(client_region, local_region);
    let remote_score = region_distance(client_region, &best.region);

    // Only redirect if the remote node is meaningfully closer (margin: 1 hop)
    if remote_score + 1 < local_score {
        debug!(
            client = client_region,
            local = local_region,
            best = %best.domain,
            best_region = %best.region,
            "Geo redirect"
        );
        Some(best.domain.clone())
    } else {
        None
    }
}

/// Peer node as returned by DB query.
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub domain: String,
    pub region: String,
    pub status: String,
}

/// Distance between two AWS-style regions (lower = closer).
///
/// Same region = 0, same geographic area = 1, same continent = 2,
/// different continent = 3, unknown = 4.
fn region_distance(a: &str, b: &str) -> u8 {
    if a == b { return 0; }

    let area_a = region_area(a);
    let area_b = region_area(b);
    if area_a == area_b { return 1; }

    let continent_a = region_continent(a);
    let continent_b = region_continent(b);
    if continent_a == continent_b { return 2; }

    3
}

#[derive(PartialEq)]
enum Area {
    SeAsia, EastAsia, SouthAsia, Oceania,
    WestEurope, EastEurope,
    UsEast, UsWest, UsCentral,
    SouthAmerica, MiddleEast, Africa,
    Unknown,
}

#[derive(PartialEq)]
enum Continent { Asia, Europe, NorthAmerica, SouthAmerica, Oceania, Africa, Unknown }

fn region_area(r: &str) -> Area {
    match r {
        "ap-southeast-1" | "ap-southeast-2" | "ap-southeast-3" => Area::SeAsia,
        "ap-northeast-1" | "ap-northeast-2" | "ap-northeast-3" => Area::EastAsia,
        "ap-south-1" | "ap-south-2" => Area::SouthAsia,
        "ap-southeast-4" | "ap-southeast-5" => Area::Oceania,
        "eu-west-1" | "eu-west-2" | "eu-west-3" | "eu-central-1" | "eu-north-1" => Area::WestEurope,
        "eu-south-1" | "eu-central-2" => Area::EastEurope,
        "us-east-1" | "us-east-2" => Area::UsEast,
        "us-west-1" | "us-west-2" => Area::UsWest,
        "ca-central-1" | "us-central-1" => Area::UsCentral,
        "sa-east-1" => Area::SouthAmerica,
        "me-south-1" | "me-central-1" | "il-central-1" => Area::MiddleEast,
        "af-south-1" => Area::Africa,
        _ => Area::Unknown,
    }
}

fn region_continent(r: &str) -> Continent {
    if r.starts_with("ap-") { return Continent::Asia; }
    if r.starts_with("eu-") || r.starts_with("il-") { return Continent::Europe; }
    if r.starts_with("us-") || r.starts_with("ca-") { return Continent::NorthAmerica; }
    if r.starts_with("sa-") { return Continent::SouthAmerica; }
    if r.starts_with("af-") { return Continent::Africa; }
    if r.starts_with("me-") { return Continent::Asia; }
    Continent::Unknown
}

/// Map Fly.io PoP codes to AWS-style region strings.
pub fn fly_region_to_aws(fly: &str) -> String {
    match fly.to_lowercase().as_str() {
        "sin" => "ap-southeast-1",
        "jkt" => "ap-southeast-3",  // Jakarta — primary NexusHosting market
        "nrt" => "ap-northeast-1",
        "syd" => "ap-southeast-2",
        "ams" => "eu-west-1",
        "lhr" => "eu-west-2",
        "fra" => "eu-central-1",
        "iad" => "us-east-1",
        "ord" => "us-east-2",
        "lax" => "us-west-1",
        "sea" => "us-west-2",
        "gru" => "sa-east-1",
        "bog" => "sa-east-1",
        "scl" => "sa-east-1",
        "dub" => "eu-west-1",
        "cdg" => "eu-west-3",
        "maa" => "ap-south-1",
        "bom" => "ap-south-1",
        other => other,
    }.to_string()
}

/// Map ISO 3166-1 alpha-2 country codes to AWS-style region strings.
/// Indonesia gets the Jakarta region (ap-southeast-3) — the primary NexusHosting market.
pub fn country_to_aws_region(cc: &str) -> String {
    match cc.to_uppercase().as_str() {
        // Southeast Asia — primary market
        "ID" => "ap-southeast-3",   // Indonesia — Jakarta
        "SG" | "MY" | "TH" | "VN" | "PH" | "MM" | "KH" | "LA" | "BN" => "ap-southeast-1",

        // East Asia
        "JP" => "ap-northeast-1",
        "KR" => "ap-northeast-2",
        "TW" | "HK" => "ap-northeast-1",
        "CN" => "ap-east-1",

        // Oceania
        "AU" | "NZ" => "ap-southeast-2",

        // South Asia
        "IN" | "PK" | "BD" | "LK" | "NP" => "ap-south-1",

        // Middle East
        "SA" | "AE" | "QA" | "KW" | "BH" | "OM" => "me-south-1",
        "IL" => "il-central-1",

        // Europe
        "DE" | "AT" | "CH" | "PL" | "CZ" | "HU" => "eu-central-1",
        "GB" | "IE" => "eu-west-2",
        "FR" | "BE" | "LU" => "eu-west-3",
        "NL" => "eu-west-1",
        "SE" | "NO" | "DK" | "FI" => "eu-north-1",
        "ES" | "PT" | "IT" | "GR" => "eu-south-1",

        // Americas
        "US" | "PR" => "us-east-1",
        "CA" => "ca-central-1",
        "MX" => "us-east-1",
        "BR" | "AR" | "CL" | "CO" | "PE" => "sa-east-1",

        // Africa
        "ZA" | "NG" | "KE" | "EG" => "af-south-1",

        // Default fallback
        _ => "us-east-1",
    }.to_string()
}
