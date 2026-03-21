//! Geographic routing — redirect to the closest federation node.
//!
//! Reads region headers from Cloudflare, Fly.io, or CloudFront and
//! selects the nearest active peer node from the database.
//!
//! TODO: query the `nodes` table for active peers and their regions,
//! then match against the inferred client region.

use axum::http::HeaderMap;

/// Infer the client's AWS-style region from request headers.
/// Returns None if no geo header is present.
pub fn infer_region(headers: &HeaderMap) -> Option<String> {
    // Fly.io
    if let Some(fly) = headers.get("fly-region").and_then(|v| v.to_str().ok()) {
        return Some(fly_to_aws(fly));
    }
    // Cloudflare
    if let Some(cc) = headers.get("cf-ipcountry").and_then(|v| v.to_str().ok()) {
        return Some(country_to_region(cc));
    }
    // CloudFront
    if let Some(cc) = headers.get("cloudfront-viewer-country").and_then(|v| v.to_str().ok()) {
        return Some(country_to_region(cc));
    }
    None
}

/// Select the closest node domain for a given client region.
/// Returns None if the local node is already in the best region.
///
/// TODO: implement DB query + region matching logic from geoRouting.ts
pub async fn select_closest_node(_domain: &str, _headers: &HeaderMap) -> Option<String> {
    None // stub — implement after DB layer is wired
}

fn fly_to_aws(fly: &str) -> String {
    match fly.to_lowercase().as_str() {
        "sin" => "ap-southeast-1",
        "jkt" => "ap-southeast-3",
        "nrt" => "ap-northeast-1",
        "syd" => "ap-southeast-2",
        "ams" => "eu-west-1",
        "lhr" => "eu-west-2",
        "fra" => "eu-central-1",
        "iad" => "us-east-1",
        "ord" => "us-east-2",
        "lax" => "us-west-1",
        "gru" => "sa-east-1",
        other => other,
    }.to_string()
}

fn country_to_region(cc: &str) -> String {
    match cc.to_uppercase().as_str() {
        "ID" => "ap-southeast-3", // Indonesia — primary market
        "SG" | "MY" | "TH" | "VN" | "PH" => "ap-southeast-1",
        "JP" => "ap-northeast-1",
        "AU" | "NZ" => "ap-southeast-2",
        "IN" | "PK" | "BD" => "ap-south-1",
        "DE" => "eu-central-1",
        "GB" => "eu-west-2",
        "FR" => "eu-west-3",
        "NL" | "IE" => "eu-west-1",
        "US" | "CA" => "us-east-1",
        "BR" => "sa-east-1",
        _ => "us-east-1",
    }.to_string()
}
