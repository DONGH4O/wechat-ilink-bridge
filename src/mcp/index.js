#!/usr/bin/env node
import { loadConfig } from "../config/load-config.js";
import { startMcpStdioServer } from "./stdio-server.js";

async function main(argv = process.argv.slice(2)) {
  const config = await loadConfig({ argv });
  startMcpStdioServer({
    context: {
      config
    }
  });
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
