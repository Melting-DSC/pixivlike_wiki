/* ==========================================================================
   Article page bootstrap + interactions.

   Loads content (defaults + localStorage overlay), renders the article in the
   browser, and wires up toasts and the editor trigger. The header search box
   is a dummy: typing in it does nothing.
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
  <p>通信状態を確認して、ページを再読み込みしてください。パソコンに保存したファイルを直接開いた場合は表示できないため、公開されているURLから開いてください。</p>
  <p><a class="button button--blue" href="">再読み込み</a> <a class="button button--soft" href="guide.html">使い方を見る</a></p>
</main>`;
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

    /* Delegated actions */
    document.addEventListener(
      "click",
      async (event) => {
        if (event.target.closest("[data-empty-link]")) {
          event.preventDefault();
          return;
        }

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
