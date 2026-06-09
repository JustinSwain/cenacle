# Open-Source Group Prayer App - Packaging Plan

Turn the working prayer app (currently an island page in this personal site)
into a standalone, self-hostable open-source project. This doc is the source of
truth, the same way `PLAN.md` drove the original build.

## Goal & principles

- **Decentralized, never centralized.** Every group's admin runs their OWN
  isolated instance on their OWN Cloudflare account. There is no shared server
  and no operator who can see everyone's data. The maintainer (you) ships code,
  not a service.
- **Adoptable by a mildly-technical admin.** Target: someone who can install
  Node, copy/paste a few terminal commands, and follow a README. Success = "I
  cloned it, set a couple of secrets, ran one deploy, and had a working URL for
  my group in ~15 minutes."
- **Single origin.** The Worker serves BOTH the API and the static page from one
  URL. No CORS, no second host, no `API_BASE` to configure. Works out of the box
  on the free `*.workers.dev` subdomain with no DNS setup.
- **Privacy is a feature, stated honestly.** Sensitive spiritual data. The docs
  must be candid about the trust model (see Security posture below).
- **Keep what already works.** The app logic, schema, auth, anonymity handling,
  theming, and admin tooling are done and battle-tested in your group. This is a
  lift-and-genericize, not a rewrite.

## Target architecture (single origin)

```
                 one Cloudflare Worker (one URL, one deploy)
   browser  ->   /            -> serves index.html / app.js / style.css (static assets)
                 /manifest.webmanifest -> generated from config
                 /api/*       -> JSON API (session, requests, pray, stats, ...)
                                    |
                                    +-- D1 (SQLite): members, requests, prayers, updates
```

- Static files live in `public/` and are served via Cloudflare Workers static
  assets (`assets` binding in `wrangler.jsonc`).
- **All API routes move under an `/api/` prefix** so they never collide with
  static asset paths. Frontend `API_BASE = "/api"` (relative, same origin).
- CORS handling can be dropped entirely for the single-origin build (no
  cross-origin requests happen). Keep a tiny optional allow-list only if we also
  support the split-hosting mode later; otherwise delete it.
- Config (group name, branding) is injected at request time by the Worker from
  `wrangler.jsonc` vars - no build step (see Configuration model).

## Repo layout (proposed)

```
group-prayer/
  src/
    index.js              Worker: /api/* routes + static asset serving + config injection
  public/
    index.html
    app.js
    style.css
    icon.png              default app icon (admin replaces with their own)
  migrations/
    0001_init.sql         D1 schema
  scripts/
    seed-members.mjs      invite-code provisioning (generic)
  wrangler.jsonc          template with vars + bindings, placeholders documented
  .dev.vars.example       SESSION_SECRET example (gitignored real one)
  README.md               what it is, screenshots, "Deploy your own" walkthrough
  ADMIN.md                day-to-day admin guide (generalized from current one)
  SECURITY.md             trust model, data handling, how to report issues
  CONTRIBUTING.md
  LICENSE                 MIT (recommended)
  .gitignore
```

## Naming (TBD)

Working title `group-prayer`. Friendlier candidates to consider: **Selah**,
**Upper Room**, **Intercede**, **PrayerCircle**, **Together**, **Cenacle**.
Pick one before publishing (affects repo name, package name, default app title).

## Decoupling checklist (hardcoded -> config)

Everything tied to your site today and what it becomes:

| Hardcoded now | Location | Becomes |
|---|---|---|
| `API_BASE` = your workers.dev URL | `app.js:4` | `"/api"` (relative, same origin) |
| CORS allow-list = justinswain.dev | `index.js` ALLOWED_ORIGINS | removed for single-origin |
| API routes at root (`/session`, `/requests`...) | `index.js` router | moved under `/api/` |
| `start_url`/`scope` = `/p/prayer/` | `manifest.json` | `/` (generated from config) |
| App title "Prayer", description | `index.html`, manifest | from `GROUP_NAME` config |
| Favicon `spacecat.png`, apple-touch `prayer_hands.jpg` | `index.html` | bundled default `icon.png` |
| Invite links -> justinswain.dev | `seed-members.mjs` | deploy URL via flag/config |
| Worker name `prayer-api`, D1 `prayer_app` | `wrangler.jsonc` | template defaults |
| `noindex` meta | `index.html` | keep (private by default) |

Note: theming is already CSS custom properties and the page is already
self-contained (Phase E), so there is NO entanglement with the personal site's
VGA font, palette, or challenge system to unwind.

## Configuration model (no build step)

Admin edits ONE place - the `vars` block in `wrangler.jsonc`:

```jsonc
"vars": {
  "GROUP_NAME": "Grace Group",          // header title, manifest, onboarding, invite copy
  "THEME": "warm"                        // optional palette key (default provided)
}
```

Secrets (never in the repo) via `wrangler secret put`:
- `SESSION_SECRET` - HMAC signing key (already in use).

How config reaches the frontend (Worker does it at request time):
1. **index.html** - Worker injects `<script>window.__CONFIG__ = { groupName, theme }</script>`
   (via HTMLRewriter or a placeholder token) before serving. `app.js` reads it
   to set the header title and onboarding copy.
2. **manifest** - Worker serves `/manifest.webmanifest` generated from
   `GROUP_NAME` (name/short_name/start_url/icons).
