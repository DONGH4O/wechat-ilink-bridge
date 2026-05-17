import {
  itemKindByPayloadField,
  itemTypeByCode,
  messageIdFields,
  timestampFields
} from "./protocol-constants.js";

function firstDefined(source, fields) {
  for (const field of fields) {
    if (source?.[field] !== undefined && source?.[field] !== null && source?.[field] !== "") {
      return source[field];
    }
  }
  return undefined;
}

function asString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function normalizeTimestamp(raw) {
  const value = firstDefined(raw, timestampFields);
  if (value === undefined) {
    return undefined;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }

  if (numberValue > 9_999_999_999) {
    return Math.floor(numberValue / 1000);
  }

  return Math.floor(numberValue);
}

function detectItemKind(item) {
  for (const [field, kind] of Object.entries(itemKindByPayloadField)) {
    if (item?.[field]) {
      return kind;
    }
  }

  return itemTypeByCode[String(item?.type)] ?? "unknown";
}

function pickPayload(item, kind) {
  return item?.[`${kind}_item`]
    ?? item?.[`${kind}Item`]
    ?? item?.payload
    ?? {};
}

function normalizeTextItem(item, payload) {
  return {
    kind: "text",
    text: asString(payload.text ?? payload.content ?? item.text ?? "")
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
  );
}

function normalizeMediaItem(item, kind, payload, options) {
  const media = payload.media
    ?? payload.cdn_media
    ?? payload.cdnMedia
    ?? payload.original_media
    ?? payload.originalMedia
    ?? {};
  const thumbMedia = payload.thumb_media
    ?? payload.thumbMedia
    ?? {};
  const metadata = compactObject({
    fileId: payload.file_id ?? payload.fileid ?? payload.file_key ?? payload.filekey ?? media.file_id ?? media.fileid,
    fileName: payload.file_name ?? payload.filename ?? payload.name,
    mimeType: payload.mime_type ?? payload.mimetype,
    size: payload.size ?? payload.file_size ?? payload.filesize ?? payload.len ?? payload.hd_size ?? payload.video_size,
    md5: payload.md5 ?? payload.file_md5 ?? payload.rawfilemd5 ?? payload.video_md5,
    width: payload.width,
    height: payload.height,
    duration: payload.duration ?? payload.duration_ms ?? payload.playtime ?? payload.play_length,
    ...(options.includeMediaSecrets
      ? {
        url: payload.url ?? payload.cdn_url ?? payload.download_url ?? media.full_url ?? media.url,
        encryptQueryParam: payload.encrypt_query_param ?? payload.encryptQueryParam ?? media.encrypt_query_param ?? media.encryptQueryParam,
        thumbUrl: thumbMedia.full_url ?? thumbMedia.url,
        thumbEncryptQueryParam: thumbMedia.encrypt_query_param ?? thumbMedia.encryptQueryParam,
        aesKey: payload.aeskey ?? payload.aes_key ?? payload.aesKey ?? media.aes_key ?? media.aesKey
      }
      : {})
  });

  return {
    kind,
    metadata,
    ...(Object.keys(metadata).length === 0
      ? {
        diagnostics: {
          rawType: item.type,
          itemKeys: Object.keys(item),
          payloadKeys: Object.keys(payload)
        }
      }
      : {})
  };
}

export function normalizeItem(item = {}, options = {}) {
  const kind = detectItemKind(item);
  const payload = pickPayload(item, kind);

  if (kind === "text") {
    return normalizeTextItem(item, payload);
  }

  if (kind === "image" || kind === "voice" || kind === "file" || kind === "video") {
    return normalizeMediaItem(item, kind, payload, options);
  }

  return {
    kind: "unknown",
    rawType: item.type,
    payloadKeys: Object.keys(item).filter((key) => key !== "type")
  };
}

export function normalizeRawMessage(raw = {}, options = {}) {
  const items = (raw.item_list ?? raw.items ?? []).map((item) => normalizeItem(item, options));
  const itemKinds = [...new Set(items.map((item) => item.kind))];
  const text = items
    .filter((item) => item.kind === "text" && item.text)
    .map((item) => item.text)
    .join("\n");

  const id = asString(firstDefined(raw, messageIdFields));
  const timestamp = normalizeTimestamp(raw);
  const contextToken = raw.context_token ?? raw.contextToken;
  const type = itemKinds.length === 0
    ? "unknown"
    : itemKinds.length === 1
      ? itemKinds[0]
      : "mixed";

  return compactObject({
    id,
    direction: "incoming",
    fromUserId: asString(raw.from_user_id ?? raw.fromUserId ?? raw.sender_user_id ?? raw.senderUserId),
    toUserId: asString(raw.to_user_id ?? raw.toUserId ?? raw.receiver_user_id ?? raw.receiverUserId),
    timestamp,
    type,
    text: text || undefined,
    items,
    messageType: raw.message_type ?? raw.messageType,
    messageState: raw.message_state ?? raw.messageState,
    rawType: raw.type,
    hasContextToken: Boolean(contextToken),
    contextToken: options.includeContextToken ? contextToken : undefined
  });
}

export function normalizeUpdateResponse(raw = {}, options = {}) {
  const rawMessages = raw.msgs ?? raw.messages ?? [];

  return compactObject({
    ret: raw.ret,
    errcode: raw.errcode,
    getUpdatesBuf: raw.get_updates_buf ?? raw.getUpdatesBuf,
    messages: rawMessages.map((message) => normalizeRawMessage(message, options))
  });
}
