import { renderMarkdown, escapeHtml } from "/markdown.js";

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  app: $("#app"),
  list: $("#chat-list"),
  search: $("#search"),
  thread: $("#thread"),
  messages: $("#messages"),
  composer: $("#composer"),
  input: $("#input"),
  send: $("#send"),
  title: $("#chat-title"),
  jump: $("#jump"),
  dot: $("#status-dot"),
  chipName: $("#model-chip-name"),
  chipMeta: $("#model-chip-meta"),
  spec: $("#model-spec"),
  drawer: $("#drawer"),
};

/* ---------- Persistence ---------- */

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const DEFAULTS = {
  system: "",
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 0,
  theme: "system",
  showThinking: true,
  showStats: true,
};

const settings = { ...DEFAULTS, ...storage.get("unmuzzled.settings", {}) };
let chats = storage.get("unmuzzled.chats", []);
let activeId = null;
let server = { status: "loading", model: null, error: null };
let streaming = null; // { chatId, controller, reply }
let stickToBottom = true;

let saveTimer;
function saveChats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.set("unmuzzled.chats", chats), 250);
}
const saveSettings = () => storage.set("unmuzzled.settings", settings);

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const getChat = (id) => chats.find((c) => c.id === id) ?? null;
const activeChat = () => getChat(activeId);

function titleFrom(text) {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ");
  if (line.length <= 56) return line || "New chat";
  return line.slice(0, 56).replace(/\s+\S*$/, "") + "…";
}

/* ---------- Sidebar ---------- */

function groupLabel(ts) {
  const day = 86_400_000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - day) return "Yesterday";
  if (ts >= startOfToday - 7 * day) return "Previous 7 days";
  if (ts >= startOfToday - 30 * day) return "Previous 30 days";
  return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderSidebar() {
  const q = els.search.value.trim().toLowerCase();
  const visible = chats
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!visible.length) {
    els.list.innerHTML = `<p class="chat-empty">${q ? "No chats match your search." : "Your conversations will appear here."}</p>`;
    return;
  }

  let html = "";
  let current = null;
  for (const c of visible) {
    const label = groupLabel(c.updatedAt);
    if (label !== current) {
      if (current !== null) html += `</div>`;
      html += `<div class="chat-group"><div class="chat-group-label">${label}</div>`;
      current = label;
    }
    const live = streaming?.chatId === c.id ? " is-streaming" : "";
    html +=
      `<div class="chat-item${live}" role="link" tabindex="0" data-chat="${c.id}" aria-current="${c.id === activeId}">` +
        `<span class="chat-item-title">${escapeHtml(c.title)}</span>` +
        `<button class="chat-item-del" data-action="delete-chat" title="Delete chat" aria-label="Delete chat">` +
          `<svg class="i i-sm"><use href="#i-trash"/></svg>` +
        `</button>` +
      `</div>`;
  }
  els.list.innerHTML = html + `</div>`;
}

function setSidebar(open) {
  els.app.dataset.sidebar = open ? "open" : "closed";
  if (!isNarrow()) storage.set("unmuzzled.sidebar", open);
}
const isNarrow = () => matchMedia("(max-width: 900px)").matches;

/* ---------- Thread ---------- */

const inSetup = () => server.status === "setup" || server.status === "downloading";

function renderThread() {
  if (inSetup()) {
    els.title.textContent = "";
    document.title = "Set up · Unmuzzled";
    return renderSetup();
  }

  const chat = activeChat();
  els.title.textContent = chat ? chat.title : "";
  document.title = chat ? `${chat.title} · Unmuzzled` : "Unmuzzled";

  if (!chat) {
    els.messages.replaceChildren($("#tpl-empty").content.cloneNode(true));
    const m = server.model;
    $("#empty-model").textContent = m
      ? [m.name, m.quant].filter(Boolean).join(" · ")
      : "Loading model";
    return;
  }

  els.messages.replaceChildren(...chat.messages.map((m, i) => {
    const el = m.role === "user" ? userMessageEl(m) : assistantMessageEl(m);
    if (i === chat.messages.length - 1) el.classList.add("is-last");
    return el;
  }));
}

