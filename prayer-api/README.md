# prayer-api

Cloudflare Worker backing the private small-group prayer app at `p/prayer/`.
Same pattern as `_workers/iw4x-stats`: pathname routing, D1 binding `DB`,
`json()` / `corsHeaders()` helpers. CORS is locked to the site origin +
localhost (never `*`) because this is private data.

## One-time setup (needs your Cloudflare account)

From this directory (`_workers/prayer-api/`):

1. Install deps:
   ```
   npm install
   ```

2. Create the D1 database and copy the printed `database_id` into
   `wrangler.jsonc` (replace `REPLACE_WITH_D1_DATABASE_ID`):
   ```
   npx wrangler d1 create prayer_app
   ```

3. Apply the schema (local for dev, remote for production):
   ```
   npx wrangler d1 migrations apply prayer_app --local
   npx wrangler d1 migrations apply prayer_app --remote
   ```

4. Set the session-signing secret (any long random string; never committed):
   ```
   npx wrangler secret put SESSION_SECRET
   ```
   For local dev, add the same value to a `.dev.vars` file (gitignored):
   ```
   SESSION_SECRET=your-long-random-string
   ```

5. Seed members and hand out their codes. Names after `--admin` (up to `--`)
   become admins; the rest are members:
   ```
   node seed-members.mjs --admin "Justin" -- "Alice" "Bob"        # local DB
   node seed-members.mjs --remote --admin "Justin" -- "Alice"     # deployed DB
   ```
   It prints a `?code=...` link per person. Copy them - the raw codes are NOT
   stored anywhere (only their SHA-256 hashes go into D1).

6. Deploy:
   ```
   npm run deploy
   ```

The frontend (`p/prayer/app.js`) points at
`https://prayer-api.justinswain2.workers.dev`. If your deployed Worker URL
differs, update `API_BASE` there.

## Local development

```
npm run dev
```

Serves on `http://localhost:8787`. The frontend's `API_BASE` is the production
URL, so to test against local: temporarily point `API_BASE` at
`http://localhost:8787`, or seed/redeem against the local DB.

## Endpoints (Phase A)

| Method | Path                  | Auth | Purpose |
|--------|-----------------------|------|---------|
| POST   | `/session`            | code | Redeem invite code -> session token + profile |
| GET    | `/me`                 | yes  | Current member + "new since last visit" badge counts |
| GET    | `/requests?status=`   | yes  | Feed: `open` (default), `answered`, `mine` |
| GET    | `/requests/:id`       | yes  | Request detail + updates thread |
| POST   | `/requests/:id/pray`  | yes  | Record an "I prayed" tap (2s dedup); returns counts |

Phases B-E (create requests, updates, answered wall, stats, prayer graph) are
in `p/prayer/PLAN.md`.

## Auth model

Per-person invite codes (no passwords, no email). A code is hashed (SHA-256)
and matched to a member; the Worker mints an HMAC session token
(`base64url(payload).hmac`, payload = `{memberId, tokenVersion, iat}`) stored
in `localStorage`. Codes are not single-use - the same link works on any
device. Bump a member's `token_version` in D1 to instantly revoke every live
session for that person.

## Revoking a member

```
npx wrangler d1 execute prayer_app --remote --command \
  "UPDATE members SET token_version = token_version + 1 WHERE name = 'Alice';"
```

Optionally also rotate `token_hash` so the old code can't mint a new session.

## Notes for seeding by hand (testing)

To create a couple of requests to see in the feed before the create-request UI
(Phase B) exists:

```
npx wrangler d1 execute prayer_app --local --command \
  "INSERT INTO requests (author_id, title, body, category, status, created_at) \
   VALUES (1, 'Travel safety', 'Driving to see family this weekend.', 'family', 'open', strftime('%s','now')*1000);"
```
