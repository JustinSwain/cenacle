/* Prayer app frontend. Login gate + feed (Open/Answered/Mine), create form,
   request detail with updates thread and author-only mark-answered/archive. */

const API_BASE = "/api";
const SESSION_KEY = "cenacle_session_v1";
const ONBOARDED_KEY = "cenacle_onboarded_v1";
const THEME_KEY = "cenacle_theme_v1";
const FEED_CACHE_KEY = "cenacle_feed_v1";

// Branding injected by the Worker (window.__CONFIG__). Falls back to "Prayer"
// when the page is served as a raw static asset without the Worker.
const CONFIG = (window.__CONFIG__ && typeof window.__CONFIG__ === "object") ? window.__CONFIG__ : {};
const GROUP_NAME = (typeof CONFIG.groupName === "string" && CONFIG.groupName.trim()) || "Prayer";

const CATEGORIES = [
  { value: "general", label: "General", emoji: "\u{1F64F}" },
  { value: "health", label: "Health", emoji: "\u{1FA7A}" },
  { value: "family", label: "Family", emoji: "\u{1F46A}" },
  { value: "work", label: "Work", emoji: "\u{1F4BC}" },
  { value: "spiritual", label: "Spiritual", emoji: "\u{2728}" },
  { value: "praise", label: "Praise", emoji: "\u{1F389}" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const state = {
  token: null,
  member: null,
  tab: "open",
  stats: null,
};

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
  if (el.who && state.member) el.who.textContent = `Signed in as ${state.member.name}`;
  return data.member;
}

// ─────────────────────────────── DOM ───────────────────────────────

const el = {
  gate: document.getElementById("gate"),
  gateForm: document.getElementById("gate-form"),
  codeInput: document.getElementById("code-input"),
  gateSubmit: document.getElementById("gate-submit"),
  gateError: document.getElementById("gate-error"),
  shell: document.getElementById("shell"),
  gateTitle: document.querySelector(".gate-title"),
  gateLead: document.getElementById("gate-lead"),
  shellTitle: document.querySelector(".shell-title"),
  who: document.getElementById("who"),
  feed: document.getElementById("feed"),
  feedStatus: document.getElementById("feed-status"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  helpBtn: document.getElementById("help-btn"),
  statsBtn: document.getElementById("stats-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  summary: document.getElementById("summary"),
  themeToggle: document.getElementById("theme-toggle"),
  newBtn: document.getElementById("new-request-btn"),
  backdrop: document.getElementById("modal-backdrop"),
  modal: document.getElementById("modal"),
};

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
  if (state.member) {
    el.who.textContent = `Signed in as ${state.member.name}`;
  }
}

function setFeedStatus(message) {
  if (!message) {
    el.feedStatus.hidden = true;
    el.feedStatus.textContent = "";
    return;
  }
  el.feedStatus.textContent = message;
  el.feedStatus.hidden = false;
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

function formatDate(epochMs) {
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function categoryLabel(cat) {
  return CATEGORY_LABEL[cat] || CATEGORY_LABEL.general;
}

function prayerCountLabel(n, isOwn) {
  // On your own request the count describes OTHERS (you're shown as already
  // praying), so the wording never clashes with your settled "Prayed" button.
  if (!n) return isOwn ? "No one else has prayed yet" : "Be the first to pray";
  if (n === 1) return isOwn ? "1 other person praying" : "1 person praying";
  return isOwn ? `${n} others praying` : `${n} people praying`;
}

// ───────────────────────────── tabs/feed ─────────────────────────────

function setActiveTab(tab) {
  state.tab = tab;
  for (const t of el.tabs) {
    const active = t.dataset.tab === tab;
    t.setAttribute("aria-selected", active ? "true" : "false");
    t.classList.toggle("tab-active", active);
  }
}

function setTabBadge(tab, count) {
  const button = el.tabs.find((t) => t.dataset.tab === tab);
  if (!button) return;
  const badge = button.querySelector(".tab-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = String(count);
    badge.hidden = false;
    button.setAttribute("aria-label", `${tab}, ${count} new`);
  } else {
    badge.textContent = "";
    badge.hidden = true;
    button.removeAttribute("aria-label");
  }
}

function clearTabBadge(tab) {
  setTabBadge(tab, 0);
}

// Fetch "new since last visit" counts and badge the tabs. Defensive: if /me is
// unavailable or predates this feature, badges simply do not appear.
async function refreshBadges() {
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
    el.who.textContent = `Signed in as ${state.member.name}`;
  }
  const badges = data.badges || {};
  setTabBadge("open", toCount(badges.open));
  setTabBadge("answered", toCount(badges.answered));
  setTabBadge("mine", toCount(badges.mine));
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

async function loadFeed() {
  // Show the last saved view instantly so the page is never blank on open.
  const cached = readFeedCache(state.tab);
  if (cached && cached.length) {
    renderFeed(cached);
  } else {
    setFeedStatus("Loading...");
    el.feed.replaceChildren();
  }
  try {
    const data = await api(`/requests?status=${encodeURIComponent(state.tab)}`);
    const requests = data.requests || [];
    renderFeed(requests);
    writeFeedCache(state.tab, requests);
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    const msg = isNetworkError(err)
      ? "Could not connect. Check your internet and try again."
      : "Could not load the feed. Try again in a moment.";
    setFeedStatus(cached && cached.length ? `${msg} Showing your last saved view.` : msg);
  }
}

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
  if (el.refreshBtn) el.refreshBtn.classList.add("is-refreshing");
  try {
    await Promise.all([loadFeed(), refreshBadges(), loadStats()]);
  } finally {
    refreshing = false;
    if (el.refreshBtn) el.refreshBtn.classList.remove("is-refreshing");
  }
}

function readFeedCache(tab) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || "{}");
    const entry = all[tab];
    return entry && Array.isArray(entry.requests) ? entry.requests : null;
  } catch {
    return null;
  }
}

