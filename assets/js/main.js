/* ==========================================================================
   Article page bootstrap + interactions.

   Loads content (defaults + localStorage overlay), renders the article in the
   browser, and wires up search, the drawer, dialogs and the editor trigger.
   Everything is client-side; there is no build step or save API.
   ========================================================================== */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const root = $("#site-root");
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

  let state = null;
  let searchItems = [];
  let controller = null;
  let toastTimer = 0;

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  function showToast(message, duration = 3200) {
    const toast = $("#toast");
    if (!toast || !message) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  function updateDocumentMeta() {
    const { site = {}, article = {} } = state;
    const siteName = site.site?.name || "百科事典";
    const title = `${article.title || "記事"}${article.reading ? ` (${article.reading})` : ""}とは【${siteName}】`;
    const description = WikiRender.plainText(article.summary || site.site?.description || "");

    document.title = title;
    body.dataset.articleTitle = article.title || "article";

    const setMeta = (selector, value, attribute = "content") => {
      let element = $(selector);
      if (!element) {
        element = document.createElement("meta");
        if (selector.includes("property=")) element.setAttribute("property", selector.match(/property="([^"]+)"/)[1]);
        else element.setAttribute("name", selector.match(/name="([^"]+)"/)[1]);
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };

    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', article.title || "");
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:image"]', article.hero?.src || "");
    setMeta('meta[property="og:site_name"]', siteName);
  }

  function render() {
    if (!state) return;
    if (controller) controller.abort();
    controller = new AbortController();

    root.innerHTML = WikiRender.renderSite(state);
    searchItems = WikiRender.buildSearchIndex(state.article).map((item) => ({
      ...item,
      _title: normalize(item.title),
      _text: normalize(item.text),
    }));

    updateDocumentMeta();
    bindInteractions(controller.signal);
    restoreHash();
  }

  function restoreHash() {
    const hash = window.location.hash;
    if (!hash || hash === "#editor") return;
    let id = "";
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: "start" });
  }

  function renderLoadError(error) {
    const detail = error?.message ? `<p class="site-error__detail">${escapeHTML(error.message)}</p>` : "";
    if (!root) return;
    root.innerHTML = `<main class="page site-error" id="main">
  <h1>コンテンツを読み込めませんでした</h1>
  ${detail}
  <p>このサイトは <code>content/*.json</code> をブラウザで読み込んで表示します。ローカルで確認する場合は <code>npm run dev</code> でサーバーを起動し、<code>http://localhost:4173/</code> を開いてください。</p>
  <p><a class="button button--blue" href="">再読み込み</a> <a class="button button--soft" href="guide.html">使い方を見る</a></p>
</main>`;
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */

  function snippet(text, query) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    if (!flat) return "";
    const index = normalize(flat).indexOf(normalize(query));
    const start = Math.max(0, index > 22 ? index - 22 : 0);
    const end = Math.min(flat.length, start + 92);
    return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  }

  function buildSearch(signal) {
    const form = $("#site-search");
    const input = $("#search-input");
    const results = $("#search-results");
    if (!form || !input || !results) return;

    let currentResults = [];
    let activeResult = -1;
    let inputTimer = 0;

    const close = () => {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      activeResult = -1;
    };

    const setActive = (index) => {
      const nodes = $$(".search-result", results);
      if (!nodes.length) return;
      activeResult = Math.max(0, Math.min(index, nodes.length - 1));
      nodes.forEach((node, nodeIndex) => {
        const active = nodeIndex === activeResult;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-selected", active ? "true" : "false");
        if (active) {
          node.id = `search-result-${nodeIndex}`;
          input.setAttribute("aria-activedescendant", node.id);
          node.scrollIntoView({ block: "nearest" });
        }
      });
    };

    const renderResults = (query) => {
      const q = normalize(query);
      if (!q) {
        currentResults = [];
        close();
        return [];
      }

      const seen = new Set();
      currentResults = searchItems
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
        .map((entry) => entry.item)
        .filter((item) => {
          const key = `${item.type}:${item.title}:${item.href}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 9);

      if (!currentResults.length) {
        results.innerHTML = `<div class="search__empty">「${escapeHTML(query)}」に一致する項目はありません。<br>別の言葉で試してみてください。</div>`;
        results.hidden = false;
        input.setAttribute("aria-expanded", "true");
        activeResult = -1;
        return [];
      }

      results.innerHTML = [
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

      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
      activeResult = -1;
      input.removeAttribute("aria-activedescendant");
      return currentResults;
    };

    const navigateTo = (href) => {
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
          flashElement(target);
        }
      }
    };

    input.addEventListener(
      "input",
      () => {
        window.clearTimeout(inputTimer);
        inputTimer = window.setTimeout(() => renderResults(input.value), 70);
      },
      { signal },
    );

    input.addEventListener(
      "focus",
      () => {
        if (input.value.trim()) renderResults(input.value);
      },
      { signal },
    );

    input.addEventListener(
      "keydown",
      (event) => {
        const nodes = $$(".search-result", results);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (results.hidden) renderResults(input.value);
          if (nodes.length) setActive(activeResult < 0 ? 0 : activeResult + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          if (results.hidden) renderResults(input.value);
          if (nodes.length) setActive(activeResult <= 0 ? nodes.length - 1 : activeResult - 1);
        } else if (event.key === "Escape") {
          close();
        } else if (event.key === "Tab") {
          close();
        }
      },
      { signal },
    );

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) return;
        const found = currentResults.length ? currentResults : renderResults(query);
        if (found.length) {
          const first = found[Math.max(0, activeResult)] || found[0];
          close();
          navigateTo(first.href);
        } else {
          showToast(`「${query}」に一致する項目はありませんでした。`);
        }
      },
      { signal },
    );

    results.addEventListener(
      "click",
      (event) => {
        const result = event.target.closest(".search-result");
        if (!result) return;
        event.preventDefault();
        close();
        navigateTo(result.getAttribute("href"));
        input.blur();
      },
      { signal },
    );

    document.addEventListener(
      "click",
      (event) => {
        if (!form.contains(event.target)) close();
      },
      { signal },
    );

    document.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        const typing =
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable);
        if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          input.focus();
          input.select();
        }
      },
      { signal },
    );

    const queryParam = new URLSearchParams(window.location.search).get("q");
    if (queryParam) {
      input.value = queryParam;
      renderResults(queryParam);
    }

    return { input, renderResults };
  }

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */

  function flashElement(element) {
    if (!element) return;
    element.classList.remove("is-flash");
    // Force a reflow so the animation can be replayed.
    void element.offsetWidth;
    element.classList.add("is-flash");
    window.setTimeout(() => element.classList.remove("is-flash"), 1300);
  }

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

  /* ------------------------------------------------------------------ *
   * Interactions
   * ------------------------------------------------------------------ */

  function bindInteractions(signal) {
    /* Notice bar */
    const notice = $("[data-notice]", root);
    if (notice) {
      const storageKey = notice.dataset.storageKey || "pixpedia-parody-notice";
      if (getStorage(storageKey) === "1") {
        notice.remove();
      } else {
        $("[data-notice-close]", notice)?.addEventListener(
          "click",
          () => {
            setStorage(storageKey, "1");
            notice.classList.add("is-hiding");
            window.setTimeout(() => notice.remove(), 140);
          },
          { signal },
        );
      }
    }

    /* Bookmark */
    const bookmarkButton = $('[data-action="bookmark"]', root);
    const articleId = body.dataset.articleTitle || "article";
    const bookmarkKey = `pixpedia-parody-bookmark:${articleId}`;
    if (bookmarkButton) {
      const setBookmark = (saved) => {
        bookmarkButton.setAttribute("aria-pressed", saved ? "true" : "false");
        bookmarkButton.setAttribute("aria-label", saved ? "この記事の保存を解除" : "この記事を保存");
        const label = $(".bookmark__label", bookmarkButton);
        if (label) label.textContent = saved ? "保存済み" : "保存";
      };
      setBookmark(getStorage(bookmarkKey) === "1");
      bookmarkButton.addEventListener(
        "click",
        () => {
          const next = bookmarkButton.getAttribute("aria-pressed") !== "true";
          setBookmark(next);
          if (next) setStorage(bookmarkKey, "1");
          else removeStorage(bookmarkKey);
          showToast(next ? "この記事を保存しました。" : "保存を解除しました。");
        },
        { signal },
      );
    }

    /* Header shadow / back to top / scroll spy */
    const header = $("#site-header");
    const backToTop = $("#back-to-top");
    let scrollTicking = false;

    const updateActiveToc = () => {
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
    };

    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(() => {
        header?.classList.toggle("is-scrolled", window.scrollY > 6);
        backToTop?.classList.toggle("is-visible", window.scrollY > 560);
        updateActiveToc();
        scrollTicking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true, signal });
    window.addEventListener("resize", onScroll, { passive: true, signal });
    onScroll();

    backToTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: scrollBehavior }), {
      signal,
    });

    /* Mobile drawer */
    const drawerOverlay = $("#drawer-overlay");
    const drawer = drawerOverlay ? $(".drawer", drawerOverlay) : null;
    const openMenuButton = $("[data-open-menu]", root);
    let lastFocused = null;

    const drawerFocusables = () => {
      if (!drawer) return [];
      return $$(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        drawer,
      ).filter((el) => el.offsetParent !== null);
    };

    const onDrawerKeydown = (event) => {
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
    };

    function openDrawer() {
      if (!drawerOverlay) return;
      lastFocused = document.activeElement;
      drawerOverlay.hidden = false;
      body.classList.add("is-menu-open");
      openMenuButton?.setAttribute("aria-expanded", "true");
      document.addEventListener("keydown", onDrawerKeydown, { signal });
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

    openMenuButton?.addEventListener("click", openDrawer, { signal });
    $$(".drawer [data-close-menu]", root).forEach((button) =>
      button.addEventListener("click", closeDrawer, { signal }),
    );
    drawerOverlay?.addEventListener(
      "click",
      (event) => {
        if (event.target === drawerOverlay) closeDrawer();
      },
      { signal },
    );
    $$(".drawer a[href]", root).forEach((link) =>
      link.addEventListener("click", closeDrawer, { signal }),
    );

    /* History dialog */
    const historyDialog = $("#history-dialog", root);
    const openHistory = () => {
      if (!historyDialog) return;
      if (typeof historyDialog.showModal === "function") {
        if (!historyDialog.open) historyDialog.showModal();
      } else {
        historyDialog.setAttribute("open", "");
      }
    };
    const closeHistory = () => {
      if (!historyDialog) return;
      if (typeof historyDialog.close === "function") historyDialog.close();
      else historyDialog.removeAttribute("open");
    };

    $$("[data-close-dialog]", root).forEach((button) =>
      button.addEventListener("click", closeHistory, { signal }),
    );
    historyDialog?.addEventListener(
      "click",
      (event) => {
        if (event.target === historyDialog) closeHistory();
      },
      { signal },
    );

    /* Search */
    const search = buildSearch(signal);

    /* Delegated actions */
    document.addEventListener(
      "click",
      async (event) => {
        const editorTrigger = event.target.closest("[data-open-editor], a[href='#editor']");
        if (editorTrigger && root.contains(editorTrigger)) {
          event.preventDefault();
          openEditor();
          return;
        }

        const copyButton = event.target.closest("[data-copy]");
        if (copyButton) {
          const code = copyButton.closest(".code-block")?.querySelector("pre code")?.innerText ?? "";
          const ok = await copyText(code);
          showToast(ok ? "コードをコピーしました。" : "コピーできませんでした。");
          return;
        }

        const searchTrigger = event.target.closest("[data-search]");
        if (searchTrigger && search && !searchTrigger.closest("#site-search")) {
          event.preventDefault();
          search.input.value = searchTrigger.dataset.search || "";
          search.input.focus();
          search.renderResults(search.input.value);
          return;
        }

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
      },
      { signal },
    );

    /* Hash landing / flash */
    if (window.location.hash && window.location.hash !== "#editor") {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = document.getElementById(id);
      if (target) window.setTimeout(() => flashElement(target), 120);
    }

    updateActiveToc();
  }

  function openEditor() {
    if (window.WikiEditor?.open) {
      window.WikiEditor.open();
      return;
    }
    window.location.hash = "#editor";
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  const ready = (async () => {
    try {
      state = await WikiStore.load();
      render();
      document.dispatchEvent(new CustomEvent("wiki:ready", { detail: state }));
      return state;
    } catch (error) {
      console.error(error);
      renderLoadError(error);
      throw error;
    }
  })();

  window.WikiSite = {
    ready,
    getState: () => state,
    render,
    setState(next) {
      state = next;
      render();
    },
    openEditor,
    toast: showToast,
  };
})();
