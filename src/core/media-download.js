import { createDecipheriv } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeAccountId } from "../state/state-dir.js";

const mediaKinds = new Set(["image", "file", "voice", "video"]);
const maxAttachmentFileNameLength = 180;
const maxAttachmentExtensionLength = 16;
const reservedWindowsNames = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

function extensionFor(kind, mimeType) {
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "audio/silk") {
    return ".silk";
  }
  if (mimeType === "audio/mpeg") {
    return ".mp3";
  }
  if (mimeType === "video/mp4") {
    return ".mp4";
  }
  if (kind === "image") {
    return ".bin";
  }
  if (kind === "voice") {
    return ".voice";
  }
  if (kind === "video") {
    return ".video";
  }
  return ".dat";
}

function detectMimeType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString("ascii") === "#!SILK") {
    return "audio/silk";
  }

  return undefined;
}

export function sanitizeAttachmentFileName(input, fallback = "attachment.dat") {
  const raw = String(input || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/^[._\s]+/g, "")
    .trim();
  const normalized = raw && raw !== "." ? raw : fallback;
  const parsed = path.parse(normalized);
  const base = parsed.name.replace(/[ .]+$/g, "") || "attachment";
  const upperBase = base.toUpperCase();
  const safeBase = reservedWindowsNames.has(upperBase) ? `${base}_` : base;
  const parsedExt = parsed.ext.replace(/[ .]+$/g, "");
  const fallbackExt = path.parse(fallback).ext.replace(/[ .]+$/g, "");
  const ext = parsedExt.length <= maxAttachmentExtensionLength
    ? parsedExt
    : fallbackExt.slice(0, maxAttachmentExtensionLength);
  const maxBaseLength = Math.max(1, maxAttachmentFileNameLength - ext.length);
  return `${safeBase.slice(0, maxBaseLength)}${ext}`;
}

