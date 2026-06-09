# Contributing to Cenacle

Thanks for your interest. Cenacle is a small, deliberately simple app: a single
Cloudflare Worker that serves both a vanilla-JS frontend and a JSON API, backed
by D1 (SQLite). There is no build step, framework, or bundler, and the goal is
to keep it that way.

## Project scope

Cenacle is a private prayer-request board for one small group, self-hosted by
that group's admin. Good contributions keep it:

- **Simple to deploy.** A mildly-technical admin should still be able to clone,
  set two values, and deploy in ~15 minutes. Features that add required setup
  steps or services need a strong reason.
- **Single-origin.** One Worker serves the page and the API from one URL. No
  CORS, no second host, no `API_BASE` to configure.
- **Private by default.** No third-party trackers, no analytics, no external
  calls with user data. The page stays `noindex`.

Out of scope (by design): multi-tenant / shared-server hosting, accounts with
passwords or email, push notifications, native apps, heavy frameworks.

If you're unsure whether a change fits, open an issue to discuss before building.

## Running locally

You need Node and a Cloudflare account (the free tier is fine for dev).

```
npm install
cp .dev.vars.example .dev.vars          # then edit SESSION_SECRET
npx wrangler d1 migrations apply prayer_app --local
node scripts/seed-members.mjs --admin "You"   # prints a local invite link
npm run dev
```

`npm run dev` serves the whole app (page + API) from one local URL. Use that
URL, not the editor's static preview, since the preview bypasses the Worker
(config injection and `/api/*` won't work).

## Code style

- **Vanilla JS, no dependencies in the frontend.** Build DOM with
  `document.createElement`. Never assign user-supplied text via `innerHTML`
  (XSS risk); use `textContent` or build nodes.
- **Plain ASCII in rendered copy.** No smart quotes, em dashes, or other
  non-ASCII punctuation in user-facing strings. Emoji are fine where intentional.
- **Match the surrounding code.** Two-space indent, double quotes, semicolons.
- **Comments explain "why," not "what."** Default to none.
- **No new config the admin must set** unless the feature truly needs it, with a
  sensible default.

## Security

Please read [SECURITY.md](SECURITY.md) before working on auth, sessions,
anonymity, or anything touching member data. Report vulnerabilities privately
(see that file) rather than in a public issue or PR.

## Pull requests

- Keep PRs focused; one change per PR.
- Describe what changed and why, and how you tested it.
- Test the actual feature in a browser (light and dark mode) before submitting,
  not just that the code compiles.
