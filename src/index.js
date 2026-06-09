/**
 * Cenacle - Cloudflare Worker backing the private small-group prayer app.
 *
 * Single origin: one Worker serves both the static page (via the ASSETS
 * binding) and the JSON API (under the /api/ prefix). Same-origin only, so
 * there is no CORS layer. Auth is per-person invite codes minting HMAC session
 * tokens. See docs/PLAN.md for the full design.
 */

const VALID_CATEGORIES = new Set([
  "general", "health", "family", "work", "spiritual", "praise",
]);
const NAME_MAX = 40;
const TITLE_MAX = 120;
const BODY_MAX = 4000;
const UPDATE_MAX = 2000;
const ANSWER_MAX = 2000;

// Branding palettes. Keys match the THEME var; values are the page background
// used for the manifest and the <meta theme-color> tints. The full colour sets
// live in public/style.css under [data-palette].
const PALETTES = {
  warm: { lightBg: "#fbf3e9", darkBg: "#211b18" },
  cool: { lightBg: "#eef3f7", darkBg: "#161d23" },
  neutral: { lightBg: "#f4f3f1", darkBg: "#1c1b19" },
};

function readConfig(env) {
  const groupName = (env.GROUP_NAME && String(env.GROUP_NAME).trim()) || "Prayer";
  let theme = (env.THEME && String(env.THEME).trim().toLowerCase()) || "warm";
  if (!PALETTES[theme]) theme = "warm";
  return { groupName, theme };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/* is the JSON API; every other path is a static asset.
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice(4) || "/"; // strip the "/api" prefix
      try {
        const route = await dispatch(request, env, path);
        return route ?? json({ error: "Not found" }, 404);
      } catch (err) {
        console.error("Unhandled error:", err);
        return json({ error: "Internal error" }, 500);
      }
    }

    // The PWA manifest is generated from the admin's branding config.
    if (url.pathname === "/manifest.webmanifest") {
      return manifestResponse(env);
    }

    const assetRes = await env.ASSETS.fetch(request);

    // Inject branding into HTML pages; serve other assets untouched.
    const contentType = assetRes.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      return rewriteHtml(assetRes, env);
    }
    return assetRes;
  },
};

function manifestResponse(env) {
  const { groupName, theme } = readConfig(env);
  const colors = PALETTES[theme];
  const manifest = {
    name: groupName,
    short_name: groupName,
    description: `Private prayer space for ${groupName}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: colors.lightBg,
    theme_color: colors.lightBg,
    icons: [
      { src: "/icon.jpg", sizes: "360x360", type: "image/jpeg", purpose: "any" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
}

// Stream the static HTML through HTMLRewriter, injecting window.__CONFIG__ and
// applying the palette so the page is branded before the first paint.
function rewriteHtml(res, env) {
  const { groupName, theme } = readConfig(env);
  const colors = PALETTES[theme];
  // Escape "<" so the group name can't break out of the inline <script>.
  const payload = JSON.stringify({ groupName, theme }).replace(/</g, "\\u003c");

  return new HTMLRewriter()
    .on("html", {
      element(e) { e.setAttribute("data-palette", theme); },
    })
    .on("title", {
      element(e) { e.setInnerContent(groupName); },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(e) { e.setAttribute("content", groupName); },
    })
    .on('meta[name="theme-color"]', {
      element(e) {
        const media = e.getAttribute("media") || "";
        e.setAttribute("content", media.includes("dark") ? colors.darkBg : colors.lightBg);
      },
    })
    .on("head", {
      element(e) { e.append(`<script>window.__CONFIG__=${payload};</script>`, { html: true }); },
    })
    .transform(res);
}

async function dispatch(request, env, path) {
  const method = request.method;

  if (method === "POST" && path === "/session") {
    return handleSession(request, env);
  }

  if (method === "GET" && path === "/me") {
    return withMember(request, env, (member) => handleMe(env, member));
  }

  if (method === "POST" && path === "/me") {
    return withMember(request, env, (member) => handleUpdateProfile(request, env, member));
  }

  if (method === "GET" && path === "/stats") {
    return withMember(request, env, (member) => handleStats(env, member));
  }

  if (method === "GET" && path === "/requests") {
    return withMember(request, env, (member) => handleListRequests(request, env, member));
  }

  if (method === "POST" && path === "/requests") {
    return withMember(request, env, (member) => handleCreateRequest(request, env, member));
  }

  const prayMatch = path.match(/^\/requests\/(\d+)\/pray$/);
  if (method === "POST" && prayMatch) {
    const id = Number(prayMatch[1]);
    return withMember(request, env, (member) => handlePray(env, member, id));
  }

  const updateMatch = path.match(/^\/requests\/(\d+)\/update$/);
  if (method === "POST" && updateMatch) {
    const id = Number(updateMatch[1]);
    return withMember(request, env, (member) => handleAddUpdate(request, env, member, id));
  }

  const answerMatch = path.match(/^\/requests\/(\d+)\/answer$/);
  if (method === "POST" && answerMatch) {
    const id = Number(answerMatch[1]);
    return withMember(request, env, (member) => handleAnswer(request, env, member, id));
  }

  const archiveMatch = path.match(/^\/requests\/(\d+)\/archive$/);
  if (method === "POST" && archiveMatch) {
    const id = Number(archiveMatch[1]);
    return withMember(request, env, (member) => handleArchive(env, member, id));
  }

  const detailMatch = path.match(/^\/requests\/(\d+)$/);
  if (method === "GET" && detailMatch) {
    const id = Number(detailMatch[1]);
    return withMember(request, env, (member) => handleRequestDetail(env, member, id));
  }

  return null;
}

// ─────────────────────────────── auth ───────────────────────────────

async function handleSession(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const code = normalizeCode(body?.code);
  if (!code) return json({ error: "Missing code" }, 400);

  const tokenHash = await sha256Hex(code);
  const member = await env.DB.prepare(`
    SELECT id, name, role, token_version, last_seen_at
    FROM members
    WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!member) {
    // Generic message: do not reveal whether a code is valid.
    return json({ error: "That code was not recognized." }, 401);
  }

  const token = await mintToken(env, member);

  // Note: last_seen_at is advanced by GET /me (the "new since last visit"
  // marker), not here, so a returning member's badge window stays intact.
  return json({
    token,
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
    },
  });
}

// Wraps a handler that needs a logged-in member; returns 401 otherwise.
async function withMember(request, env, handler) {
  const member = await requireMember(request, env);
  if (!member) return json({ error: "Unauthorized" }, 401);
  return handler(member);
}

async function requireMember(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const payload = await verifyToken(env, match[1].trim());
  if (!payload) return null;

  const member = await env.DB.prepare(`
    SELECT id, name, role, token_version, last_seen_at
    FROM members
    WHERE id = ?
  `).bind(payload.memberId).first();

  if (!member) return null;
  // token_version mismatch = revoked session.
  if (Number(member.token_version) !== Number(payload.tokenVersion)) return null;

  return member;
}

// HMAC token: base64url(payload) "." base64url(hmac). Payload = {memberId, tokenVersion, iat}.
async function mintToken(env, member) {
  const payload = {
    memberId: member.id,
    tokenVersion: Number(member.token_version),
    iat: Date.now(),
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacHex(env.SESSION_SECRET, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifyToken(env, token) {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = await hmacHex(env.SESSION_SECRET, payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (typeof payload.memberId !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

async function touchLastSeen(env, memberId) {
  await env.DB.prepare(`UPDATE members SET last_seen_at = ? WHERE id = ?`)
    .bind(Date.now(), memberId)
    .run();
}

// ─────────────────────────────── /me ───────────────────────────────

// "New since last visit" badges. Reads the stored last_seen_at as the window
// start, computes per-tab counts against it, then advances the marker to now
// (consume-on-read). A member's first visit (last_seen_at NULL) shows zero so
// they are not greeted with a huge backlog count.
async function handleMe(env, member) {
  const firstVisit = member.last_seen_at == null;
  const since = firstVisit ? Date.now() : toInt(member.last_seen_at);

  let badges = { open: 0, answered: 0, mine: 0 };

  if (!firstVisit) {
    // New open requests from other members (the Open tab).
    const newOpen = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM requests
      WHERE status = 'open' AND created_at > ? AND author_id != ?
    `).bind(since, member.id).first();

    // Requests answered by others since the marker (the Answered tab).
    const newAnswered = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM requests
      WHERE status = 'answered' AND answered_at > ? AND author_id != ?
    `).bind(since, member.id).first();

    // New updates from others on the member's own requests (the Mine tab).
    const newMine = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM updates u
      JOIN requests r ON r.id = u.request_id
      WHERE r.author_id = ? AND r.status != 'archived'
        AND u.member_id != ? AND u.created_at > ?
    `).bind(member.id, member.id, since).first();

    badges = {
      open: toInt(newOpen?.n),
      answered: toInt(newAnswered?.n),
      mine: toInt(newMine?.n),
    };
  }

  await touchLastSeen(env, member.id);

  return json({
    member: { id: member.id, name: member.name, role: member.role },
    since,
    firstVisit,
    badges,
  });
}

async function handleUpdateProfile(request, env, member) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const name = cleanText(body?.name, NAME_MAX);
  if (!name) return json({ error: "Please enter a name." }, 400);

  await env.DB.prepare(`UPDATE members SET name = ? WHERE id = ?`)
    .bind(name, member.id)
    .run();

  return json({
    member: { id: member.id, name, role: member.role },
  });
}

// ─────────────────────────────── stats ───────────────────────────────

// Public + personal stats for everyone; the admin block is included only for
// admins (gated server-side, never trust the client). No prayer graph and no
// reciprocity ratio by product decision.
async function handleStats(env, member) {
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);

  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requests WHERE status = 'open'`
  ).first();
  const answered = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requests WHERE status = 'answered'`
  ).first();

  // Personal prayer count = prayers offered + requests submitted, this year.
  const myTaps = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM prayers WHERE member_id = ? AND created_at >= ?`
  ).bind(member.id, yearStart).first();
  const myRequests = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requests WHERE author_id = ? AND created_at >= ?`
  ).bind(member.id, yearStart).first();

  // Answered prayers the member was part of (authored or prayed for) this year.
  const myAnswered = await env.DB.prepare(`
    SELECT COUNT(DISTINCT r.id) AS n FROM requests r
    WHERE r.status = 'answered' AND r.answered_at >= ?
      AND (r.author_id = ?
           OR EXISTS (SELECT 1 FROM prayers p WHERE p.request_id = r.id AND p.member_id = ?))
  `).bind(yearStart, member.id, member.id).first();

  const stats = {
    public: {
      open: toInt(open?.n),
      answered: toInt(answered?.n),
    },
    personal: {
      year,
      prayers: toInt(myTaps?.n) + toInt(myRequests?.n),
      answered: toInt(myAnswered?.n),
    },
    admin: member.role === "admin" ? await computeAdminStats(env, now) : null,
  };

  return json({ stats });
}

async function computeAdminStats(env, now) {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weekStart = now - WEEK_MS;

  const prayersWeek = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM prayers WHERE created_at >= ?`
  ).bind(weekStart).first();
  const prayersAll = await env.DB.prepare(`SELECT COUNT(*) AS n FROM prayers`).first();

  // Active = distinct members who prayed, posted a request, or posted an update
  // in the last 7 days.
  const active = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT member_id FROM prayers  WHERE created_at >= ?
      UNION SELECT author_id FROM requests WHERE created_at >= ?
      UNION SELECT member_id FROM updates  WHERE created_at >= ?
    )
  `).bind(weekStart, weekStart, weekStart).first();

  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requests WHERE status = 'open'`
  ).first();
  const answered = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM requests WHERE status = 'answered'`
  ).first();
  const openN = toInt(open?.n);
  const answeredN = toInt(answered?.n);
  const denom = openN + answeredN;
  const answeredRate = denom > 0 ? Math.round((answeredN / denom) * 100) : 0;

  const { results: cats } = await env.DB.prepare(`
    SELECT category, COUNT(*) AS n FROM requests
    WHERE status != 'archived' GROUP BY category
  `).all();

  // Prayers per week for the last 8 weeks (index 0 = oldest, last = this week).
  const WEEKS = 8;
  const { results: trendRows } = await env.DB.prepare(`
    SELECT CAST((? - created_at) / ? AS INTEGER) AS wk, COUNT(*) AS n
    FROM prayers WHERE created_at >= ?
    GROUP BY wk
  `).bind(now, WEEK_MS, now - WEEKS * WEEK_MS).all();
  const weeklyTrend = new Array(WEEKS).fill(0);
  for (const row of trendRows ?? []) {
    const idx = WEEKS - 1 - toInt(row.wk);
    if (idx >= 0 && idx < WEEKS) weeklyTrend[idx] = toInt(row.n);
  }

  // Medians computed in JS (SQLite has no native median).
  const { results: firstPrayerRows } = await env.DB.prepare(`
    SELECT r.created_at AS rc, MIN(p.created_at) AS fp
    FROM requests r JOIN prayers p ON p.request_id = r.id
    GROUP BY r.id
  `).all();
  const ttfp = (firstPrayerRows ?? [])
    .map((r) => toInt(r.fp) - toInt(r.rc))
    .filter((d) => d >= 0);

  const { results: answeredRows } = await env.DB.prepare(`
    SELECT (answered_at - created_at) AS d FROM requests
    WHERE status = 'answered' AND answered_at IS NOT NULL
  `).all();
  const tta = (answeredRows ?? []).map((r) => toInt(r.d)).filter((d) => d >= 0);

  return {
    prayersThisWeek: toInt(prayersWeek?.n),
    prayersAllTime: toInt(prayersAll?.n),
    activeThisWeek: toInt(active?.n),
    open: openN,
    answered: answeredN,
    answeredRate,
    byCategory: (cats ?? []).map((c) => ({ category: c.category, count: toInt(c.n) })),
    weeklyTrend,
    medianHoursToFirstPrayer: medianHours(ttfp),
    medianHoursToAnswered: medianHours(tta),
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medianHours(msValues) {
  const m = median(msValues);
  return m == null ? null : Math.round(m / 3600000);
}

// ─────────────────────────── requests feed ───────────────────────────

async function handleListRequests(request, env, member) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "open";

  let where;
  let binds;
  if (status === "answered") {
    where = "r.status = 'answered'";
    binds = [];
  } else if (status === "mine") {
    where = "r.author_id = ? AND r.status != 'archived'";
    binds = [member.id];
  } else {
    where = "r.status = 'open'";
    binds = [];
  }

  const { results } = await env.DB.prepare(`
    SELECT
      r.id, r.author_id, r.title, r.body, r.category, r.status,
      r.is_anonymous, r.created_at, r.answered_at, r.answer_note,
      m.name AS author_name,
      (SELECT COUNT(DISTINCT p.member_id) FROM prayers p WHERE p.request_id = r.id) AS distinct_prayers,
      (SELECT COUNT(*)                    FROM prayers p WHERE p.request_id = r.id) AS total_prayers,
      (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id AND p.member_id = ?) AS viewer_prayers
    FROM requests r
    JOIN members m ON m.id = r.author_id
    WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT 200
  `).bind(member.id, ...binds).all();

  const cards = (results ?? []).map((row) => serializeCard(row, member));
  return json({ requests: cards });
}

async function handleRequestDetail(env, member, id) {
  const row = await env.DB.prepare(`
    SELECT
      r.id, r.author_id, r.title, r.body, r.category, r.status,
      r.is_anonymous, r.created_at, r.answered_at, r.answer_note,
      m.name AS author_name,
      (SELECT COUNT(DISTINCT p.member_id) FROM prayers p WHERE p.request_id = r.id) AS distinct_prayers,
      (SELECT COUNT(*)                    FROM prayers p WHERE p.request_id = r.id) AS total_prayers,
      (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id AND p.member_id = ?) AS viewer_prayers
    FROM requests r
    JOIN members m ON m.id = r.author_id
    WHERE r.id = ?
  `).bind(member.id, id).first();

  if (!row || row.status === "archived") {
    return json({ error: "Not found" }, 404);
  }

  const { results: updateRows } = await env.DB.prepare(`
    SELECT u.id, u.body, u.created_at, u.member_id, m.name AS author_name
    FROM updates u
    JOIN members m ON m.id = u.member_id
    WHERE u.request_id = ?
    ORDER BY u.created_at ASC
  `).bind(id).all();

  // Prayer-ers are always named to each other (independent of request anonymity).
  // Most recent first by that member's latest prayer.
  const { results: prayingRows } = await env.DB.prepare(`
    SELECT p.member_id, m.name, MAX(p.created_at) AS last_at
    FROM prayers p
    JOIN members m ON m.id = p.member_id
    WHERE p.request_id = ?
    GROUP BY p.member_id, m.name
    ORDER BY last_at DESC
  `).bind(id).all();

  const card = serializeCard(row, member);
  card.body = String(row.body ?? "");
  card.updates = (updateRows ?? []).map((u) => ({
    id: u.id,
    body: String(u.body ?? ""),
    createdAt: toInt(u.created_at),
    author: u.author_name,
  }));
  card.prayingMembers = (prayingRows ?? []).map((p) => ({
    id: p.member_id,
    name: p.name,
  }));

  return json({ request: card });
}

async function handlePray(env, member, id) {
  const req = await env.DB.prepare(`SELECT id, status FROM requests WHERE id = ?`)
    .bind(id).first();
  if (!req || req.status === "archived") {
    return json({ error: "Not found" }, 404);
  }

  const now = Date.now();
  // One prayer signal per member per request: if this member has already prayed
  // for it, do not insert again. This keeps prayer counts honest (a member can't
  // inflate them by tapping repeatedly) and makes the action idempotent.
  const existing = await env.DB.prepare(`
    SELECT 1 FROM prayers WHERE request_id = ? AND member_id = ? LIMIT 1
  `).bind(id, member.id).first();

  if (!existing) {
    await env.DB.prepare(`
      INSERT INTO prayers (request_id, member_id, created_at)
      VALUES (?, ?, ?)
    `).bind(id, member.id, now).run();
  }

  const counts = await env.DB.prepare(`
    SELECT
      COUNT(DISTINCT member_id) AS distinct_prayers,
      COUNT(*)                  AS total_prayers
    FROM prayers WHERE request_id = ?
  `).bind(id).first();

  return json({
    distinctPrayers: toInt(counts?.distinct_prayers),
    totalPrayers: toInt(counts?.total_prayers),
    hasViewerPrayed: true,
    alreadyPrayed: Boolean(existing),
  });
}

async function handleCreateRequest(request, env, member) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const title = cleanText(body?.title, TITLE_MAX);
  const text = cleanText(body?.body, BODY_MAX);
  const category = VALID_CATEGORIES.has(body?.category) ? body.category : "general";
  const isAnonymous = body?.isAnonymous ? 1 : 0;

  if (!title) return json({ error: "Please add a short title." }, 400);
  if (!text) return json({ error: "Please add a few words about your request." }, 400);

  const now = Date.now();
  const result = await env.DB.prepare(`
    INSERT INTO requests (author_id, title, body, category, status, is_anonymous, created_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?)
  `).bind(member.id, title, text, category, isAnonymous, now).run();

  const id = result.meta?.last_row_id;
  return handleRequestDetail(env, member, id);
}

async function handleAddUpdate(request, env, member, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const text = cleanText(body?.body, UPDATE_MAX);
  if (!text) return json({ error: "Please write something to share." }, 400);

  const req = await env.DB.prepare(`SELECT id, status FROM requests WHERE id = ?`)
    .bind(id).first();
  if (!req || req.status === "archived") {
    return json({ error: "Not found" }, 404);
  }

  await env.DB.prepare(`
    INSERT INTO updates (request_id, member_id, body, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(id, member.id, text, Date.now()).run();

  return handleRequestDetail(env, member, id);
}

async function handleAnswer(request, env, member, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const note = cleanText(body?.answerNote, ANSWER_MAX);

  const req = await env.DB.prepare(`SELECT id, author_id, status FROM requests WHERE id = ?`)
    .bind(id).first();
  if (!req || req.status === "archived") {
    return json({ error: "Not found" }, 404);
  }
  if (!canModerate(member, req)) {
    return json({ error: "Only the author can mark this answered." }, 403);
  }

  await env.DB.prepare(`
    UPDATE requests
    SET status = 'answered', answered_at = ?, answer_note = ?
    WHERE id = ?
  `).bind(Date.now(), note || null, id).run();

  return handleRequestDetail(env, member, id);
}

async function handleArchive(env, member, id) {
  const req = await env.DB.prepare(`SELECT id, author_id, status FROM requests WHERE id = ?`)
    .bind(id).first();
  if (!req) {
    return json({ error: "Not found" }, 404);
  }
  if (!canModerate(member, req)) {
    return json({ error: "Only the author can archive this." }, 403);
  }

  await env.DB.prepare(`UPDATE requests SET status = 'archived' WHERE id = ?`)
    .bind(id).run();

  return json({ ok: true, archived: true });
}

// Author-only for now; admins (role='admin') are honored too so moderation can
// be turned on later without an API change.
function canModerate(member, req) {
  return req.author_id === member.id || member.role === "admin";
}

// Anonymity-respecting card serializer (SEC4): when is_anonymous and the
// viewer is neither the author nor an admin, strip author identity.
function serializeCard(row, member) {
  const isAnon = Number(row.is_anonymous) === 1;
  const isOwner = row.author_id === member.id;
  const isAdmin = member.role === "admin";
  const hideAuthor = isAnon && !isOwner && !isAdmin;

  const card = {
    id: row.id,
    title: String(row.title ?? ""),
    snippet: snippet(row.body),
    category: row.category,
    status: row.status,
    isAnonymous: isAnon,
    createdAt: toInt(row.created_at),
    answeredAt: row.answered_at != null ? toInt(row.answered_at) : null,
    answerNote: row.answer_note != null ? String(row.answer_note) : null,
    distinctPrayers: toInt(row.distinct_prayers),
    totalPrayers: toInt(row.total_prayers),
    hasViewerPrayed: toInt(row.viewer_prayers) > 0,
    isMine: isOwner,
  };

  if (hideAuthor) {
    card.author = "Anonymous";
  } else {
    card.author = row.author_name;
    card.authorId = row.author_id;
  }

  return card;
}

// ───────────────────────────── helpers ─────────────────────────────

function normalizeCode(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().slice(0, 64);
}

// Trim, hard-cap length, and drop control chars. Content is escaped on render
// client-side (SEC5); this just bounds and sanitizes what we store.
function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const out = [];
  for (const ch of value) {
    const c = ch.codePointAt(0);
    // keep tab(9) and newline(10); drop other C0 controls and DEL(127)
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out.push(ch);
  }
  return out.join("").trim().slice(0, max);
}

function snippet(body, max = 160) {
  const text = String(body ?? "").trim();
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest));
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(new Uint8Array(sig));
}

function hex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