function userMessageEl(m) {
  const el = document.createElement("div");
  el.className = "msg msg-user";
  el.dataset.id = m.id;
  el.innerHTML =
    `<div class="bubble"></div>` +
    `<div class="msg-actions">` +
      actionBtn("copy", "Copy", "i-copy") +
      actionBtn("edit", "Edit", "i-edit") +
    `</div>`;
  $(".bubble", el).textContent = m.content;
  return el;
}

function assistantMessageEl(m) {
  const el = document.createElement("div");
  el.className = "msg msg-assistant";
  el.dataset.id = m.id;
  el.innerHTML =
    `<details class="thought" hidden>` +
      `<summary><svg class="i"><use href="#i-chevron"/></svg><span class="label"></span></summary>` +
      `<div class="thought-body"></div>` +
    `</details>` +
    `<div class="prose"></div>` +
    `<div class="msg-error" hidden></div>` +
    `<div class="msg-actions">` +
      actionBtn("copy", "Copy", "i-copy") +
      actionBtn("retry", "Regenerate", "i-retry") +
      `<span class="stats"></span>` +
    `</div>`;
  // Once the user opens or closes the reasoning themselves, stop auto-toggling it.
  $(".thought summary", el).addEventListener("click", () => {
    $(".thought", el).dataset.touched = "1";
  });
  updateAssistantEl(el, m);
  return el;
}

const actionBtn = (act, label, icon) =>
  `<button class="act" data-act="${act}" title="${label}" aria-label="${label}"><svg class="i i-sm"><use href="#${icon}"/></svg></button>`;

function updateAssistantEl(el, m) {
  const live = streaming?.reply.id === m.id;

  const thought = $(".thought", el);
  const showThought = settings.showThinking && m.thought.trim().length > 0;
  thought.hidden = !showThought;
  if (showThought) {
    const thinking = live && !m.content;
    thought.classList.toggle("is-live", thinking);
    $(".label", thought).textContent = thinking
      ? "Thinking"
      : m.thoughtSeconds != null
        ? `Thought for ${formatDuration(m.thoughtSeconds)}`
        : "Reasoning";
    const body = $(".thought-body", thought);
    body.textContent = m.thought.trim();
    if (live && !thought.dataset.touched) thought.open = thinking;
    if (thinking) body.scrollTop = body.scrollHeight;
  }

  const prose = $(".prose", el);
  if (live && !m.content && !(showThought && m.thought)) {
    prose.innerHTML = `<div class="pending" aria-label="Waiting for the model"><span></span><span></span><span></span></div>`;
  } else {
    prose.innerHTML = renderMarkdown(m.content);
    if (live && m.content) appendCaret(prose);
  }

  const err = $(".msg-error", el);
  err.hidden = !m.error;
  err.textContent = m.error ?? "";

  $(".msg-actions", el).hidden = live;
  const stats = $(".stats", el);
  stats.textContent = settings.showStats && m.stats ? formatStats(m.stats) : "";
}

function appendCaret(prose) {
  let node = prose.lastElementChild;
  if (!node || node.classList.contains("code") || node.tagName === "TABLE") return;
  while (node.lastElementChild && /^(UL|OL|LI|BLOCKQUOTE)$/.test(node.tagName)) node = node.lastElementChild;
  const caret = document.createElement("span");
  caret.className = "caret";
  node.append(caret);
}

const formatDuration = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

function formatStats({ tokens, tokensPerSecond, seconds, stopped }) {
  const parts = [`${tokens} tokens`, `${tokensPerSecond.toFixed(1)} tok/s`, formatDuration(seconds)];
  if (stopped) parts.push("stopped");
  return parts.join(" · ");
}

function messageEl(id) {
  return els.messages.querySelector(`.msg[data-id="${id}"]`);
}

/* ---------- Scrolling ---------- */

function scrollToBottom(force = false) {
  if (force) stickToBottom = true;
  if (stickToBottom) els.thread.scrollTop = els.thread.scrollHeight;
}

els.thread.addEventListener("scroll", () => {
  const distance = els.thread.scrollHeight - els.thread.scrollTop - els.thread.clientHeight;
  stickToBottom = distance < 80;
  els.jump.hidden = distance < 240;
}, { passive: true });

/* ---------- Generation ---------- */

