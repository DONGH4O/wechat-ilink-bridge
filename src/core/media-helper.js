import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { WxbError } from "./errors.js";
import { redactSensitiveData } from "./redact.js";

const supportedModes = new Set([
  "inspect",
  "extractText",
  "imageQuestion",
  "transcribeAudio",
  "summarizeVideo"
]);

const mimeByExtension = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".log": "text/plain"
});

const textMimeTypes = new Set([
  "application/json",
  "application/xml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/xml"
]);

function readUInt24LE(buffer, offset) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function inferMimeType(header, filePath) {
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (header.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") {
    return "audio/wav";
  }
  if (header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (header.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = header.subarray(8, 12).toString("ascii");
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }

  return mimeByExtension[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function mediaKindFromMime(mimeType) {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (textMimeTypes.has(mimeType) || mimeType.startsWith("text/")) {
    return "text";
  }
  return "file";
}

function parsePngDimensions(header) {
  if (header.length < 24 || inferMimeType(header, "image.png") !== "image/png") {
    return undefined;
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
}

function parseGifDimensions(header) {
  const signature = header.subarray(0, 6).toString("ascii");
  if (header.length < 10 || !["GIF87a", "GIF89a"].includes(signature)) {
    return undefined;
  }
  return {
    width: header.readUInt16LE(6),
    height: header.readUInt16LE(8)
  };
}

function parseJpegDimensions(header) {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 9 < header.length) {
    if (header[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = header[offset + 1];
    const segmentLength = header.readUInt16BE(offset + 2);
    const isSofMarker = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);

    if (isSofMarker && offset + 8 < header.length) {
      return {
        width: header.readUInt16BE(offset + 7),
        height: header.readUInt16BE(offset + 5)
      };
    }

    if (!Number.isFinite(segmentLength) || segmentLength < 2) {
      break;
    }
    offset += 2 + segmentLength;
  }

  return undefined;
}

function parseWebpDimensions(header) {
  if (header.length < 30 || header.subarray(0, 4).toString("ascii") !== "RIFF" || header.subarray(8, 12).toString("ascii") !== "WEBP") {
    return undefined;
  }

  const chunkType = header.subarray(12, 16).toString("ascii");
  if (chunkType === "VP8X") {
    return {
      width: readUInt24LE(header, 24) + 1,
      height: readUInt24LE(header, 27) + 1
    };
  }

  if (chunkType === "VP8 " && header.length >= 30) {
    return {
      width: header.readUInt16LE(26) & 0x3fff,
      height: header.readUInt16LE(28) & 0x3fff
    };
  }

  return undefined;
}

function parseImageDimensions(header, mimeType) {
  if (mimeType === "image/png") {
    return parsePngDimensions(header);
  }
  if (mimeType === "image/jpeg") {
    return parseJpegDimensions(header);
  }
  if (mimeType === "image/gif") {
    return parseGifDimensions(header);
  }
  if (mimeType === "image/webp") {
    return parseWebpDimensions(header);
  }
  return undefined;
}

async function readHeader(filePath, maxBytes = 65536) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function isTextLike(mimeType) {
  return textMimeTypes.has(mimeType) || mimeType.startsWith("text/");
}

async function readTextPreview(filePath, bytes, maxTextBytes) {
  if (maxTextBytes <= 0) {
    return undefined;
  }

  const header = await readHeader(filePath, Math.min(bytes, maxTextBytes));
  const text = header.toString("utf8").replace(/^\uFEFF/, "");
  return {
    text: redactSensitiveData(text),
    bytesRead: header.length,
    truncated: bytes > header.length
  };
}

function validateMaxTextBytes(value) {
  const maxTextBytes = value ?? 8192;
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 0) {
    throw new WxbError("CONFIG_VALUE_INVALID", "maxTextBytes must be a non-negative integer.", {
      retryable: false,
      details: { key: "maxTextBytes", value: maxTextBytes }
    });
  }
  return maxTextBytes;
}

export async function inspectMediaFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new WxbError("MEDIA_PATH_REQUIRED", "A local media file path is required.", {
      retryable: false
    });
  }

  const absolutePath = path.resolve(filePath);
  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new WxbError("MEDIA_FILE_NOT_FOUND", "Media file does not exist.", {
        retryable: false,
        details: { path: absolutePath }
      });
    }
    throw error;
  }

  if (!info.isFile()) {
    throw new WxbError("MEDIA_PATH_NOT_FILE", "Media path must point to a regular file.", {
      retryable: false,
      details: { path: absolutePath }
    });
  }

  const maxTextBytes = validateMaxTextBytes(options.maxTextBytes);
  const header = await readHeader(absolutePath);
  const mimeType = inferMimeType(header, absolutePath);
  const kind = mediaKindFromMime(mimeType);
  const dimensions = parseImageDimensions(header, mimeType);
  const textPreview = isTextLike(mimeType)
    ? await readTextPreview(absolutePath, info.size, maxTextBytes)
    : undefined;

  return {
    path: absolutePath,
    fileName: path.basename(absolutePath),
    extension: path.extname(absolutePath).toLowerCase() || undefined,
    bytes: info.size,
    mimeType,
    kind,
    sha256: await hashFile(absolutePath),
    ...(dimensions ? { dimensions } : {}),
    ...(textPreview ? { textPreview } : {})
  };
}

