# Control Plane + Frontend 接口与页面总览

更新时间：2026-02-22

## 1. 后端 API 总览

### 1.1 健康检查

- `GET /healthz`
- 鉴权：无
- 返回：`{ "ok": true }`

### 1.2 房间加入

- `POST /rooms/join`
- 鉴权：
  - 当 `role=host` 时，要求 `Authorization: Bearer <ADMIN_TOKEN>`
  - 或全局 `REQUIRE_ADMIN_FOR_JOIN=true` 时统一要求 admin token
- 请求体：
  - `room_id: string`
  - `user_name: string`
  - `role?: "host" | "member"`
  - `redeem_token?: string`
  - `nickname?: string`
  - `avatar_url?: string`
- 返回体：
  - `lk_url: string`
  - `token: string` (LiveKit JWT)
  - `expires_in_seconds: number`
  - `role: "host" | "member"`
  - `app_session_token: string`
  - `app_session_expires_in_seconds: number`

### 1.3 App Session 刷新

- `POST /sessions/refresh`
- 鉴权：`Authorization: Bearer <app_session_token>`
- 请求体：`{}`
- 返回体：
  - `app_session_token: string`
  - `app_session_expires_in_seconds: number`

### 1.4 邀请码流程

- `POST /auth/invite`（管理员）
  - 请求：`{ room_id, host_identity }`
  - 返回：`{ invite_code, invite_ticket, invite_max_uses, invite_url, expires_at }`

- `POST /invites/redeem`
  - 请求：`{ room_id, user_name, invite_ticket, invite_code }`
  - 返回：`{ redeem_token, ticket_remaining_uses, expires_in_seconds }`

### 1.5 推流流程

- `POST /broadcast/issue`（管理员）
  - 请求：`{ room_id, host_identity }`
  - 返回：`{ start_token, expires_in_seconds }`

- `POST /broadcast/start`（管理员）
  - 请求：`{ room_id, participant_identity, participant_name?, start_token }`
  - 返回：`{ whip_url, stream_key, ingress_id }`

- `POST /broadcast/stop`（管理员）
  - 请求：`{ ingress_id }`
  - 返回：`{ status: "stopped" }`

### 1.6 用户与聊天

- `POST /users/upsert`
  - 请求：`{ user_name, nickname, avatar_url? }`
  - 返回：`{ user_name, nickname, avatar_url }`

- `GET /rooms/:room_id/messages?limit=...&after_id=...`
  - 返回：`{ items: MessageItem[] }`
  - 说明：`after_id` 可选，传入后仅返回比该 id 更新的消息（增量拉取）

- `POST /rooms/:room_id/messages`
  - 鉴权：`Authorization: Bearer <app_session_token>`
  - 请求：`{ text }`
  - 返回：`MessageItem`

`MessageItem` 字段：
- `id, room_id, user_name, nickname, avatar_url, role, text, created_at`

## 2. 页面视觉与结构总览

前端文件：
- `apps/frontend/src/App.tsx`
- `apps/frontend/src/styles.css`

### 2.1 视觉方向

- 深色科技风背景（径向渐变 + 线性渐变）
- 字体组合：`Space Grotesk` + `IBM Plex Mono`
- 高亮色：青绿色系（`--accent`）
- 状态成功色：绿色（`--ok`）

### 2.2 页面布局

- 左栏：
  - `Join` 区
  - `Admin Flow` 区
  - `Members` 区（发言高亮）
- 右栏：
  - 顶部状态条
  - 音视频舞台区（tiles）
  - 聊天区
  - 日志区

### 2.3 关键交互

- 入会：`Join / Leave`
- 设备：`Mic / Cam / Share`
- 管理：`Issue Invite / 复制邀请链接 / Redeem`
- 推流：`Issue Start / Start Broadcast / Stop Broadcast`
- 复制反馈：复制邀请后显示 `复制成功`（2 秒）

## 3. 前后端 API 对照（前端实际调用）

- 加入房间：`POST /rooms/join`
- 刷新会话：`POST /sessions/refresh`
- 历史消息：`GET /rooms/:room_id/messages`
- 写入消息：`POST /rooms/:room_id/messages`
- 生成邀请：`POST /auth/invite`
- 兑换邀请：`POST /invites/redeem`
- 申请开播 token：`POST /broadcast/issue`
- 开始推流：`POST /broadcast/start`
- 停止推流：`POST /broadcast/stop`

## 4. 安全与约束

### 4.1 鉴权

- 管理接口统一 `Bearer ADMIN_TOKEN`
- 聊天写入等敏感写操作绑定 `app_session_token`
- 聊天接口不再信任前端传入 `user_name`

### 4.2 输入校验

- `room_id`: `[a-zA-Z0-9_-]`，3-64
- `user_name`: `[a-zA-Z0-9_-]`，2-32
- `nickname`: 2-32
- `message.text`: 1-500
- `avatar_url`: 可选，必须 `https://`，最大 512

### 4.3 反向代理与 IP

- 默认使用直连 peer IP
- 仅当 peer 在 `TRUSTED_PROXY_IPS` 时，才信任 `X-Forwarded-For`
- 防止用户伪造 header 绕过限流

### 4.4 日志与追踪

- 自动注入并回写 `x-request-id`
- 关键路由输出结构化日志字段：
  - `request_id`
  - `route`
  - `room_id`
  - `user_name`
  - `ip`
  - `result`

## 5. 关于推流与录制（大概思路）

### 5.1 OBS 推流到 Ingress（已支持）

当前流程已经支持：
1. 管理端申请一次性开播凭证（`/broadcast/issue`）
2. 调用 `/broadcast/start` 得到 `whip_url + stream_key`
3. 在 OBS 以 WHIP 方式推流到该地址（携带 stream key）
4. LiveKit Ingress 把流作为主持人轨道注入房间

核心价值：主持人的大画面推流稳定，观众端统一走 LiveKit 订阅。

### 5.2 不用 OBS，浏览器直接投屏（已支持实时投屏）

当前前端已有 `Share` 按钮（`setScreenShareEnabled(true)`）。
它本质是浏览器直接把屏幕采集为 WebRTC track 发布到房间。

适合场景：轻量、临时分享、无需 OBS。

### 5.3 浏览器“录屏/录像”能力（当前未做服务端持久化录制）

现状：
- 实时投屏是支持的
- 服务端录制归档（回放文件）这条链路尚未接入

高层方案通常有两类：
1. 客户端录制：浏览器本地录制后上传
2. 服务端录制：接 LiveKit Egress/录制服务，按房间输出 MP4/HLS 到对象存储

如果目标是“私人部署 Discord + 可回放”，推荐走服务端录制链路，管理和审计更稳定。
