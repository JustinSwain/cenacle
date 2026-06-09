# Cenacle - Admin Guide

Everyday backend tasks for running your group's prayer app. No prior Cloudflare
knowledge assumed - just follow the recipes.

> **There are no passwords.** Each person logs in with a personal invite code
> (like `coral-7382`) baked into their link. So "reset a password" really means
> "give them a new code," and "lock someone out" means "revoke their code."

---

## Before you start

- Run every command **from the repo root** (the folder with `wrangler.jsonc`).
- Commands use `npx wrangler ...` and work the same on macOS, Linux, and
  Windows (PowerShell or WSL). Where a path or quote differs, it's noted.
- Two databases exist:
  - `--local` = a throwaway copy on your PC for testing. Safe to break.
  - `--remote` = the **real, live database your group uses.** Changes here are
    real and immediate.
- **Rule of thumb:** practice on `--local`, then run the same thing with
  `--remote` once you're happy. When in doubt, [make a backup](#back-up-the-database) first.
- After changing the Worker *code* you must `npm run deploy`. Changing *data*
  (members, posts) takes effect instantly - no deploy needed.

A quick way to run any SQL against the live database:

```
npx wrangler d1 execute cenacle_db --remote --command "SQL GOES HERE;"
```

That single command is the workhorse for most tasks below.

---

## Members

### Add a new member

Generates a code, prints a ready-to-share link, and stores only the *hash* of
the code (the raw code is never saved - copy it when it prints).

```
node scripts/seed-members.mjs --remote "Firstname Lastname"
```

Add several at once:

```
node scripts/seed-members.mjs --remote "Alice" "Bob" "Carol"
```

It prints something like:

```
Alice: https://your-group.example.workers.dev/?code=maple-4821
    code: maple-4821
```

The link's base comes from `--url <your-deploy-url>` or the `APP_URL`
environment variable; without either it prints a `<your-app-url>` placeholder
for you to fill in. Set it once so the links are ready to share:

```
node scripts/seed-members.mjs --remote --url https://your-group.example.workers.dev "Alice"
```

Send each person their own link. Tapping it logs them in and (on phones) they
can "Add to Home Screen" to install it like an app.

### Add a new admin

Names listed after `--admin` (up to a `--` separator) become admins; names
after `--` are regular members:

```
node scripts/seed-members.mjs --remote --admin "Newadmin" -- "Regularmember"
```

Admins can see the Stats panel and remove anyone's post.

### See the current members

```
npx wrangler d1 execute cenacle_db --remote --command "SELECT id, name, role, joined_at, last_seen_at FROM members ORDER BY name;"
```

`id` is the number you'll use in other commands. `last_seen_at` (and
`joined_at`) are timestamps in milliseconds; `0`/empty `last_seen_at` means
they've never logged in yet.

### Make someone an admin (or take it away)

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE members SET role = 'admin' WHERE name = 'Alice';"
```

Demote back to a regular member by setting `role = 'member'`.

### Rename a member

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE members SET name = 'Alice Smith' WHERE id = 5;"
```

(Use `id` if two people share a first name.)

---

## Codes & access (the "password" tasks)

### Give someone a new code (they lost it / it leaked)

This is the closest thing to a password reset. Two steps: pick a new code,
store its hash, and bump their `token_version` so the old code stops working.

1. Choose a new code, e.g. `river-5093`, and compute its hash:

   ```
   node -e "console.log(require('crypto').createHash('sha256').update('river-5093').digest('hex'))"
   ```

   That prints a long hex string - copy it.

2. Save the hash and invalidate the old code in one go (paste the hash where
   shown):

   ```
   npx wrangler d1 execute cenacle_db --remote --command "UPDATE members SET token_hash = 'PASTE_HASH_HERE', token_version = token_version + 1 WHERE name = 'Alice';"
   ```

3. Send them their new link (use your own deploy URL):
   `https://your-group.example.workers.dev/?code=river-5093`

### Lock someone out immediately (revoke access)

Bumping `token_version` invalidates every device they're currently logged in
on. Their old code also stops minting new sessions until you reissue one.

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE members SET token_version = token_version + 1 WHERE name = 'Alice';"
```

To lock them out *and* make sure their code can never be used again, also
overwrite the hash with garbage:

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE members SET token_version = token_version + 1, token_hash = 'revoked-' || id WHERE name = 'Alice';"
```

