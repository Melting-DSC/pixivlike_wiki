/* ==========================================================================
   Pixiv-like encyclopedia parody — interactions
   Vanilla JS, no dependencies. Everything is progressive enhancement.
   ========================================================================== */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollBehavior = reduceMotion ? "auto" : "smooth";

  const escapeHTML = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normalize = (value = "") =>
    String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

  const getStorage = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const setStorage = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* localStorage can be unavailable in private / file contexts */
    }
  };

  const removeStorage = (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  };

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  const toast = $("#toast");
  let toastTimer = 0;

  function showToast(message, duration = 3200) {
    if (!toast || !message) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  /* ------------------------------------------------------------------ *
   * Parody notice bar
   * ------------------------------------------------------------------ */

  const notice = $("[data-notice]");
  if (notice) {
    const storageKey = notice.dataset.storageKey || "pixpedia-parody-notice";
    if (getStorage(storageKey) === "1") {
      notice.remove();
    } else {
      const closeButton = $("[data-notice-close]", notice);
      closeButton?.addEventListener("click", () => {
        setStorage(storageKey, "1");
        notice.classList.add("is-hiding");
        window.setTimeout(() => notice.remove(), 140);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Header shadow / back to top / scroll spy
   * ------------------------------------------------------------------ */

  const header = $("#site-header");
  const backToTop = $("#back-to-top");
  let scrollTicking = false;

  function updateActiveToc() {
    const links = $$(".toc a[href^='#']");
    if (!links.length) return;
    const targets = links
      .map((link) => {
        const id = decodeURIComponent(link.getAttribute("href").slice(1));
        const el = document.getElementById(id);
        return el ? { link, el } : null;
      })
      .filter(Boolean);
    if (!targets.length) return;

    const offset = window.innerWidth <= 900 ? 128 : 100;
    let current = targets[0];
    for (const target of targets) {
      if (target.el.getBoundingClientRect().top - offset <= 0) current = target;
    }

    for (const target of targets) {
      const active = target === current;
      target.link.classList.toggle("is-active", active);
      if (active) target.link.setAttribute("aria-current", "location");
      else target.link.removeAttribute("aria-current");
    }
  }

  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      header?.classList.toggle("is-scrolled", window.scrollY > 6);
      backToTop?.classList.toggle("is-visible", window.scrollY > 560);
      updateActiveToc();
      scrollTicking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();

  backToTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: scrollBehavior });
  });

  /* ------------------------------------------------------------------ *
   * Bookmark
   * ------------------------------------------------------------------ */

  const bookmarkButton = $('[data-action="bookmark"]');
  const articleId = body.dataset.articleTitle || "article";
  const bookmarkKey = `pixpedia-parody-bookmark:${articleId}`;

  function setBookmark(saved) {
    if (!bookmarkButton) return;
    bookmarkButton.setAttribute("aria-pressed", saved ? "true" : "false");
    bookmarkButton.setAttribute("aria-label", saved ? "この記事の保存を解除" : "この記事を保存");
    const label = $(".bookmark__label", bookmarkButton);
    if (label) label.textContent = saved ? "保存済み" : "保存";
  }

  setBookmark(getStorage(bookmarkKey) === "1");

  bookmarkButton?.addEventListener("click", () => {
    const next = bookmarkButton.getAttribute("aria-pressed") !== "true";
    setBookmark(next);
    if (next) setStorage(bookmarkKey, "1");
    else removeStorage(bookmarkKey);
    showToast(next ? "この記事を保存しました。" : "保存を解除しました。");
  });

  /* ------------------------------------------------------------------ *
   * Code copy buttons
   * ------------------------------------------------------------------ */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  for (const button of $$("[data-copy]")) {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block")?.querySelector("pre code")?.innerText ?? "";
      const ok = await copyText(code);
      showToast(ok ? "コードをコピーしました。" : "コピーできませんでした。");
    });
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */

  const searchForm = $("#site-search");
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");

  let rawIndex = { sections: [], categories: [], tags: [] };
  try {
    rawIndex = JSON.parse($("#search-index")?.textContent || "{}");
  } catch {
    rawIndex = { sections: [], categories: [], tags: [] };
  }

  const searchItems = [
    ...(rawIndex.sections || []),
    ...(rawIndex.categories || []),
    ...(rawIndex.tags || []),
  ].map((item) => ({
    ...item,
    _title: normalize(item.title),
    _text: normalize(item.text),
  }));

  let currentResults = [];
  let activeResult = -1;
  let inputTimer = 0;

  function snippet(text, query) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    if (!flat) return "";
    const index = normalize(flat).indexOf(normalize(query));
    const start = Math.max(0, index > 22 ? index - 22 : 0);
    const end = Math.min(flat.length, start + 92);
    return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  }

  function closeSearch() {
    if (!searchResults || !searchInput) return;
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
    activeResult = -1;
  }

  function setActiveResult(index) {
    const nodes = $$(".search-result", searchResults);
    if (!nodes.length) return;
    activeResult = Math.max(0, Math.min(index, nodes.length - 1));
    nodes.forEach((node, nodeIndex) => {
      const active = nodeIndex === activeResult;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
      if (active) {
        node.id = `search-result-${nodeIndex}`;
        searchInput.setAttribute("aria-activedescendant", node.id);
        node.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderResults(query) {
    if (!searchInput || !searchResults) return [];
    const q = normalize(query);
    if (!q) {
      currentResults = [];
      closeSearch();
      return [];
    }

    const scored = searchItems
      .map((item) => {
        let score = 0;
        if (item._title === q) score = 120;
        else if (item._title.startsWith(q)) score = 100;
        else if (item._title.includes(q)) score = 70;
        else if (item._text.includes(q)) score = 30;
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "ja"))
      .map((entry) => entry.item);

    const seen = new Set();
    currentResults = scored
      .filter((item) => {
        const key = `${item.type}:${item.title}:${item.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 9);

    if (!currentResults.length) {
      searchResults.innerHTML = `<div class="search__empty">「${escapeHTML(query)}」に一致する項目はありません。<br>別の言葉で試してみてください。</div>`;
      searchResults.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
      activeResult = -1;
      return [];
    }

    searchResults.innerHTML = [
      `<div class="search__hint">検索結果 ${currentResults.length}件</div>`,
      ...currentResults.map(
        (item, index) => `<a class="search-result" href="${escapeHTML(item.href)}" data-type="${escapeHTML(item.type)}" data-index="${index}" role="option" aria-selected="false">
  <span class="search-result__type">${escapeHTML(item.type)}</span>
  <span>
    <span class="search-result__title">${escapeHTML(item.title)}</span>
    <span class="search-result__text">${escapeHTML(snippet(item.text, query))}</span>
  </span>
</a>`,
      ),
    ].join("");

    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
    activeResult = -1;
    searchInput.removeAttribute("aria-activedescendant");
    return currentResults;
  }

  function flashElement(element) {
    if (!element) return;
    element.classList.remove("is-flash");
    // Force a reflow so the animation can be replayed.
    void element.offsetWidth;
    element.classList.add("is-flash");
    window.setTimeout(() => element.classList.remove("is-flash"), 1300);
  }

  function navigateTo(href) {
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const target = document.getElementById(id);
      if (target) {
        window.history.pushState(null, "", href);
        target.scrollIntoView({ behavior: scrollBehavior, block: "start" });
        flashElement(target.closest(".category-card") || target);
      }
    }
  }

  if (searchForm && searchInput && searchResults) {
    searchInput.addEventListener("input", () => {
      window.clearTimeout(inputTimer);
      inputTimer = window.setTimeout(() => renderResults(searchInput.value), 70);
    });

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) renderResults(searchInput.value);
    });

    searchInput.addEventListener("keydown", (event) => {
      const nodes = $$(".search-result", searchResults);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (searchResults.hidden) renderResults(searchInput.value);
        if (nodes.length) setActiveResult(activeResult < 0 ? 0 : activeResult + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (searchResults.hidden) renderResults(searchInput.value);
        if (nodes.length) setActiveResult(activeResult <= 0 ? nodes.length - 1 : activeResult - 1);
      } else if (event.key === "Escape") {
        closeSearch();
      } else if (event.key === "Tab") {
        closeSearch();
      }
    });

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      const found = currentResults.length ? currentResults : renderResults(query);
      if (found.length) {
        const first = found[Math.max(0, activeResult)] || found[0];
        closeSearch();
        navigateTo(first.href);
      } else {
        showToast(`「${query}」に一致する項目はありませんでした。`);
      }
    });

    searchResults.addEventListener("click", (event) => {
      const result = event.target.closest(".search-result");
      if (!result) return;
      event.preventDefault();
      closeSearch();
      navigateTo(result.getAttribute("href"));
      searchInput.blur();
    });

    document.addEventListener("click", (event) => {
      if (!searchForm.contains(event.target)) closeSearch();
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    const queryParam = new URLSearchParams(window.location.search).get("q");
    if (queryParam) {
      searchInput.value = queryParam;
      renderResults(queryParam);
    }
  }

  /* ------------------------------------------------------------------ *
   * Spotlight / tags → search
   * ------------------------------------------------------------------ */

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-search]");
    if (!trigger || !searchInput || trigger.closest("#site-search")) return;
    event.preventDefault();
    searchInput.value = trigger.dataset.search || "";
    searchInput.focus();
    renderResults(searchInput.value);
  });

  /* ------------------------------------------------------------------ *
   * Mobile drawer
   * ------------------------------------------------------------------ */

  const drawerOverlay = $("#drawer-overlay");
  const drawer = drawerOverlay ? $(".drawer", drawerOverlay) : null;
  const openMenuButton = $("[data-open-menu]");
  let lastFocused = null;

  function drawerFocusables() {
    if (!drawer) return [];
    return $$(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      drawer,
    ).filter((el) => el.offsetParent !== null);
  }

  function onDrawerKeydown(event) {
    if (event.key === "Escape") {
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = drawerFocusables();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDrawer() {
    if (!drawerOverlay) return;
    lastFocused = document.activeElement;
    drawerOverlay.hidden = false;
    body.classList.add("is-menu-open");
    openMenuButton?.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onDrawerKeydown);
    window.requestAnimationFrame(() => drawer?.focus());
  }

  function closeDrawer() {
    if (!drawerOverlay || drawerOverlay.hidden) return;
    drawerOverlay.hidden = true;
    body.classList.remove("is-menu-open");
    openMenuButton?.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onDrawerKeydown);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  openMenuButton?.addEventListener("click", openDrawer);
  $$(".drawer [data-close-menu]").forEach((button) => button.addEventListener("click", closeDrawer));
  drawerOverlay?.addEventListener("click", (event) => {
    if (event.target === drawerOverlay) closeDrawer();
  });
  $$(".drawer a[href]").forEach((link) => link.addEventListener("click", closeDrawer));

  /* ------------------------------------------------------------------ *
   * History dialog, login toast, “not made yet” items
   * ------------------------------------------------------------------ */

  const historyDialog = $("#history-dialog");

  function openHistory() {
    if (!historyDialog) return;
    if (typeof historyDialog.showModal === "function") {
      if (!historyDialog.open) historyDialog.showModal();
    } else {
      historyDialog.setAttribute("open", "");
    }
  }

  function closeHistory() {
    if (!historyDialog) return;
    if (typeof historyDialog.close === "function") historyDialog.close();
    else historyDialog.removeAttribute("open");
  }

  document.addEventListener("click", (event) => {
    const soonItem = event.target.closest("[data-soon]");
    if (soonItem) {
      event.preventDefault();
      showToast(`「${soonItem.dataset.soon}」はこのパロディ版では未作成です。`);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "login") {
      showToast(action.dataset.message || "ここはパロディサイトなので、登録もログインも不要です。");
    } else if (action.dataset.action === "soon") {
      showToast(action.dataset.message || "この機能は準備中です。");
    } else if (action.dataset.action === "history") {
      event.preventDefault();
      openHistory();
    }
  });

  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeHistory));
  historyDialog?.addEventListener("click", (event) => {
    if (event.target === historyDialog) closeHistory();
  });

  /* ------------------------------------------------------------------ *
   * Hash landing / flash
   * ------------------------------------------------------------------ */

  if (window.location.hash) {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = document.getElementById(id);
    if (target) {
      window.setTimeout(() => flashElement(target.closest(".category-card") || target), 120);
    }
  }

  updateActiveToc();
})();
