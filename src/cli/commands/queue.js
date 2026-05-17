import { parseCliArgs } from "../../config/load-config.js";
import { WxbError, cliSuccess } from "../../core/errors.js";
import { resolveFetchAccount } from "../../core/fetch-messages.js";
import { listQueuedDeliveries } from "../../core/delivery-queue.js";
import { clearDeliveryQueue } from "../../state/delivery-queue-store.js";

export async function runQueueCommand(argv, context) {
  const [subcommand = "list", ...rest] = argv;
  const flags = parseCliArgs(rest);
  const account = await resolveFetchAccount(context.config.stateDir, flags.account === true ? undefined : flags.account);

  if (subcommand === "list") {
    const items = await listQueuedDeliveries(context.config.stateDir, account.accountId);
    return cliSuccess({
      accountId: account.accountId,
      items,
      count: items.length
    });
  }

  if (subcommand === "clear") {
    const removed = await clearDeliveryQueue(context.config.stateDir, account.accountId, {
      userId: flags.user === true ? undefined : flags.user
    });
    return cliSuccess({
      accountId: account.accountId,
      removed
    });
  }

  throw new WxbError("QUEUE_COMMAND_UNKNOWN", `Unknown queue subcommand: ${subcommand}`, {
    retryable: false,
    details: { subcommand }
  });
}
