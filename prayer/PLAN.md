# Prayer App - Build Plan

Audience: Sonnet, implementing in follow-up sessions.
Purpose: A private prayer app for a ~25-person church small group. People request
prayer, signal that they are praying for each other, and post updates / testimonies
when prayers are answered. A stats dashboard measures the COMMUNITY (not God): how
connected and active the group is.

Source files (to be created):
- `p/prayer/index.html`     - single island page (HTML shell, links CSS + JS)
- `p/prayer/app.js`         - frontend logic (feed, detail, forms, stats, session)
- `p/prayer/style.css`      - page styles
- `_workers/prayer-api/index.js`         - Cloudflare Worker (REST API)
- `_workers/prayer-api/wrangler.jsonc`   - worker config (D1 binding)
- `_workers/prayer-api/schema.sql`       - D1 schema + indexes
- `_workers/prayer-api/seed-members.mjs` - one-time invite-code generator (local)

## Architecture

Same pattern the site already uses for `_workers/iw4x-stats` and `_workers/cat-visits`:

```
GitHub Pages (static)                Cloudflare
  p/prayer/index.html  --fetch()-->  prayer-api Worker  -->  D1 (SQLite)
```

- Frontend is plain static HTML/CSS/JS on GitHub Pages. No framework.
- Backend is ONE Cloudflare Worker (`prayer-api`) with a D1 database binding `DB`.
- Routing uses the `url.pathname` switch style from `_workers/iw4x-stats/src/index.js`.
- Reuse the `json()` and `corsHeaders()` helpers from that worker. CORS allow-list
  should be tightened to the site origin (not `*`) since this is private data - see SEC1.

## House style reminders

- Plain ASCII in any text the page RENDERS (no em dashes, no `&nbsp;`, no smart quotes).
  The site uses a DOS VGA font that mangles fancy glyphs. Emoji icons are fine (praying
  hands, check mark, etc.) - they use the OS emoji font, not the VGA font.
  NOTE: a prayer app may read better in a softer face than the DOS VGA font. Decide per
  E-phase whether to override the font on this page only. Until then, assume VGA rules.
- Use the existing `--space0`..`--space7` spacing/color tokens from `/style/style.css`.
- Keep file layout consistent with sibling pages (`p/<name>/index.html`).
- Page must be `noindex` (meta robots + ideally not linked from public nav). This is
  private group data.

---

## Data model (D1 / SQLite)

`_workers/prayer-api/schema.sql`. The `prayers` table (one row per "I prayed" tap) is
the heart of the stats - never collapse it into a counter.

```sql
CREATE TABLE members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 of the invite code; raw code never stored
  token_version INTEGER NOT NULL DEFAULT 1,  -- bump to instantly invalidate all live sessions (revocation)
  role        TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'admin'
  joined_at   INTEGER NOT NULL,       -- epoch ms
  last_seen_at INTEGER                -- epoch ms, drives "new since last visit"
);

CREATE TABLE requests (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES members(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general', -- general|health|family|work|spiritual|praise
  status       TEXT NOT NULL DEFAULT 'open',    -- open|answered|archived
  is_anonymous INTEGER NOT NULL DEFAULT 0,      -- 1 = author hidden from group, still attributed internally
  created_at   INTEGER NOT NULL,
  answered_at  INTEGER,
  answer_note  TEXT                              -- the testimony
);

CREATE TABLE prayers (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE updates (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_prayers_request ON prayers(request_id);
CREATE INDEX idx_prayers_member  ON prayers(member_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_updates_request ON updates(request_id);
```

Notes:
- `is_anonymous`: the request still has a real `author_id` (so reciprocity stats work and
  the author can edit/mark-answered), but the API must NOT leak the author name to other
  members when this flag is set. Enforce in the serializer, not just the UI.
- Allow repeated `prayers` rows per member per request (you can pray more than once over
  time). Stats use COUNT(DISTINCT member_id) where "how many people" is the question, and
  COUNT(*) where "how many prayers" is the question. Keep both available.

---

## Auth: per-person invite codes (decided)

No passwords, no email. You pre-provision 25 members.

- `seed-members.mjs` (run locally once): takes a list of names, generates a random code
  per person (e.g. `crypto.randomUUID()` or a short readable code like `coral-7382`),
  prints `name -> code` to the console for you to hand out, and writes only the
  SHA-256 `token_hash` into D1 via `wrangler d1 execute`. The raw code is never stored.
