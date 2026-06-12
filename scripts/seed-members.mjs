#!/usr/bin/env node
/**
 * seed-members.mjs - one-time, local invite-code provisioning.
 *
 * For each name you pass, it generates a readable code (e.g. coral-maple-7382),
 * prints "name -> code" for you to hand out, and writes ONLY the SHA-256
 * token_hash into D1. The raw code is never stored anywhere by this script,
 * so copy the printed codes before they scroll away.
 *
 * Usage (from the repo root):
 *   node scripts/seed-members.mjs "Alice" "Bob"
 *   node scripts/seed-members.mjs --remote "Alice" "Bob"     # write to deployed (remote) D1
 *   node scripts/seed-members.mjs --admin "You" -- "Alice"   # names before -- are admins
 *   node scripts/seed-members.mjs --url https://my-group.example.workers.dev "Alice"
 *
 * Invite links use, in order: the --url flag, the APP_URL env var, or a
 * "<your-app-url>" placeholder you can replace by hand. The D1 database name
 * defaults to the DB_NAME constant below (override with --db or D1_DATABASE).
 *
 * It shells out to `wrangler d1 execute <db>` so it uses your existing wrangler
 * auth. Add --remote to target the deployed DB instead of local.
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

function parseArgs(argv) {
  let remote = false;
  let url = null;
  let db = null;
  const adminNames = [];
  const memberNames = [];
  let bucket = memberNames; // names default to members

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--remote") { remote = true; continue; }
    if (arg === "--local") { remote = false; continue; } // explicit; local is the default
    if (arg === "--admin") { bucket = adminNames; continue; }
    if (arg === "--") { bucket = memberNames; continue; }
    if (arg === "--url") { url = argv[++i]; continue; }
    if (arg === "--db") { db = argv[++i]; continue; }
    bucket.push(arg);
  }

  return { remote, url, db, adminNames, memberNames };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { remote, adminNames, memberNames } = args;
  const dbName = args.db || process.env.D1_DATABASE || DB_NAME;
  const base = inviteBase(args);
  const people = [
    ...adminNames.map((name) => ({ name, role: "admin" })),
    ...memberNames.map((name) => ({ name, role: "member" })),
  ];

  if (people.length === 0) {
    console.error(
      "Usage: node scripts/seed-members.mjs [--remote] [--url <base>] [--db <name>] " +
      "[--admin <names...> --] <names...>");
    process.exit(1);
  }

  const now = Date.now();
  const handouts = [];
  const usedCodes = new Set();

  const values = people.map(({ name, role }) => {
    let code;
    do { code = makeCode(); } while (usedCodes.has(code));
    usedCodes.add(code);
    handouts.push({ name, role, code });
    const hash = sha256Hex(code);
    return `('${sqlEscape(name)}', '${hash}', 1, '${role}', ${now})`;
  });

  const sql =
    "INSERT INTO members (name, token_hash, token_version, role, joined_at) VALUES " +
    values.join(", ") + ";";

  console.log(`\nSeeding ${people.length} member(s) into ${dbName} (${remote ? "remote" : "local"})...\n`);
  runSql(sql, { remote, dbName, label: "seed-members" });

  console.log("\n=== HAND THESE OUT (not stored anywhere - copy now) ===\n");
  for (const { name, role, code } of handouts) {
    const tag = role === "admin" ? " [admin]" : "";
    console.log(`  ${name}${tag}: ${base}/?code=${code}`);
    console.log(`      code: ${code}\n`);
  }
  if (base === URL_PLACEHOLDER) {
    console.log(`(Replace ${URL_PLACEHOLDER} with your deploy URL, or pass --url / set APP_URL.)\n`);
  }
  console.log("=======================================================\n");
}

main();