function writeFeedCache(tab, requests) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || "{}");
    all[tab] = { requests, ts: Date.now() };
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable - non-fatal */
  }
}

function renderFeed(requests) {
  el.feed.replaceChildren();
  if (requests.length === 0) {
    setFeedStatus(emptyMessage(state.tab));
    return;
  }
  setFeedStatus(null);
  for (const req of requests) {
    el.feed.appendChild(renderCard(req));
  }
}

function emptyMessage(tab) {
  if (tab === "answered") return "No answered prayers yet - they will gather here.";
  if (tab === "mine") return "You have not shared a request yet.";
  return "No open requests right now - a quiet week.";
}

function renderCard(req) {
  const li = document.createElement("li");
  li.className = req.status === "answered" ? "card card-answered" : "card";
  li.dataset.id = req.id;

  const head = elem("div", "card-head");
  head.appendChild(elem("h2", "card-title", req.title));
  const chevron = elem("span", "card-chevron", "›");
  chevron.setAttribute("aria-hidden", "true");
  head.appendChild(chevron);
  li.appendChild(head);

  // Category shown as quiet text, and only when it adds information ("General"
  // is the default, so we omit it to keep most cards uncluttered).
  const parts = [];
  if (req.category && req.category !== "general") parts.push(categoryLabel(req.category));
  parts.push(req.author, formatDate(req.createdAt));
  const cardMeta = parts.join(" - ");
  li.appendChild(elem("p", "card-meta", req.editedAt ? `${cardMeta} (edited)` : cardMeta));

  if (req.status === "answered") {
    const badge = elem("p", "answered-badge", "Answered");
    li.appendChild(badge);
    if (req.answerNote) {
      li.appendChild(elem("blockquote", "answer-note", req.answerNote));
    }
  } else if (req.snippet) {
    li.appendChild(elem("p", "card-snippet", req.snippet));
  }

  const ownPost = !!req.isMine;
  const foot = elem("div", "card-foot");
  const count = elem("span", "card-count", prayerCountLabel(req.distinctPrayers, ownPost));
  foot.appendChild(count);

  if (req.status !== "answered") {
    const btn = document.createElement("button");
    btn.className = "pray-btn";
    btn.type = "button";
    // Your own request shows as already "Prayed" and can't be re-tapped.
    setPrayButton(btn, ownPost || req.hasViewerPrayed);
    if (ownPost) {
      btn.setAttribute("aria-label", "This is your own request.");
    } else {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onPray(req, btn, count);
      });
    }
    foot.appendChild(btn);
  }
  li.appendChild(foot);

  const hint = elem("p", "card-hint", req.status === "answered"
    ? "Tap to read the full story"
    : "Tap to read, comment, or mark answered");
  li.appendChild(hint);

  // Open detail when tapping the card body (but not the pray button).
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `${req.title} - open to read and respond`);
  li.addEventListener("click", () => openDetail(req.id));
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail(req.id);
    }
  });

  return li;
}