async function sendMessage(text) {
  if (streaming || server.status !== "ready" || !text.trim()) return;

  let chat = activeChat();
  if (!chat) {
    const now = Date.now();
    chat = { id: uid(), title: titleFrom(text), createdAt: now, updatedAt: now, messages: [] };
    chats.unshift(chat);
    openChat(chat.id, { replace: false, render: false });
  }
  chat.messages.push({ id: uid(), role: "user", content: text });
  els.input.value = "";
  autosize();
  await generate(chat);
}

async function generate(chat) {
  const reply = { id: uid(), role: "assistant", content: "", thought: "", thoughtSeconds: null, stats: null, error: null };
  chat.messages.push(reply);
  chat.updatedAt = Date.now();

  const controller = new AbortController();
  streaming = { chatId: chat.id, controller, reply };
  renderSidebar();
  renderThread();
  updateComposer();
  scrollToBottom(true);

  const history = chat.messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.content)
    .map(({ role, content }) => ({ role, content }));

  const started = performance.now();
  let thoughtStart = null;
  let chunks = 0;
  let frame = 0;
  const paint = () => {
    frame = 0;
    if (activeId !== chat.id) return;
    const el = messageEl(reply.id);
    if (el) updateAssistantEl(el, reply);
    scrollToBottom();
  };
  const schedule = () => { frame ||= requestAnimationFrame(paint); };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        system: settings.system,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `The server responded with ${res.status}.`);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const line = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));

        if (ev.type === "thought") {
          thoughtStart ??= performance.now();
          reply.thought += ev.text;
          chunks++;
        } else if (ev.type === "text") {
          if (thoughtStart != null && reply.thoughtSeconds == null) {
            reply.thoughtSeconds = (performance.now() - thoughtStart) / 1000;
          }
          reply.content += ev.text;
          chunks++;
        } else if (ev.type === "done") {
          reply.stats = {
            tokens: ev.tokens,
            seconds: ev.seconds,
            tokensPerSecond: ev.tokensPerSecond,
            stopped: ev.stopped,
          };
        } else if (ev.type === "error") {
          reply.error = ev.error;
        }
        schedule();
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      const seconds = (performance.now() - started) / 1000;
      reply.stats = { tokens: chunks, seconds, tokensPerSecond: seconds ? chunks / seconds : 0, stopped: true };
    } else {
      reply.error = err instanceof TypeError
        ? "Couldn't reach the local server. Check that Unmuzzled is still running in your terminal."
        : err.message;
    }
  } finally {
    cancelAnimationFrame(frame);
    if (thoughtStart != null && reply.thoughtSeconds == null) {
      reply.thoughtSeconds = (performance.now() - thoughtStart) / 1000;
    }
    streaming = null;
    chat.updatedAt = Date.now();
    saveChats();
    renderSidebar();
    if (activeId === chat.id) {
      const el = messageEl(reply.id);
      if (el) updateAssistantEl(el, reply);
      scrollToBottom();
    }
    updateComposer();
  }
}

function stopGeneration() {
  streaming?.controller.abort();
}

/* ---------- Message actions ---------- */

function regenerate(chat) {
  if (streaming) return;
  const last = chat.messages.at(-1);
  if (last?.role === "assistant") chat.messages.pop();
  generate(chat);
}

function startEdit(chat, msg, el) {
  if (streaming) return;
  el.innerHTML =
    `<div class="edit-box">` +
      `<textarea rows="1"></textarea>` +
      `<div class="edit-actions">` +
        `<button class="btn btn-ghost" data-edit="cancel">Cancel</button>` +
        `<button class="btn btn-primary" data-edit="save">Send</button>` +
      `</div>` +
    `</div>`;
  const ta = $("textarea", el);
  ta.value = msg.content;
  const fit = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") renderThread();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
  });
  const save = () => {
    const text = ta.value.trim();
    if (!text) return;
    const idx = chat.messages.indexOf(msg);
    msg.content = text;
    chat.messages = chat.messages.slice(0, idx + 1);
    generate(chat);
  };
  el.addEventListener("click", (e) => {
    const action = e.target.closest("[data-edit]")?.dataset.edit;
    if (action === "cancel") renderThread();
    if (action === "save") save();
  });
  fit();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function flashCopied(btn) {
  const use = $("use", btn);
  const label = $("span", btn);
  const prevIcon = use.getAttribute("href");
  const prevLabel = label?.textContent;
  use.setAttribute("href", "#i-check");
  btn.classList.add("is-done");
  if (label) label.textContent = "Copied";
  setTimeout(() => {
    use.setAttribute("href", prevIcon);
    btn.classList.remove("is-done");
    if (label) label.textContent = prevLabel;
  }, 1400);
}

