import path from "node:path";
import { ensureStateDir } from "./state-dir.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";

export function aliasFilePath(stateDir) {
  return path.join(stateDir, "aliases.json");
}

export async function readAliases(stateDir) {
  return readJsonFile(aliasFilePath(stateDir), {});
}

export async function writeAliases(stateDir, aliases) {
  await ensureStateDir(stateDir);
  await writeJsonAtomic(aliasFilePath(stateDir), aliases ?? {});
}

export async function setAlias(stateDir, userId, alias) {
  const aliases = await readAliases(stateDir);
  aliases[String(userId)] = String(alias);
  await writeAliases(stateDir, aliases);
  return aliases;
}

export async function getAlias(stateDir, userId) {
  const aliases = await readAliases(stateDir);
  return aliases[String(userId)];
}

export async function removeAlias(stateDir, userId) {
  const aliases = await readAliases(stateDir);
  const existed = Object.hasOwn(aliases, String(userId));
  delete aliases[String(userId)];
  await writeAliases(stateDir, aliases);
  return existed;
}

export async function resolveAlias(stateDir, alias) {
  const aliases = await readAliases(stateDir);
  const matches = Object.entries(aliases).filter(([, value]) => value === alias);

  if (matches.length === 0) {
    return undefined;
  }

  return matches.map(([userId]) => userId);
}
