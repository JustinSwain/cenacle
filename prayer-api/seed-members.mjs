#!/usr/bin/env node
/**
 * seed-members.mjs - one-time, local invite-code provisioning.
 *
 * For each name you pass, it generates a short readable code (e.g. coral-7382),
 * prints "name -> code" for you to hand out, and writes ONLY the SHA-256
 * token_hash into D1. The raw code is never stored anywhere by this script,
 * so copy the printed codes before they scroll away.
 *
 * Usage (from _workers/prayer-api/):
 *   node seed-members.mjs "Justin" "Alice" "Bob"
 *   node seed-members.mjs --remote "Justin" "Alice"     # write to deployed (remote) D1
 *   node seed-members.mjs --admin "Justin" -- "Alice"   # names before -- are admins
 *
 * It shells out to `wrangler d1 execute prayer_app` so it uses your existing
 * wrangler auth. Add --remote to target the deployed DB instead of local.
 */

import { createHash, randomInt } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_NAME = "prayer_app";

const WORDS = [
  "coral", "amber", "maple", "river", "cedar", "ember", "lunar", "pearl",
  "olive", "raven", "slate", "willow", "cobalt", "saffron", "indigo", "hazel",
  "aspen", "flint", "ivory", "marble", "onyx", "quartz", "topaz", "violet",
];

function parseArgs(argv) {
  let remote = false;
  const adminNames = [];
  const memberNames = [];
  let bucket = memberNames; // names default to members

  for (const arg of argv) {
    if (arg === "--remote") { remote = true; continue; }
    if (arg === "--admin") { bucket = adminNames; continue; }
    if (arg === "--") { bucket = memberNames; continue; }
    bucket.push(arg);
  }

  return { remote, adminNames, memberNames };
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
function runSql(sql, remote) {
  const tmp = join(tmpdir(), `prayer-seed-${Date.now()}.sql`);
  writeFileSync(tmp, sql, "utf8");
  try {
    const target = remote ? "--remote" : "--local";
    execSync(`npx wrangler d1 execute ${DB_NAME} ${target} --yes --file "${tmp}"`, { stdio: "inherit" });
  } finally {
    rmSync(tmp, { force: true });
  }
}

function main() {
  const { remote, adminNames, memberNames } = parseArgs(process.argv.slice(2));
  const people = [
    ...adminNames.map((name) => ({ name, role: "admin" })),
    ...memberNames.map((name) => ({ name, role: "member" })),
  ];

  if (people.length === 0) {
    console.error('Usage: node seed-members.mjs [--remote] [--admin <names...> --] <names...>');
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

  console.log(`\nSeeding ${people.length} member(s) into ${DB_NAME} (${remote ? "remote" : "local"})...\n`);
  runSql(sql, remote);

  console.log("\n=== HAND THESE OUT (not stored anywhere - copy now) ===\n");
  for (const { name, role, code } of handouts) {
    const tag = role === "admin" ? " [admin]" : "";
    console.log(`  ${name}${tag}: https://justinswain.dev/p/prayer/?code=${code}`);
    console.log(`      code: ${code}\n`);
  }
  console.log("=======================================================\n");
}

main();
