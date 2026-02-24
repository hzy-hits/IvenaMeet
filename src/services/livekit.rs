use crate::error::{AppError, AppResult};
use livekit_api::{
    access_token::{AccessToken, VideoGrants},
    services::{
        ingress::{CreateIngressOptions, IngressClient, IngressListFilter},
        room::{RoomClient, UpdateParticipantOptions},
    },
};
use livekit_protocol as proto;
use std::time::Duration;

#[derive(Clone)]
pub struct LiveKitService {
    api_host: String,
    public_ws_url: String,
    api_key: String,
    api_secret: String,
    token_ttl_seconds: u64,
}

#[derive(Clone)]
pub struct CreatedIngress {
    pub whip_url: String,
    pub stream_key: String,
    pub ingress_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishPermission {
    pub camera: bool,
    pub screen_share: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserRole {
    Host,
    Member,
}

impl UserRole {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "host" => Some(Self::Host),
            "member" => Some(Self::Member),
            _ => None,
        }
    }
}

impl LiveKitService {
    pub fn new(
        api_host: String,
        public_ws_url: String,
        api_key: String,
        api_secret: String,
        token_ttl_seconds: u64,
    ) -> Self {
        Self {
            api_host,
            public_ws_url,
            api_key,
            api_secret,
            token_ttl_seconds,
        }
    }

    pub fn public_ws_url(&self) -> &str {
        &self.public_ws_url
    }

    fn api_hosts_in_order(&self) -> Vec<String> {
        let mut hosts = vec![self.api_host.clone()];
        // Some livekit-api/Twirp paths require plain http scheme for server API endpoint.
        if let Some(rest) = self.api_host.strip_prefix("https://") {
            hosts.push(format!("http://{rest}"));
        }
        hosts
    }

    pub fn issue_room_token(
        &self,
        identity: &str,
        room: &str,
        _role: UserRole,
        permission: PublishPermission,
    ) -> AppResult<String> {
        let publish_sources = token_publish_sources(permission);

        AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(identity)
            .with_name(identity)
            .with_ttl(Duration::from_secs(self.token_ttl_seconds))
            .with_grants(VideoGrants {
                room_join: true,
                room: room.to_string(),
                can_publish: true,
                can_subscribe: true,
                can_publish_data: true,
                can_publish_sources: publish_sources,
                ..Default::default()
            })
            .to_jwt()
            .map_err(|e| AppError::LiveKit(e.to_string()))
    }

