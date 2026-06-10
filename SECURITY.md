# Security & Privacy

Cenacle holds sensitive, personal data: people's prayer requests. This document
explains the trust model honestly so admins know what they're responsible for,
and tells security researchers how to report issues.

## Trust model (who can see what)

- **You, the admin who deploys, are the data controller.** Every request lives
  in *your* Cloudflare D1 database, under *your* Cloudflare account. Each group
  runs its own isolated instance. There is no shared server and no central
  operator. The project maintainer never sees your group's data.
- **Cloudflare** runs the Worker and stores the D1 database, so they are a
  processor in the usual cloud sense. No other third party is involved: no
  analytics, no trackers, no external calls carrying user data.
- **Members** see each other's active and Prayer Log requests, who has prayed, and
  group stats. Admins additionally see the Stats panel and can remove any post.

## Authentication

- **Per-person invite codes, no passwords and no email.** Each member gets a
  unique code (like `coral-7382`) baked into a personal link.
- Codes are stored only as **SHA-256 hashes**; the raw code is never written to
  the database or logs. If someone loses their code you cannot look it up, you
  issue a new one (see [ADMIN.md](ADMIN.md)).
- Sessions are short HMAC-signed tokens kept in the browser's `localStorage`.
  The signing key, `SESSION_SECRET`, is a Cloudflare Worker secret, set with
  `wrangler secret put` and never committed to the repo.
- Each member has a `token_version`. Bumping it instantly invalidates every
  active session for that person, which is how revocation and "give a new code"
  work.

## Anonymity (read this carefully)

A request can be posted **anonymously**. The guarantee is:

- Anonymous requests **never leak the author's name or id to non-authors** in
  any view or API response (this is invariant SEC4 below).

But note the deliberate, important nuance:

- **The "who's praying" list is not anonymous.** When you tap "I prayed" on any
  request, your name is shown to others on that request, regardless of whether
  the request itself was posted anonymously. Praying for a request reveals that
  *you* prayed; it does not reveal who *wrote* an anonymous request.

Make sure your group understands this distinction before relying on anonymity.

## Privacy posture

- The page is marked `noindex, nofollow` and is private by default. Share invite
  links directly with members; don't post them publicly.
- Treat database backups as sensitive. They contain everyone's requests. Keep
  them private (the `.gitignore` already excludes `*-backup-*.sql`).
- This is real spiritual data about real people. Handle it with the same care
  you'd want for your own.

## Security invariants (the baseline)

These are enforced in the code and should not be weakened by changes:

- **SEC1 - Same origin.** The Worker serves the page and API from one origin, so
  there is no CORS surface to misconfigure. (No `*` cross-origin access.)
- **SEC2 - Not indexed.** The page sends `noindex` and is not linked from any
  public navigation.
- **SEC3 - Secrets stay secret.** Raw invite codes are never stored (only
  SHA-256 hashes). `SESSION_SECRET` is a Worker secret, never committed.
- **SEC4 - Anonymity holds.** Anonymous requests never expose `author_id` or the
  author's name to non-authors in any endpoint.
- **SEC5 - Untrusted input.** All text inputs are validated and length-capped
  server-side. User content is treated as untrusted and escaped on render; never
  inserted via `innerHTML`.
- **SEC6 - Be transparent.** Tell your group their data lives in your Cloudflare
  account. Honesty about the trust model is part of the design.

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue or pull
request.

- Use GitHub's private vulnerability reporting: open the repository's
  **Security** tab and choose **Report a vulnerability**. This opens a private
  advisory visible only to the maintainers.

Please include steps to reproduce and the potential impact. We'll acknowledge
your report and work on a fix before any public disclosure. Thank you for
helping keep groups' data safe.