// Once a member has prayed for a request the button settles into a done state
// and is disabled - one prayer signal per request, so the count can't be padded.
function setPrayButton(btn, hasPrayed) {
  btn.dataset.prayed = hasPrayed ? "1" : "0";
  btn.textContent = hasPrayed ? "\u{1F64F} Prayed" : "\u{1F64F} I'm praying";
  btn.disabled = hasPrayed;
  btn.setAttribute("aria-label", hasPrayed
    ? "You have prayed for this request."
    : "Tap to pray for this request.");
}

async function onPray(req, btn, countEl) {
  // Optimistic: settle the button (which disables it) and bump the count.
  req.distinctPrayers += 1;
  countEl.textContent = prayerCountLabel(req.distinctPrayers);
  setPrayButton(btn, true);

  try {
    const result = await api(`/requests/${req.id}/pray`, { method: "POST" });
    req.distinctPrayers = result.distinctPrayers;
    req.totalPrayers = result.totalPrayers;
    req.hasViewerPrayed = result.hasViewerPrayed;
    countEl.textContent = prayerCountLabel(req.distinctPrayers);
    setPrayButton(btn, true);
  } catch (err) {
    // Roll back so the member can try again.
    req.distinctPrayers = Math.max(0, req.distinctPrayers - 1);
    countEl.textContent = prayerCountLabel(req.distinctPrayers);
    setPrayButton(btn, false);
    if (err.status === 401) return handleExpiredSession();
    setFeedStatus("Could not record that just now. Try again in a moment.");
  }
}

// ───────────────────────────── modal core ─────────────────────────────

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

function closeModal() {
  el.backdrop.hidden = true;
  el.modal.replaceChildren();
  document.body.classList.remove("modal-open");
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

// Swap the contents of an already-open modal (used for multi-step flows) without
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
  const close = elem("button", "modal-close", "✕");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeModal);
  header.appendChild(close);
  parent.appendChild(header);
}

// ─────────────────────────── create request ───────────────────────────

function openCreateForm() {
  openRequestForm({
    heading: "Share a request",
    submitLabel: "Share",
    onSubmit: async (payload) => {
      await api("/requests", { method: "POST", body: payload });
      closeModal();
      setActiveTab("open");
      await loadFeed();
    },
  });
}