els.messages.addEventListener("click", (e) => {
  const codeBtn = e.target.closest("[data-copy-code]");
  if (codeBtn) {
    copyText($("code", codeBtn.closest(".code")).textContent);
    flashCopied(codeBtn);
    return;
  }

  const starter = e.target.closest(".starter");
  if (starter) {
    const prompt = starter.dataset.prompt;
    if (prompt.endsWith("\n")) {
      els.input.value = prompt;
      autosize();
      els.input.focus();
    } else {
      sendMessage(prompt);
    }
    return;
  }

  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const chat = activeChat();
  const msgEl = btn.closest(".msg");
  const msg = chat?.messages.find((m) => m.id === msgEl.dataset.id);
  if (!msg) return;

  if (btn.dataset.act === "copy") { copyText(msg.content); flashCopied(btn); }
  if (btn.dataset.act === "retry") regenerate(chat);
  if (btn.dataset.act === "edit") startEdit(chat, msg, msgEl);
});

/* ---------- Chats ---------- */

function openChat(id, { replace = true, render = true } = {}) {
  activeId = id;
  const hash = id ? `#/c/${id}` : "#/";
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  if (render) {
    renderSidebar();
    renderThread();
    updateComposer();
    stickToBottom = true;
    requestAnimationFrame(() => scrollToBottom(true));
  }
  if (isNarrow()) setSidebar(false);
}

function newChat() {
  openChat(null, { replace: false });
  els.input.focus();
}

function deleteChat(id) {
  const index = chats.findIndex((c) => c.id === id);
  if (index === -1) return;
  if (streaming?.chatId === id) stopGeneration();
  const [removed] = chats.splice(index, 1);
  saveChats();
  if (activeId === id) openChat(null);
  else renderSidebar();
  toast("Chat deleted", "Undo", () => {
    chats.splice(index, 0, removed);
    saveChats();
    renderSidebar();
  });
}

els.list.addEventListener("click", (e) => {
  const item = e.target.closest("[data-chat]");
  if (!item) return;
  if (e.target.closest('[data-action="delete-chat"]')) {
    e.stopPropagation();
    deleteChat(item.dataset.chat);
    return;
  }
  openChat(item.dataset.chat, { replace: false });
});
els.list.addEventListener("keydown", (e) => {
  const item = e.target.closest("[data-chat]");
  if (item && e.key === "Enter") openChat(item.dataset.chat, { replace: false });
  if (item && e.key === "Delete") deleteChat(item.dataset.chat);
});
els.search.addEventListener("input", renderSidebar);

// Rename by double-clicking the title.
els.title.addEventListener("dblclick", () => {
  const chat = activeChat();
  if (!chat) return;
  els.title.contentEditable = "true";
  els.title.focus();
  getSelection().selectAllChildren(els.title);
});
els.title.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); els.title.blur(); }
  if (e.key === "Escape") { els.title.textContent = activeChat()?.title ?? ""; els.title.blur(); }
});
els.title.addEventListener("blur", () => {
  if (els.title.contentEditable !== "true") return;
  els.title.contentEditable = "false";
  const chat = activeChat();
  const title = els.title.textContent.trim();
  if (chat && title) { chat.title = title; saveChats(); }
  renderSidebar();
  renderThread();
});

