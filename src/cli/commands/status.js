import { parseCliArgs } from "../../config/load-config.js";
import { cliSuccess } from "../../core/errors.js";
import { getAccountStatuses } from "../../core/auth.js";

export async function runStatusCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const statuses = await getAccountStatuses(context.config.stateDir, {
    accountId: flags.account === true ? undefined : flags.account
  });

  return cliSuccess({
    accounts: statuses,
    count: statuses.length
  });
}