// Reused by both "Share a request" and "Edit request". `initial` prefills the
// fields (used for editing); `onSubmit` receives the validated payload and is
// responsible for the API call and closing/refreshing.
function openRequestForm({ heading, submitLabel, initial, onSubmit }) {
  const init = initial || {};
  openModal((modal) => {
    modalHeader(modal, heading);

    const form = elem("form", "req-form");

    const titleField = elem("input", "field-input");
    titleField.type = "text";
    titleField.name = "title";
    titleField.maxLength = 120;
    titleField.placeholder = "Short title";
    titleField.required = true;
    if (init.title) titleField.value = init.title;
    form.appendChild(labeled("Title", titleField));

    const bodyField = elem("textarea", "field-input field-textarea");
    bodyField.name = "body";
    bodyField.maxLength = 4000;
    bodyField.rows = 5;
    bodyField.placeholder = "Share as much or as little as you like.";
    bodyField.required = true;
    if (init.body) bodyField.value = init.body;
    form.appendChild(labeled("Request", bodyField));

    const select = elem("select", "field-input");
    select.name = "category";
    for (const c of CATEGORIES) {
      const opt = elem("option", null, c.label);
      opt.value = c.value;
      select.appendChild(opt);
    }
    if (init.category) select.value = init.category;
    form.appendChild(labeled("Category", select));

    const anonWrap = elem("label", "checkbox-row");
    const anon = document.createElement("input");
    anon.type = "checkbox";
    anon.name = "anonymous";
    if (init.isAnonymous) anon.checked = true;
    anonWrap.appendChild(anon);
    anonWrap.appendChild(text(" Post anonymously (your name is hidden from the group)"));
    form.appendChild(anonWrap);

    const errLine = elem("p", "form-error");
    errLine.hidden = true;
    form.appendChild(errLine);

    const actions = elem("div", "modal-actions");
    const submit = elem("button", "btn-primary", submitLabel);
    submit.type = "submit";
    const cancel = elem("button", "btn-secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    actions.appendChild(cancel);
    actions.appendChild(submit);
    form.appendChild(actions);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        title: titleField.value.trim(),
        body: bodyField.value.trim(),
        category: select.value,
        isAnonymous: anon.checked,
      };
      if (!payload.title || !payload.body) {
        showFormError(errLine, "Please add a title and a few words.");
        return;
      }
      submit.disabled = true;
      try {
        await onSubmit(payload);
      } catch (err) {
        if (err.status === 401) { closeModal(); return handleExpiredSession(); }
        showFormError(errLine, isNetworkError(err)
          ? "Could not connect. Try again."
          : (err.message || "Could not save that. Try again."));
        submit.disabled = false;
      }
    });

    modal.appendChild(form);
  });
}

function openEditForm(req) {
  openRequestForm({
    heading: "Edit request",
    submitLabel: "Save changes",
    initial: {
      title: req.title,
      body: req.body,
      category: req.category,
      isAnonymous: req.isAnonymous,
    },
    onSubmit: async (payload) => {
      const data = await api(`/requests/${req.id}/edit`, { method: "POST", body: payload });
      renderDetail(data.request);
      // Refresh the feed so the edited title/snippet updates in the list too.
      loadFeed();
    },
  });
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

// ─────────────────────────── request detail ───────────────────────────

async function openDetail(id) {
  openModal((modal) => {
    modal.appendChild(elem("p", "modal-loading", "Loading..."));
  });
  try {
    const data = await api(`/requests/${id}`);
    renderDetail(data.request);
  } catch (err) {
    if (err.status === 401) { closeModal(); return handleExpiredSession(); }
    openModal((modal) => {
      modalHeader(modal, "Request");
      modal.appendChild(elem("p", "modal-loading",
        isNetworkError(err) ? "Could not connect. Try again." : "Could not load this request."));
    });
  }
}

function renderDetail(req) {
  openModal((modal) => {
    modalHeader(modal, req.title);

    const metaText = `${categoryLabel(req.category)} - ${req.author} - ${formatDate(req.createdAt)}`;
    const meta = elem("p", "detail-meta", req.editedAt ? `${metaText} (edited)` : metaText);
    modal.appendChild(meta);

    if (req.status === "answered") {
      modal.appendChild(elem("p", "answered-badge", "Answered"));
    }

    modal.appendChild(elem("p", "detail-body", req.body));

    // The author (admins too) can revise their own request after posting.
    // Archived posts are never shown here, so isMine is the only gate needed.
    if (req.isMine) {
      const editRow = elem("div", "detail-edit-row");
      const editBtn = elem("button", "btn-secondary btn-small", "Edit");
      editBtn.type = "button";
      editBtn.addEventListener("click", () => openEditForm(req));
      editRow.appendChild(editBtn);
      modal.appendChild(editRow);
    }

    if (req.status === "answered" && req.answerNote) {
      const t = elem("div", "testimony");
      t.appendChild(elem("p", "testimony-label", "Testimony"));
      t.appendChild(elem("blockquote", "answer-note", req.answerNote));
      modal.appendChild(t);
    }

    // Who's praying: count line that expands to names.
    modal.appendChild(renderPraying(req));

    // Pray button (not for answered requests).
    if (req.status !== "answered") {
      const ownPost = !!req.isMine;
      const prayRow = elem("div", "detail-pray-row");
      const countEl = elem("span", "card-count", prayerCountLabel(req.distinctPrayers, ownPost));
      const btn = elem("button", "pray-btn");
      btn.type = "button";
      // Your own request shows as already "Prayed" and can't be re-tapped.
      setPrayButton(btn, ownPost || req.hasViewerPrayed);
      if (ownPost) {
        btn.setAttribute("aria-label", "This is your own request.");
      } else {
        btn.addEventListener("click", () => onPrayDetail(req, btn, countEl));
      }
      prayRow.appendChild(countEl);
      prayRow.appendChild(btn);
      modal.appendChild(prayRow);
    }

    // Updates thread.
    modal.appendChild(renderUpdates(req));

    // Add an update.
    modal.appendChild(renderUpdateForm(req));

    // Author-only actions on open requests.
    if (req.isMine && req.status === "open") {
      modal.appendChild(renderAuthorActions(req));
    }

    // Admin moderation: remove anyone else's post (any status) from all feeds.
    if (state.member && state.member.role === "admin" && !req.isMine) {
      modal.appendChild(renderAdminActions(req));
    }
  });
}

function renderAdminActions(req) {
  const wrap = elem("div", "admin-actions");
  wrap.appendChild(elem("p", "admin-actions-note",
    "Admin: remove this post from everyone's feed."));

  const btn = elem("button", "btn-danger", "Remove post");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    if (!window.confirm("Remove this post for everyone? It will disappear from all feeds.")) return;
    btn.disabled = true;
    try {
      await api(`/requests/${req.id}/archive`, { method: "POST" });
      closeModal();
      loadFeed();
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      btn.disabled = false;
    }
  });
  wrap.appendChild(btn);
  return wrap;
}