- Redemption: user opens `p/prayer/?code=coral-7382` (or pastes it into a field). Frontend
  POSTs the code to `/session`. Worker hashes it, looks up the member, and returns a
  signed session token (HMAC of `member_id` + `token_version` + issued-at, secret in a
  Worker secret `SESSION_SECRET`). Frontend stores it in `localStorage` under
  `prayer_session_v1`. The code is NOT single-use or device-bound: the same code can be
  redeemed on any number of devices (new phone, tablet, laptop). The session token is what
  lives per-browser; the code just mints it.
- Every subsequent request sends `Authorization: Bearer <token>`. Worker verifies the
  HMAC. To make revocation real, also compare the token's `token_version` against the
  member's current `token_version` - a cheap DB read (or cache it). If they differ, reject
  with 401 so the device must re-redeem. Bump `last_seen_at` opportunistically.
- Day-to-day there is zero friction: same browser, the localStorage session just works.
- Re-access on a NEW device: the member re-taps their original link themselves; no admin
  action needed. They only need a fresh link from you if they LOST the original.
- Revocation (lost/stolen device, or someone leaves the group): admin bumps that member's
  `token_version`. This INSTANTLY invalidates every live session for that person on every
  device (because the version no longer matches), not just future logins. Optionally also
  rotate `token_hash` so the old code can't mint a new session either.
- This gives every action an identity, which is what powers the whole stats layer.

---

## Worker API

Helpers ported from `iw4x-stats`: `json(body, status)`, `corsHeaders()`. Add
`requireMember(request, env)` that verifies the bearer token and returns the member or a
401. All write endpoints go through it.

| Method | Path                     | Auth | Purpose |
|--------|--------------------------|------|---------|
| POST   | `/session`               | code | Redeem invite code -> session token + member profile |
| GET    | `/me`                    | yes  | Current member + counts since `last_seen_at` (badges) |
| GET    | `/requests`             | yes  | List, filterable `?status=open|answered|mine` |
| POST   | `/requests`             | yes  | Create a request |
| GET    | `/requests/:id`         | yes  | Detail: request + updates + who's-praying summary |
| POST   | `/requests/:id/pray`    | yes  | Insert a `prayers` row |
| POST   | `/requests/:id/update`  | yes  | Add an update/comment |
| POST   | `/requests/:id/answer`  | author/admin | Set status=answered + answer_note |
| POST   | `/requests/:id/archive` | author/admin | Soft-hide |
| GET    | `/stats`                | yes  | Aggregate community metrics (see Phase D) |

Serializer rule: when `is_anonymous=1` and the viewer is not the author/admin, replace
author name with "Anonymous" and strip `author_id` from the payload.

---

## PHASE A - Backend foundation + read/pray feed (first PR)

Goal: a working feed where a logged-in member sees open requests and can tap "I'm praying".
No request creation UI yet (seed a few rows by hand to test).

### A1. Scaffold the worker
- Create `_workers/prayer-api/` mirroring `iw4x-stats` layout (wrangler.jsonc, src/index.js,
  package.json with `dev`/`deploy` scripts).
- Create the D1 database (`wrangler d1 create prayer_app`), wire the `DB` binding, apply
  `schema.sql`.

### A2. Session + auth
- Implement `seed-members.mjs` and provision yourself + 2 test members.
- Implement `POST /session`, the HMAC token, and `requireMember()`.
- Add `SESSION_SECRET` as a Worker secret.

### A3. Read + pray endpoints
- `GET /requests?status=open` returns cards: id, title, snippet, category, author (or
  Anonymous), created_at, distinct-prayer-count, total-prayer-count, hasViewerPrayed.
- `POST /requests/:id/pray` inserts a row, returns the new counts.
- `GET /requests/:id` full detail incl. updates (empty for now).

### A4. The island page shell
- `p/prayer/index.html`: noindex meta, links to `app.js` + `style.css`, a login gate
  (code field) and an empty `#feed` container.
- `app.js`: session bootstrap (read localStorage or `?code=`), fetch feed, render cards,
  wire the "I'm praying" button to optimistic-update the count.
- Mobile-first layout. Big tap targets (>=44px).

