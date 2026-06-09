#!/usr/bin/env node
/**
 * seed-members.mjs - one-time, local invite-code provisioning.
 *
 * For each name you pass, it generates a short readable code (e.g. coral-7382),
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

import { createHash, randomInt } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must match `database_name` in wrangler.jsonc. Override per-run with --db or
// the D1_DATABASE env var if you renamed the database.
const DB_NAME = "prayer_app";

const URL_PLACEHOLDER = "<your-app-url>";

const WORDS = [
  "coral", "amber", "maple", "river", "cedar", "ember", "lunar", "pearl",
  "olive", "raven", "slate", "willow", "cobalt", "saffron", "indigo", "hazel",
  "aspen", "flint", "ivory", "marble", "onyx", "quartz", "topaz", "violet",
];

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

// Trim a trailing slash so we can append "/?code=..." cleanly.
function inviteBase({ url }) {
  const base = url || process.env.APP_URL || URL_PLACEHOLDER;
  return base.replace(/\/+$/, "");
}

function makeCode() {
  const word = WORDS[randomInt(WORDS.length)];
  const num = String(randomInt(1000, 10000)); // 4 digits, no leading zero
  return `${word}-${num}`;
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

// Write the SQL to a temp file and use --file. Passing SQL via --command gets
// re-split by the shell on Windows (spaces become separate args), so a file is
// the reliable path.
function runSql(sql, remote, dbName) {
  const tmp = join(tmpdir(), `seed-${Date.now()}.sql`);
  writeFileSync(tmp, sql, "utf8");
  try {
    const target = remote ? "--remote" : "--local";
    execSync(`npx wrangler d1 execute ${dbName} ${target} --yes --file "${tmp}"`, { stdio: "inherit" });
  } finally {
    rmSync(tmp, { force: true });
  }
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
  runSql(sql, remote, dbName);

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
