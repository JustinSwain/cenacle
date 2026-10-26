/* Cenacle frontend. A small hash router shows one screen at a time:
     #/          active requests (the feed)
     #/log       the Prayer Log
     #/you       your requests and settings
     #/pray      prayer time, one request at a time
     #/members   the group roster
     #/r/<id>    one request and its updates
     #/new       share a request; #/edit/<id> edits one
   Bottom sheets (the modal host) carry menus, confirmations, help, admin, and
   stats. Member content always enters the DOM as text nodes, never HTML (SEC5). */

const API_BASE = "/api";
const SESSION_KEY = "cenacle_session_v1";
const ONBOARDED_KEY = "cenacle_onboarded_v1";
const THEME_KEY = "cenacle_theme_v1";
const FEED_CACHE_KEY = "cenacle_feed_v1";

// Branding injected by the Worker (window.__CONFIG__). Falls back to "Prayer"
// when the page is served as a raw static asset without the Worker.
const CONFIG = (window.__CONFIG__ && typeof window.__CONFIG__ === "object") ? window.__CONFIG__ : {};
const GROUP_NAME = (typeof CONFIG.groupName === "string" && CONFIG.groupName.trim()) || "Prayer";
const SHOW_PUBLIC_PRAYER_COUNTS = CONFIG.showPublicPrayerCounts === true ||
  String(CONFIG.showPublicPrayerCounts ?? "").trim().toLowerCase() === "true";
const SHOW_FEED_COUNTS = CONFIG.showFeedCounts === true ||
  String(CONFIG.showFeedCounts ?? "").trim().toLowerCase() === "true";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "health", label: "Health" },
  { value: "family", label: "Family" },
  { value: "work", label: "Work" },
  { value: "spiritual", label: "Spiritual" },
  { value: "praise", label: "Praise" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
// "General" is the default, so the composer offers the others as optional topics.
const TOPICS = CATEGORIES.filter((c) => c.value !== "general");

// Top-level screens keep the tab bar; the rest are full-screen sub-views.
const TOP_LEVEL = new Set(["feed", "log", "you"]);

const state = {
  token: null,
  member: null,
  route: null,
  members: null,
  stats: null,
  logFilter: "all",
  pray: null,
};

// ───────────────────────────── icons ─────────────────────────────

// Static stroke icons. Only these constant strings ever pass through innerHTML.
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  pray: '<path d="M11.5 4.5C10.4 5.2 9.5 7.2 9.5 9.6V13L6 16.6V20h3.6l1.9-2.4z"/><path d="M12.5 4.5c1.1.7 2 2.7 2 5.1V13l3.5 3.6V20h-3.6l-1.9-2.4z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5c.9-3 3.4-4.5 6.5-4.5s5.6 1.5 6.5 4.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 15.3c1.4.7 2.4 2.1 3 4.2"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17.2v.1"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h9"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="m4 6 8 7 8-7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

function icon(name, className = "icon") {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  return span;
}

// ───────────────────────────── session ─────────────────────────────

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string") return parsed;
  } catch {
    /* ignore corrupt session */
  }
  return null;
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  // Drop the cached feed so a different person on this device can't see it.
  localStorage.removeItem(FEED_CACHE_KEY);
  state.token = null;
  state.member = null;
  state.members = null;
  state.stats = null;
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && state.token) headers["Authorization"] = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON or empty */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// True for fetch network failures (offline, DNS, CORS) where err.status is unset.
function isNetworkError(err) {
  return err && err.status === undefined;
}

// Held in memory for this page only (never persisted) so the onboarding flow
// can show the member their code to copy into the installed app the first time
// they open it. Cleared on reload.
let lastCode = null;

async function redeemCode(code) {
  const data = await api("/session", { method: "POST", body: { code }, auth: false });
  state.token = data.token;
  state.member = data.member;
  lastCode = code;
  saveSession({ token: data.token, member: data.member });
  return data.member;
}

async function updateName(name) {
  const data = await api("/me", { method: "POST", body: { name } });
  state.member = data.member;
  saveSession({ token: state.token, member: data.member });
  renderIdentity();
  return data.member;
}

// ─────────────────────────────── DOM ───────────────────────────────

const el = {
  gate: document.getElementById("gate"),
  gateForm: document.getElementById("gate-form"),
  codeInput: document.getElementById("code-input"),
  gateSubmit: document.getElementById("gate-submit"),
  gateError: document.getElementById("gate-error"),
  gateTitle: document.querySelector(".gate-title"),
  gateLead: document.getElementById("gate-lead"),
  shell: document.getElementById("shell"),
  shellTitle: document.querySelector(".shell-title"),
  groupSub: document.getElementById("group-sub"),
  myAvatar: document.getElementById("my-avatar"),
  refreshBtn: document.getElementById("refresh-btn"),
  prayBanner: document.getElementById("pray-banner"),
  feed: document.getElementById("feed"),
  feedStatus: document.getElementById("feed-status"),
  feedDescription: document.getElementById("feed-description"),
  newBtn: document.getElementById("new-request-btn"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  views: {
    feed: document.getElementById("view-feed"),
    log: document.getElementById("view-log"),
    you: document.getElementById("view-you"),
    members: document.getElementById("view-members"),
    thread: document.getElementById("view-thread"),
    compose: document.getElementById("view-compose"),
    pray: document.getElementById("view-pray"),
  },
  backdrop: document.getElementById("modal-backdrop"),
  modal: document.getElementById("modal"),
};

// Fill the static chrome (tab icons, header buttons) once at startup.
function decorateStatic() {
  for (const slot of document.querySelectorAll("[data-icon]")) {
    slot.replaceWith(icon(slot.dataset.icon));
  }
  el.refreshBtn.appendChild(icon("refresh"));
  el.prayBanner.querySelector(".pray-banner-icon").appendChild(icon("pray"));
  el.prayBanner.querySelector(".pray-banner-chevron").appendChild(icon("chevron"));
  el.newBtn.append(icon("plus"), text("Request"));
  el.newBtn.setAttribute("aria-label", "Share a prayer request");
}

function showGate(message) {
  el.shell.hidden = true;
  el.gate.hidden = false;
  if (message) {
    el.gateError.textContent = message;
    el.gateError.hidden = false;
  } else {
    el.gateError.hidden = true;
  }
  el.codeInput.focus();
}

function showShell() {
  el.gate.hidden = true;
  el.shell.hidden = false;
  renderIdentity();
  updateGroupSub();
}

function renderIdentity() {
  const me = state.member;
  if (!me) return;
  el.myAvatar.textContent = initialOf(me.name);
  el.myAvatar.dataset.tone = toneFor(me.id);
}

function isAdmin() {
  return state.member?.role === "admin";
}

// Build a text node (safe: never use innerHTML with user content - SEC5).
function text(value) {
  return document.createTextNode(String(value ?? ""));
}

function elem(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.appendChild(text(textContent));
  return node;
}

function button(className, label, onClick) {
  const btn = elem("button", className, label);
  btn.type = "button";
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

function iconButton(name, label, onClick, className = "icon-btn") {
  const btn = button(className, null, onClick);
  btn.setAttribute("aria-label", label);
  btn.appendChild(icon(name));
  return btn;
}

function link(className, label, href) {
  const a = elem("a", className, label);
  a.href = href;
  return a;
}

function initialOf(name) {
  const first = Array.from(String(name || "?").trim())[0] || "?";
  return first.toUpperCase();
}

// Avatar colors are stable per member, so a name keeps its tone everywhere.
function toneFor(id) {
  return String((toCount(id) % 4) + 1);
}

function avatar(name, id, size) {
  const node = elem("span", size ? `avatar avatar-${size}` : "avatar", initialOf(name));
  node.dataset.tone = toneFor(id);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function shortDate(epochMs) {
  const date = new Date(epochMs);
  const opts = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

// Compact timeline time: "now", "12m", "5h", "3d", then a date.
function relTime(epochMs) {
  const diff = Date.now() - epochMs;
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return shortDate(epochMs);
}

function longDate(epochMs) {
  return new Date(epochMs).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function monthLabel(epochMs) {
  return new Date(epochMs).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function categoryLabel(cat) {
  return CATEGORY_LABEL[cat] || CATEGORY_LABEL.general;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// "Ana", "Ana and Tom", "Ana, Tom and Ruth"; past four names, "... and 3 others".
function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list.join("");
  if (list.length <= 4) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `${list.slice(0, 3).join(", ")} and ${list.length - 3} others`;
}

function prayerCountLabel(n, isOwn) {
  // On your own request the count describes OTHERS, so the wording never
  // clashes with the author's view of who prayed.
  if (!n) return isOwn ? "Prayers from your group will appear here" : "Be the first to pray";
  if (n === 1) return isOwn ? "1 other person praying" : "1 person praying";
  return isOwn ? `${n} others praying` : `${n} people praying`;
}

// Only the author sees who prayed; the lock says so on every such line.
function prayedByLine(names) {
  const line = elem("p", "private-line");
  line.appendChild(icon("lock"));
  const span = elem("span");
  if (names.length) {
    span.appendChild(elem("strong", null, joinNames(names)));
    span.appendChild(text(" prayed · only you see this"));
  } else {
    span.appendChild(text("Only you will see who prays for this."));
  }
  line.appendChild(span);
  return line;
}

function replyNote(req) {
  const n = toCount(req.newComments);
  if (n === 0) return null;
  return elem("p", "reply-note", n === 1
    ? `${req.newCommentAuthor || "Someone"} replied`
    : `${n} new replies`);
}

function closingNote(req) {
  const praise = req.category === "praise";
  const box = elem("div", praise ? "closing-note is-praise" : "closing-note");
  box.appendChild(elem("p", "section-label", praise ? "Praise report" : "Closing note"));
  box.appendChild(elem("p", null, req.answerNote));
  return box;
}

function labeled(labelText, field) {
  const wrap = elem("label", "field");
  wrap.appendChild(elem("span", "field-label", labelText));
  wrap.appendChild(field);
  return wrap;
}

function showFormError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function errorText(err, fallback) {
  return isNetworkError(err) ? "Could not connect. Check your internet and try again." : (err.message || fallback);
}

let toastTimer = null;

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = elem("div", "toast");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

// A sub-view's top bar: back, a title, and optional trailing buttons.
function subBar(title, { actions = [] } = {}) {
  const bar = elem("header", "sub-bar");
  bar.appendChild(iconButton("back", "Back", () => goBack()));
  bar.appendChild(elem("h1", "sub-title", title));
  for (const action of actions) bar.appendChild(action);
  return bar;
}

// ───────────────────────────── router ─────────────────────────────

function parseRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  let match;
  if (hash === "/log") return { name: "log" };
  if (hash === "/you") return { name: "you" };
  if (hash === "/pray") return { name: "pray" };
  if (hash === "/members") return { name: "members" };
  if (hash === "/new") return { name: "compose" };
  if ((match = hash.match(/^\/edit\/(\d+)$/))) return { name: "compose", editId: Number(match[1]) };
  if ((match = hash.match(/^\/r\/(\d+)$/))) return { name: "thread", id: Number(match[1]) };
  return { name: "feed" };
}

// Back returns to wherever the member came from inside the app; a deep link
// opened cold falls back to the feed instead of leaving the app.
let inAppNavigations = 0;

function goBack(fallback = "#/") {
  if (inAppNavigations > 0) history.back();
  else location.hash = fallback;
}

const scrollMemory = {};

function render() {
  if (!state.token || el.shell.hidden) return;
  const previous = state.route;
  if (previous && TOP_LEVEL.has(previous.name)) scrollMemory[previous.name] = window.scrollY;

  const route = parseRoute();
  state.route = route;
  if (!el.backdrop.hidden) closeModal({ restoreFocus: false });
  stopCardVisibilityTracking();

  for (const [name, view] of Object.entries(el.views)) view.hidden = name !== route.name;
  el.shell.classList.toggle("is-sub", !TOP_LEVEL.has(route.name));
  for (const tab of el.tabs) {
    if (tab.dataset.tab === route.name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }

  if (route.name === "feed") loadFeed();
  else if (route.name === "log") showLog();
  else if (route.name === "you") showYou();
  else if (route.name === "members") showMembers();
  else if (route.name === "thread") showThread(route.id);
  else if (route.name === "compose") showCompose(route.editId);
  else if (route.name === "pray") showPray();

  window.scrollTo(0, TOP_LEVEL.has(route.name) ? (scrollMemory[route.name] || 0) : 0);
}

window.addEventListener("hashchange", () => {
  inAppNavigations += 1;
  render();
});

function isCurrent(name, id) {
  return state.route?.name === name && (id === undefined || state.route.id === id);
}

// ─────────────────────────── tab dots ───────────────────────────

// A tab carries a single dot when it holds anything new to you - no count,
// since the rows inside say what changed. The dot is just "look in here".
function setTabDot(tab, on) {
  const node = el.tabs.find((t) => t.dataset.tab === tab);
  const dot = node?.querySelector(".tab-dot");
  if (!dot) return;
  dot.hidden = !on;
  const label = node.querySelector(".tab-label")?.textContent || tab;
  if (on) node.setAttribute("aria-label", `${label}, has something new`);
  else node.removeAttribute("aria-label");
}

async function refreshTabDots() {
  let data;
  try {
    data = await api("/me");
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    return;
  }
  if (state.member && data.member && data.member.name) {
    state.member = data.member;
    saveSession({ token: state.token, member: data.member });
    renderIdentity();
  }
  const newTabs = data.newTabs || {};
  setTabDot("feed", !!newTabs.open);
  setTabDot("log", !!newTabs.answered);
  setTabDot("you", !!newTabs.mine);
}

// ─────────────────────────── feed cache ───────────────────────────

function readFeedCache(status) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || "{}");
    const entry = all[status];
    return entry && Array.isArray(entry.requests) ? entry.requests : null;
  } catch {
    return null;
  }
}

function writeFeedCache(status, requests) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || "{}");
    all[status] = { requests, ts: Date.now() };
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable - non-fatal */
  }
}

