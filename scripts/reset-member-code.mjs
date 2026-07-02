#!/usr/bin/env node
/**
 * reset-member-code.mjs - generate a fresh invite code for an existing member.
 *
 * This automates the three manual steps of a "password reset": pick a new code,
 * hash it, and UPDATE the member's row. It stores only the SHA-256 hash, bumps
 * token_version to sign out existing sessions, and prints the raw code once.
 *
 * It runs a single UPDATE and lets wrangler print its own result. If wrangler
 * reports "Rows written: 1" the reset worked; "0" means the name/id matched no
 * one (nothing changed) - rerun with the right name or --id. The new code is
 * printed only after wrangler exits successfully.
 *
 * Usage (from the repo root):
 *   node scripts/reset-member-code.mjs "Alice"
 *   node scripts/reset-member-code.mjs --remote "Alice"
 *   node scripts/reset-member-code.mjs --remote --id 5
 *   node scripts/reset-member-code.mjs --url https://my-group.example.workers.dev "Alice"
 */

import {
  DB_NAME,
  URL_PLACEHOLDER,
  inviteBase,
  makeCode,
  runSql,
  sha256Hex,
  sqlEscape,
} from "./invite-utils.mjs";

function usage() {
  return [
    "Usage: node scripts/reset-member-code.mjs [--remote] [--url <base>] [--db <name>] <member name>",
    "       node scripts/reset-member-code.mjs [--remote] [--url <base>] [--db <name>] --id <member id>",
  ].join("\n");
}

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  let remote = false;
  let url = null;
  let db = null;
  let id = null;
  let help = false;
  const names = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--remote") { remote = true; continue; }
    if (arg === "--local") { remote = false; continue; }
    if (arg === "--url") { url = readFlagValue(argv, i, arg); i += 1; continue; }
    if (arg === "--db") { db = readFlagValue(argv, i, arg); i += 1; continue; }
    if (arg === "--id") { id = readFlagValue(argv, i, arg); i += 1; continue; }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    names.push(arg);
  }

  if (help) return { help };
  if (id && names.length > 0) throw new Error("Use either --id or a member name, not both.");
  if (!id && names.length === 0) throw new Error("Missing member name or --id.");
  if (names.length > 1) throw new Error("Pass exactly one member name; quote names that contain spaces.");
  if (id && (!/^\d+$/.test(id) || Number(id) < 1)) {
    throw new Error("--id must be a positive integer.");
  }

  return {
    remote,
    url,
    db,
    id: id ? Number(id) : null,
    name: names[0] || null,
  };
}

function targetLabel({ id, name }) {
  return id ? `id ${id}` : `"${name}"`;
}

function buildSql({ id, name, hash }) {
  const where = id ? `id = ${id}` : `name = '${sqlEscape(name)}'`;
  // The trailing changes() prints "members_updated": 1 (or 0) in wrangler's own
  // output, so you can see whether a row matched without parsing anything.
  return [
    "UPDATE members",
    `SET token_hash = '${hash}', token_version = token_version + 1, active = 1`,
    `WHERE ${where};`,
    "SELECT changes() AS members_updated;",
  ].join("\n") + "\n";
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error(usage());
    process.exit(1);
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  const dbName = args.db || process.env.D1_DATABASE || DB_NAME;
  const base = inviteBase(args);
  const code = makeCode();
  const hash = sha256Hex(code);
  const sql = buildSql({ ...args, hash });

  console.log(`\nResetting invite code for ${targetLabel(args)} in ${dbName} (${args.remote ? "remote" : "local"})...\n`);
  try {
    runSql(sql, { remote: args.remote, dbName, label: "reset-member-code" });
  } catch (err) {
    console.error(`\nReset failed - wrangler reported an error. Nothing was changed.`);
    if (err.message) console.error(err.message);
    process.exit(1);
  }

  // Wrangler printed "members_updated": 1 (or 0) in its output just above.
  // The code below is only live in the database if it updated 1 row.
  console.log(`\nDone. Check the "members_updated" value in wrangler's output above:`);
  console.log(`  1 = reset worked; their old link and sessions are now dead.`);
  console.log(`  0 = no member matched ${targetLabel(args)}; nothing changed, the code below is NOT active.\n`);

  console.log("=== HAND THIS OUT (not stored anywhere - copy now) ===\n");
  console.log(`  ${args.name ? args.name : `member ${args.id}`}: ${base}/?code=${code}`);
  console.log(`      code: ${code}\n`);
  if (base === URL_PLACEHOLDER) {
    console.log(`(Replace ${URL_PLACEHOLDER} with your deploy URL, or pass --url / set APP_URL.)\n`);
  }
  console.log("======================================================\n");
}

main();
