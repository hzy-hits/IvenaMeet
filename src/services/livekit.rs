use crate::error::{AppError, AppResult};
use livekit_api::{
    access_token::{AccessToken, VideoGrants},
    services::{
        ingress::{CreateIngressOptions, IngressClient},
        room::RoomClient,
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

    pub fn issue_room_token(
        &self,
        identity: &str,
        room: &str,
        role: UserRole,
    ) -> AppResult<String> {
        let publish_sources = match role {
            UserRole::Host => vec![
                "camera".to_string(),
                "microphone".to_string(),
                "screen_share".to_string(),
                "screen_share_audio".to_string(),
            ],
            UserRole::Member => vec!["microphone".to_string()],
        };

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
        let client = IngressClient::with_api_key(&self.api_host, &self.api_key, &self.api_secret);

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
            ..Default::default()
        };

        let ingress = client
            .create_ingress(proto::IngressInput::WhipInput, options)
            .await
            .map_err(|e| AppError::LiveKit(e.to_string()))?;

        Ok(CreatedIngress {
            whip_url: ingress.url,
            stream_key: ingress.stream_key,
            ingress_id: ingress.ingress_id,
        })
    }

    pub async fn delete_ingress(&self, ingress_id: &str) -> AppResult<()> {
        let client = IngressClient::with_api_key(&self.api_host, &self.api_key, &self.api_secret);
        client
            .delete_ingress(ingress_id)
            .await
            .map_err(|e| AppError::LiveKit(e.to_string()))?;
        Ok(())
    }

    pub async fn mute_participant_microphone(
        &self,
        room_id: &str,
        participant_identity: &str,
        muted: bool,
    ) -> AppResult<u32> {
        let client = RoomClient::with_api_key(&self.api_host, &self.api_key, &self.api_secret);
        let participant = client
            .get_participant(room_id, participant_identity)
            .await
            .map_err(|e| AppError::LiveKit(e.to_string()))?;

        let mut changed = 0_u32;
        for track in participant.tracks {
            if track.source != proto::TrackSource::Microphone as i32 {
                continue;
            }
            client
                .mute_published_track(room_id, participant_identity, &track.sid, muted)
                .await
                .map_err(|e| AppError::LiveKit(e.to_string()))?;
            changed += 1;
        }
        Ok(changed)
    }

    pub async fn mute_all_microphones(
        &self,
        room_id: &str,
        exclude_identity: Option<&str>,
        muted: bool,
    ) -> AppResult<u32> {
        let client = RoomClient::with_api_key(&self.api_host, &self.api_key, &self.api_secret);
        let participants = client
            .list_participants(room_id)
            .await
            .map_err(|e| AppError::LiveKit(e.to_string()))?;

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
                    .mute_published_track(room_id, &participant.identity, &track.sid, muted)
                    .await
                    .map_err(|e| AppError::LiveKit(e.to_string()))?;
                changed += 1;
            }
        }
        Ok(changed)
    }
}