function updateCachedRequest(id, update) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || "{}");
    let changed = false;
    for (const entry of Object.values(all)) {
      if (!entry || !Array.isArray(entry.requests)) continue;
      for (const req of entry.requests) {
        if (String(req.id) !== String(id)) continue;
        update(req);
        changed = true;
      }
    }
    if (changed) localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* corrupt or unavailable storage is non-fatal */
  }
}

async function fetchList(status) {
  const data = await api(`/requests?status=${encodeURIComponent(status)}`);
  const list = data.requests || [];
  writeFeedCache(status, list);
  return list;
}

// ───────────────────────────── feed ─────────────────────────────

function setFeedStatus(message) {
  el.feedStatus.textContent = message || "";
  el.feedStatus.hidden = !message;
}

async function loadFeed() {
  // Show the last saved view instantly so the page is never blank on open.
  const cached = readFeedCache("open");
  if (cached) {
    renderFeed(cached);
  } else {
    el.feed.replaceChildren();
    setFeedStatus("Loading...");
  }
  try {
    const list = await fetchList("open");
    if (isCurrent("feed")) renderFeed(list);
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    const msg = isNetworkError(err)
      ? "Could not connect. Check your internet and try again."
      : "Could not load the requests. Try again in a moment.";
    setFeedStatus(cached ? `${msg} Showing your last saved view.` : msg);
  }
}

function renderFeed(requests) {
  stopCardVisibilityTracking();
  el.feed.replaceChildren();
  setTabDot("feed", requests.some((r) => r.isNew));
  el.prayBanner.hidden = !requests.some((r) => !r.isMine);
  renderFeedDescription(requests.length);

  if (requests.length === 0) {
    setFeedStatus("No active requests right now. A quiet week.");
    return;
  }
  setFeedStatus(null);

  // When the newest rows are new to you, a divider marks where you left off.
  const caughtUpAt = requests[0].isNew ? requests.findIndex((r) => !r.isNew) : -1;
  requests.forEach((req, i) => {
    if (i === caughtUpAt) el.feed.appendChild(caughtUpDivider());
    el.feed.appendChild(renderPost(req));
  });
  el.feed.appendChild(elem("li", "feed-end", "That's every active request. Closed ones live in the Prayer Log."));
  startCardVisibilityTracking(el.feed);
}

function caughtUpDivider() {
  const li = elem("li", "caught-up");
  li.setAttribute("role", "separator");
  li.appendChild(icon("check"));
  li.appendChild(elem("span", null, "You're caught up · earlier requests"));
  return li;
}

function renderFeedDescription(count) {
  if (!SHOW_FEED_COUNTS) {
    el.feedDescription.hidden = true;
    return;
  }
  el.feedDescription.textContent = plural(count, "active request", "active requests");
  el.feedDescription.hidden = false;
}

// One timeline row. The Prayer Log reuses it with its dates and closing note.
function renderPost(req, { inLog = false } = {}) {
  const li = elem("li", "post");
  li.dataset.id = req.id;
  li.dataset.newCardActivity = req.newCardActivity ? "1" : "0";
  const threadHref = `#/r/${req.id}`;

  li.appendChild(avatar(req.isMine ? state.member?.name || req.author : req.author, req.authorId));
  const main = elem("div", "post-main");

  const meta = elem("div", "post-meta");
  meta.appendChild(elem("span", "post-author", req.isMine ? "You" : req.author));
  const when = inLog && req.answeredAt
    ? `${shortDate(req.createdAt)} – ${shortDate(req.answeredAt)}`
    : relTime(req.createdAt);
  meta.appendChild(elem("span", "post-time", `· ${when}`));
  if (req.category && req.category !== "general") {
    meta.appendChild(elem("span", "chip", categoryLabel(req.category)));
  }
  if (req.isNew) {
    const dot = elem("span", "new-dot");
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "New to you");
    meta.appendChild(dot);
  }
  main.appendChild(meta);

  main.appendChild(link("post-title", req.title, threadHref));
  if (!inLog && req.snippet) main.appendChild(elem("p", "post-body", req.snippet));

  if (!inLog && req.latestUpdate) {
    const update = link("post-update", null, threadHref);
    update.appendChild(elem("span", "update-label", `Update · ${relTime(req.latestUpdate.createdAt)}`));
    update.appendChild(elem("span", "post-update-text", req.latestUpdate.snippet));
    main.appendChild(update);
  }
  if (inLog && req.answerNote) main.appendChild(closingNote(req));

  const note = replyNote(req);
  if (note) main.appendChild(note);

  if (inLog) {
    if (!req.isMine && req.hasViewerPrayed) {
      const mark = elem("p", "prayed-mark");
      mark.append(icon("check"), text("You prayed for this"));
      main.appendChild(mark);
    }
  } else if (req.isMine) {
    main.appendChild(prayedByLine(Array.isArray(req.prayerNames) ? req.prayerNames : []));
  } else {
    const actions = elem("div", "post-actions");
    const count = SHOW_PUBLIC_PRAYER_COUNTS
      ? elem("span", "post-time", prayerCountLabel(toCount(req.distinctPrayers), false))
      : null;
    actions.appendChild(prayButton(req, "pill", count));
    const replies = toCount(req.updateCount);
    const reply = link("ghost-pill", null, threadHref);
    reply.append(icon("chat"), text(replies ? plural(replies, "reply", "replies") : "Encourage"));
    actions.appendChild(reply);
    if (count) actions.appendChild(count);
    main.appendChild(actions);
  }

  li.appendChild(main);

  // The whole row opens the request; links and buttons inside keep their own job.
  li.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    location.hash = threadHref;
  });
  return li;
}

// ─────────────────────────── praying ───────────────────────────

// Once a member has prayed the button settles into a done state - one prayer
// signal per request, so nothing can be padded or counted up.
function prayButton(req, kind, countEl = null) {
  const btn = button(kind === "pill" ? "pray-pill" : "pray-big", null);
  setPrayState(btn, !!req.hasViewerPrayed, kind, req);
  btn.addEventListener("click", () => {
    if (btn.dataset.prayed === "1") return;
    onPray(req, btn, kind, countEl);
  });
  return btn;
}

function setPrayState(btn, prayed, kind, req) {
  btn.dataset.prayed = prayed ? "1" : "0";
  btn.setAttribute("aria-pressed", prayed ? "true" : "false");
  let label;
  if (kind === "pill") label = prayed ? "Prayed" : "Pray";
  else label = prayed ? `You prayed · ${req.author} will see your name` : "I prayed for this";
  btn.replaceChildren(icon(prayed ? "check" : "pray"), text(label));
}

