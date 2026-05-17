import { parseCliArgs } from "../../config/load-config.js";
import { WxbError, cliSuccess } from "../../core/errors.js";
import { getAlias, readAliases, removeAlias, resolveAlias, setAlias } from "../../state/alias-store.js";

function aliasEntries(aliases) {
  return Object.entries(aliases)
    .map(([userId, alias]) => ({ userId, alias }))
    .sort((a, b) => a.alias.localeCompare(b.alias) || a.userId.localeCompare(b.userId));
}

export async function runAliasCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  const flags = parseCliArgs(rest);
  const positionals = rest.filter((entry, index) => {
    if (entry.startsWith("--")) {
      return false;
    }
    const previous = rest[index - 1];
    return !previous?.startsWith("--") || previous.includes("=");
  });

  if (subcommand === "set") {
    const userId = flags.user === true ? undefined : flags.user ?? positionals[0];
    const alias = flags.alias === true ? undefined : flags.alias ?? positionals[1];
    if (!userId || !alias) {
      throw new WxbError("ALIAS_ARGUMENTS_REQUIRED", "Usage: wxb alias set <userId> <alias>", {
        retryable: false
      });
    }

    await setAlias(context.config.stateDir, userId, alias);
    return cliSuccess({ userId, alias });
  }

  if (subcommand === "get") {
    const userId = flags.user === true ? undefined : flags.user ?? positionals[0];
    if (!userId) {
      throw new WxbError("ALIAS_ARGUMENTS_REQUIRED", "Usage: wxb alias get <userId>", {
        retryable: false
      });
    }

    return cliSuccess({
      userId,
      alias: await getAlias(context.config.stateDir, userId) ?? null
    });
  }

  if (subcommand === "resolve") {
    const alias = flags.alias === true ? undefined : flags.alias ?? positionals[0];
    if (!alias) {
      throw new WxbError("ALIAS_ARGUMENTS_REQUIRED", "Usage: wxb alias resolve <alias>", {
        retryable: false
      });
    }

    return cliSuccess({
      alias,
      userIds: await resolveAlias(context.config.stateDir, alias) ?? []
    });
  }

  if (subcommand === "list" || !subcommand) {
    const aliases = await readAliases(context.config.stateDir);
    const entries = aliasEntries(aliases);
    return cliSuccess({
      aliases: entries,
      count: entries.length
    });
  }

  if (subcommand === "remove" || subcommand === "delete") {
    const userId = flags.user === true ? undefined : flags.user ?? positionals[0];
    if (!userId) {
      throw new WxbError("ALIAS_ARGUMENTS_REQUIRED", "Usage: wxb alias remove <userId>", {
        retryable: false
      });
    }

    return cliSuccess({
      userId,
      removed: await removeAlias(context.config.stateDir, userId)
    });
  }

  throw new WxbError("ALIAS_COMMAND_UNKNOWN", `Unknown alias subcommand: ${subcommand}`, {
    retryable: false,
    details: { subcommand }
  });
}
