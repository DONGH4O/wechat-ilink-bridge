const sensitiveKeyPattern = /^(authorization|bot_?token|context_?token|access_?token|refresh_?token|token|aes_?key)$/i;
const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const authorizationHeaderPattern = /\b(Authorization\s*:\s*)Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const sensitiveAssignmentPattern = /\b((?:WX_)?(?:BOT_?TOKEN|CONTEXT_?TOKEN|ACCESS_?TOKEN|REFRESH_?TOKEN|AES_?KEY)|(?:bot|context|access|refresh)Token|aesKey|token)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function redactText(value) {
  return String(value)
    .replace(sensitiveAssignmentPattern, "$1$2[REDACTED]")
    .replace(authorizationHeaderPattern, "$1Bearer [REDACTED]")
    .replace(bearerPattern, "$1[REDACTED]");
}

export function redactSensitiveData(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.code ? { code: value.code } : {}),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
      ...redactSensitiveData(
        Object.fromEntries(
          Object.entries(value).filter(([key]) => !["name", "message", "code", "stack"].includes(key))
        )
      )
    };
  }

  if (typeof value === "string") {
    return redactText(value);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (sensitiveKeyPattern.test(key)) {
        return [key, "[REDACTED]"];
      }

      return [key, redactSensitiveData(entryValue)];
    })
  );
}

export const redactForLog = redactSensitiveData;