async function onPray(req, btn, kind, countEl) {
  const previous = { hasViewerPrayed: req.hasViewerPrayed, distinctPrayers: req.distinctPrayers };
  req.hasViewerPrayed = true;
  if (SHOW_PUBLIC_PRAYER_COUNTS) req.distinctPrayers = toCount(req.distinctPrayers) + 1;
  setPrayState(btn, true, kind, req);
  if (countEl) countEl.textContent = prayerCountLabel(toCount(req.distinctPrayers), false);
  updateCachedRequest(req.id, (r) => { r.hasViewerPrayed = true; });

  try {
    const result = await api(`/requests/${req.id}/pray`, { method: "POST" });
    if (result.distinctPrayers != null) req.distinctPrayers = result.distinctPrayers;
    if (countEl) countEl.textContent = prayerCountLabel(toCount(req.distinctPrayers), false);
  } catch (err) {
    // Roll back so the member can try again.
    req.hasViewerPrayed = previous.hasViewerPrayed;
    req.distinctPrayers = previous.distinctPrayers;
    setPrayState(btn, !!req.hasViewerPrayed, kind, req);
    if (countEl) countEl.textContent = prayerCountLabel(toCount(req.distinctPrayers), false);
    updateCachedRequest(req.id, (r) => { r.hasViewerPrayed = !!previous.hasViewerPrayed; });
    if (err.status === 401) return handleExpiredSession();
    showToast("Could not record that just now. Try again in a moment.");
  }
}

// ─────────────────────── card impressions ───────────────────────

// Treat a post/log badge like a stable "new this visit" snapshot. Once at least
// half its row enters the viewport, persist the impression for the next load,
// but leave this render unchanged. Reply signals remain untouched.
let cardVisibilityObserver = null;
let cardSeenTimer = null;
const pendingCardSeen = new Set();
const inFlightCardSeen = new Set();

function stopCardVisibilityTracking() {
  cardVisibilityObserver?.disconnect();
  cardVisibilityObserver = null;
}

function startCardVisibilityTracking(container) {
  const rows = Array.from(container.querySelectorAll('li[data-new-card-activity="1"]'));
  if (rows.length === 0) return;

  if (!("IntersectionObserver" in window)) {
    for (const row of rows) queueCardSeen(row.dataset.id);
    return;
  }

  cardVisibilityObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      observer.unobserve(entry.target);
      queueCardSeen(entry.target.dataset.id);
    }
  }, { threshold: 0.5 });

  for (const row of rows) cardVisibilityObserver.observe(row);
}

function queueCardSeen(rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0 || inFlightCardSeen.has(id)) return;
  pendingCardSeen.add(id);
  if (cardSeenTimer == null) cardSeenTimer = window.setTimeout(flushCardSeen, 250);
}

async function flushCardSeen() {
  cardSeenTimer = null;
  const ids = [...pendingCardSeen];
  pendingCardSeen.clear();
  if (ids.length === 0) return;
  for (const id of ids) inFlightCardSeen.add(id);

  try {
    const result = await api("/requests/seen", { method: "POST", body: { ids } });
    for (const id of result.seen || []) cacheCardActivitySeen(id);
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    // A failed receipt should remain eligible when it enters the viewport again.
    for (const id of ids) {
      const row = document.querySelector(`li.post[data-id="${CSS.escape(String(id))}"]`);
      if (row?.dataset.newCardActivity === "1") cardVisibilityObserver?.observe(row);
    }
  } finally {
    for (const id of ids) inFlightCardSeen.delete(id);
  }
}

function cacheCardActivitySeen(id) {
  // Keep the current row and tab dot stable. Updating the cache prevents a
  // stale flash before the next server response arrives after a reload.
  updateCachedRequest(id, (req) => {
    req.newCardActivity = false;
    if (toCount(req.newComments) === 0) req.isNew = false;
  });
}

// Opening a request records a read receipt server-side, so drop its "new to
// you" state from the cached lists too.
function clearCachedHighlight(id) {
  updateCachedRequest(id, (req) => {
    req.isNew = false;
    req.newCardActivity = false;
    req.newComments = 0;
    req.newCommentAuthor = null;
  });
}

// ───────────────────────────── log ─────────────────────────────

function showLog() {
  const view = el.views.log;
  view.replaceChildren();

  const head = elem("header", "page-head");
  const titles = elem("div");
  titles.appendChild(elem("h1", "page-title", "Prayer Log"));
  titles.appendChild(elem("p", "page-lead", "Where our requests landed. Look back and give thanks."));
  head.appendChild(titles);

  const filter = elem("div", "segmented");
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "Show");
  const options = [["all", "Everyone"], ["mine", "Mine"]];
  for (const [value, label] of options) {
    const opt = button(null, label, () => {
      state.logFilter = value;
      for (const b of filter.children) b.setAttribute("aria-pressed", b === opt ? "true" : "false");
      renderLogList(list, status, readFeedCache("answered"));
    });
    opt.setAttribute("aria-pressed", state.logFilter === value ? "true" : "false");
    filter.appendChild(opt);
  }
  head.appendChild(filter);
  view.appendChild(head);

  const body = elem("div", "view-body");
  const status = elem("p", "feed-status");
  status.hidden = true;
  const list = elem("ul", "feed");
  body.append(status, list);
  view.appendChild(body);

  const cached = readFeedCache("answered");
  if (cached) renderLogList(list, status, cached);
  else {
    status.textContent = "Loading...";
    status.hidden = false;
  }

  fetchList("answered")
    .then((requests) => { if (isCurrent("log")) renderLogList(list, status, requests); })
    .catch((err) => {
      if (err.status === 401) return handleExpiredSession();
      if (!cached) {
        status.textContent = errorText(err, "Could not load the Prayer Log.");
        status.hidden = false;
      }
    });
}

function renderLogList(list, status, requests) {
  stopCardVisibilityTracking();
  list.replaceChildren();
  if (!requests) return;
  setTabDot("log", requests.some((r) => r.isNew));

  const shown = requests
    .filter((r) => state.logFilter !== "mine" || r.isMine)
    .sort((a, b) => (b.answeredAt || b.createdAt) - (a.answeredAt || a.createdAt));

  if (shown.length === 0) {
    status.textContent = state.logFilter === "mine"
      ? "None of your requests are in the Prayer Log yet."
      : "The Prayer Log is empty for now. Closed requests will gather here.";
    status.hidden = false;
    return;
  }
  status.hidden = true;

  let month = null;
  for (const req of shown) {
    const label = monthLabel(req.answeredAt || req.createdAt);
    if (label !== month) {
      const heading = elem("li", "month-head", label);
      heading.setAttribute("role", "presentation");
      list.appendChild(heading);
      month = label;
    }
    list.appendChild(renderPost(req, { inLog: true }));
  }
  startCardVisibilityTracking(list);
}

// ───────────────────────────── you ─────────────────────────────

function showYou() {
  const me = state.member;
  const view = el.views.you;
  view.replaceChildren();
  if (!me) return;
  const body = elem("div", "view-body");

  const profile = elem("header", "profile");
  profile.appendChild(avatar(me.name, me.id, "xl"));
  const who = elem("div", "profile-text");
  who.appendChild(elem("h1", "profile-name", me.name));
  const self = state.members?.find((m) => m.isSelf);
  const since = self?.joinedAt
    ? ` · member since ${new Date(self.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
    : "";
  who.appendChild(elem("p", "profile-sub", `${GROUP_NAME}${since}`));
  profile.appendChild(who);
  profile.appendChild(button("outline-pill", "Edit name", openEditName));
  body.appendChild(profile);

  body.appendChild(elem("h2", "group-head", "Your active requests"));
  const mine = elem("section", "box");
  body.appendChild(mine);
  const cached = readFeedCache("mine");
  renderMyRequests(mine, cached);
  fetchList("mine")
    .then((requests) => { if (isCurrent("you")) renderMyRequests(mine, requests); })
    .catch((err) => {
      if (err.status === 401) return handleExpiredSession();
      if (!cached) mine.replaceChildren(elem("p", "box-empty", errorText(err, "Could not load your requests.")));
    });

  body.appendChild(elem("h2", "group-head", "Appearance"));
  body.appendChild(themeControl());

  body.appendChild(elem("h2", "group-head", "Group"));
  const group = elem("nav", "box");
  group.setAttribute("aria-label", "Group");
  const membersRow = rowLink("people", "Group members", { href: "#/members" });
  if (state.members) {
    membersRow.querySelector(".chevron").before(elem("span", "row-link-value", String(state.members.length)));
  }
  group.appendChild(membersRow);
  body.appendChild(group);

  body.appendChild(elem("h2", "group-head", "App"));
  const app = elem("nav", "box");
  app.setAttribute("aria-label", "App");
  app.appendChild(rowLink("phone", "Add to Home Screen", { onClick: openHomeScreenHelp }));
  app.appendChild(rowLink("help", "How Cenacle works", { onClick: openHelp }));
  app.appendChild(rowLink("signout", "Sign out on this device", { onClick: openSignOut, danger: true }));
  body.appendChild(app);

  if (isAdmin()) {
    body.appendChild(elem("h2", "group-head", "Group admin"));
    const admin = elem("nav", "box");
    admin.setAttribute("aria-label", "Group admin");
    admin.appendChild(rowLink("mail", "Members & invites", { onClick: openAdminPanel }));
    admin.appendChild(rowLink("chart", "Group overview", { onClick: openStatsPanel }));
    body.appendChild(admin);
    body.appendChild(elem("p", "box-note", "Only admins see this section."));
  }

  const footer = elem("p", "you-footer");
  footer.appendChild(text("Cenacle is open source. "));
  const repo = link(null, "Run your own or contribute on GitHub.", "https://github.com/JustinSwain/cenacle");
  repo.target = "_blank";
  repo.rel = "noopener noreferrer";
  footer.appendChild(repo);
  body.appendChild(footer);

  view.appendChild(body);
}

function rowLink(iconName, label, { href, onClick, danger = false } = {}) {
  const node = href ? link("row-link", null, href) : button("row-link", null, onClick);
  if (danger) node.classList.add("is-danger");
  node.appendChild(icon(iconName));
  node.appendChild(elem("span", "row-link-label", label));
  if (!danger) node.appendChild(icon("chevron", "icon chevron"));
  return node;
}

function renderMyRequests(box, requests) {
  box.replaceChildren();
  if (!requests) {
    box.appendChild(elem("p", "box-empty", "Loading..."));
    return;
  }
  setTabDot("you", requests.some((r) => r.isNew));
  const open = requests.filter((r) => r.status === "open");
  if (open.length === 0) {
    const empty = elem("p", "box-empty", "You have no active requests. ");
    empty.appendChild(link("inline-link", "Share one", "#/new"));
    box.appendChild(empty);
    return;
  }
  for (const req of open) {
    const item = elem("div", "my-request");
    const head = elem("div", "my-request-head");
    head.appendChild(link(null, req.title, `#/r/${req.id}`));
    head.appendChild(elem("span", null, relTime(req.createdAt)));
    item.appendChild(head);
    item.appendChild(prayedByLine(Array.isArray(req.prayerNames) ? req.prayerNames : []));
    const note = replyNote(req);
    if (note) item.appendChild(note);
    const actions = elem("div", "modal-actions");
    actions.appendChild(link("btn-secondary btn-small", "Post update", `#/r/${req.id}`));
    actions.appendChild(button("btn-secondary btn-small", "Move to Log", () => openLogSheet(req, {
      onDone: () => { if (isCurrent("you")) showYou(); },
    })));
    item.appendChild(actions);
    box.appendChild(item);
  }
}