### A5. Security baseline (do not defer)
- CORS allow-list to the site origin + localhost, not `*` (SEC1).
- Validate + length-cap all text inputs server-side.
- Rate-limit `pray` per member per request (e.g. ignore duplicate taps within 2s) to
  avoid accidental double counts from double-taps.

End of A: log in with a code, see seeded requests, tap to pray, count goes up and persists.

---

## PHASE B - Requests, updates, answered prayers (second PR)

Goal: the full lifecycle, end to end, by real users.

### B1. Create-request form
- Title, body, category select, anonymous toggle. Client + server validation.
- `POST /requests`, prepend to feed on success.

### B2. Request detail view
- Full body, the updates thread (chronological), and a "X people praying" line that can
  expand to show names (respecting anonymity of the REQUEST author only; prayer-ers are
  always named to each other - decide in B-open-question whether prayers are public).
- "I'm praying" button here too.

### B3. Updates / comments
- `POST /requests/:id/update`, render in the thread. Keep it simple text for now.

### B4. Mark answered + testimony
- Author/admin only. `POST /requests/:id/answer` with `answer_note`. Moves the card to
  the Answered section and shows a celebratory treatment.

### B5. Tabs / views
- Feed tabs: `Open` | `Answered` | `Mine`. Answered tab is the testimonies wall - this is
  the emotional payoff of the app, give it a warm visual treatment.

End of B: a member can post a request, others pray + comment, author marks it answered with
a testimony, and it lands on the Answered wall.

---

## PHASE C - Identity polish + "new since last visit" (third PR)

Phase A already did the hard auth. C is about making the logged-in experience feel personal
and making people want to come back.

### C1. Profile + onboarding
- First login (`?code=`) asks the member to confirm their display name, then drops the code
  from the URL. Show a one-time "how this works" card.
- A small header showing who you're signed in as + a sign-out.

### C1a. Low-tech onboarding (REQUIREMENT, not optional)
The group includes older / less-technical members. The whole magic-link model only "just
works" day-to-day if these are handled. Design for the person who does not understand
browsers, tabs, or sessions.

- **Add-to-home-screen prompt.** On first successful login, show a simple, illustrated
  step ("Add this to your home screen so you can tap it like an app") with SEPARATE
  screenshots for iPhone (Share -> Add to Home Screen) and Android (menu -> Add to Home
  screen). This is the single most important step - it sidesteps the in-app-browser and
  "re-find the URL" confusion entirely, because the icon always opens the same browser
  context where the session lives. Make it dismissible but easy to re-show from a "Help"
  link. Ship a proper `manifest.json` + apple-touch-icon so the installed icon looks like
  a real app.
- **Human-readable fallback code.** Codes must be short and readable (e.g. `coral-7382`),
  NOT raw UUIDs, so a member can type one off a text message if a tapped link ever fails.
  (Update `seed-members.mjs` in Phase A accordingly - readable word+number codes.)
- **Forgiving login gate.** If there is no valid session, never show a raw/scary error.
  Show a warm screen: "Tap your personal link again, or type your code here:" with a code
  field. Same screen handles expired/revoked sessions.
- **No accidental logout.** Do not put a prominent "sign out" button in the main UI for
  members (a non-technical user who signs out has no easy way back). Tuck it behind a Help/
  Settings area with a confirm, or omit it for `member` role entirely. Sessions should be
  long-lived (no short expiry).
- **Admin setup path.** Document (in a short README the admin keeps) that for the 2-3
  least-technical members, the highest-success path is the admin setting up the home-screen
  icon on their device in person once. The app should not DEPEND on this, but should be
  pleasant if it happens.
- **A11y basics for this audience.** Large default font size, high-contrast text, big tap
  targets (>=44px, already noted in A4), and avoid relying on color alone for status.

### C2. "New since last visit" badges
- `GET /me` returns counts of requests/updates/answers created after `last_seen_at`.
- Badge the tabs ("Open 3", "Answered 1"). Update `last_seen_at` when the member views.
- This is the entire notification strategy for MVP (in-app only, decided). No email/push.

### C3. Gentle reminders (in-app)
- Optional: a soft nudge card "you haven't prayed for anyone in N days" - PRIVATE to the
  viewer, never shown to others. Keep it encouraging, not guilt-inducing.

---

## PHASE D - Stats dashboard + the prayer graph (fourth PR)

