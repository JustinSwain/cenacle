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
- **Members** see each other's active and Prayer Log requests, who wrote them,
  and who has prayed. Admins additionally see group statistics, manage member
  access and roles, review the administration audit trail, and remove any post.

## Authentication

- **Per-person invite codes, no passwords and no email.** Each member gets a
  unique code (like `coral-maple-7382`) baked into a personal link.
- Codes are stored only as **SHA-256 hashes**; the raw code is never written to
  the database or logs. If someone loses their code you cannot look it up, you
  issue a new one (see [ADMIN.md](ADMIN.md)).
- Sessions are HMAC-signed tokens kept in the browser's `localStorage`.
  The signing key, `SESSION_SECRET`, is a Cloudflare Worker secret, set with
  `wrangler secret put` and never committed to the repo.
- Failed code attempts are rate-limited by HMAC-hashed client IP and attempted
  code hash. Raw IPs and raw attempted codes are not stored in the limiter table.
- Each member has an `active` flag and a `token_version`. Revocation clears the
  active flag and bumps the version, so both the old invite and every live
  session stop working immediately.

## Named participation

Cenacle does not support anonymous posts. This is intentional: the app is for a
known small group, not a public confession box. If a request is too private to
attach your name to, it should be shared another way instead of stored here.

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
- **SEC4 - Named participation.** Requests, prayers, and updates are attached to
  member names within the group.
- **SEC5 - Untrusted input.** All text inputs are validated and length-capped
  server-side. User content is treated as untrusted and escaped on render; never
  inserted via `innerHTML`.
- **SEC6 - Be transparent.** Tell your group their data lives in your Cloudflare
  account. Honesty about the trust model is part of the design.
- **SEC7 - Enforce administration server-side.** Every administration route
  verifies the current member's active session and `admin` role. The Worker
  also prevents self-revocation and preserves at least one active administrator.

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue or pull
request.

- Use GitHub's private vulnerability reporting: open the repository's
  **Security** tab and choose **Report a vulnerability**. This opens a private
  advisory visible only to the maintainers.

Please include steps to reproduce and the potential impact. We'll acknowledge
your report and work on a fix before any public disclosure. Thank you for
helping keep groups' data safe.