// ─────────────────────────────── theme ─────────────────────────────

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch { return null; }
}

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// The palette is the group's (set at deployment); each member only picks
// light, dark, or following the device.
function setThemeChoice(choice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch { /* ignore */ }
  applyTheme(choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice);
}

function themeControl() {
  const group = elem("div", "segmented in-you");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Light or dark");
  const current = storedTheme() || "system";
  for (const [value, label] of [["system", "System"], ["light", "Light"], ["dark", "Dark"]]) {
    const opt = button(null, label, () => {
      setThemeChoice(value);
      for (const b of group.children) b.setAttribute("aria-pressed", b === opt ? "true" : "false");
    });
    opt.setAttribute("aria-pressed", current === value ? "true" : "false");
    group.appendChild(opt);
  }
  return group;
}

function initTheme() {
  applyTheme(storedTheme() || (systemPrefersDark() ? "dark" : "light"));
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!storedTheme()) applyTheme(e.matches ? "dark" : "light");
    });
  }
}

// ─────────────────────────── members ───────────────────────────

async function loadMembers() {
  try {
    const data = await api("/members");
    state.members = Array.isArray(data.members) ? data.members : [];
    updateGroupSub();
  } catch (err) {
    if (err.status === 401) handleExpiredSession();
    throw err;
  }
  return state.members;
}

function updateGroupSub() {
  el.groupSub.replaceChildren(
    text(state.members ? plural(state.members.length, "member", "members") : "Group members"),
    icon("chevron"),
  );
}

function showMembers() {
  const view = el.views.members;
  view.replaceChildren(subBar("Group members"));
  const body = elem("div", "view-body");

  const hero = elem("section", "members-hero");
  hero.appendChild(elem("span", "group-mark", initialOf(GROUP_NAME)));
  hero.appendChild(elem("h2", null, GROUP_NAME));
  const count = elem("p", null, state.members ? plural(state.members.length, "member", "members") : "Loading...");
  hero.appendChild(count);
  body.appendChild(hero);

  const list = elem("ul", "member-list");
  body.appendChild(list);

  const privacy = elem("div", "privacy-note");
  const lock = elem("span", "privacy-icon");
  lock.appendChild(icon("lock"));
  privacy.appendChild(lock);
  privacy.appendChild(elem("strong", null, "Only people in this group have access to our prayer requests."));
  privacy.appendChild(elem("p", null,
    "New members join only by a personal invite from an admin. When someone leaves, their access ends right away."));
  if (isAdmin()) {
    const manage = button("btn-secondary", "Manage invites & roles", openAdminPanel);
    manage.style.marginTop = "8px";
    privacy.appendChild(manage);
  }
  body.appendChild(privacy);
  view.appendChild(body);

  const fill = () => {
    list.replaceChildren();
    for (const member of state.members || []) list.appendChild(memberRow(member));
    count.textContent = plural((state.members || []).length, "member", "members");
  };
  if (state.members) fill();
  loadMembers()
    .then(() => { if (isCurrent("members")) fill(); })
    .catch((err) => {
      if (!state.members && isCurrent("members")) count.textContent = errorText(err, "Could not load the members.");
    });
}

function memberRow(member) {
  const li = elem("li", "member-row");
  li.appendChild(avatar(member.name, member.id, "md"));
  const textCol = elem("span", "member-text");
  const nameRow = elem("span", "member-name-row");
  nameRow.appendChild(elem("span", "member-name", member.name));
  if (member.isSelf) nameRow.appendChild(elem("span", "member-you", "(you)"));
  if (member.role === "admin") nameRow.appendChild(elem("span", "tag-admin", "Admin"));
  textCol.appendChild(nameRow);
  if (member.joinedAt) {
    textCol.appendChild(elem("span", "member-joined",
      `Joined ${new Date(member.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`));
  }
  li.appendChild(textCol);
  return li;
}

// ───────────────────────────── thread ─────────────────────────────

async function showThread(id) {
  const view = el.views.thread;
  view.replaceChildren(subBar("Request"), elem("p", "modal-loading", "Loading..."));
  try {
    const data = await api(`/requests/${id}`);
    if (!isCurrent("thread", id)) return;
    renderThread(data.request);
    clearCachedHighlight(id);
    refreshTabDots();
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    if (!isCurrent("thread", id)) return;
    view.replaceChildren(subBar("Request"), elem("p", "modal-loading", err.status === 404
      ? "This request is no longer here. It may have been removed."
      : errorText(err, "Could not load this request.")));
  }
}

function renderThread(req, { draft = "" } = {}) {
  const view = el.views.thread;
  const logged = req.status === "answered";
  const canManage = req.isMine || isAdmin();
  const actions = canManage ? [iconButton("more", "Request options", () => openThreadMenu(req))] : [];
  view.replaceChildren(subBar(logged ? "Prayer Log" : "Request", { actions }));

  const body = elem("div", "view-body");
  const post = elem("article", "thread-post");

  const authorRow = elem("div", "author-row");
  authorRow.appendChild(avatar(req.author, req.authorId, "lg"));
  const who = elem("div");
  who.appendChild(elem("p", "author-name", req.isMine ? `${req.author} (you)` : req.author));
  let meta = req.category && req.category !== "general"
    ? `${categoryLabel(req.category)} · ${longDate(req.createdAt)}`
    : longDate(req.createdAt);
  if (req.editedAt) meta += " · edited";
  who.appendChild(elem("p", "author-meta", meta));
  authorRow.appendChild(who);
  post.appendChild(authorRow);

  post.appendChild(elem("h2", "thread-title", req.title));
  post.appendChild(elem("p", "thread-body", req.body));

  if (logged) {
    if (req.answerNote) post.appendChild(closingNote(req));
    if (req.answeredAt) post.appendChild(elem("p", "author-meta", `Moved to the Prayer Log on ${shortDate(req.answeredAt)}`));
  }

  if (req.isMine) {
    const names = (req.prayingMembers || []).map((m) => m.name);
    if (!logged || names.length) post.appendChild(prayedByLine(names));
    if (SHOW_PUBLIC_PRAYER_COUNTS) post.appendChild(elem("p", "author-meta", prayerCountLabel(toCount(req.distinctPrayers), true)));
  } else if (!logged) {
    const count = SHOW_PUBLIC_PRAYER_COUNTS
      ? elem("p", "author-meta", prayerCountLabel(toCount(req.distinctPrayers), false))
      : null;
    post.appendChild(prayButton(req, "big", count));
    if (count) post.appendChild(count);
  } else if (req.hasViewerPrayed) {
    const mark = elem("p", "prayed-mark");
    mark.append(icon("check"), text("You prayed for this"));
    post.appendChild(mark);
  }
  body.appendChild(post);

  body.appendChild(elem("h3", "section-head", "Updates & encouragement"));
  const updates = req.updates || [];
  if (updates.length === 0) {
    body.appendChild(elem("p", "empty-replies", req.isMine
      ? "No updates yet. Share how things are going whenever you're ready."
      : "No replies yet. A word of encouragement goes a long way."));
  } else {
    const list = elem("ol", "replies");
    for (const u of updates) list.appendChild(renderReply(u, req));
    body.appendChild(list);
  }
  view.appendChild(body);

  // Anyone can reply while a request is active; once logged, only the author.
  if (req.status === "open" || (logged && req.isMine)) view.appendChild(renderComposer(req, draft));
}

function renderReply(update, req) {
  const li = elem("li", "reply");
  const rail = elem("div", "reply-rail");
  rail.appendChild(avatar(update.author, update.authorId, "md"));
  li.appendChild(rail);
  const main = elem("div", "reply-main");
  const meta = elem("div", "reply-meta");
  meta.appendChild(elem("span", "post-author", update.author));
  if (update.authorId === req.authorId) meta.appendChild(elem("span", "tag-update", "Update"));
  meta.appendChild(elem("span", "post-time", `· ${relTime(update.createdAt)}`));
  main.appendChild(meta);
  main.appendChild(elem("p", "reply-body", update.body));
  li.appendChild(main);
  return li;
}

function renderComposer(req, draft) {
  const form = elem("form", "composer");
  const label = elem("label", "visually-hidden", req.isMine ? "Share an update" : "Write an encouragement");
  label.htmlFor = "reply-field";
  const field = elem("textarea");
  field.id = "reply-field";
  field.rows = 1;
  field.maxLength = 2000;
  field.placeholder = req.isMine ? "Share an update..." : "Write an encouragement...";
  field.value = draft;
  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  };
  field.addEventListener("input", grow);

  const send = button("send-btn", null);
  send.type = "submit";
  send.setAttribute("aria-label", "Send");
  send.appendChild(icon("arrow"));
  form.append(label, field, send);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    send.disabled = true;
    try {
      const data = await api(`/requests/${req.id}/update`, { method: "POST", body: { body: value } });
      if (!isCurrent("thread", req.id)) return;
      renderThread(data.request);
      window.scrollTo(0, document.body.scrollHeight);
    } catch (err) {
      if (err.status === 401) return handleExpiredSession();
      showToast(errorText(err, "Could not post that. Try again."));
      send.disabled = false;
    }
  });
  return form;
}

