import { parseCliArgs } from "../../config/load-config.js";
import { cliSuccess } from "../../core/errors.js";
import { IlinkClient } from "../../core/ilink-client.js";
import { loginWithQrcode } from "../../core/auth.js";

function numberFlag(value, fallback) {
  if (value === undefined || value === true) {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new TypeError(`Expected numeric flag value, got ${value}`);
  }
  return numberValue;
}

export async function runLoginCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const { config } = context;
  const client = context.client ?? new IlinkClient({
    baseUrl: config.baseUrl,
    channelVersion: config.channelVersion
  });

  const result = await loginWithQrcode({
    client,
    stateDir: config.stateDir,
    config,
    maxPolls: numberFlag(flags.maxPolls, 10),
    pollIntervalMs: numberFlag(flags.pollIntervalMs, 1000),
    onQrcode: async (qrcode) => {
      if (flags.quiet) {
        return;
      }
      const line = qrcode.imageUrl
        ? `Scan this iLink QR code: ${qrcode.imageUrl}\n`
        : "iLink QR code received; waiting for confirmation.\n";
      context.stderr?.write(line);
    },
    onStatus: async ({ status }) => {
      if (!flags.verbose) {
        return;
      }
      context.stderr?.write(`iLink QR status: ${status}\n`);
    }
  });

  return cliSuccess({
    account: result.account,
    qrcode: result.qrcode
  });
}
