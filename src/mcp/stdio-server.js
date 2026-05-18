import { handleMcpRequest } from "./tools.js";

function writeJsonLine(stdout, payload) {
  stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseErrorResponse() {
  return {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32700,
      message: "Parse error"
    }
  };
}

export function startMcpStdioServer(options = {}) {
  const {
    stdin = process.stdin,
    stdout = process.stdout,
    context = {}
  } = options;
  let buffer = "";
  let queue = Promise.resolve();

  async function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      writeJsonLine(stdout, parseErrorResponse());
      return;
    }

    const response = await handleMcpRequest(request, context);
    if (response) {
      writeJsonLine(stdout, response);
    }
  }

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      queue = queue.then(() => processLine(line)).catch((error) => {
        writeJsonLine(stdout, {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: error?.message ?? String(error)
          }
        });
      });
      newlineIndex = buffer.indexOf("\n");
    }
  });

  stdin.on("end", () => {
    if (buffer.trim()) {
      queue = queue.then(() => processLine(buffer));
      buffer = "";
    }
  });
}