function openThreadMenu(req) {
  openModal((modal) => {
    modalHeader(modal, "Request options");
    const menu = elem("div", "menu-list");
    if (req.isMine && req.status === "open") {
      const edit = button("menu-item", null, () => { location.hash = `#/edit/${req.id}`; });
      edit.append(icon("edit"), text("Edit request"));
      menu.appendChild(edit);
      const move = button("menu-item", null, () => openLogSheet(req));
      move.append(icon("book"), text("Move to Prayer Log"));
      menu.appendChild(move);
    }
    const remove = button("menu-item is-danger", null, () => openRemoveConfirm(req, { admin: !req.isMine }));
    remove.append(icon("trash"), text(req.isMine ? "Remove request" : "Remove for everyone (admin)"));
    menu.appendChild(remove);
    modal.appendChild(menu);
  });
}

// Moving to the Prayer Log takes an optional closing note: a final update, a
// praise report, or why it no longer needs to stay active.
function openLogSheet(req, { onDone } = {}) {
  const build = (modal) => {
    modalHeader(modal, "Move to Prayer Log?");
    modal.appendChild(elem("p", "sheet-text",
      `"${req.title}" will leave Active and stay readable in the Prayer Log, where the group can look back on it.`));
    const form = elem("form", "stack");
    const note = elem("textarea", "field-input field-textarea");
    note.maxLength = 2000;
    note.rows = 3;
    note.placeholder = "A final update, praise report, or why it is closing";
    form.appendChild(labeled("Closing note (optional)", note));
    const errLine = elem("p", "form-error");
    errLine.hidden = true;
    form.appendChild(errLine);
    const actions = elem("div", "modal-actions");
    actions.appendChild(button("btn-secondary", "Cancel", closeModal));
    const confirm = elem("button", "btn-primary", "Move to Log");
    confirm.type = "submit";
    actions.appendChild(confirm);
    form.appendChild(actions);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      confirm.disabled = true;
      try {
        const data = await api(`/requests/${req.id}/answer`, {
          method: "POST",
          body: { answerNote: note.value.trim() },
        });
        closeModal();
        showToast("Moved to the Prayer Log.");
        if (onDone) onDone(data.request);
        else if (isCurrent("thread", req.id)) renderThread(data.request);
      } catch (err) {
        if (err.status === 401) { closeModal(); return handleExpiredSession(); }
        showFormError(errLine, errorText(err, "Could not move that. Try again."));
        confirm.disabled = false;
      }
    });
    modal.appendChild(form);
  };
  if (el.backdrop.hidden) openModal(build);
  else renderModalContent(build);
}

function openRemoveConfirm(req, { admin = false } = {}) {
  renderModalContent((modal) => {
    modalHeader(modal, "Remove request?");
    modal.appendChild(elem("p", "sheet-text", admin
      ? `Remove "${req.title}" from everyone's feed?`
      : `Remove "${req.title}" from the group?`));
    modal.appendChild(elem("p", "sheet-note", "It will disappear from every feed. An admin can restore it later."));
    const errLine = elem("p", "form-error");
    errLine.hidden = true;
    modal.appendChild(errLine);
    const actions = elem("div", "modal-actions");
    actions.appendChild(button("btn-secondary", "Cancel", closeModal));
    const confirm = button("btn-danger", "Remove", async () => {
      confirm.disabled = true;
      try {
        await api(`/requests/${req.id}/archive`, { method: "POST" });
        closeModal();
        showToast("Request removed.");
        goBack();
      } catch (err) {
        if (err.status === 401) { closeModal(); return handleExpiredSession(); }
        showFormError(errLine, errorText(err, "Could not remove that. Try again."));
        confirm.disabled = false;
      }
    });
    actions.appendChild(confirm);
    modal.appendChild(actions);
  });
}

// ───────────────────────────── compose ─────────────────────────────

async function showCompose(editId) {
  const view = el.views.compose;
  if (!editId) {
    renderCompose(view, {});
    return;
  }
  view.replaceChildren(subBar("Edit request"), elem("p", "modal-loading", "Loading..."));
  try {
    const data = await api(`/requests/${editId}`);
    if (!isCurrent("compose")) return;
    const req = data.request;
    if (!req.isMine || req.status !== "open") {
      view.replaceChildren(subBar("Edit request"), elem("p", "modal-loading",
        "Only the author can edit an active request. Add an update instead."));
      return;
    }
    renderCompose(view, { editId, initial: req });
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    view.replaceChildren(subBar("Edit request"), elem("p", "modal-loading", errorText(err, "Could not load this request.")));
  }
}

function renderCompose(view, { editId = null, initial = {} }) {
  view.replaceChildren();
  const formId = "compose-form";

  const bar = elem("header", "sub-bar compose-bar");
  bar.appendChild(button("text-btn", "Cancel", () => goBack()));
  bar.appendChild(elem("h1", "sub-title", editId ? "Edit request" : "New request"));
  const submit = elem("button", "pill-btn", editId ? "Save" : "Share");
  submit.type = "submit";
  submit.setAttribute("form", formId);
  bar.appendChild(submit);
  view.appendChild(bar);

  const form = elem("form", "compose-form");
  form.id = formId;

  const row = elem("div", "compose-row");
  row.appendChild(avatar(state.member?.name, state.member?.id));
  const fields = elem("div", "compose-fields");
  const titleLabel = elem("label", "visually-hidden", "Title");
  titleLabel.htmlFor = "compose-title";
  const title = elem("input", "compose-title");
  title.id = "compose-title";
  title.type = "text";
  title.maxLength = 120;
  title.required = true;
  title.placeholder = "What can we pray for?";
  title.value = initial.title || "";
  const bodyLabel = elem("label", "visually-hidden", "Details");
  bodyLabel.htmlFor = "compose-body";
  const body = elem("textarea", "compose-body");
  body.id = "compose-body";
  body.rows = 6;
  body.maxLength = 4000;
  body.required = true;
  body.placeholder = "Share as much or as little as you'd like...";
  body.value = initial.body || "";
  fields.append(titleLabel, title, bodyLabel, body);
  row.appendChild(fields);
  form.appendChild(row);

  let category = initial.category && initial.category !== "general" ? initial.category : "general";
  const topics = elem("fieldset", "topic-set");
  topics.appendChild(elem("legend", null, "Topic · optional"));
  const chips = elem("div", "topic-chips");
  for (const topic of TOPICS) {
    const chip = button("topic-chip", topic.label, () => {
      category = category === topic.value ? "general" : topic.value;
      for (const c of chips.children) c.setAttribute("aria-pressed", c === chip && category !== "general" ? "true" : "false");
    });
    chip.setAttribute("aria-pressed", category === topic.value ? "true" : "false");
    chips.appendChild(chip);
  }
  topics.appendChild(chips);
  form.appendChild(topics);

  if (!editId) {
    const info = elem("div", "info-box");
    const who = elem("div", "info-row");
    who.appendChild(icon("lock"));
    const whoText = elem("span");
    whoText.appendChild(text("Only the "));
    whoText.appendChild(link("inline-link", state.members
      ? `${plural(state.members.length, "member", "members")} of ${GROUP_NAME}`
      : `members of ${GROUP_NAME}`, "#/members"));
    whoText.appendChild(text(" can see this."));
    who.appendChild(whoText);
    info.appendChild(who);
    const later = elem("div", "info-row");
    later.appendChild(icon("book"));
    later.appendChild(elem("span", null,
      "Post updates as things change. When it's resolved, move it to the Prayer Log with a closing note."));
    info.appendChild(later);
    form.appendChild(info);
  }

  const errLine = elem("p", "form-error");
  errLine.hidden = true;
  form.appendChild(errLine);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = { title: title.value.trim(), body: body.value.trim(), category };
    if (!payload.title || !payload.body) {
      showFormError(errLine, "Please add a title and a few words.");
      return;
    }
    submit.disabled = true;
    try {
      const data = editId
        ? await api(`/requests/${editId}/edit`, { method: "POST", body: payload })
        : await api("/requests", { method: "POST", body: payload });
      // Replace the composer in history so Back from the request skips it.
      location.replace(`#/r/${data.request.id}`);
    } catch (err) {
      if (err.status === 401) return handleExpiredSession();
      showFormError(errLine, errorText(err, "Could not save that. Try again."));
      submit.disabled = false;
    }
  });

  view.appendChild(form);
  if (!editId) title.focus();
}

// ─────────────────────────── prayer time ───────────────────────────

// Prayer time walks through others' active requests one at a time. "Amen"
// records a prayer (once per request, as everywhere); "Skip" only moves on.
async function showPray() {
  const cached = readFeedCache("open");
  if (cached) startPrayQueue(cached);
  else renderPrayMessage("Loading...");
  try {
    const list = await fetchList("open");
    // Rebuild only if the member has not started yet, so a refresh never
    // yanks the request they are praying over.
    if (isCurrent("pray") && (!cached || state.pray?.index === 0)) startPrayQueue(list);
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    if (!cached && isCurrent("pray")) renderPrayMessage(errorText(err, "Could not load the requests."));
  }
}

function startPrayQueue(list) {
  const queue = list.filter((r) => !r.isMine && r.status === "open");
  // Requests you have not prayed for yet come first; otherwise feed order.
  queue.sort((a, b) => Number(!!a.hasViewerPrayed) - Number(!!b.hasViewerPrayed));
  state.pray = { queue, index: 0 };
  renderPray();
}

function prayHead(subtitle) {
  const head = elem("header", "pray-head");
  const titles = elem("div", "pray-head-text");
  titles.appendChild(elem("h1", "sub-title", "Prayer time"));
  titles.appendChild(elem("p", "author-meta", subtitle));
  head.appendChild(titles);
  head.appendChild(iconButton("close", "End prayer time", () => goBack()));
  return head;
}

function renderPrayMessage(message) {
  el.views.pray.replaceChildren(prayHead(""), elem("p", "modal-loading", message));
}

