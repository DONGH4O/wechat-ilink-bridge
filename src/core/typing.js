import { rememberContextToken } from "../state/context-token-store.js";

function pickTypingTicket(response = {}) {
  return response.typing_ticket
    ?? response.typingTicket
    ?? response.data?.typing_ticket
    ?? response.data?.typingTicket;
}

function pickContextToken(response = {}) {
  return response.context_token
    ?? response.contextToken
    ?? response.data?.context_token
    ?? response.data?.contextToken;
}

function publicTypingError(error, fallbackCode, message) {
  return {
    code: error?.code ?? fallbackCode,
    message
  };
}

function publicStartError(error) {
  return publicTypingError(error, "TYPING_START_FAILED", "Typing setup failed before delivery.");
}

function publicStopError(error) {
  return publicTypingError(error, "TYPING_STOP_FAILED", "Typing stop failed after the delivery attempt.");
}

export async function withOptionalTyping(options = {}, operation) {
  if (!options.enabled) {
    return operation(options.contextToken);
  }

  let activeContextToken = options.contextToken;
  let typingTicket;
  let startError;
  let started = false;

  try {
    const config = await options.client.getConfig({
      token: options.token,
      userId: options.userId,
      contextToken: options.contextToken,
      timeoutMs: options.timeoutMs
    });
    typingTicket = pickTypingTicket(config);
    activeContextToken = pickContextToken(config) ?? options.contextToken;

    if (activeContextToken && activeContextToken !== options.contextToken) {
      try {
        await rememberContextToken(options.stateDir, options.accountId, options.userId, activeContextToken, { lock: false });
      } catch (error) {
        startError = publicStartError(error);
      }
    }

    if (!typingTicket) {
      startError = startError ?? {
        code: "TYPING_TICKET_MISSING",
        message: "Typing setup failed before delivery."
      };
    } else {
      try {
        await options.client.sendTyping({
          token: options.token,
          userId: options.userId,
          typingTicket,
          status: 1,
          timeoutMs: options.timeoutMs
        });
        started = true;
      } catch (error) {
        startError = publicStartError(error);
      }
    }
  } catch (error) {
    startError = publicStartError(error);
  }

  let result;
  let operationError;
  try {
    result = await operation(activeContextToken);
  } catch (error) {
    operationError = error;
  }

  let stopError;
  if (started) {
    try {
      await options.client.sendTyping({
        token: options.token,
        userId: options.userId,
        typingTicket,
        status: 2,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      stopError = error;
    }
  }

  if (operationError) {
    throw operationError;
  }

  return {
    ...result,
    typing: {
      requested: true,
      started,
      stopped: started && !stopError,
      ...(startError ? { startError } : {}),
      ...(stopError ? { stopError: publicStopError(stopError) } : {})
    }
  };
}
