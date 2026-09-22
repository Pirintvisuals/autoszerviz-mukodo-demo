(function () {
  // ---------------------------------------------------------------------------
  //  Per-shop settings - the only block that differs between workshops.
  //  Everything below it is shared. Rebranding is this block plus a logo.
  // ---------------------------------------------------------------------------
  const BOT = {
    id: "autoszerviz-minta",
    subtitle: "Automata árajánlatkészítő",
    phone: "+36 70 250 1739",
    greeting: "Szia! Pár kérdés, és kapsz egy **tételes becslést** a javításra.\n\nKözben **bármit megkérdezhetsz**.",
    hint: "Kérdezz bátran - pl. mi van benne az árban",
    teasers: [
      "Mennyibe kerül a vezérműszíj csere?",
      "Fékbetét, kuplung, olajcsere? Számoljunk!",
      "Pár kérdés, és látod az árat.",
      "Nem tudod, mi a baja? Segítek.",
    ],
  };

  // Embed options, set on the host page BEFORE this script:
  //   window.AUTOSZERVIZ_CONFIG = {
  //     apiUrl: "https://<app>.vercel.app/api/faq-agent",
  //     assetsUrl: "https://<app>.vercel.app",
  //     launcher: false,  // the site already has its own floating button
  //     autoOpen: false,  // do not pop the chat open by itself
  //   };
  // Any element with data-quote-agent or .js-quote-agent opens the chat.
  const config = window.AUTOSZERVIZ_CONFIG || {};
  const apiUrl = config.apiUrl || "/api/faq-agent";
  const assetsUrl = String(config.assetsUrl || "").replace(/\/+$/, "");
  const SHOW_LAUNCHER = config.launcher !== false;
  // The prototype is handed out as a link, so the chat opens itself: one fewer
  // tap between a mechanic tapping the link and seeing the first question.
  const AUTO_OPEN = config.autoOpen !== false;
  const PHONE = BOT.phone;
  const asset = (name) => (assetsUrl ? `${assetsUrl}/${name}` : name);

  const T = {
    launcherAria: "Árajánlatkészítő megnyitása",
    bubbleClose: "Buborék bezárása",
    chatClose: "Csevegés bezárása",
    sendAria: "Küldés",
    callAria: "Hívás",
    placeholder: "Írd be a válaszod, vagy kérdezz…",
    inputAria: "Válasz vagy kérdés",
    dialogAria: "Autószerviz árajánlatkészítő",
    concept: "Minta árakkal fut. A végleges árat a szerviz erősíti meg, miután látta az autót.",
    next: "Tovább",
    errGeneric: "Elnézést, hiba történt. Próbáld újra, vagy hívj: " + PHONE,
    errConnect: "Elnézést, nem sikerült kapcsolódni. Próbáld újra, vagy hívj: " + PHONE,
  };

  // --- Analytics (PostHog) -------------------------------------------------
  // Every event is tagged with `client`, so one PostHog project breaks down by
  // bot. Nothing the customer types is ever sent as a property or shown in a
  // session replay (inputs and the customer's own bubbles are masked).
  // Analytics is OFF in the prototype: there is no funnel to measure yet, and a
  // tracker on a page handed to strangers is one more thing to explain. Set
  // window.AUTOSZERVIZ_CONFIG.posthogKey to switch it on later.
  const POSTHOG_KEY = config.posthogKey || "";
  const POSTHOG_HOST = config.posthogHost || "https://eu.i.posthog.com";
  const CLIENT_ID = config.client || BOT.id;
  const WIDGET_VERSION = "2026-09-11";
  const SESSION_REPLAY = config.sessionReplay !== false;

  function track(event, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === "function") window.posthog.capture(event, props || {});
    } catch (e) {}
  }

  function initAnalytics() {
    if (!POSTHOG_KEY || POSTHOG_KEY.indexOf("REPLACE") !== -1) return;
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    try {
      window.posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: !SESSION_REPLAY,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: ".faq-msg.user .faq-bubble, .ph-no-capture",
        },
      });
      window.posthog.register({ client: CLIENT_ID, widget_version: WIDGET_VERSION, language: navigator.language || "" });
    } catch (e) {}
  }

  let container = null;
  let chatOpen = false;
  let chatWindow = null;
  let messagesContainer = null;
  let inputElement = null;
  let sending = false;
  let conversationHistory = []; // [{ role: "user"|"assistant", content }]
  let convState = {};           // answers so far, carried turn to turn
  let started = false;
  let quoteDone = false;
  let formEl = null;
  let progressFillEl = null, progressLabelEl = null, progressBarEl = null;
  let lastProgress = 0, lastProgressTotal = 0;

  // --- Owner transcript copy ------------------------------------------------
  // The backend only e-mails a finished quote. Most visitors stop before that,
  // so the conversation is also pushed to the owner when it ends without one:
  // chat closed, page closed or hidden, or 3 minutes idle.
  const TRANSCRIPT_IDLE_MS = 3 * 60 * 1000;
  const TRANSCRIPT_CLOSE_MS = 20 * 1000;
  const TRANSCRIPT_MAX_SENDS = 3;
  let sessionId = newSessionId();
  let transcriptSends = 0;
  let transcriptSentAt = 0;
  let idleTimer = null, closeTimer = null;

  function newSessionId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 8); } catch (e) {}
    return Math.random().toString(36).slice(2, 10);
  }

  function flushTranscript(reason) {
    if (quoteDone) return;
    if (transcriptSends >= TRANSCRIPT_MAX_SENDS) return;
    if (!conversationHistory.some((m) => m.role === "user")) return; // opened, never answered
    if (conversationHistory.length <= transcriptSentAt) return;

    const payload = JSON.stringify({
      action: "transcript",
      history: conversationHistory.slice(-80),
      state: convState,
      sessionId: sessionId,
      pageUrl: location.href,
      reason: reason || "",
      update: transcriptSends > 0,
    });
    transcriptSends++;
    transcriptSentAt = conversationHistory.length;

    // sendBeacon survives the page closing; text/plain keeps it a simple
    // request with no CORS preflight. fetch+keepalive is the fallback.
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(apiUrl, new Blob([payload], { type: "text/plain;charset=UTF-8" }))) return;
    } catch (e) {}
    try {
      fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    } catch (e) {}
  }

  function armIdleFlush() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => flushTranscript("3 perc tétlenség"), TRANSCRIPT_IDLE_MS);
  }

  function watchPageExit() {
    window.addEventListener("pagehide", () => flushTranscript("oldal elhagyva"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushTranscript("lap háttérbe került");
    });
  }

  // --- Icons -----------------------------------------------------------------
  const ICON = {
    chat: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    house: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.6-4.3A2 2 0 0 1 8.5 7.4h7a2 2 0 0 1 1.9 1.3L19 13"/><path d="M4 13h16v4H4z"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function injectStyles() {
    if (document.getElementById("faq-agent-styles")) return;
    const link = document.createElement("link");
    link.id = "faq-agent-styles";
    link.rel = "stylesheet";
    link.href = asset("style.css");
    document.head.appendChild(link);
  }

  function createContainer() {
    container = document.createElement("div");
    container.id = "faq-agent-container";
    document.body.appendChild(container);
  }

  // --- Launcher + rotating teaser ---------------------------------------------
  const TEASER_ROTATE_MS = 9000;
  const TEASER_DISMISS_KEY = BOT.id + "_teaser_dismissed";
  let teaserIdx = Math.floor(Math.random() * BOT.teasers.length);
  let teaserTimer = null;
  let teaserDismissed = false;
  try { teaserDismissed = localStorage.getItem(TEASER_DISMISS_KEY) === "1"; } catch (e) {}

  function createLauncher() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "faq-chat-launcher";
    btn.setAttribute("aria-label", T.launcherAria);
    btn.innerHTML = `<span class="faq-launcher-ring" aria-hidden="true"></span>${ICON.chat}<span class="faq-launcher-dot" aria-hidden="true"></span>`;
    btn.onclick = toggleChat;
    container.appendChild(btn);

    const tooltip = document.createElement("div");
    tooltip.className = "faq-chat-tooltip hidden";
    tooltip.setAttribute("role", "button");
    tooltip.setAttribute("tabindex", "0");
    tooltip.innerHTML = `<span class="faq-tooltip-text">${BOT.teasers[teaserIdx]}</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "faq-tooltip-close";
    closeBtn.setAttribute("aria-label", T.bubbleClose);
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      teaserDismissed = true;
      try { localStorage.setItem(TEASER_DISMISS_KEY, "1"); } catch (err) {}
      hideTeaser();
    };
    tooltip.appendChild(closeBtn);
    const openFromTooltip = () => { hideTeaser(); if (!chatOpen) toggleChat(); };
    tooltip.onclick = openFromTooltip;
    tooltip.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFromTooltip(); } };
    container.appendChild(tooltip);
    setTimeout(showTeaser, 1600);
  }

  function teaserEl() { return container && container.querySelector(".faq-chat-tooltip"); }

  function rotateTeaser() {
    const tip = teaserEl();
    if (!tip || !tip.classList.contains("show")) return;
    const textEl = tip.querySelector(".faq-tooltip-text");
    tip.classList.add("swapping");
    setTimeout(() => {
      teaserIdx = (teaserIdx + 1) % BOT.teasers.length;
      textEl.textContent = BOT.teasers[teaserIdx];
      tip.classList.remove("swapping");
      tip.classList.add("attention");
      setTimeout(() => tip.classList.remove("attention"), 650);
    }, 260);
  }

  function showTeaser() {
    if (teaserDismissed || chatOpen) return;
    const tip = teaserEl();
    if (!tip) return;
    tip.classList.remove("hidden");
    void tip.offsetWidth;
    tip.classList.add("show");
    if (!teaserTimer) teaserTimer = setInterval(rotateTeaser, TEASER_ROTATE_MS);
  }

  function hideTeaser() {
    const tip = teaserEl();
    if (teaserTimer) { clearInterval(teaserTimer); teaserTimer = null; }
    if (!tip) return;
    tip.classList.remove("show");
    setTimeout(() => tip.classList.add("hidden"), 300);
  }

  // --- Open / close -----------------------------------------------------------
  function toggleChat() {
    const launcher = container.querySelector(".faq-chat-launcher");
    if (chatOpen) {
      const w = chatWindow;
      w.classList.add("closing");
      setTimeout(() => { w.style.display = "none"; w.classList.remove("closing"); }, 180);
      chatOpen = false;
      if (launcher) launcher.classList.remove("active");
      track("chat_closed", { answered: lastProgress, total: lastProgressTotal });
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => flushTranscript("csevegés bezárva"), TRANSCRIPT_CLOSE_MS);
      if (SHOW_LAUNCHER) setTimeout(showTeaser, 400);
    } else {
      hideTeaser();
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      if (!chatWindow) {
        buildChat();
      } else {
        chatWindow.style.display = "flex";
        chatWindow.style.animation = "none";
        void chatWindow.offsetWidth;
        chatWindow.style.animation = "";
        scrollToBottom();
      }
      chatOpen = true;
      if (launcher) launcher.classList.add("active");
      track("chat_opened");
    }
  }

  function openChat() { if (!chatOpen) toggleChat(); }
  function closeChat() { if (chatOpen) toggleChat(); }

  function buildChat() {
    chatWindow = document.createElement("div");
    chatWindow.className = "faq-chat-window";
    chatWindow.setAttribute("role", "dialog");
    chatWindow.setAttribute("aria-label", T.dialogAria);

    const header = document.createElement("div");
    header.className = "faq-chat-header";
    header.innerHTML =
      `<div class="faq-header-text">` +
        `<span class="faq-header-mark" aria-hidden="true">` +
          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<circle cx="12" cy="12" r="3"></circle>` +
            `<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>` +
          `</svg>` +
        `</span>` +
        `<span class="faq-header-status"><span class="faq-status-dot" aria-hidden="true"></span>${BOT.subtitle}</span>` +
      `</div>`;
    const actions = document.createElement("div");
    actions.className = "faq-header-actions";
    const phone = document.createElement("a");
    phone.className = "faq-header-phone";
    phone.href = `tel:${PHONE.replace(/\s/g, "")}`;
    phone.setAttribute("aria-label", `${T.callAria}: ${PHONE}`);
    phone.innerHTML = `${ICON.phone}<span>${PHONE}</span>`;
    phone.onclick = () => track("phone_clicked");
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "faq-header-close";
    closeBtn.setAttribute("aria-label", T.chatClose);
    closeBtn.innerHTML = ICON.close;
    closeBtn.onclick = toggleChat;
    actions.appendChild(phone);
    actions.appendChild(closeBtn);
    header.appendChild(actions);

    const concept = document.createElement("div");
    concept.className = "faq-concept-banner";
    concept.textContent = T.concept;

    const progress = document.createElement("div");
    progress.className = "faq-progress";
    progress.innerHTML = '<div class="faq-progress-track"><div class="faq-progress-fill"></div></div><span class="faq-progress-label"></span>';
    progressBarEl = progress;
    progressFillEl = progress.querySelector(".faq-progress-fill");
    progressLabelEl = progress.querySelector(".faq-progress-label");

    messagesContainer = document.createElement("div");
    messagesContainer.className = "faq-chat-messages";
    messagesContainer.setAttribute("role", "log");
    messagesContainer.setAttribute("aria-live", "polite");

    const hintBar = document.createElement("div");
    hintBar.className = "faq-question-hint";
    hintBar.textContent = BOT.hint;

    const inputBar = document.createElement("form");
    inputBar.className = "faq-chat-input";
    inputBar.onsubmit = (e) => { e.preventDefault(); sendMessage(); };
    inputElement = document.createElement("input");
    inputElement.type = "text";
    inputElement.className = "faq-input-field";
    inputElement.setAttribute("aria-label", T.inputAria);
    inputElement.placeholder = T.placeholder;
    inputElement.autocomplete = "off";
    inputElement.maxLength = 1500;
    // Enter sends explicitly instead of relying on implicit form submission,
    // which not every browser or input method triggers.
    inputElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "faq-send-btn";
    sendBtn.setAttribute("aria-label", T.sendAria);
    sendBtn.innerHTML = ICON.send;
    inputBar.appendChild(inputElement);
    inputBar.appendChild(sendBtn);

    chatWindow.appendChild(header);
    chatWindow.appendChild(concept);
    chatWindow.appendChild(progress);
    chatWindow.appendChild(messagesContainer);
    chatWindow.appendChild(hintBar);
    chatWindow.appendChild(inputBar);
    container.appendChild(chatWindow);

    // No autofocus on touch screens: it would pop the keyboard over the buttons.
    if (!window.matchMedia || !window.matchMedia("(pointer: coarse)").matches) {
      setTimeout(() => inputElement && inputElement.focus(), 150);
    }

    if (!started) {
      started = true;
      track("quote_started");
      addMessage("bot", BOT.greeting);
      conversationHistory.push({ role: "assistant", content: BOT.greeting });
      post({ action: "start", state: convState }, false);
    }
  }

  // --- Rendering ----------------------------------------------------------------
  function renderMarkdown(text) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const safeUrl = (u) => (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(u) ? u : "#");
    const inline = (s) =>
      esc(s)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => `<a href="${safeUrl(url.trim())}" target="_blank" rel="noopener noreferrer">${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    let html = "";
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "") { html += '<div class="faq-sp"></div>'; continue; }
      if (line.startsWith("•")) { html += '<div class="faq-li">' + inline(line.replace(/^•\s*/, "")) + "</div>"; continue; }
      if (/^\*\*[^*]+\*\*:?$/.test(line)) { html += '<div class="faq-h">' + inline(line) + "</div>"; continue; }
      html += '<div class="faq-p">' + inline(line) + "</div>";
    }
    return html;
  }

  function scrollToBottom() {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function avatar() {
    const a = document.createElement("span");
    a.className = "faq-avatar";
    a.setAttribute("aria-hidden", "true");
    a.innerHTML = ICON.house;
    return a;
  }

  function addMessage(sender, text) {
    const msg = document.createElement("div");
    msg.className = "faq-msg " + sender;
    if (sender === "bot") msg.appendChild(avatar());
    const bubble = document.createElement("div");
    bubble.className = "faq-bubble";
    if (sender === "bot") bubble.innerHTML = renderMarkdown(text);
    else { bubble.textContent = text; bubble.classList.add("ph-no-capture"); }
    msg.appendChild(bubble);
    messagesContainer.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  let thinkingEl = null;
  function addThinking() {
    const msg = document.createElement("div");
    msg.className = "faq-msg bot";
    msg.appendChild(avatar());
    const bubble = document.createElement("div");
    bubble.className = "faq-bubble faq-typing";
    bubble.innerHTML = "<span></span><span></span><span></span>";
    msg.appendChild(bubble);
    messagesContainer.appendChild(msg);
    scrollToBottom();
    thinkingEl = msg;
  }
  function removeThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  function clearChips() {
    if (messagesContainer) messagesContainer.querySelectorAll(".faq-chips").forEach((c) => c.remove());
  }

  function makeChip(label) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "faq-chip";
    chip.textContent = label;
    return chip;
  }

  function renderChips(chips) {
    clearChips();
    if (!chips || !chips.length) return;
    const wrap = document.createElement("div");
    wrap.className = "faq-chips";
    chips.forEach((label) => {
      const chip = makeChip(label);
      chip.onclick = () => { clearChips(); sendMessage(label); };
      wrap.appendChild(chip);
    });
    messagesContainer.appendChild(wrap);
    scrollToBottom();
  }

  // Multi-select: toggle chips, then "Tovább". A "none of these" chip clears
  // the others and is cleared by them.
  function renderMultiChips(chips, exclusive, nextLabel) {
    clearChips();
    if (!chips || !chips.length) return;
    const ex = exclusive || [];
    const picked = new Set();
    const wrap = document.createElement("div");
    wrap.className = "faq-chips faq-chips--multi";
    const buttons = [];
    const go = document.createElement("button");
    go.type = "button";
    go.className = "faq-chip faq-chip-next";
    go.textContent = nextLabel || T.next;
    go.disabled = true;

    const refresh = () => {
      buttons.forEach((b) => {
        const on = picked.has(b.dataset.label);
        b.classList.toggle("is-picked", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      go.disabled = picked.size === 0;
    };

    chips.forEach((label) => {
      const chip = makeChip("");
      chip.dataset.label = label;
      chip.setAttribute("aria-pressed", "false");
      chip.innerHTML = `<span class="faq-chip-tick" aria-hidden="true">${ICON.check}</span><span></span>`;
      chip.lastChild.textContent = label;
      chip.onclick = () => {
        if (picked.has(label)) picked.delete(label);
        else {
          if (ex.includes(label)) picked.clear();
          else ex.forEach((x) => picked.delete(x));
          picked.add(label);
        }
        refresh();
      };
      buttons.push(chip);
      wrap.appendChild(chip);
    });
    go.onclick = () => {
      if (!picked.size) return;
      const text = chips.filter((l) => picked.has(l)).join(" · ");
      clearChips();
      sendMessage(text);
    };
    wrap.appendChild(go);
    messagesContainer.appendChild(wrap);
    scrollToBottom();
  }

  // --- Contact form ------------------------------------------------------------
  // "Miből jött ki ez az ár?" - the normaidő, the óradíj and the part price
  // behind every line. A mechanic wants to audit the number, and letting him is
  // what stops this looking like a black box. Collapsed by default, so a normal
  // customer never has to care.
  function renderWorkings(w, extraClass) {
    const det = document.createElement("details");
    det.className = "faq-workings" + (extraClass ? " " + extraClass : "");
    // The sales panel is the one a mechanic should actually read, so it opens
    // itself; the arithmetic stays folded away for whoever wants to check it.
    if (extraClass === "faq-live") det.open = true;
    const sum = document.createElement("summary");
    sum.textContent = w.title || "Miből jött ki ez az ár?";
    det.appendChild(sum);
    if (w.note) {
      const note = document.createElement("div");
      note.className = "faq-workings-note";
      note.textContent = w.note;
      det.appendChild(note);
    }
    const ul = document.createElement("ul");
    (w.lines || []).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = String(line).replace(/\*\*/g, "");
      ul.appendChild(li);
    });
    det.appendChild(ul);
    if (w.footer) {
      const f = document.createElement("div");
      f.className = "faq-workings-note";
      f.textContent = w.footer;
      det.appendChild(f);
    }
    messagesContainer.appendChild(det);
    scrollToBottom();
  }

  // "Ez minta ár. Nálad a te számaid mennének bele" - three lines, always open,
  // styled as a card rather than a disclosure. This is the sentence the whole
  // prototype exists to earn, so it is not something to unfold.
  function renderLive(w) {
    const box = document.createElement("div");
    box.className = "faq-live";
    const h = document.createElement("div");
    h.className = "faq-live-title";
    h.textContent = w.title || "";
    box.appendChild(h);
    const ul = document.createElement("ul");
    (w.lines || []).forEach((line) => {
      const li = document.createElement("li");
      li.innerHTML = renderMarkdown(String(line));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (w.footer) {
      const f = document.createElement("div");
      f.className = "faq-live-foot";
      f.textContent = w.footer;
      box.appendChild(f);
    }
    messagesContainer.appendChild(box);
    scrollToBottom();
  }

  function clearContactForm() {
    if (formEl) { formEl.remove(); formEl = null; }
  }

  // Options for a combo box, given what the other boxes currently hold. The
  // whole catalogue arrives with the form, so this never needs a round trip.
  function comboOptions(f, catalog, values) {
    if (!catalog) return [];
    if (f.source === "makes") return Object.keys(catalog);
    if (f.source === "models") {
      const make = matchKey(catalog, values.make);
      return make ? Object.keys(catalog[make]) : [];
    }
    if (f.source === "engines") {
      const make = matchKey(catalog, values.make);
      if (!make) return [];
      const model = matchKey(catalog[make], values.model);
      return model ? catalog[make][model] : [];
    }
    return [];
  }

  // Loose match so "mercedes" finds "Mercedes-Benz" and "3as" finds "3-as".
  function fold(x) {
    return String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function matchKey(obj, typed) {
    if (!obj || !typed) return null;
    const t = fold(typed);
    if (!t) return null;
    const keys = Object.keys(obj);
    return keys.find((k) => fold(k) === t)
      || keys.find((k) => fold(k).startsWith(t) || t.startsWith(fold(k)))
      || null;
  }

  // A text input with a filtered suggestion list underneath it.
  function buildCombo(f, getOptions, onPick) {
    const box = document.createElement("div");
    box.className = "faq-combo";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "faq-form-input ph-no-capture";
    input.placeholder = f.placeholder || "";
    input.value = f.value || "";
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "words");
    const list = document.createElement("div");
    list.className = "faq-combo-list";
    box.appendChild(input);
    box.appendChild(list);

    let active = -1;
    const close = () => { list.innerHTML = ""; list.classList.remove("open"); active = -1; };
    const render = () => {
      const typed = fold(input.value);
      const all = getOptions() || [];
      // With nothing typed, show the lot (capped) so the box is browsable too,
      // not only searchable - a lot of people would rather scan than type.
      const hits = (typed ? all.filter((o) => fold(o).includes(typed)) : all).slice(0, 8);
      list.innerHTML = "";
      if (!hits.length) { close(); return; }
      hits.forEach((o, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "faq-combo-item";
        b.textContent = o;
        b.onmousedown = (e) => { e.preventDefault(); pick(o); };
        if (i === active) b.classList.add("active");
        list.appendChild(b);
      });
      list.classList.add("open");
    };
    const pick = (value) => {
      input.value = value;
      close();
      if (onPick) onPick(value);
    };

    input.addEventListener("focus", render);
    input.addEventListener("input", () => { active = -1; render(); if (onPick) onPick(input.value); });
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
      const items = [...list.querySelectorAll(".faq-combo-item")];
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = e.key === "ArrowDown"
          ? Math.min(items.length - 1, active + 1)
          : Math.max(0, active - 1);
        items.forEach((el, i) => el.classList.toggle("active", i === active));
      } else if (e.key === "Enter") {
        if (active >= 0) { e.preventDefault(); pick(items[active].textContent); }
        else if (items.length === 1) { e.preventDefault(); pick(items[0].textContent); }
      } else if (e.key === "Escape") {
        close();
      }
    });
    return { box: box, input: input, refresh: render };
  }

  function renderContactForm(form, errors) {
    clearChips();
    clearContactForm();
    const wrap = document.createElement("form");
    wrap.className = "faq-form";
    wrap.noValidate = true;

    if (form.title) {
      const h = document.createElement("div");
      h.className = "faq-form-title";
      h.textContent = form.title;
      wrap.appendChild(h);
    }

    const inputs = {};
    (form.fields || []).forEach((f) => {
      const row = document.createElement("label");
      row.className = "faq-form-row";
      const lab = document.createElement("span");
      lab.className = "faq-form-label";
      lab.textContent = f.label;
      row.appendChild(lab);
      if (f.help) {
        const help = document.createElement("span");
        help.className = "faq-form-help";
        help.textContent = f.help;
        row.appendChild(help);
      }

      let input;
      if (f.type === "combo") {
        const read = () => {
          const v = {};
          Object.keys(inputs).forEach((k) => { v[k] = inputs[k].input.value.trim(); });
          return v;
        };
        const combo = buildCombo(f, () => comboOptions(f, form.catalog, read()), () => {
          // Picking a brand invalidates the model, and a model the engine: the
          // old value would silently belong to a different car.
          (f.source === "makes" ? ["model", "engine"] : f.source === "models" ? ["engine"] : [])
            .forEach((k) => { if (inputs[k]) inputs[k].input.value = ""; });
        });
        input = combo.input;
        row.appendChild(combo.box);
        const err0 = document.createElement("span");
        err0.className = "faq-form-err";
        row.appendChild(err0);
        inputs[f.key] = { input: input, err: err0, row: row };
        wrap.appendChild(row);
        return;
      }
      if (f.type === "select") {
        input = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = f.optional ? "-" : "Válassz…";
        input.appendChild(blank);
        (f.options || []).forEach((o) => {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o;
          if (f.value === o) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
        input.placeholder = f.placeholder || "";
        input.value = f.value || "";
      } else {
        input = document.createElement("input");
        input.type = f.type || "text";
        input.placeholder = f.placeholder || "";
        input.value = f.value || "";
        if (f.autocomplete) input.autocomplete = f.autocomplete;
        if (f.key === "phone") input.inputMode = "tel";
      }
      input.className = "faq-form-input ph-no-capture";
      row.appendChild(input);

      // Nobody testing a prototype from their sofa wants to type their own
      // number plate, so a field that offers a sample gets a one-tap filler.
      if (f.sample) {
        const fill = document.createElement("button");
        fill.type = "button";
        fill.className = "faq-form-sample";
        fill.textContent = f.sampleLabel || "Minta";
        fill.onclick = () => { input.value = f.sample; input.focus(); };
        row.appendChild(fill);
      }

      const err = document.createElement("span");
      err.className = "faq-form-err";
      row.appendChild(err);
      inputs[f.key] = { input: input, err: err, row: row };
      wrap.appendChild(row);
    });

    const btn = document.createElement("button");
    btn.type = "submit";
    btn.className = "faq-form-submit";
    btn.textContent = form.submit || "OK";
    wrap.appendChild(btn);

    if (form.why) {
      const why = document.createElement("div");
      why.className = "faq-form-why";
      why.textContent = form.why;
      wrap.appendChild(why);
    }

    if (errors) {
      let focused = false;
      Object.keys(errors).forEach((k) => {
        const f = inputs[k];
        if (!f) return;
        f.row.classList.add("faq-form-row--bad");
        f.err.textContent = String(errors[k]).replace(/\*\*/g, "");
        if (!focused) { try { f.input.focus(); } catch (e) {} focused = true; }
      });
    }

    wrap.onsubmit = (e) => {
      e.preventDefault();
      if (sending) return;
      const values = {};
      Object.keys(inputs).forEach((k) => { values[k] = inputs[k].input.value.trim(); });
      submitContactForm(values, form);
    };

    messagesContainer.appendChild(wrap);
    formEl = wrap;
    scrollToBottom();
  }

  async function submitContactForm(values, form) {
    if (sending) return;
    // The feedback form posts under its own key, so the backend can tell a
    // mechanic's verdict from a customer's contact details.
    const ACTIONS = { feedback: 1, group: 1, contact: 1 };
    const key = form && ACTIONS[form.action] ? form.action : "contact";
    const ECHO = {
      feedback: ["fb_verdict", "fb_price", "fb_text"],
      // A group form echoes every answer, so the transcript reads like the
      // conversation it replaced rather than jumping straight to the price.
      group: Object.keys(values),
      contact: ["name", "phone", "email"],
    };
    const shown = ECHO[key].map((k) => values[k]).filter(Boolean).join(" · ");
    clearContactForm();
    // The details are echoed as the customer's own message only once ACCEPTED.
    // A rejected form comes back with the bad fields marked and the transcript
    // untouched, so a typo leaves no trace in it (or in the owner's copy).
    const payload = { history: conversationHistory, state: convState };
    payload[key] = values;
    const data = await post(payload, true, () => {
      if (!shown) return;
      addMessage("user", shown);
      conversationHistory.push({ role: "user", content: shown });
    });
    if (!data) { renderContactForm(form); return; }
    if (data.formErrors && data.form) renderContactForm(data.form, data.formErrors);
  }

  function updateProgress(done, total) {
    if (!progressFillEl || !total) return;
    const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    progressFillEl.style.width = pct + "%";
    if (progressLabelEl) progressLabelEl.textContent = pct + "%";
    if (progressBarEl) {
      progressBarEl.classList.add("visible");
      progressBarEl.classList.toggle("complete", done >= total);
    }
  }

  // --- Talking to the backend -----------------------------------------------------
  // One round trip. Renders the reply (bubbles + chips / multi-chips / form) and
  // returns the parsed data, or null on failure. `onAccepted` runs just before
  // the reply renders, unless the server bounced a contact form back.
  async function post(payload, withThinking, onAccepted) {
    if (sending) return null;
    sending = true;
    if (withThinking !== false) addThinking();
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ sessionId: sessionId }, payload)),
      });
      removeThinking();
      if (!res.ok) {
        let msg = T.errGeneric;
        try { const d = await res.json(); if (d && d.answer) msg = d.answer; } catch (e) {}
        addMessage("bot", msg);
        return null;
      }
      const data = await res.json();
      if (data.state && typeof data.state === "object") convState = data.state;

      if (typeof data.progress === "number" && typeof data.progressTotal === "number") {
        if (payload.question && data.progress > lastProgress) {
          track("question_answered", { answered: data.progress, total: data.progressTotal, project_type: convState.projectType });
        }
        updateProgress(data.progress, data.progressTotal);
        lastProgress = data.progress;
        lastProgressTotal = data.progressTotal;
      }

      if (data.formErrors) return data; // caller re-renders the form
      if (onAccepted) onAccepted(data);

      if (data.done && !quoteDone) {
        quoteDone = true;
        const l = data.lead || {};
        track("quote_completed", { project_type: l.type, quote_total: l.total, vat_basis: l.basis });
      }

      const parts = String(data.answer || "").split("[[SPLIT]]").map((s) => s.trim()).filter(Boolean);
      parts.forEach((p) => addMessage("bot", p));
      if (parts.length) conversationHistory.push({ role: "assistant", content: parts.join("\n\n") });

      if (data.workings) renderWorkings(data.workings);
      if (data.live) renderLive(data.live);
      if (data.form) renderContactForm(data.form);
      else if (data.multi) renderMultiChips(data.chips, data.exclusive, data.next);
      else renderChips(data.chips);

      armIdleFlush();
      return data;
    } catch (err) {
      console.error(err);
      removeThinking();
      addMessage("bot", T.errConnect);
      return null;
    } finally {
      sending = false;
    }
  }

  async function sendMessage(presetText) {
    if (sending) return;
    const text = (presetText !== undefined ? presetText : (inputElement.value || "")).trim();
    if (!text) return;
    clearChips();
    clearContactForm();
    addMessage("user", text);
    if (presetText === undefined) inputElement.value = "";
    conversationHistory.push({ role: "user", content: text });
    const data = await post({ question: text, history: conversationHistory.slice(-80), state: convState }, true);
    // A form the customer had open is still owed: put it back if the reply
    // did not bring its own.
    if (!data && lastProgressTotal && lastProgress >= lastProgressTotal && !quoteDone) {
      post({ question: "", history: conversationHistory.slice(-80), state: convState }, false);
    }
  }

  // --- Host page hooks --------------------------------------------------------------
  // The Banacraft sites mark every "AI árbecslés" button with data-quote-agent or
  // .js-quote-agent and bind a placeholder toast to it. This listener runs in the
  // capture phase on the document, before those placeholders, and stops the
  // click there - so embedding the widget is enough, no site script to remove.
  const HOST_SELECTOR = "[data-quote-agent], .js-quote-agent, [data-autoszerviz-chat]";
  function bindHostButtons() {
    const open = (e) => {
      const el = e.target && e.target.closest ? e.target.closest(HOST_SELECTOR) : null;
      if (!el || (container && container.contains(el))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      track("host_button_clicked");
      openChat();
    };
    document.addEventListener("click", open, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    }, true);
  }

  function init() {
    initAnalytics();
    injectStyles();
    createContainer();
    if (SHOW_LAUNCHER) createLauncher();
    bindHostButtons();
    watchPageExit();
    window.AUTOSZERVIZ = window.AUTOSZERVIZ || {};
    window.AUTOSZERVIZ.open = openChat;
    window.AUTOSZERVIZ.close = closeChat;
    // Manual test hook: after a few answers, run BANACRAFT.sendTranscriptNow()
    // in the console to get the owner copy without waiting for the idle timer.
    window.AUTOSZERVIZ.sendTranscriptNow = function () {
      transcriptSends = 0;
      transcriptSentAt = 0;
      flushTranscript("kézi teszt");
      return "Beszélgetés elküldve - nézd meg a postafiókot (a spam mappát is).";
    };
    window.AUTOSZERVIZ.getHistory = function () { return conversationHistory.slice(); };
    track("widget_loaded");
    // The link IS the call to action, so the chat opens itself a moment after
    // the page settles rather than waiting for a tap on the bubble.
    if (AUTO_OPEN) setTimeout(openChat, 450);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