function renderPray() {
  const view = el.views.pray;
  const { queue, index } = state.pray;
  const done = index >= queue.length;
  view.replaceChildren();

  if (queue.length === 0) {
    view.appendChild(prayHead("Nothing to pray through"));
    view.appendChild(prayDone("There are no requests from others right now.",
      "Check back soon, or share one of your own."));
    return;
  }

  view.appendChild(prayHead(done ? "All done" : `${index + 1} of ${plural(queue.length, "active request", "active requests")}`));
  if (queue.length <= 12) {
    const progress = elem("div", "pray-progress");
    progress.setAttribute("aria-hidden", "true");
    queue.forEach((_, i) => {
      progress.appendChild(elem("span", i < index ? "is-done" : (i === index ? "is-current" : null)));
    });
    view.appendChild(progress);
  }

  if (done) {
    view.appendChild(prayDone("You've prayed through every active request", "“Pray without ceasing.”\n1 Thessalonians 5:17"));
    return;
  }

  const req = queue[index];
  const stage = elem("div", "pray-stage");
  const card = elem("article", "pray-card");
  const authorRow = elem("div", "author-row");
  authorRow.appendChild(avatar(req.author, req.authorId, "lg"));
  const who = elem("div");
  who.appendChild(elem("p", "author-name", req.author));
  const cat = req.category && req.category !== "general" ? `${categoryLabel(req.category)} · ` : "";
  who.appendChild(elem("p", "author-meta", `${cat}${relTime(req.createdAt)}`));
  authorRow.appendChild(who);
  card.appendChild(authorRow);
  card.appendChild(elem("h2", "pray-card-title", req.title));
  const bodyText = elem("p", "pray-card-body", req.body || req.snippet);
  card.appendChild(bodyText);
  if (req.latestUpdate) {
    const update = elem("div", "post-update");
    update.appendChild(elem("span", "update-label", "Latest update"));
    update.appendChild(elem("span", "post-update-text", req.latestUpdate.snippet));
    card.appendChild(update);
  }
  stage.appendChild(card);

  const actions = elem("div", "pray-actions");
  const amen = button("pray-big", null, () => {
    if (!req.hasViewerPrayed) prayInBackground(req);
    state.pray.index += 1;
    renderPray();
  });
  amen.append(text("Amen · next"), icon("arrow"));
  actions.appendChild(amen);
  actions.appendChild(button("text-btn", "Skip for now", () => {
    state.pray.index += 1;
    renderPray();
  }));
  stage.appendChild(actions);
  view.appendChild(stage);

  // The feed carries only a snippet; fetch the full request for the card.
  if (!req.body) {
    api(`/requests/${req.id}`).then((data) => {
      req.body = data.request.body;
      clearCachedHighlight(req.id);
      if (isCurrent("pray") && state.pray.queue[state.pray.index] === req) bodyText.textContent = req.body;
    }).catch(() => { /* the snippet stays */ });
  }
}

async function prayInBackground(req) {
  req.hasViewerPrayed = true;
  updateCachedRequest(req.id, (r) => { r.hasViewerPrayed = true; });
  try {
    await api(`/requests/${req.id}/pray`, { method: "POST" });
  } catch (err) {
    req.hasViewerPrayed = false;
    updateCachedRequest(req.id, (r) => { r.hasViewerPrayed = false; });
    if (err.status === 401) return handleExpiredSession();
    showToast(`Could not record your prayer for "${req.title}".`);
  }
}

function prayDone(heading, note) {
  const done = elem("div", "pray-done");
  const mark = elem("span", "pray-done-icon");
  mark.appendChild(icon("pray"));
  done.appendChild(mark);
  done.appendChild(elem("h2", null, heading));
  const p = elem("p", null, note);
  p.style.whiteSpace = "pre-line";
  done.appendChild(p);
  const actions = elem("div", "pray-done-actions");
  actions.appendChild(link("pray-big", "Back to requests", "#/"));
  if (state.pray?.queue.length) {
    actions.appendChild(button("text-btn", "Start over", () => {
      state.pray.index = 0;
      renderPray();
    }));
  }
  done.appendChild(actions);
  return done;
}

// ───────────────────────────── sheets ─────────────────────────────

let lastFocused = null;

function openModal(buildContent) {
  lastFocused = document.activeElement;
  el.modal.replaceChildren();
  buildContent(el.modal);
  el.backdrop.hidden = false;
  document.body.classList.add("modal-open");
  const focusable = el.modal.querySelector("input, textarea, select, button");
  if (focusable) focusable.focus();
}

function closeModal({ restoreFocus = true } = {}) {
  el.backdrop.hidden = true;
  el.modal.replaceChildren();
  document.body.classList.remove("modal-open");
  if (restoreFocus && lastFocused && lastFocused.focus && document.contains(lastFocused)) lastFocused.focus();
}

// Swap the contents of an already-open sheet (used for multi-step flows) without
// disturbing the saved focus target that closeModal restores.
function renderModalContent(buildContent) {
  el.modal.replaceChildren();
  buildContent(el.modal);
  const focusable = el.modal.querySelector("input, textarea, select, button");
  if (focusable) focusable.focus();
}

el.backdrop.addEventListener("click", (e) => {
  if (e.target === el.backdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.backdrop.hidden) closeModal();
});

function modalHeader(parent, titleText) {
  const header = elem("div", "modal-head");
  const h = elem("h2", "modal-title", titleText);
  h.id = "modal-title";
  header.appendChild(h);
  header.appendChild(iconButton("close", "Close", () => closeModal(), "modal-close"));
  parent.appendChild(header);
}

function openEditName() {
  openModal((modal) => {
    modalHeader(modal, "Your name");
    const form = elem("form", "stack");
    const field = elem("input", "field-input");
    field.type = "text";
    field.maxLength = 40;
    field.required = true;
    field.value = state.member?.name || "";
    form.appendChild(labeled("How your name appears to the group", field));
    const errLine = elem("p", "form-error");
    errLine.hidden = true;
    form.appendChild(errLine);
    const actions = elem("div", "modal-actions");
    actions.appendChild(button("btn-secondary", "Cancel", closeModal));
    const save = elem("button", "btn-primary", "Save");
    save.type = "submit";
    actions.appendChild(save);
    form.appendChild(actions);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = field.value.trim();
      if (!name) return showFormError(errLine, "Please enter a name.");
      save.disabled = true;
      try {
        await updateName(name);
        closeModal();
        loadMembers().catch(() => {});
        if (isCurrent("you")) showYou();
      } catch (err) {
        if (err.status === 401) { closeModal(); return handleExpiredSession(); }
        showFormError(errLine, errorText(err, "Could not save your name."));
        save.disabled = false;
      }
    });
    modal.appendChild(form);
  });
}

// Sign-out is deliberately behind a confirmation so a less-technical member
// cannot tap it by accident and lock themselves out.
function openSignOut() {
  openModal((modal) => {
    modalHeader(modal, "Sign out?");
    modal.appendChild(elem("p", "sheet-text",
      "Sign out on this device? You will need your personal link or code to get back in."));
    const actions = elem("div", "modal-actions");
    actions.appendChild(button("btn-secondary", "Cancel", closeModal));
    actions.appendChild(button("btn-danger", "Sign out", () => {
      clearSession();
      closeModal({ restoreFocus: false });
      history.replaceState(null, "", location.pathname);
      showGate();
    }));
    modal.appendChild(actions);
  });
}

// ─────────────────────── onboarding + help ───────────────────────

function isOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === "1"; }
  catch { return false; }
}

function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* ignore */ }
}

// True when running as an installed app (iOS adds it to the home screen;
// Android/desktop install it). iOS gives the installed app a SEPARATE storage
// jar from Safari, so the session and the "onboarded" flag never carry over.
function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
         window.navigator.standalone === true;
}

// Show the welcome flow once per device. Mark onboarded up front so skipping
// (Escape / backdrop / close) does not make it reappear on the next open.
function maybeShowOnboarding() {
  if (isOnboarded()) return;
  markOnboarded();
  // In the installed app the person has already seen this flow in the browser
  // before adding it to their home screen. iOS replays it only because the app
  // has its own empty storage; skip it so opening the app doesn't feel like
  // "starting over".
  if (isStandalone()) return;
  openOnboarding();
}

function howItWorksList() {
  const ul = elem("ul", "info-list");
  const points = [
    "Share a request and the group can pray over it.",
    "Tap Pray to let someone know you are lifting them up. Only they see your name.",
    "Use Prayer time to pray through each active request, one at a time.",
    "Post updates, and move a request to the Prayer Log with a closing note.",
    "Your requests, prayers, and updates stay inside this group.",
  ];
  for (const p of points) ul.appendChild(elem("li", null, p));
  return ul;
}

// Screenshot placeholder: hides itself if the image file is not present yet,
// so the text steps stand on their own until real screenshots are added.
function screenshotSlot(src, altText) {
  const img = document.createElement("img");
  img.className = "screenshot";
  img.src = src;
  img.alt = altText;
  img.loading = "lazy";
  img.addEventListener("error", () => { img.hidden = true; });
  return img;
}