window.addEventListener("popstate", () => {
  const id = location.hash.match(/^#\/c\/(.+)$/)?.[1] ?? null;
  activeId = getChat(id) ? id : null;
  renderSidebar();
  renderThread();
  updateComposer();
});

/* ---------- Composer ---------- */

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 240)}px`;
  updateComposer();
}

function updateComposer() {
  const use = $("use", els.send);
  if (streaming) {
    els.send.disabled = false;
    els.send.classList.add("is-stop");
    els.send.setAttribute("aria-label", "Stop");
    els.send.title = "Stop (Esc)";
    use.setAttribute("href", "#i-stop");
  } else {
    els.send.disabled = server.status !== "ready" || !els.input.value.trim();
    els.send.classList.remove("is-stop");
    els.send.setAttribute("aria-label", "Send");
    els.send.title = "Send";
    use.setAttribute("href", "#i-arrow-up");
  }
  els.input.placeholder =
    server.status === "ready" ? (activeChat() ? "Reply" : "Message the model")
    : server.status === "loading" ? "The model is loading…"
    : server.status === "setup" ? "Download a model to start chatting"
    : server.status === "downloading" ? "Downloading the model…"
    : "The model isn't available";
}

/* ---------- First-run setup ---------- */

const gb = (n) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 2)} GB`;

function formatEta(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  if (seconds < 90) return `${Math.round(seconds)}s left`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min left`;
  return `${(seconds / 3600).toFixed(1)} h left`;
}

function renderSetup() {
  const entry = server.catalog?.[0];
  if (!entry) return;
  let root = $(".setup", els.messages);

  if (!root) {
    els.messages.replaceChildren($("#tpl-setup").content.cloneNode(true));
    root = $(".setup", els.messages);
    const machine = server.setup?.machine ?? {};
    $(".model-card-name", root).textContent = entry.name;
    $(".model-card-variant", root).textContent = entry.variant;
    $(".model-card-desc", root).textContent = entry.description;
    $(".model-card-source", root).href = entry.source;

    const ramOk = machine.totalMemory ? machine.totalMemory >= entry.memoryBytes * 1.5 : null;
    const diskOk = machine.freeDisk != null ? machine.freeDisk >= entry.sizeBytes * 1.05 : null;
    // RAM is marketed in binary units (a "16 GB" laptop reports ~17.1e9 bytes).
    const ramGb = (n) => `${Math.round(n / 2 ** 30)} GB`;
    const rows = [
      ["Download", gb(entry.sizeBytes)],
      ["Memory needed", `~${Math.round(entry.memoryBytes / 1e9)} GB`],
      ["This computer", machine.totalMemory ? `${ramGb(machine.totalMemory)} RAM` : "—", ramOk],
      ["Free disk", machine.freeDisk != null ? gb(machine.freeDisk) : "—", diskOk],
      ["Licence", entry.license],
    ];
    $(".model-card-specs", root).innerHTML = rows
      .map(([k, v, ok]) => `<dt>${k}</dt><dd${ok === false ? ' class="is-bad"' : ""}>${escapeHtml(v)}</dd>`)
      .join("");
    $(".setup-path", root).textContent = machine.modelsDir ?? "";
  }

  const downloading = server.status === "downloading";
  const d = server.download;
  const btn = $(".setup-btn", root);
  const label = $(".setup-btn-label", root);
  const icon = $(".setup-btn use", root);

  if (downloading) {
    btn.dataset.action = "setup-pause";
    btn.classList.remove("btn-primary");
    label.textContent = d?.pausing ? "Pausing…" : "Pause";
    icon.setAttribute("href", "#i-pause");
  } else {
    btn.dataset.action = "setup-download";
    btn.classList.add("btn-primary");
    label.textContent = server.setup?.resumable ? "Resume download" : `Download · ${gb(entry.sizeBytes)}`;
    icon.setAttribute("href", "#i-download");
  }
  btn.disabled = !!d?.pausing;

  const progress = $(".setup-progress", root);
  progress.hidden = !downloading;
  if (downloading && d) {
    const pct = d.total ? (d.downloaded / d.total) * 100 : 0;
    $(".setup-fill", root).style.width = `${Math.max(0.5, pct)}%`;
    $(".setup-amount", root).textContent = `${gb(d.downloaded)} of ${gb(d.total)} · ${pct.toFixed(0)}%`;
    $(".setup-speed", root).textContent = d.pausing ? "Pausing…" : d.speed
      ?[`${(d.speed / 1e6).toFixed(1)} MB/s`, formatEta((d.total - d.downloaded) / d.speed)].filter(Boolean).join(" · ")
      : "Connecting…";
  }

  const err = $(".setup-error", root);
  err.hidden = !server.error;
  err.textContent = server.error ?? "";
}

async function setupAction(action, btn) {
  btn.disabled = true;
  try {
    await fetch(`/api/setup/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch {}
  clearTimeout(pollTimer);
  setTimeout(pollStatus, 300);
}

