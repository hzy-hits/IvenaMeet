use axum::{extract::ConnectInfo, http::HeaderMap};
use std::net::{IpAddr, SocketAddr};

pub fn request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or("-")
        .to_string()
}

pub fn client_ip(
    trusted_proxy_ips: &[IpAddr],
    headers: &HeaderMap,
    peer: ConnectInfo<SocketAddr>,
) -> String {
    let peer_ip = peer.0.ip();
    if !trusted_proxy_ips.contains(&peer_ip) {
        return peer_ip.to_string();
    }

    if let Some(raw) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = raw.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    if let Some(ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        return ip.to_string();
    }
    peer_ip.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn ignores_forwarded_header_from_untrusted_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "1.2.3.4".parse().unwrap());
        let peer = ConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 9)),
            4567,
        ));
        let ip = client_ip(&[], &headers, peer);
        assert_eq!(ip, "10.0.0.9");
    }

    #[test]
    fn uses_forwarded_header_from_trusted_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "1.2.3.4, 5.6.7.8".parse().unwrap());
        let trusted = [IpAddr::V4(Ipv4Addr::new(10, 0, 0, 9))];
        let peer = ConnectInfo(SocketAddr::new(trusted[0], 4567));
        let ip = client_ip(&trusted, &headers, peer);
        assert_eq!(ip, "1.2.3.4");
    }
}