// Shows the member's code with a one-tap Copy button so they can paste it into
// the installed app on first launch. The code is the only credential, so it is
// shown only inside the authenticated onboarding flow, never on the public gate.
function codeCopyBlock(code) {
  const box = elem("div", "code-copy");
  box.appendChild(elem("span", "code-copy-label", "Your code"));
  box.appendChild(elem("code", "code-copy-value", code));
  const btn = button("btn-secondary code-copy-btn", "Copy", async () => {
    const ok = await copyTextValue(code);
    btn.textContent = ok ? "Copied" : "Select and copy";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
  box.appendChild(btn);
  return box;
}

function addToHomeBlock(alreadyInstalledNote = false) {
  const wrap = elem("div", "home-help");
  wrap.appendChild(elem("p", "info-lead",
    `Add ${GROUP_NAME} to your home screen so you can open it in one tap.`));
  if (!alreadyInstalledNote) {
    wrap.appendChild(elem("p", "info-note",
      "On iPhone the home-screen app asks for your code the first time you open " +
      "it. Copy your code now, then paste it once there — after that you'll " +
      "stay signed in."));
  }
  if (lastCode) wrap.appendChild(codeCopyBlock(lastCode));

  const ios = elem("div", "home-steps");
  ios.appendChild(elem("h4", "home-os", "iPhone or iPad (Safari)"));
  const iosOl = elem("ol", "info-list");
  iosOl.appendChild(elem("li", null, "Tap the Share button (the square with an up arrow)."));
  iosOl.appendChild(elem("li", null, "Scroll down and tap Add to Home Screen."));
  iosOl.appendChild(elem("li", null, `Tap Add. A ${GROUP_NAME} icon appears on your home screen.`));
  ios.appendChild(iosOl);
  ios.appendChild(screenshotSlot("screenshots/ios-add-home.png",
    "iPhone: tap Share, then Add to Home Screen."));
  wrap.appendChild(ios);

  const android = elem("div", "home-steps");
  android.appendChild(elem("h4", "home-os", "Android (Chrome)"));
  const andOl = elem("ol", "info-list");
  andOl.appendChild(elem("li", null, "Tap the menu (three dots, top right)."));
  andOl.appendChild(elem("li", null, "Tap Add to Home screen (or Install app)."));
  andOl.appendChild(elem("li", null, `Tap Add. A ${GROUP_NAME} icon appears on your home screen.`));
  android.appendChild(andOl);
  android.appendChild(screenshotSlot("screenshots/android-add-home.png",
    "Android: open the menu, then Add to Home screen."));
  wrap.appendChild(android);

  return wrap;
}

function openOnboarding() {
  const steps = [stepWelcome, stepHowItWorks, stepAddHome];
  let i = 0;
  const ctx = {
    next() {
      i += 1;
      if (i < steps.length) renderModalContent((m) => steps[i](m, ctx));
      else closeModal();
    },
    finish: () => closeModal(),
  };
  openModal((m) => steps[0](m, ctx));
}

function stepWelcome(modal, ctx) {
  modalHeader(modal, `Welcome to ${GROUP_NAME}`);
  modal.appendChild(elem("p", "info-lead",
    "This is a private space for our group. First, how would you like your name shown to everyone?"));

  const form = elem("form", "stack");
  const nameField = elem("input", "field-input");
  nameField.type = "text";
  nameField.maxLength = 40;
  nameField.value = state.member ? state.member.name : "";
  nameField.required = true;
  form.appendChild(labeled("Your name", nameField));

  const actions = elem("div", "modal-actions");
  const next = elem("button", "btn-primary", "Looks good");
  next.type = "submit";
  actions.appendChild(next);
  form.appendChild(actions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameField.value.trim();
    if (!name) return;
    next.disabled = true;
    try {
      if (state.member && name !== state.member.name) await updateName(name);
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      // Saving the name is best-effort; continue onboarding regardless.
    }
    ctx.next();
  });

  modal.appendChild(form);
}

function stepHowItWorks(modal, ctx) {
  modalHeader(modal, "How this works");
  modal.appendChild(howItWorksList());
  const actions = elem("div", "modal-actions");
  actions.appendChild(button("btn-primary", "Next", ctx.next));
  modal.appendChild(actions);
}

function stepAddHome(modal, ctx) {
  modalHeader(modal, "Open it like an app");
  modal.appendChild(addToHomeBlock());
  const actions = elem("div", "modal-actions");
  actions.appendChild(button("btn-primary", "Done", ctx.finish));
  modal.appendChild(actions);
}

function openHomeScreenHelp() {
  openModal((modal) => {
    modalHeader(modal, "Open it like an app");
    modal.appendChild(addToHomeBlock(true));
  });
}

function openHelp() {
  openModal((modal) => {
    modalHeader(modal, "How Cenacle works");

    const how = elem("section", "help-section");
    how.appendChild(howItWorksList());
    modal.appendChild(how);

    const about = elem("section", "help-section");
    about.appendChild(elem("h3", "help-heading", "Privacy"));
    about.appendChild(elem("p", "help-note",
      `Only members of ${GROUP_NAME} can sign in. This app is hosted on a personal Cloudflare account, so share only what you are comfortable storing there.`));
    modal.appendChild(about);
  });
}

// ─────────────────────────────── admin ─────────────────────────────

function openAdminPanel() {
  if (!isAdmin()) return;
  openModal((modal) => {
    modalHeader(modal, "Members & invites");
    modal.appendChild(elem("p", "modal-loading", "Loading members..."));
  });
  void loadAdminPanel();
}

async function loadAdminPanel(inviteResult = null) {
  try {
    const data = await api("/admin/members");
    renderModalContent((modal) => renderAdminPanel(modal, data, inviteResult));
    loadMembers().catch(() => {});
  } catch (err) {
    if (err.status === 401) { closeModal(); return handleExpiredSession(); }
    renderModalContent((modal) => {
      modalHeader(modal, "Members & invites");
      modal.appendChild(elem("p", "modal-loading", errorText(err, "Could not load members.")));
    });
  }
}

function renderAdminPanel(modal, data, inviteResult) {
  modalHeader(modal, "Members & invites");
  const wrap = elem("div", "admin-dashboard");
  wrap.appendChild(elem("p", "admin-lead",
    "Manage routine access here. Deployment, secrets, migrations, and backups stay in Cloudflare and the CLI."));

  if (inviteResult) wrap.appendChild(renderAdminInvite(inviteResult));
  wrap.appendChild(renderAddMemberForm());

  const membersSection = elem("section", "admin-section");
  membersSection.appendChild(elem("h3", "admin-heading", "Members"));
  const members = Array.isArray(data.members) ? data.members : [];
  const list = elem("div", "admin-member-list");
  for (const member of members) list.appendChild(renderAdminMember(member));
  membersSection.appendChild(list);
  wrap.appendChild(membersSection);

  const audit = Array.isArray(data.audit) ? data.audit : [];
  if (audit.length) wrap.appendChild(renderAdminAudit(audit));
  modal.appendChild(wrap);
}

function renderAddMemberForm() {
  const section = elem("section", "admin-section admin-add-member");
  section.appendChild(elem("h3", "admin-heading", "Add a member"));
  const form = elem("form", "admin-add-form");
  const name = elem("input", "field-input");
  name.type = "text";
  name.maxLength = 40;
  name.placeholder = "Name";
  name.required = true;
  form.appendChild(labeled("Name", name));

  const roleRow = elem("label", "checkbox-row");
  const role = document.createElement("input");
  role.type = "checkbox";
  roleRow.appendChild(role);
  roleRow.appendChild(text("Make this person an administrator"));
  form.appendChild(roleRow);

  const error = elem("p", "form-error");
  error.hidden = true;
  form.appendChild(error);
  const actions = elem("div", "modal-actions");
  const submit = elem("button", "btn-primary", "Create invite");
  submit.type = "submit";
  actions.appendChild(submit);
  form.appendChild(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberName = name.value.trim();
    if (!memberName) return showFormError(error, "Please enter a name.");
    submit.disabled = true;
    try {
      const result = await api("/admin/members", {
        method: "POST",
        body: { name: memberName, role: role.checked ? "admin" : "member" },
      });
      await loadAdminPanel({ name: result.member.name, ...result.invite });
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      showFormError(error, errorText(err, "Could not create that invite."));
      submit.disabled = false;
    }
  });

  section.appendChild(form);
  return section;
}

function renderAdminInvite(invite) {
  const box = elem("section", "admin-invite");
  box.setAttribute("role", "status");
  box.appendChild(elem("h3", "admin-invite-title", `Invite for ${invite.name}`));
  box.appendChild(elem("p", "admin-invite-note",
    "Copy this now. Cenacle stores only its hash and cannot show this code again."));
  box.appendChild(elem("code", "admin-invite-code", invite.code));
  const actions = elem("div", "admin-invite-actions");
  actions.appendChild(adminCopyButton(invite.code, "Copy code"));
  actions.appendChild(adminCopyButton(invite.url, "Copy invite link"));
  box.appendChild(actions);
  return box;
}

function adminCopyButton(value, label) {
  const btn = button("btn-secondary btn-small", label, async () => {
    const copied = await copyTextValue(value);
    btn.textContent = copied ? "Copied" : "Select and copy";
    setTimeout(() => { btn.textContent = label; }, 2000);
  });
  return btn;
}

async function copyTextValue(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* use the selection fallback below */ }

  const temporary = elem("textarea", "copy-fallback");
  temporary.value = value;
  temporary.setAttribute("readonly", "");
  document.body.appendChild(temporary);
  temporary.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  temporary.remove();
  return copied;
}

