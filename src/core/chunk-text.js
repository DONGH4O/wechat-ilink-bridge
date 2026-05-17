import { WxbError } from "./errors.js";

const primaryBoundaries = [".", "!", "?", "\n", "\u3002", "\uff01", "\uff1f"];
const secondaryBoundaries = [",", ";", "\uff0c", "\uff1b"];

function validateOptions(options) {
  const maxChunkChars = options.maxChunkChars ?? 3800;
  const minChunkChars = options.minChunkChars ?? 20;
  const maxMessages = options.maxMessages ?? 10;

  if (!Number.isInteger(maxChunkChars) || maxChunkChars < 1) {
    throw new WxbError("CONFIG_VALUE_INVALID", "maxChunkChars must be a positive integer.", {
      retryable: false,
      details: { key: "maxChunkChars", value: maxChunkChars }
    });
  }

  if (!Number.isInteger(minChunkChars) || minChunkChars < 0) {
    throw new WxbError("CONFIG_VALUE_INVALID", "minChunkChars must be a non-negative integer.", {
      retryable: false,
      details: { key: "minChunkChars", value: minChunkChars }
    });
  }

  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new WxbError("CONFIG_VALUE_INVALID", "maxMessages must be a positive integer.", {
      retryable: false,
      details: { key: "maxMessages", value: maxMessages }
    });
  }

  return { maxChunkChars, minChunkChars, maxMessages };
}

function lastBoundaryIndex(slice, boundaries) {
  let best = -1;
  for (const boundary of boundaries) {
    const index = slice.lastIndexOf(boundary);
    if (index > best) {
      best = index;
    }
  }
  return best;
}

function pickCutIndex(text, maxChunkChars, minChunkChars) {
  const slice = text.slice(0, maxChunkChars);
  for (const boundaries of [primaryBoundaries, secondaryBoundaries]) {
    const boundaryIndex = lastBoundaryIndex(slice, boundaries);
    const cutIndex = boundaryIndex + 1;
    if (boundaryIndex >= 0 && cutIndex >= Math.min(minChunkChars, maxChunkChars)) {
      return cutIndex;
    }
  }
  return maxChunkChars;
}

function mergeShortChunks(chunks, maxChunkChars, minChunkChars) {
  const merged = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.length + chunk.length <= maxChunkChars
      && (previous.length < minChunkChars || chunk.length < minChunkChars)
    ) {
      merged[merged.length - 1] = `${previous}${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

export function chunkText(text, options = {}) {
  const normalizedText = String(text ?? "");
  const { maxChunkChars, minChunkChars, maxMessages } = validateOptions(options);

  if (normalizedText.length === 0) {
    throw new WxbError("TEXT_EMPTY", "Text message must not be empty.", {
      retryable: false
    });
  }

  if (normalizedText.length <= maxChunkChars) {
    return [normalizedText];
  }

  const chunks = [];
  let remaining = normalizedText;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkChars) {
      chunks.push(remaining);
      break;
    }

    const cutIndex = pickCutIndex(remaining, maxChunkChars, minChunkChars);
    chunks.push(remaining.slice(0, cutIndex));
    remaining = remaining.slice(cutIndex);
  }

  const merged = mergeShortChunks(chunks, maxChunkChars, minChunkChars);

  if (merged.length > maxMessages) {
    throw new WxbError("TEXT_TOO_LONG", "Text message exceeds the maximum number of deliverable chunks.", {
      retryable: false,
      details: {
        chunks: merged.length,
        maxMessages,
        maxChunkChars,
        suggestion: "Shorten the text, increase WX_MAX_DELIVERY_MESSAGES, increase WX_MAX_CHUNK_CHARS, or send the content as a file."
      }
    });
  }

  return merged;
}