The mathematician's payoff. Measures the COMMUNITY. Public stats are AGGREGATE/ANONYMIZED
to avoid turning prayer into a leaderboard; personal stats are private to the viewer.

### D1. `GET /stats` aggregates
Community (shown to everyone):
- Prayers offered this week / all time (COUNT(*) on `prayers`).
- Active members this week (distinct members who prayed or posted).
- Open vs answered counts; answered-rate over time.
- Median time-to-first-prayer and time-to-answered.
- Requests by category (for a simple bar/pie).
- A weekly trend series (prayers per week) for a sparkline/line chart.

Personal (only in your own session):
- "You've prayed for N requests this month."
- Your reciprocity ratio: prayers_offered / requests_made (framed as encouragement).

### D2. The prayer graph
The relation "member A prayed for a request authored by member B" is a directed,
weighted multigraph over the 25 members. Compute server-side from `prayers JOIN requests`:
- Adjacency / weight matrix (A -> B = number of times A prayed for B's requests).
- Graph density, number of weakly-connected components, isolated members (people nobody
  has prayed for, or who haven't prayed for anyone) - surface these GENTLY as "let's
  surround these requests" prompts, never as call-outs of individuals.
- Reciprocity coefficient of the whole graph (how mutual is the praying).
- Optional viz: a small force-directed or circular chord diagram. Names can be hidden
  behind initials/avatars in the public view if the group prefers.

Keep D2 behind the same aggregate-first principle: the GRAPH SHAPE is the interesting
math; individual rankings are not the point.

### D3. Charts
- Reuse whatever lightweight charting the site already does (check other toys before
  pulling in a library). A tiny inline canvas sparkline is enough for trends.

---

## PHASE E - Polish

### E1. Typography decision
- Evaluate a softer, more readable font for this page only vs the site VGA font. If kept
  VGA, audit every rendered string for non-ASCII (see house style).

### E2. Empty / loading / error states
- Friendly empty states ("No open requests right now - a quiet week").
- Optimistic UI with rollback on failed pray/post.

### E3. Accessibility
- Emoji buttons get `aria-label`s. Full keyboard nav. `prefers-reduced-motion` respected
  on any graph animation.

### E4. Offline-friendliness
- Cache the last feed in `localStorage` so the page shows something instantly on open.

### E5. Optional weekly digest (deferred, needs email)
- The cron pattern exists in `iw4x-stats` (`triggers.crons`). If the group later wants a
  weekly email summary, add a scheduled handler + an email sender (MailChannels/Resend).
  Out of MVP scope by decision (in-app notifications only).

---

## Security / privacy checklist (revisit every PR)

- SEC1. CORS locked to site origin + localhost, never `*`.
- SEC2. `noindex` on the page; not linked from public site nav.
- SEC3. Raw invite codes never stored; only SHA-256 hashes. `SESSION_SECRET` is a Worker
  secret, never committed.
- SEC4. Anonymous requests never leak `author_id`/name to non-authors in any endpoint.
- SEC5. All text inputs validated + length-capped server-side; treat content as untrusted
  and escape on render (no `innerHTML` with user text).
- SEC6. Be transparent with the group: data lives in your personal Cloudflare account.
  Consider a short in-app note saying so.

---

## Suggested PR sequence

1. PR 1 (Phase A): worker scaffold, D1 schema, session/auth, read+pray, login gate, feed.
2. PR 2 (Phase B): create requests, detail view, updates, mark-answered, tabs.
3. PR 3 (Phase C): profile/onboarding, "new since last visit" badges.
4. PR 4 (Phase D): stats dashboard + prayer graph.
5. PR 5 (Phase E): polish, a11y, typography, optional digest groundwork.

PR 1 is the priority - once login + feed + pray work end to end, the app is already useful
to the group and everything else is additive.

---

## Open questions for the user before PR 2+

- Are individual "who is praying" names visible to the group, or only the count? (Anonymity
  of the REQUEST author is handled; this is about whether prayer-ers are named.)
- Should there be categories beyond the starter list (general/health/family/work/spiritual/
  praise)? Any the group specifically wants?
- Admin powers: just you, or a couple of group leaders who can edit/remove anything?
- For the prayer graph viz, are real names OK to display within the group, or prefer
  initials/avatars?
- Any content the group would NOT want stored server-side at all (very sensitive requests)?
  If so, consider a "this stays in the room" flag that omits the body from storage.
