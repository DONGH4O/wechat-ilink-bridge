export const protocolDefaults = Object.freeze({
  baseUrl: "https://ilinkai.weixin.qq.com",
  cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
  qrBotType: 3,
  channelVersion: "0.1.0",
  fetchTimeoutMs: 15000,
  pollIntervalMs: 1000,
  loginPollTimeoutMs: 35000,
  minChunkChars: 20,
  maxChunkChars: 3800,
  maxDeliveryMessages: 10,
  delayedQueueMaxItems: 100,
  messageRetentionDays: 30,
  attachmentRetentionDays: 30,
  maxHistoryMessages: 10000
});

export const endpoints = Object.freeze({
  getBotQrcode: "/ilink/bot/get_bot_qrcode",
  getQrcodeStatus: "/ilink/bot/get_qrcode_status",
  getUpdates: "/ilink/bot/getupdates",
  sendMessage: "/ilink/bot/sendmessage",
  getConfig: "/ilink/bot/getconfig",
  sendTyping: "/ilink/bot/sendtyping",
  getUploadUrl: "/ilink/bot/getuploadurl",
  channelReset: "/api/v1/wechat/channel_reset"
});

export const authHeaders = Object.freeze({
  authorizationType: "ilink_bot_token"
});

export const itemTypes = Object.freeze({
  text: 1,
  image: 3,
  file: 4,
  voiceCandidate: 34,
  videoCandidate: 43
});

export const itemTypeByCode = Object.freeze({
  1: "text",
  3: "image",
  4: "file",
  34: "voice",
  43: "video"
});

export const itemKindByPayloadField = Object.freeze({
  text_item: "text",
  image_item: "image",
  file_item: "file",
  voice_item: "voice",
  video_item: "video"
});

export const messageIdFields = Object.freeze([
  "msg_id",
  "message_id",
  "id",
  "client_msg_id",
  "client_id"
]);

export const timestampFields = Object.freeze([
  "timestamp",
  "create_time",
  "create_time_ms",
  "server_time",
  "time"
]);

export const qrcodeStatus = Object.freeze({
  wait: "wait",
  scaned: "scaned",
  confirmed: "confirmed",
  expired: "expired"
});

export const protocolErrorCodes = Object.freeze({
  sessionExpired: -14,
  invalidArgument: -2
});
