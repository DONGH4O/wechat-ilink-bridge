import { cliSuccess } from "../../core/errors.js";
import { listPublicAccounts } from "../../core/auth.js";

export async function runAccountsCommand(_argv, context) {
  const accounts = await listPublicAccounts(context.config.stateDir);
  return cliSuccess({
    accounts,
    count: accounts.length
  });
}