3. **Branding** - admin replaces `public/icon.png` with their own; that's it.

This keeps the promise: "change one config value, redeploy, done" - no bundler,
no framework, no toolchain for the admin to learn.

## Admin setup flow (the README walkthrough)

Aim for the shortest credible path:

1. `git clone` (or use a "Deploy to Cloudflare" button if we add one).
2. `npm install`
3. `npx wrangler d1 create prayer` -> paste the printed id into `wrangler.jsonc`.
4. `npx wrangler d1 migrations apply prayer --remote`
5. `npx wrangler secret put SESSION_SECRET` (paste a long random string).
6. Set `GROUP_NAME` in `wrangler.jsonc`; optionally drop in `public/icon.png`.
7. `npm run deploy` -> get the live URL.
8. `node scripts/seed-members.mjs --remote --admin "You" -- "Friend" "Friend2"`
   -> hand out the printed invite links.

Stretch: a "Deploy to Cloudflare" button automates clone + Worker create; D1,
secret, and seeding still need steps 3-8, so the README stays the real guide.

## Code changes required (summary)

Frontend (`public/`):
- `API_BASE = "/api"`.
- Read `window.__CONFIG__` for title/onboarding instead of literal "Prayer".
- Remove personal-site favicon refs; point at bundled icon.
- `manifest` link -> `/manifest.webmanifest` (Worker-generated).

Worker (`src/index.js`):
- Add static-asset serving + the `assets` binding in `wrangler.jsonc`.
- Prefix all routes with `/api`.
- Add `/manifest.webmanifest` generator and index.html config injection.
- Delete (or make optional) the CORS layer.
- Read `env.GROUP_NAME` etc.

Tooling:
- `seed-members.mjs`: accept a `--url`/config base for invite links; DB name from
  a constant the README documents.
- Generalize `ADMIN.md` (strip justinswain specifics, keep the recipes).

## OSS scaffolding

- `LICENSE` - MIT.
- `README.md` - one-paragraph pitch, screenshots (light+dark), feature list,
  "Deploy your own" walkthrough, config reference, link to ADMIN/SECURITY.
- `SECURITY.md` - trust model + responsible-disclosure contact.
- `CONTRIBUTING.md` - how to run locally (`npm run dev`), code style, scope.
- `.gitignore`, `.dev.vars.example`.
- Optional: GitHub issue/PR templates, a screenshot/GIF, a CHANGELOG.

## Security & privacy posture (must be documented honestly)

State plainly in README/SECURITY:
- The admin who deploys is the **data controller**. Prayer requests live in
  THEIR Cloudflare D1, under THEIR account. The project maintainer never sees it.
- Auth = per-person invite codes (SHA-256 hashed; raw codes never stored). No
  passwords, no email, no third-party trackers.
- Anonymity guarantee: anonymous requests never leak the author to non-authors
  (SEC4). Note the existing nuance: the "who's praying" list names pray-ers to
  each other regardless of request anonymity - document it so admins understand.
- Page is `noindex` and private by default; CORS is moot in single-origin.
- It's still sensitive data: admins should keep DB backups private and treat
  invite links with care. (This is also why the year-end export matters.)

Carry over SEC1-SEC6 from the original `PLAN.md` as the security baseline.

## Repo-location recommendation (the open decision)

**Recommended: a fresh, separate repo.** Reasons:
- Clean public history with no personal-site code or commit noise.
- Independent issues/stars/releases; contributors clone a small focused repo.
- Your group keeps running on your current in-site copy untouched; later you can
  optionally re-point it at an instance of the OSS version.

Extraction is a one-time copy of `p/prayer/` -> `public/` and
`_workers/prayer-api/` -> `src/`+`migrations/`+`scripts/`, then genericize per the
checklist. (Alternative: build in-place here and split later - simpler short
term, but you inherit this repo's history and have to scrub it at publish time.
Not recommended unless you want to prototype the single-origin refactor against
your live group first.)

## Phased execution

- **P0 - Single-origin refactor (prove it works):** asset serving, `/api/`
  prefix, drop CORS, `API_BASE="/api"`. Deploy a throwaway instance; confirm the
  whole app works from one URL. (Can be done in this repo as a spike, or in the
  new repo.)
- **P1 - Config & branding:** `GROUP_NAME` injection, generated manifest,
  swappable icon, config-driven title/onboarding.
- **P2 - Seeding & admin docs:** generic seed script URL handling; generalized
  ADMIN.md.
- **P3 - OSS scaffolding:** LICENSE, README + screenshots, SECURITY,
  CONTRIBUTING, .gitignore, example config.
- **P4 - Publish:** pick the name, create the public repo, optional "Deploy to
  Cloudflare" button, tag v0.1.0, announce.

## Open questions to resolve before/while building

1. **Name** (blocks repo creation and default title).
2. **Custom domain in docs?** Default to `*.workers.dev` (zero setup); document
   custom domains as an optional add-on.
3. **Theme config scope:** ship just the warm palette for v1, or expose 2-3
   presets via `THEME`? (Lean: one good default for v1, presets later.)
4. **Demo instance:** worth standing up a public read-only/sandbox demo for the
   README, or keep it screenshots-only for v1? (Lean: screenshots first.)
5. **Split-hosting mode:** support Pages + separate Worker as an option, or
   single-origin only? (Lean: single-origin only for v1 to keep it simple.)
