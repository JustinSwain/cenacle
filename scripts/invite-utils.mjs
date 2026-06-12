import { createHash, randomInt } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Must match `database_name` in wrangler.jsonc. Override per-run with --db or
// the D1_DATABASE env var if you renamed the database.
export const DB_NAME = "cenacle_db";

export const URL_PLACEHOLDER = "<your-app-url>";

const WORDS = [
  "coral", "amber", "maple", "river", "cedar", "ember", "lunar", "pearl",
  "olive", "raven", "slate", "willow", "cobalt", "saffron", "indigo", "hazel",
  "aspen", "flint", "ivory", "marble", "onyx", "quartz", "topaz", "violet",
];

// Trim a trailing slash so we can append "/?code=..." cleanly.
export function inviteBase({ url } = {}) {
  const base = url || process.env.APP_URL || URL_PLACEHOLDER;
  return base.replace(/\/+$/, "");
}

export function makeCode() {
  const first = WORDS[randomInt(WORDS.length)];
  let second;
  do { second = WORDS[randomInt(WORDS.length)]; } while (second === first);
  const num = String(randomInt(1000, 10000)); // 4 digits, no leading zero
  return `${first}-${second}-${num}`;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function shellQuote(s) {
  const value = String(s);
  if (process.platform === "win32") return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function validateDbName(dbName) {
  if (!/^[A-Za-z0-9_.-]+$/.test(dbName)) {
    throw new Error("Database name may only contain letters, numbers, dots, underscores, and hyphens.");
  }
}

// Write the SQL to a temp file and use --file. Passing SQL via --command gets
// re-split by the shell on Windows (spaces become separate args), so a file is
// the reliable path. Wrangler's own output is shown to the user (inherited), so
// they can read how many rows were written; we don't parse it. execSync throws
// if wrangler exits non-zero, which is how we detect a real failure.
export function runSql(sql, { remote, dbName, label = "invite" }) {
  validateDbName(dbName);

  const tmp = join(tmpdir(), `${label}-${process.pid}-${Date.now()}-${randomInt(100000)}.sql`);
  writeFileSync(tmp, sql, "utf8");
  try {
    const target = remote ? "--remote" : "--local";
    const command = [
      "npx",
      "wrangler",
      "d1",
      "execute",
      dbName,
      target,
      "--yes",
      "--file",
      shellQuote(tmp),
    ].join(" ");

    execSync(command, {
      env: {
        ...process.env,
        WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS ?? "false",
      },
      stdio: "inherit",
    });
  } finally {
    rmSync(tmp, { force: true });
  }
}