function datePart(timestamp) {
  const date = timestamp
    ? new Date(Number(timestamp) * 1000)
    : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function buildInboxPath({ stateDir, accountId, message, item, itemIndex }) {
  const metadata = item.metadata ?? {};
  const root = path.resolve(stateDir, "inbox", safeAccountId(accountId));
  const dir = path.join(root, datePart(message.timestamp));
  const fallbackName = `${item.kind}-${metadata.fileId ?? itemIndex}${extensionFor(item.kind, metadata.mimeType)}`;
  const safeOriginalName = sanitizeAttachmentFileName(metadata.fileName, fallbackName);
  const messageId = sanitizeAttachmentFileName(message.id ?? "message", "message").replace(/\.[^.]*$/, "");
  const fileName = sanitizeAttachmentFileName(`${messageId}-${itemIndex + 1}-${safeOriginalName}`, fallbackName);
  const filePath = path.resolve(dir, fileName);

  if (!filePath.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("Resolved attachment path escaped inbox root.");
  }

  return { root, dir, filePath, fileName };
}

function decodeAesKey(value) {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim();
  if (/^[a-f0-9]{32}$/i.test(text)) {
    return Buffer.from(text, "hex");
  }

  const decoded = Buffer.from(text, "base64");
  if (decoded.length === 16) {
    return decoded;
  }

  const decodedText = decoded.toString("utf8").trim();
  if (/^[a-f0-9]{32}$/i.test(decodedText)) {
    return Buffer.from(decodedText, "hex");
  }

  throw new Error("Unsupported AES key format.");
}

function decryptAes128Ecb(buffer, aesKey) {
  const key = decodeAesKey(aesKey);
  if (!key) {
    return {
      buffer,
      encrypted: false,
      decrypted: false
    };
  }

  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return {
    buffer: Buffer.concat([decipher.update(buffer), decipher.final()]),
    encrypted: true,
    decrypted: true
  };
}

function resolveMediaUrl(metadata, config = {}) {
  if (metadata.url) {
    return new URL(metadata.url, config.cdnBaseUrl).toString();
  }

  if (metadata.encryptQueryParam && config.cdnBaseUrl) {
    const base = config.cdnBaseUrl.replace(/\/+$/, "");
    const query = String(metadata.encryptQueryParam).replace(/^\?/, "");
    return `${base}/download?${query}`;
  }

  if (metadata.fileId && config.cdnBaseUrl) {
    return new URL(encodeURIComponent(metadata.fileId), `${config.cdnBaseUrl.replace(/\/+$/, "")}/`).toString();
  }

  return undefined;
}

function publicError(code, error) {
  return {
    code,
    message: code === "MEDIA_DOWNLOAD_FAILED"
      ? "Media download failed before the attachment could be saved."
      : error?.message ?? String(error)
  };
}

async function fetchMediaBytes(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("global fetch is unavailable; use Node.js 18+ or pass fetchImpl.");
  }

  const controller = options.timeoutMs ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => controller.abort(new Error("media download timeout")), options.timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller?.signal
    });

    if (!response.ok) {
      throw new Error(`media HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function downloadMediaItem({ stateDir, accountId, message, item, itemIndex, config, fetchImpl, timeoutMs }) {
  const metadata = item.metadata ?? {};

  try {
    const url = resolveMediaUrl(metadata, config);

    if (!url) {
      return {
        item: {
          ...item,
          metadata: stripMediaSecrets({ metadata }).metadata,
          download: {
            ok: false,
            error: {
              code: "MEDIA_URL_MISSING",
              message: "Media item does not include a download URL or file ID."
            }
          }
        },
        attachment: undefined
      };
    }

    const encryptedBytes = await fetchMediaBytes(url, { fetchImpl, timeoutMs });
    const decoded = decryptAes128Ecb(encryptedBytes, metadata.aesKey);
    const detectedMimeType = metadata.mimeType ?? detectMimeType(decoded.buffer);
    const downloadedItem = detectedMimeType
      ? {
        ...item,
        metadata: {
          ...metadata,
          mimeType: detectedMimeType
        }
      }
      : item;
    const { dir, filePath, fileName } = buildInboxPath({ stateDir, accountId, message, item: downloadedItem, itemIndex });
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, decoded.buffer);

    const attachment = {
      kind: item.kind,
      fileId: metadata.fileId,
      fileName,
      path: filePath,
      mimeType: detectedMimeType,
      bytes: decoded.buffer.length,
      encrypted: decoded.encrypted,
      decrypted: decoded.decrypted
    };

    return {
      item: {
        ...downloadedItem,
        metadata: stripMediaSecrets(downloadedItem).metadata,
        attachment,
        download: {
          ok: true,
          path: filePath
        }
      },
      attachment
    };
  } catch (error) {
    return {
      item: {
        ...item,
        metadata: stripMediaSecrets({ metadata }).metadata,
        download: {
          ok: false,
          error: publicError("MEDIA_DOWNLOAD_FAILED", error)
        }
      },
      attachment: undefined
    };
  }
}

const mediaSecretKeys = new Set([
  "aesKey",
  "url",
  "encryptQueryParam",
  "thumbUrl",
  "thumbEncryptQueryParam"
]);

function stripMediaSecrets(item) {
  if (!item?.metadata) {
    return item;
  }

  const metadata = Object.fromEntries(
    Object.entries(item.metadata).filter(([key]) => !mediaSecretKeys.has(key))
  );
  if (Object.keys(metadata).length === Object.keys(item.metadata).length) {
    return item;
  }

  return {
    ...item,
    metadata
  };
}

export async function downloadMessageMedia(message, options = {}) {
  const items = [];
  const attachments = [];
  let attempted = 0;
  let failed = 0;

  for (let index = 0; index < (message.items ?? []).length; index += 1) {
    const item = message.items[index];
    if (!mediaKinds.has(item.kind)) {
      items.push(stripMediaSecrets(item));
      continue;
    }

    attempted += 1;
    const result = await downloadMediaItem({
      stateDir: options.stateDir,
      accountId: options.accountId,
      message,
      item,
      itemIndex: index,
      config: options.config,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs
    });

    if (result.attachment) {
      attachments.push(result.attachment);
    } else {
      failed += 1;
    }
    items.push(result.item);
  }

  return {
    ...message,
    items,
    ...(attempted > 0
      ? {
        attachments,
        mediaDownload: {
          requested: attempted,
          succeeded: attachments.length,
          failed
        }
      }
      : {})
  };
}

export async function downloadMessagesMedia(messages, options = {}) {
  const result = [];
  for (const message of messages) {
    result.push(await downloadMessageMedia(message, options));
  }
  return result;
}

export function stripMessageMediaSecrets(message) {
  return {
    ...message,
    items: (message.items ?? []).map(stripMediaSecrets)
  };
}