function renderPraying(req) {
  const wrap = elem("div", "praying");
  const ownPost = !!req.isMine;
  const members = req.prayingMembers || [];
  if (members.length === 0) {
    wrap.appendChild(elem("p", "praying-line",
      ownPost ? "No one else has prayed yet." : "No one has prayed yet."));
    return wrap;
  }
  const names = members.map((m) => m.name).join(", ");
  const summary = document.createElement("details");
  summary.className = "praying-details";
  const sum = document.createElement("summary");
  sum.appendChild(text(prayerCountLabel(req.distinctPrayers, ownPost)));
  summary.appendChild(sum);
  summary.appendChild(elem("p", "praying-names", names));
  wrap.appendChild(summary);
  return wrap;
}

async function onPrayDetail(req, btn, countEl) {
  // Optimistic: settle the button (which disables it) and bump the count.
  req.distinctPrayers += 1;
  countEl.textContent = prayerCountLabel(req.distinctPrayers);
  setPrayButton(btn, true);
  try {
    const result = await api(`/requests/${req.id}/pray`, { method: "POST" });
    req.distinctPrayers = result.distinctPrayers;
    req.hasViewerPrayed = result.hasViewerPrayed;
    countEl.textContent = prayerCountLabel(req.distinctPrayers);
    setPrayButton(btn, true);
  } catch (err) {
    req.distinctPrayers = Math.max(0, req.distinctPrayers - 1);
    countEl.textContent = prayerCountLabel(req.distinctPrayers);
    setPrayButton(btn, false);
    if (err.status === 401) { closeModal(); return handleExpiredSession(); }
  }
}

function renderUpdates(req) {
  const wrap = elem("div", "updates");
  const updates = req.updates || [];
  if (updates.length === 0) return wrap;
  wrap.appendChild(elem("h3", "updates-title", "Updates"));
  for (const u of updates) {
    const item = elem("div", "update");
    item.appendChild(elem("p", "update-meta", `${u.author} - ${formatDate(u.createdAt)}`));
    item.appendChild(elem("p", "update-body", u.body));
    wrap.appendChild(item);
  }
  return wrap;
}