    pub async fn create_whip_ingress(
        &self,
        room_id: &str,
        participant_identity: &str,
        participant_name: &str,
    ) -> AppResult<CreatedIngress> {
        let options = CreateIngressOptions {
            name: format!("stream_{room_id}"),
            room_name: room_id.to_string(),
            participant_identity: participant_identity.to_string(),
            participant_name: participant_name.to_string(),
            audio: proto::IngressAudioOptions {
                name: "audio".to_string(),
                source: 0,
                encoding_options: None,
            },
            video: proto::IngressVideoOptions {
                name: "video".to_string(),
                source: 0,
                encoding_options: None,
            },
            // Keep WHIP in bypass mode when source is already H264/Opus.
            // This avoids the ingress transcoding path and its extra failure surface.
            bypass_transcoding: true,
            enable_transcoding: Some(false),
            ..Default::default()
        };
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = IngressClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client
                .create_ingress(proto::IngressInput::WhipInput, options.clone())
                .await
            {
                Ok(ingress) => {
                    let whip_url = if ingress.url.trim().is_empty() {
                        fallback_whip_url_from_public_ws(&self.public_ws_url)
                    } else {
                        ingress.url
                    };
                    return Ok(CreatedIngress {
                        whip_url,
                        stream_key: ingress.stream_key,
                        ingress_id: ingress.ingress_id,
                    });
                }
                Err(e) => {
                    last_err = Some(e.to_string());
                }
            }
        }
        Err(AppError::LiveKit(
            last_err.unwrap_or_else(|| "create ingress failed".to_string()),
        ))
    }

    pub async fn delete_ingress(&self, ingress_id: &str) -> AppResult<()> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = IngressClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client.delete_ingress(ingress_id).await {
                Ok(_) => return Ok(()),
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        Err(AppError::LiveKit(
            last_err.unwrap_or_else(|| "delete ingress failed".to_string()),
        ))
    }

    pub async fn get_ingress(&self, ingress_id: &str) -> AppResult<Option<proto::IngressInfo>> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = IngressClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client
                .list_ingress(IngressListFilter::IngressId(ingress_id.to_string()))
                .await
            {
                Ok(items) => return Ok(items.into_iter().next()),
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        Err(AppError::LiveKit(
            last_err.unwrap_or_else(|| "get ingress failed".to_string()),
        ))
    }

    pub async fn mute_participant_microphone(
        &self,
        room_id: &str,
        participant_identity: &str,
        muted: bool,
    ) -> AppResult<u32> {
        self.mute_participant_track_source(
            room_id,
            participant_identity,
            proto::TrackSource::Microphone,
            muted,
        )
        .await
    }

    pub async fn mute_all_microphones(
        &self,
        room_id: &str,
        exclude_identity: Option<&str>,
        muted: bool,
    ) -> AppResult<u32> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = RoomClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client.list_participants(room_id).await {
                Ok(participants) => {
                    let mut changed = 0_u32;
                    for participant in participants {
                        if exclude_identity.is_some_and(|id| id == participant.identity) {
                            continue;
                        }
                        for track in participant.tracks {
                            if track.source != proto::TrackSource::Microphone as i32 {
                                continue;
                            }
                            client
                                .mute_published_track(
                                    room_id,
                                    &participant.identity,
                                    &track.sid,
                                    muted,
                                )
                                .await
                                .map_err(|e| AppError::LiveKit(e.to_string()))?;
                            changed += 1;
                        }
                    }
                    return Ok(changed);
                }
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        Err(AppError::LiveKit(
            last_err.unwrap_or_else(|| "mute all failed".to_string()),
        ))
    }

    pub async fn is_identity_active(&self, room_id: &str, identity: &str) -> AppResult<bool> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = RoomClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client.list_participants(room_id).await {
                Ok(participants) => {
                    let active = participants
                        .into_iter()
                        .any(|participant| participant.identity == identity);
                    return Ok(active);
                }
                Err(e) => last_err = Some(e.to_string()),
            }
        }
        Err(AppError::LiveKit(last_err.unwrap_or_else(|| {
            "identity active check failed".to_string()
        })))
    }

    pub async fn update_participant_publish_permission(
        &self,
        room_id: &str,
        participant_identity: &str,
        permission: PublishPermission,
    ) -> AppResult<()> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = RoomClient::with_api_key(&host, &self.api_key, &self.api_secret);
            let options = UpdateParticipantOptions {
                permission: Some(proto::ParticipantPermission {
                    can_subscribe: true,
                    can_publish: true,
                    can_publish_data: true,
                    can_publish_sources: permission_track_sources(permission),
                    ..Default::default()
                }),
                ..Default::default()
            };
            match client
                .update_participant(room_id, participant_identity, options)
                .await
            {
                Ok(_) => return Ok(()),
                Err(e) => {
                    let err_text = e.to_string();
                    if is_participant_not_found(&err_text) {
                        return Ok(());
                    }
                    last_err = Some(err_text);
                }
            }
        }
        Err(AppError::LiveKit(last_err.unwrap_or_else(|| {
            "update participant permission failed".to_string()
        })))
    }

    pub async fn mute_participant_track_source(
        &self,
        room_id: &str,
        participant_identity: &str,
        source: proto::TrackSource,
        muted: bool,
    ) -> AppResult<u32> {
        let mut last_err = None;
        for host in self.api_hosts_in_order() {
            let client = RoomClient::with_api_key(&host, &self.api_key, &self.api_secret);
            match client.get_participant(room_id, participant_identity).await {
                Ok(participant) => {
                    let mut changed = 0_u32;
                    let source_value = source as i32;
                    for track in participant.tracks {
                        if track.source != source_value {
                            continue;
                        }
                        client
                            .mute_published_track(room_id, participant_identity, &track.sid, muted)
                            .await
                            .map_err(|e| AppError::LiveKit(e.to_string()))?;
                        changed += 1;
                    }
                    return Ok(changed);
                }
                Err(e) => {
                    let err_text = e.to_string();
                    if is_participant_not_found(&err_text) {
                        return Ok(0);
                    }
                    last_err = Some(err_text);
                }
            }
        }
        Err(AppError::LiveKit(last_err.unwrap_or_else(|| {
            "mute participant source failed".to_string()
        })))
    }
}

fn token_publish_sources(permission: PublishPermission) -> Vec<String> {
    let mut out = vec!["microphone".to_string()];
    if permission.camera {
        out.push("camera".to_string());
    }
    if permission.screen_share {
        out.push("screen_share".to_string());
    }
    out
}

fn permission_track_sources(permission: PublishPermission) -> Vec<i32> {
    let mut out = vec![proto::TrackSource::Microphone as i32];
    if permission.camera {
        out.push(proto::TrackSource::Camera as i32);
    }
    if permission.screen_share {
        out.push(proto::TrackSource::ScreenShare as i32);
    }
    out
}

fn is_participant_not_found(err: &str) -> bool {
    let lowered = err.to_ascii_lowercase();
    lowered.contains("participant does not exist")
        || lowered.contains("participant not found")
        || lowered.contains("not_found")
}

fn fallback_whip_url_from_public_ws(public_ws_url: &str) -> String {
    let ws = public_ws_url.trim().trim_end_matches('/');
    if let Some(rest) = ws.strip_prefix("wss://") {
        return format!("https://{rest}/w/");
    }
    if let Some(rest) = ws.strip_prefix("ws://") {
        return format!("http://{rest}/w/");
    }
    format!("{ws}/w/")
}

#[cfg(test)]
mod tests {
    use super::fallback_whip_url_from_public_ws;

    #[test]
    fn fallback_whip_url_from_ws_url() {
        assert_eq!(
            fallback_whip_url_from_public_ws("wss://livekit.ivena.top:44443"),
            "https://livekit.ivena.top:44443/w/"
        );
        assert_eq!(
            fallback_whip_url_from_public_ws("ws://127.0.0.1:7880"),
            "http://127.0.0.1:7880/w/"
        );
    }
}