els.input.addEventListener("input", autosize);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (streaming) stopGeneration();
  else sendMessage(els.input.value);
});

/* ---------- Settings ---------- */

function applyTheme() {
  if (settings.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  for (const b of $("#set-theme").children) b.setAttribute("aria-checked", b.dataset.value === settings.theme);
}

function bindRange(id, outId, key, format) {
  const input = $(id);
  const out = $(outId);
  const sync = () => {
    out.textContent = format(settings[key]);
    const pct = ((settings[key] - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--fill", `${pct}%`);
  };
  input.value = settings[key];
  sync();
  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    sync();
    saveSettings();
  });
}

function initSettings() {
  const system = $("#set-system");
  system.value = settings.system;
  system.addEventListener("input", () => { settings.system = system.value; saveSettings(); });

  bindRange("#set-temperature", "#out-temperature", "temperature", (v) => v.toFixed(2));
  bindRange("#set-topp", "#out-topp", "topP", (v) => v.toFixed(2));

  const max = $("#set-maxtokens");
  max.value = settings.maxTokens;
  max.addEventListener("change", () => {
    settings.maxTokens = Math.max(0, Math.round(Number(max.value) || 0));
    max.value = settings.maxTokens;
    saveSettings();
  });

  $("#set-theme").addEventListener("click", (e) => {
    const b = e.target.closest("[data-value]");
    if (!b) return;
    settings.theme = b.dataset.value;
    applyTheme();
    saveSettings();
  });

  for (const [id, key] of [["#set-thinking", "showThinking"], ["#set-stats", "showStats"]]) {
    const box = $(id);
    box.checked = settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      saveSettings();
      renderThread();
    });
  }

  applyTheme();
}

function renderSpec() {
  const m = server.model;
  const statusText = {
    loading: "Loading", ready: "Ready", error: "Failed to load", offline: "Server not reachable",
    setup: "Not downloaded", downloading: "Downloading",
  }[server.status];
  const rows = [["Status", statusText]];
  if (m) {
    rows.push(
      ["Model", m.name],
      ["File", m.file],
      ["Parameters", m.params ?? "—"],
      ["Quantisation", m.quant ?? "—"],
      ["Size", m.sizeBytes ? `${(m.sizeBytes / 1e9).toFixed(2)} GB` : "—"],
    );
    if (m.backend) rows.push(["Backend", backendName(m.backend)]);
    if (m.contextSize) rows.push(["Context", `${m.contextSize.toLocaleString()} tokens`]);
  }
  if (server.error) rows.push(["Error", server.error]);
  els.spec.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
}

const backendName = (b) =>
  ({ cuda: "CUDA", vulkan: "Vulkan", metal: "Metal", cpu: "CPU", mock: "Mock" })[b] ?? b;

function openSettings(open) {
  els.app.dataset.drawer = open ? "open" : "closed";
  els.drawer.setAttribute("aria-hidden", !open);
  if (open) { renderSpec(); $(".drawer-head button", els.drawer).focus(); }
}