### Log *everyone* out at once

If the signing secret was ever exposed, rotate it. Every active session
everywhere becomes invalid and people re-tap their links to sign back in.

```
npx wrangler secret put SESSION_SECRET
```

Enter a fresh long random string when prompted. (Changing the secret does not
change anyone's invite code - their links still work.)

---

## Posts (prayer requests)

Most post moderation is easier **in the app**: open the request, scroll down,
and use **Remove post** (admin-only) - it pulls the post from every feed. The
commands here are for when you'd rather work from your computer.

### Find a post's ID

```
npx wrangler d1 execute cenacle_db --remote --command "SELECT id, author_id, title, status, created_at FROM requests ORDER BY created_at DESC LIMIT 20;"
```

### Remove a junk / spam / accidental post

"Removing" sets the post's status to `archived`, which hides it from all feeds
and stats. Nothing is truly deleted, so it's reversible.

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE requests SET status = 'archived' WHERE id = 42;"
```

### Restore a post you removed by mistake

Put it back as `open` (or `answered` if it had been answered):

```
npx wrangler d1 execute cenacle_db --remote --command "UPDATE requests SET status = 'open' WHERE id = 42;"
```

### See removed posts

```
npx wrangler d1 execute cenacle_db --remote --command "SELECT id, title, status FROM requests WHERE status = 'archived';"
```

---

## Housekeeping

### Back up the database

Export the whole live database to a file before any big change. Keep these
somewhere safe - this is your "remember what God did" archive too.

```
npx wrangler d1 export cenacle_db --remote --output "cenacle-backup-2026-06-09.sql"
```

To restore into a fresh/local database if ever needed:

```
npx wrangler d1 execute cenacle_db --local --file "cenacle-backup-2026-06-09.sql"
```

### Quick health check (counts)

```
npx wrangler d1 execute cenacle_db --remote --command "SELECT (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM requests WHERE status='open') AS open, (SELECT COUNT(*) FROM requests WHERE status='answered') AS answered, (SELECT COUNT(*) FROM prayers) AS prayers;"
```

### Year-end review (answered prayers this year)

```
npx wrangler d1 execute cenacle_db --remote --command "SELECT title, answer_note, datetime(answered_at/1000,'unixepoch') AS answered_on FROM requests WHERE status='answered' AND answered_at >= strftime('%s','2026-01-01')*1000 ORDER BY answered_at;"
```

(The **Answered** tab in the app shows the same thing more nicely - this is for
exporting or printing.)

### Deploy a code change

Only needed after editing the Worker (`src/index.js`) or other backend code:

```
npm run deploy
```

---

## Cheat sheet

| I want to... | Where | How |
|---|---|---|
| Add a member | terminal | `node scripts/seed-members.mjs --remote "Name"` |
| Add an admin | terminal | `node scripts/seed-members.mjs --remote --admin "Name"` |
| List members | terminal | `SELECT ... FROM members` |
| Make someone admin | terminal | `UPDATE members SET role='admin' ...` |
| Give a new code | terminal | hash new code -> `UPDATE ... token_hash, token_version+1` |
| Lock someone out | terminal | `UPDATE members SET token_version = token_version + 1 ...` |
| Log everyone out | terminal | `wrangler secret put SESSION_SECRET` |
| Remove a junk post | **app** | open post -> **Remove post** |
| Restore a post | terminal | `UPDATE requests SET status='open' ...` |
| Back up everything | terminal | `wrangler d1 export cenacle_db --remote --output ...` |
| Deploy code changes | terminal | `npm run deploy` |

---

## Safety reminders

- `--remote` touches the **live** group data. There's no undo prompt - the
  command just runs. Back up first for anything you're unsure about.
- This is sensitive, personal prayer data. Keep backups private and never paste
  the database or anyone's invite code into a public place.
- Raw invite codes are never stored - only their hashes. If someone loses their
  code, you can't look it up; you issue a new one (see above).
- The `SESSION_SECRET` is set with `wrangler secret put` and is never committed
  to the repo. Don't put it in a file that gets pushed to GitHub.