function unsupportedMode(mode) {
  return new WxbError("MULTIMODAL_MODE_UNSUPPORTED", "Unsupported multimodal helper mode.", {
    retryable: false,
    details: {
      mode,
      supportedModes: [...supportedModes]
    }
  });
}

function unavailableAnalysis(mode, media) {
  const suggestedActionByMode = {
    imageQuestion: "Use the returned local path with an Agent vision model, or inject an optional multimodal helper into the adapter host.",
    transcribeAudio: "Use the returned local path with an Agent transcription model, or inject an optional multimodal helper into the adapter host.",
    summarizeVideo: "Use the returned local path with an Agent video helper, or inject an optional multimodal helper into the adapter host."
  };

  return {
    mode,
    media,
    analysis: {
      status: "unavailable",
      code: "MULTIMODAL_HELPER_UNAVAILABLE",
      message: "No optional multimodal helper is configured.",
      suggestedAction: suggestedActionByMode[mode] ?? "Use the returned local path in the host Agent."
    }
  };
}

export async function analyzeMedia(options = {}) {
  const {
    filePath,
    mode = "inspect",
    question,
    helper,
    failSoft = true
  } = options;

  if (!supportedModes.has(mode)) {
    throw unsupportedMode(mode);
  }

  const media = await inspectMediaFile(filePath, {
    maxTextBytes: validateMaxTextBytes(options.maxTextBytes)
  });

  if (mode === "inspect") {
    return {
      mode,
      media,
      analysis: {
        status: "metadata_only",
        message: "Bridge inspected local media metadata only; model understanding is left to the Agent or optional helper."
      }
    };
  }

  if (mode === "extractText") {
    if (media.textPreview) {
      return {
        mode,
        media,
        analysis: {
          status: "completed",
          provider: "local-text-preview",
          text: media.textPreview.text,
          bytesRead: media.textPreview.bytesRead,
          truncated: media.textPreview.truncated
        }
      };
    }

    return {
      mode,
      media,
      analysis: {
        status: "unavailable",
        code: "MEDIA_TEXT_UNAVAILABLE",
        message: "This local media file is not text-like; use an optional model helper if content understanding is needed."
      }
    };
  }

  if (!helper) {
    return unavailableAnalysis(mode, media);
  }

  try {
    const helperResult = await helper({
      mode,
      media,
      filePath: media.path,
      question
    });

    return {
      mode,
      media,
      analysis: {
        status: "completed",
        provider: helperResult?.provider ?? "optional-helper",
        result: redactSensitiveData(helperResult?.result ?? helperResult ?? {})
      }
    };
  } catch (error) {
    if (!failSoft) {
      throw error;
    }

    return {
      mode,
      media,
      analysis: {
        status: "failed",
        code: "MULTIMODAL_HELPER_FAILED",
        message: redactSensitiveData(error?.message ?? String(error)),
        retryable: false,
        fallback: "Bridge media fetch/send state was not modified. The Agent can still use media.path directly."
      }
    };
  }
}
