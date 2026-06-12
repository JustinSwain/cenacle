#!/usr/bin/env node
/**
 * reset-member-code.mjs - generate a fresh invite code for an existing member.
 *
 * The script stores only the SHA-256 hash in D1, bumps token_version to sign
 * out existing sessions, and prints the raw code exactly once for you to share.
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

function outputRows(output, index) {
  return Array.isArray(output?.[index]?.results) ? output[index].results : [];
}

function targetLabel({ id, name }) {
  return id ? `id ${id}` : `"${name}"`;
}

function buildSql({ id, name, hash }) {
  const lookup = id ? `id = ${id}` : `name = '${sqlEscape(name)}'`;
  const updateLookup = id
    ? lookup
    : `${lookup} AND (SELECT COUNT(*) FROM members WHERE ${lookup}) = 1`;

  return [
    `SELECT COUNT(*) AS matches FROM members WHERE ${lookup};`,
    "UPDATE members",
    `SET token_hash = '${hash}', token_version = token_version + 1`,
    `WHERE ${updateLookup}`,
    "RETURNING id, name, role, token_version;",
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
  let result;
  try {
    result = runSql(sql, {
      remote: args.remote,
      dbName,
      json: true,
      label: "reset-member-code",
    });
  } catch (err) {
    console.error(`Reset failed: ${err.message}`);
    process.exit(1);
  }

  const matches = Number(outputRows(result, 0)[0]?.matches || 0);
  const updated = outputRows(result, 1);

  if (updated.length !== 1) {
    if (matches === 0) {
      console.error(`No member found for ${targetLabel(args)}. Nothing was changed.`);
    } else if (matches > 1) {
      console.error(`More than one member is named "${args.name}". Nothing was changed.`);
      console.error("Run the member list command, then retry with --id <member id>.");
    } else {
      console.error("Wrangler did not return the updated member. Nothing was changed.");
    }
    process.exit(1);
  }

  const member = updated[0];
  const tag = member.role === "admin" ? " [admin]" : "";

  console.log(`Reset ${member.name}${tag} (id ${member.id}); token version is now ${member.token_version}.`);
  console.log("Their old link and current sessions are no longer valid.\n");

  console.log("=== HAND THIS OUT (not stored anywhere - copy now) ===\n");
  console.log(`  ${member.name}${tag}: ${base}/?code=${code}`);
  console.log(`      code: ${code}\n`);
  if (base === URL_PLACEHOLDER) {
    console.log(`(Replace ${URL_PLACEHOLDER} with your deploy URL, or pass --url / set APP_URL.)\n`);
  }
  console.log("======================================================\n");
}

main();