function renderUpdateForm(req) {
  const form = elem("form", "update-form");
  const field = elem("textarea", "field-input field-textarea");
  field.rows = 2;
  field.maxLength = 2000;
  field.placeholder = "Add an update or a word of encouragement...";
  form.appendChild(field);

  const errLine = elem("p", "form-error");
  errLine.hidden = true;
  form.appendChild(errLine);

  const submit = elem("button", "btn-primary", "Post update");
  submit.type = "submit";
  form.appendChild(submit);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    submit.disabled = true;
    try {
      const data = await api(`/requests/${req.id}/update`, { method: "POST", body: { body: value } });
      renderDetail(data.request);
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      showFormError(errLine, "Could not post that. Try again.");
      submit.disabled = false;
    }
  });
  return form;
}

function renderAuthorActions(req) {
  const wrap = elem("div", "author-actions");

  // Mark answered reveals a testimony field inline.
  const answerForm = elem("form", "answer-form");
  answerForm.hidden = true;
  const note = elem("textarea", "field-input field-textarea");
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = "Share how this was answered (optional testimony)...";
  answerForm.appendChild(note);
  const confirm = elem("button", "btn-primary", "Mark answered");
  confirm.type = "submit";
  answerForm.appendChild(confirm);

  const answerBtn = elem("button", "btn-secondary", "Mark answered");
  answerBtn.type = "button";
  answerBtn.addEventListener("click", () => {
    answerForm.hidden = false;
    answerBtn.hidden = true;
    note.focus();
  });

  answerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    confirm.disabled = true;
    try {
      const data = await api(`/requests/${req.id}/answer`, {
        method: "POST",
        body: { answerNote: note.value.trim() },
      });
      renderDetail(data.request);
      // Refresh the underlying feed so the card moves to Answered.
      loadFeed();
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      confirm.disabled = false;
    }
  });

  const archiveBtn = elem("button", "btn-danger", "Archive");
  archiveBtn.type = "button";
  archiveBtn.addEventListener("click", async () => {
    archiveBtn.disabled = true;
    try {
      await api(`/requests/${req.id}/archive`, { method: "POST" });
      closeModal();
      loadFeed();
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      archiveBtn.disabled = false;
    }
  });

  wrap.appendChild(answerBtn);
  wrap.appendChild(answerForm);
  wrap.appendChild(archiveBtn);
  return wrap;
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
    "Tap \u{1F64F} I'm praying to let someone know you are lifting them up.",
    "Post updates, and mark a request answered to share the good news.",
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
  const value = elem("code", "code-copy-value", code);
  box.appendChild(value);
  const btn = elem("button", "btn-secondary code-copy-btn", "Copy");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch { /* fall through to selection fallback */ }
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(value);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      sel.removeAllRanges();
    }
    btn.textContent = ok ? "Copied" : "Select and copy";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
  box.appendChild(btn);
  return box;
}

function addToHomeBlock() {
  const wrap = elem("div", "home-help");
  wrap.appendChild(elem("p", "info-lead",
    `Add ${GROUP_NAME} to your home screen so you can open it in one tap.`));
  wrap.appendChild(elem("p", "info-note",
    "On iPhone the home-screen app asks for your code the first time you open " +
    "it. Copy your code now, then paste it once there — after that you'll " +
    "stay signed in."));
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
    finish: closeModal,
    get isLast() { return i === steps.length - 1; },
  };
  openModal((m) => steps[0](m, ctx));
}

function stepWelcome(modal, ctx) {
  modalHeader(modal, `Welcome to ${GROUP_NAME}`);
  modal.appendChild(elem("p", "info-lead",
    "This is a private space for our group. First, how would you like your name shown to everyone?"));

  const form = elem("form", "onboard-form");
  const nameField = elem("input", "field-input");
  nameField.type = "text";
  nameField.maxLength = 40;
  nameField.value = state.member ? state.member.name : "";
  nameField.required = true;
  form.appendChild(labeled("Your name", nameField));

  const errLine = elem("p", "form-error");
  errLine.hidden = true;
  form.appendChild(errLine);

  const actions = elem("div", "modal-actions");
  const next = elem("button", "btn-primary", "Looks good");
  next.type = "submit";
  actions.appendChild(next);
  form.appendChild(actions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameField.value.trim();
    if (!name) { showFormError(errLine, "Please enter a name."); return; }
    next.disabled = true;
    try {
      if (state.member && name !== state.member.name) await updateName(name);
      ctx.next();
    } catch (err) {
      if (err.status === 401) { closeModal(); return handleExpiredSession(); }
      // Saving the name is best-effort; continue onboarding regardless.
      ctx.next();
    }
  });

  modal.appendChild(form);
}