function renderAdminMember(member) {
  const card = elem("article", member.active ? "admin-member" : "admin-member admin-member-revoked");
  const header = elem("div", "admin-member-head");
  header.appendChild(elem("h4", "admin-member-name", member.name));
  const badges = elem("div", "admin-member-badges");
  if (member.role === "admin") badges.appendChild(elem("span", "admin-badge", "Admin"));
  if (!member.active) badges.appendChild(elem("span", "admin-badge admin-badge-revoked", "Revoked"));
  if (member.isSelf) badges.appendChild(elem("span", "admin-badge admin-badge-self", "You"));
  header.appendChild(badges);
  card.appendChild(header);

  const joined = new Date(member.joinedAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  const activity = member.lastSeenAt
    ? `Last opened ${shortDate(member.lastSeenAt)}`
    : "Never signed in";
  const requests = plural(toCount(member.requestCount), "request", "requests");
  card.appendChild(elem("p", "admin-member-meta", `Joined ${joined} - ${activity} - ${requests}`));

  if (member.isSelf) {
    card.appendChild(elem("p", "admin-member-self-note",
      "Ask another administrator to change your role or reset your access."));
    return card;
  }

  const actions = elem("div", "admin-member-actions");
  const reissueLabel = member.active ? "New invite" : "Restore with new invite";
  actions.appendChild(button("btn-secondary btn-small", reissueLabel, () => showAdminConfirmation(card, actions, {
    message: member.active
      ? `Issue ${member.name} a new invite? Their old link and every current session will stop working.`
      : `Restore ${member.name}'s access with a fresh invite?`,
    label: reissueLabel,
    onConfirm: async () => {
      const result = await api(`/admin/members/${member.id}/reissue`, { method: "POST" });
      await loadAdminPanel({ name: result.member.name, ...result.invite });
    },
  })));

  const nextRole = member.role === "admin" ? "member" : "admin";
  const roleLabel = member.role === "admin" ? "Make member" : "Make admin";
  actions.appendChild(button("btn-secondary btn-small", roleLabel, () => showAdminConfirmation(card, actions, {
    message: `${roleLabel} for ${member.name}?`,
    label: roleLabel,
    onConfirm: async () => {
      await api(`/admin/members/${member.id}/role`, { method: "POST", body: { role: nextRole } });
      await loadAdminPanel();
    },
  })));

  if (member.active) {
    actions.appendChild(button("btn-danger btn-small", "Revoke access", () => showAdminConfirmation(card, actions, {
      message: `Revoke ${member.name}'s access? Their invite and every current session will stop working immediately. Their posts will remain.`,
      label: "Revoke access",
      danger: true,
      onConfirm: async () => {
        await api(`/admin/members/${member.id}/revoke`, { method: "POST" });
        await loadAdminPanel();
      },
    })));
  }
  card.appendChild(actions);
  return card;
}

function showAdminConfirmation(card, actions, options) {
  actions.hidden = true;
  const box = elem("div", options.danger ? "confirm-box" : "admin-confirm");
  box.appendChild(elem("p", options.danger ? "confirm-text" : "admin-confirm-text", options.message));
  const error = elem("p", "form-error");
  error.hidden = true;
  box.appendChild(error);
  const row = elem("div", "modal-actions");
  row.appendChild(button("btn-secondary btn-small", "Cancel", () => { box.remove(); actions.hidden = false; }));
  const confirm = button(`${options.danger ? "btn-danger" : "btn-primary"} btn-small`, options.label, async () => {
    confirm.disabled = true;
    try {
      await options.onConfirm();
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      showFormError(error, errorText(err, "Could not complete that."));
      confirm.disabled = false;
    }
  });
  row.appendChild(confirm);
  box.appendChild(row);
  card.appendChild(box);
  confirm.focus();
}

function renderAdminAudit(audit) {
  const section = elem("section", "admin-section");
  section.appendChild(elem("h3", "admin-heading", "Recent changes"));
  const list = elem("ul", "admin-audit-list");
  for (const entry of audit) {
    const messages = {
      member_created: `${entry.actor} added ${entry.target}.`,
      invite_reissued: `${entry.actor} issued ${entry.target} a new invite.`,
      access_revoked: `${entry.actor} revoked ${entry.target}'s access.`,
      admin_granted: `${entry.actor} made ${entry.target} an administrator.`,
      admin_removed: `${entry.actor} made ${entry.target} a member.`,
    };
    const item = elem("li", "admin-audit-item");
    item.appendChild(elem("span", "admin-audit-text", messages[entry.action] || `${entry.actor} updated ${entry.target}.`));
    item.appendChild(elem("time", "admin-audit-date", shortDate(entry.createdAt)));
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

// ─────────────────────────────── stats ─────────────────────────────

// Optional feed counts and the admin overview. The server includes the admin
// block only for admins; the client never decides that on its own.
async function loadStats() {
  try {
    const data = await api("/stats");
    state.stats = data.stats || null;
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
  }
}

function openStatsPanel() {
  const admin = state.stats && state.stats.admin;
  openModal((modal) => {
    modalHeader(modal, "Group overview");
    if (!admin) {
      modal.appendChild(elem("p", "modal-loading", "The overview is not available right now."));
      return;
    }
    modal.appendChild(buildAdminStats(admin));
  });
}

function buildAdminStats(a) {
  const wrap = elem("div", "stats-panel");

  const grid = elem("div", "stats-grid");
  grid.appendChild(statTile(a.prayersThisWeek, "prayers this week"));
  grid.appendChild(statTile(a.activeThisWeek, "people active this week"));
  grid.appendChild(statTile(a.prayersAllTime, "prayers all time"));
  grid.appendChild(statTile(`${toCount(a.answeredRate)}%`, "logged rate"));
  grid.appendChild(statTile(a.open, "active requests"));
  grid.appendChild(statTile(a.answered, "in Prayer Log"));
  wrap.appendChild(grid);

  const trend = Array.isArray(a.weeklyTrend) ? a.weeklyTrend : [];
  if (trend.length) {
    const section = elem("div", "stats-section");
    section.appendChild(elem("h3", "stats-heading", "Prayers per week (last 8 weeks)"));
    section.appendChild(buildSparkline(trend));
    wrap.appendChild(section);
  }

  const cats = Array.isArray(a.byCategory) ? a.byCategory : [];
  if (cats.length) {
    const section = elem("div", "stats-section");
    section.appendChild(elem("h3", "stats-heading", "By category"));
    const list = elem("ul", "stats-cat-list");
    const sorted = [...cats].sort((x, y) => toCount(y.count) - toCount(x.count));
    for (const c of sorted) {
      const li = elem("li", "stats-cat");
      li.appendChild(elem("span", "stats-cat-name", categoryLabel(c.category)));
      li.appendChild(elem("span", "stats-cat-count", String(toCount(c.count))));
      list.appendChild(li);
    }
    section.appendChild(list);
    wrap.appendChild(section);
  }

  const section = elem("div", "stats-section");
  section.appendChild(elem("h3", "stats-heading", "Response times"));
  section.appendChild(elem("p", "stats-line",
    `Median time to first prayer: ${formatHours(a.medianHoursToFirstPrayer)}`));
  section.appendChild(elem("p", "stats-line",
    `Median time to Prayer Log: ${formatHours(a.medianHoursToAnswered)}`));
  wrap.appendChild(section);

  return wrap;
}

function statTile(value, label) {
  const tile = elem("div", "stat-tile");
  tile.appendChild(elem("span", "stat-value", String(value)));
  tile.appendChild(elem("span", "stat-label", label));
  return tile;
}

function buildSparkline(values) {
  const max = Math.max(1, ...values.map((v) => toCount(v)));
  const wrap = elem("div", "sparkline");
  values.forEach((v, i) => {
    const n = toCount(v);
    const bar = elem("div", "spark-bar");
    bar.style.height = `${Math.round((n / max) * 100)}%`;
    bar.title = i === values.length - 1 ? `${n} this week` : `${n} (${values.length - 1 - i}w ago)`;
    wrap.appendChild(bar);
  });
  return wrap;
}

function formatHours(hours) {
  if (hours == null) return "no data yet";
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(hours, "hour", "hours");
  return `${Math.round(hours / 24)} days`;
}

// ───────────────────────────── refresh ─────────────────────────────

// Manual + on-foreground refresh. iOS home-screen apps have no pull-to-refresh
// and stay "frozen" on the last view when reopened, so this is how members pull
// in new requests during a meeting. Deliberately NOT a background poll: it only
// fires on an explicit tap or when the app returns to the foreground, so it
// never hammers the Worker/D1 while idle. A short rate-limit guards against
// focus + visibility events both firing on the same reopen.
let refreshing = false;
let lastRefreshAt = 0;

async function refreshAll({ force = false } = {}) {
  if (refreshing) return;
  if (!force && Date.now() - lastRefreshAt < 4000) return;
  refreshing = true;
  lastRefreshAt = Date.now();
  el.refreshBtn.classList.add("is-refreshing");
  const route = state.route?.name;
  const reload = route === "feed" ? loadFeed()
    : route === "log" ? Promise.resolve(showLog())
    : route === "you" ? Promise.resolve(showYou())
    : Promise.resolve();
  try {
    await Promise.all([reload, refreshTabDots(), loadStats(), loadMembers().catch(() => {})]);
  } finally {
    refreshing = false;
    el.refreshBtn.classList.remove("is-refreshing");
  }
}

function refreshOnForeground() {
  if (document.visibilityState !== "visible") return;
  if (!state.token || el.shell.hidden) return;
  // Thread, compose, and prayer time hold the member's place; leave them be.
  if (!TOP_LEVEL.has(state.route?.name)) return;
  refreshAll();
}

// ─────────────────────────────── boot ──────────────────────────────

function enterApp() {
  showShell();
  render();
  refreshTabDots();
  loadStats();
  loadMembers().catch(() => {});
  maybeShowOnboarding();
}

function handleExpiredSession() {
  clearSession();
  closeModal({ restoreFocus: false });
  showGate("Your link expired or was reset. Tap your personal link again, or type your code.");
}

el.gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = el.codeInput.value.trim();
  if (!code) return;

  el.gateSubmit.disabled = true;
  el.gateError.hidden = true;
  try {
    await redeemCode(code);
    stripCodeFromUrl();
    enterApp();
  } catch (err) {
    showGate(isNetworkError(err)
      ? "Could not connect. Check your internet and try again."
      : (err.message || "That code was not recognized."));
  } finally {
    el.gateSubmit.disabled = false;
  }
});

el.refreshBtn.addEventListener("click", () => refreshAll({ force: true }));
document.addEventListener("visibilitychange", refreshOnForeground);
window.addEventListener("pageshow", refreshOnForeground);

function stripCodeFromUrl() {
  if (new URLSearchParams(location.search).has("code")) {
    history.replaceState(null, "", location.pathname + location.hash);
  }
}

async function boot() {
  const urlCode = new URLSearchParams(location.search).get("code");
  if (urlCode) {
    try {
      await redeemCode(urlCode.trim());
      stripCodeFromUrl();
      enterApp();
      return;
    } catch {
      stripCodeFromUrl();
      showGate("That link did not work. Type your code below.");
      return;
    }
  }

  const session = loadSession();
  if (session) {
    state.token = session.token;
    state.member = session.member;
    enterApp();
    return;
  }

  // Installed app, first launch: its storage starts empty even though Safari is
  // already signed in (iOS keeps them separate). Reassure the user this is a
  // one-time step rather than the whole sign-up again.
  if (isStandalone() && el.gateLead) {
    el.gateLead.textContent =
      "Almost there — enter your code once to sign in on this app. " +
      "After this you'll stay signed in.";
  }

  showGate();
}

function applyBranding() {
  document.title = GROUP_NAME;
  if (el.gateTitle) el.gateTitle.textContent = GROUP_NAME;
  if (el.shellTitle) el.shellTitle.textContent = GROUP_NAME;
  for (const mark of document.querySelectorAll(".group-mark, .gate-mark")) {
    mark.textContent = initialOf(GROUP_NAME);
  }
}

decorateStatic();
applyBranding();
initTheme();
boot();