function exportChats() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), chats }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `unmuzzleds-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let clearArmed = null;
function clearAll(btn) {
  if (!chats.length) return toast("There are no chats to delete");
  if (!clearArmed) {
    const label = btn.lastChild;
    const original = label.textContent;
    label.textContent = " Click again to confirm";
    clearArmed = setTimeout(() => { label.textContent = original; clearArmed = null; }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  btn.lastChild.textContent = " Delete all";
  stopGeneration();
  chats = [];
  storage.set("unmuzzled.chats", chats);
  openChat(null);
  toast("All chats deleted");
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(message, actionLabel, action) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  if (actionLabel) {
    const b = document.createElement("button");
    b.textContent = actionLabel;
    b.onclick = () => { action(); el.remove(); };
    el.append(b);
  }
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 5000);
}

/* ---------- Server status ---------- */

let pollTimer;
async function pollStatus() {
  let next = 10_000;
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    const data = await res.json();
    server = {
      status: data.status, model: data.model, error: data.error,
      download: data.download, catalog: data.catalog, setup: data.setup,
    };
    if (data.status === "loading") next = 1500;
    if (data.status === "downloading") next = 1000;
    if (data.status === "setup") next = 4000;
  } catch {
    server = { ...server, status: "offline" };
    next = 3000;
  }
  renderStatus();
  pollTimer = setTimeout(pollStatus, next);
}

let lastStatusKey = "";
let lastStatus = "";
function renderStatus() {
  const key = JSON.stringify(server);
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  const leftSetup = (lastStatus === "setup" || lastStatus === "downloading") && !inSetup();
  lastStatus = server.status;

  const m = server.model;
  const d = server.download;
  els.dot.dataset.state = server.status === "downloading" ? "loading" : server.status;
  els.chipName.textContent = m?.name ?? server.catalog?.[0]?.name ?? (server.status === "offline" ? "Server offline" : "Connecting…");
  els.chipMeta.textContent =
    server.status === "loading" ? "loading model…"
    : server.status === "setup" ? "not downloaded yet"
    : server.status === "downloading" ? `downloading ${d?.total ? Math.floor((d.downloaded / d.total) * 100) : 0}%`
    : server.status === "error" ? "failed to load"
    : server.status === "offline" ? "start unmuzzled in a terminal"
    : [m?.quant, m?.backend && backendName(m.backend), m?.contextSize && `${Math.round(m.contextSize / 1024)}K ctx`]
        .filter(Boolean).join(" · ");

  if (!activeChat() || inSetup() || leftSetup) renderThread();
  if (els.app.dataset.drawer === "open") renderSpec();
  updateComposer();
}

/* ---------- Global actions & shortcuts ---------- */

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  switch (action) {
    case "toggle-sidebar": setSidebar(els.app.dataset.sidebar !== "open"); break;
    case "new-chat": newChat(); break;
    case "open-settings": openSettings(true); break;
    case "close-settings": openSettings(false); break;
    case "jump": scrollToBottom(true); break;
    case "export": exportChats(); break;
    case "clear-all": clearAll(e.target.closest("[data-action]")); break;
    case "setup-download": setupAction("download", e.target.closest("[data-action]")); break;
    case "setup-pause": setupAction("pause", e.target.closest("[data-action]")); break;
  }
});

// Clicking the dimmed area outside the drawer closes it.
document.addEventListener("pointerdown", (e) => {
  if (els.app.dataset.drawer === "open" && !els.drawer.contains(e.target) && !e.target.closest('[data-action="open-settings"]')) {
    openSettings(false);
  }
});

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); newChat(); return; }
  if (mod && e.key === "\\") { e.preventDefault(); setSidebar(els.app.dataset.sidebar !== "open"); return; }
  if (e.key === "Escape") {
    if (els.app.dataset.drawer === "open") return openSettings(false);
    if (streaming) return stopGeneration();
  }
  const typing = e.target.closest("input, textarea, [contenteditable='true']");
  if (e.key === "/" && !typing) { e.preventDefault(); els.input.focus(); }
});

/* ---------- Boot ---------- */

function boot() {
  // Drop any reply left half-finished by a closed tab.
  for (const c of chats) {
    c.messages = c.messages.filter((m) => m.role === "user" || m.content || m.error);
  }

  const savedSidebar = storage.get("unmuzzled.sidebar", true);
  els.app.dataset.sidebar = !isNarrow() && savedSidebar ? "open" : "closed";
  // Crossing the breakpoint: overlay sidebar starts closed, docked sidebar restores its saved state.
  matchMedia("(max-width: 900px)").addEventListener("change", (e) => {
    els.app.dataset.sidebar = !e.matches && storage.get("unmuzzled.sidebar", true) ? "open" : "closed";
  });
  els.app.dataset.drawer = "closed";

  const id = location.hash.match(/^#\/c\/(.+)$/)?.[1];
  activeId = getChat(id) ? id : null;

  initSettings();
  renderSidebar();
  renderThread();
  updateComposer();
  scrollToBottom(true);
  pollStatus();
  els.input.focus();
}

boot();