function stepHowItWorks(modal, ctx) {
  modalHeader(modal, "How this works");
  modal.appendChild(howItWorksList());
  const actions = elem("div", "modal-actions");
  const next = elem("button", "btn-primary", "Next");
  next.type = "button";
  next.addEventListener("click", ctx.next);
  actions.appendChild(next);
  modal.appendChild(actions);
}

function stepAddHome(modal, ctx) {
  modalHeader(modal, "Open it like an app");
  modal.appendChild(addToHomeBlock());
  const actions = elem("div", "modal-actions");
  const done = elem("button", "btn-primary", "Done");
  done.type = "button";
  done.addEventListener("click", ctx.finish);
  actions.appendChild(done);
  modal.appendChild(actions);
}

function openHelp() {
  openModal((modal) => {
    modalHeader(modal, "Help");

    const how = elem("section", "help-section");
    how.appendChild(elem("h3", "help-heading", "How this works"));
    how.appendChild(howItWorksList());
    modal.appendChild(how);

    const home = elem("section", "help-section");
    home.appendChild(elem("h3", "help-heading", "Open it like an app"));
    home.appendChild(addToHomeBlock());
    modal.appendChild(home);

    const account = elem("section", "help-section");
    account.appendChild(elem("h3", "help-heading", "Account"));
    if (state.member) {
      account.appendChild(elem("p", "help-note", `Signed in as ${state.member.name}.`));
    }
    account.appendChild(elem("p", "help-note",
      "This app is hosted on a personal Cloudflare account. Share only what you are comfortable storing there."));
    const signOut = elem("button", "btn-danger", "Sign out");
    signOut.type = "button";
    signOut.addEventListener("click", () => confirmSignOut(account, signOut));
    account.appendChild(signOut);
    modal.appendChild(account);
  });
}

// Sign-out is deliberately guarded by an inline confirm so a less-technical
// member cannot tap it by accident and lock themselves out.
function confirmSignOut(container, triggerBtn) {
  triggerBtn.hidden = true;
  const box = elem("div", "confirm-box");
  box.appendChild(elem("p", "confirm-text",
    "Sign out on this device? You will need your personal link or code to get back in."));
  const row = elem("div", "modal-actions");
  const cancel = elem("button", "btn-secondary", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => { box.remove(); triggerBtn.hidden = false; triggerBtn.focus(); });
  const yes = elem("button", "btn-danger", "Sign out");
  yes.type = "button";
  yes.addEventListener("click", () => {
    clearSession();
    closeModal();
    showGate();
  });
  row.appendChild(cancel);
  row.appendChild(yes);
  box.appendChild(row);
  container.appendChild(box);
  yes.focus();
}

// ─────────────────────────────── stats ─────────────────────────────

// Fetch group + personal stats. Defensive: if /stats is unavailable (e.g. the
// backend predates this feature), the summary line and Stats button stay hidden.
async function loadStats() {
  let data;
  try {
    data = await api("/stats");
  } catch (err) {
    if (err.status === 401) return handleExpiredSession();
    return;
  }
  state.stats = data.stats || null;
  renderSummary();
  // Stats button appears only when the server returned an admin block (the
  // server gates this by role; the client never decides admin on its own).
  const isAdmin = !!(state.stats && state.stats.admin);
  el.statsBtn.hidden = !isAdmin;
}

// Always-visible line: group open/answered plus the viewer's own year totals.
function renderSummary() {
  const s = state.stats;
  if (!s) { el.summary.hidden = true; return; }
  el.summary.replaceChildren();

  const pub = s.public || {};
  const group = elem("span", "summary-group",
    `${toCount(pub.open)} open - ${toCount(pub.answered)} answered`);
  el.summary.appendChild(group);

  const me = s.personal;
  if (me) {
    el.summary.appendChild(elem("span", "summary-sep", " | "));
    const prayers = toCount(me.prayers);
    const mine = elem("span", "summary-mine",
      `You in ${me.year}: ${prayers} ${prayers === 1 ? "prayer" : "prayers"}`);
    el.summary.appendChild(mine);
  }

  el.summary.hidden = false;
}

function openStatsPanel() {
  const admin = state.stats && state.stats.admin;
  openModal((modal) => {
    modalHeader(modal, "Group stats");
    if (!admin) {
      modal.appendChild(elem("p", "modal-loading", "Stats are not available right now."));
      return;
    }
    modal.appendChild(buildAdminStats(admin));
  });
}

function buildAdminStats(a) {
  const wrap = elem("div", "stats-panel");

  // Headline numbers.
  const grid = elem("div", "stats-grid");
  grid.appendChild(statTile(a.prayersThisWeek, "prayers this week"));
  grid.appendChild(statTile(a.activeThisWeek, "people active this week"));
  grid.appendChild(statTile(a.prayersAllTime, "prayers all time"));
  grid.appendChild(statTile(`${toCount(a.answeredRate)}%`, "answered rate"));
  grid.appendChild(statTile(a.open, "open requests"));
  grid.appendChild(statTile(a.answered, "answered requests"));
  wrap.appendChild(grid);

  // Weekly prayer trend sparkline (last 8 weeks).
  const trend = Array.isArray(a.weeklyTrend) ? a.weeklyTrend : [];
  if (trend.length) {
    const section = elem("div", "stats-section");
    section.appendChild(elem("h3", "stats-heading", "Prayers per week (last 8 weeks)"));
    section.appendChild(buildSparkline(trend));
    wrap.appendChild(section);
  }

  // By category.
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

  // Median response times.
  const section = elem("div", "stats-section");
  section.appendChild(elem("h3", "stats-heading", "Response times"));
  section.appendChild(elem("p", "stats-line",
    `Median time to first prayer: ${formatHours(a.medianHoursToFirstPrayer)}`));
  section.appendChild(elem("p", "stats-line",
    `Median time to answered: ${formatHours(a.medianHoursToAnswered)}`));
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
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
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
  if (el.themeToggle) {
    el.themeToggle.setAttribute("aria-checked", theme === "dark" ? "true" : "false");
  }
}

function setTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

// Follow the device setting until the member picks a side; their choice is then
// remembered and wins over later system changes.
function initTheme() {
  applyTheme(storedTheme() || (systemPrefersDark() ? "dark" : "light"));
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!storedTheme()) applyTheme(e.matches ? "dark" : "light");
    });
  }
}

// ─────────────────────────────── boot ──────────────────────────────

function enterApp() {
  showShell();
  setActiveTab("open");
  loadFeed();
  refreshBadges();
  loadStats();
  maybeShowOnboarding();
}

function handleExpiredSession() {
  clearSession();
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

for (const t of el.tabs) {
  t.addEventListener("click", () => {
    clearTabBadge(t.dataset.tab);
    if (state.tab === t.dataset.tab) return;
    setActiveTab(t.dataset.tab);
    loadFeed();
  });
}

el.newBtn.addEventListener("click", openCreateForm);
el.helpBtn.addEventListener("click", openHelp);
el.statsBtn.addEventListener("click", openStatsPanel);
if (el.refreshBtn) el.refreshBtn.addEventListener("click", () => refreshAll({ force: true }));

// Refresh when the app returns to the foreground (the practical "live" trigger
// for an installed iOS app, since reopening it does not reload the page). Both
// events can fire on a single reopen; the rate-limit in refreshAll dedupes them.
function refreshOnForeground() {
  if (document.visibilityState !== "visible") return;
  if (!state.token || el.shell.hidden) return;
  refreshAll();
}
document.addEventListener("visibilitychange", refreshOnForeground);
window.addEventListener("pageshow", refreshOnForeground);
el.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  setTheme(next);
});

function stripCodeFromUrl() {
  if (new URLSearchParams(location.search).has("code")) {
    history.replaceState(null, "", location.pathname);
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
}

applyBranding();
initTheme();
boot();
