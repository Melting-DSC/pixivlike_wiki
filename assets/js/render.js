/* ==========================================================================
   Client-side article renderer.

   Turns the two content objects (site / article) into the
   article page HTML. The same functions are used by the live page, the
   editor preview and the HTML export, so the markup stays consistent.

   No dependencies. Exposes `window.WikiRender`.
   ========================================================================== */

(() => {
  "use strict";

  const esc = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const attr = esc;
  const stripControl = (value = "") => String(value).replaceAll("\u0001", "");

  function safeHref(raw = "") {
    const href = String(raw).trim();
    if (/^(?:#|\/|\.{1,2}\/|https?:\/\/|mailto:)/i.test(href)) return href;
    // Relative paths may contain non-ASCII characters (Japanese anchors, file names).
    if (/^[\w./?=&%#+\-\u0080-\uFFFF]+$/.test(href)) return href;
    return "#";
  }

  const isExternal = (href = "") => /^https?:\/\//i.test(href);

  const linkAttrs = (href) => (isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : "");

  const isEditorHref = (href = "") => String(href).trim() === "#editor";

  const openEditorAttr = (href) => (isEditorHref(href) ? " data-open-editor" : "");

  function inline(value) {
    let text = stripControl(value ?? "");
    const held = [];
    const hold = (html) => `\u0001${held.push(html) - 1}\u0001`;

    text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));

    text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, term, label) =>
      hold(`<span class="link-term">${esc(label || term)}</span>`),
    );

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safe = safeHref(href);
      return hold(`<a href="${attr(safe)}"${linkAttrs(safe)}${openEditorAttr(safe)}>${esc(label)}</a>`);
    });

    text = esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return text.replace(/\u0001(\d+)\u0001/g, (_, index) => held[Number(index)] ?? "");
  }

  function plainText(value) {
    return String(value ?? "")
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, term, label) => label || term)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberSections(sections = []) {
    let major = 0;
    let minor = 0;
    let orphan = 0;
    return (Array.isArray(sections) ? sections : []).map((section, index) => {
      let number;
      if (Number(section.level) === 2) {
        major += 1;
        minor = 0;
        number = String(major);
      } else {
        if (major === 0) {
          orphan += 1;
          number = `0.${orphan}`;
        } else {
          minor += 1;
          number = `${major}.${minor}`;
        }
      }
      return { ...section, id: String(section.id || "").trim() || `section-${index + 1}`, number };
    });
  }

  /* ------------------------------------------------------------------ *
   * Blocks / sections
   * ------------------------------------------------------------------ */

  function renderBlock(block) {
    switch (block.type) {
      case "paragraph":
        return `<p>${inline(block.text)}</p>`;

      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const title = block.title
          ? `<p class="block-label">${inline(block.title)}</p>`
          : "";
        const items = (block.items || [])
          .map((item) => `<li>${inline(item)}</li>`)
          .join("\n");
        return `${title}<${tag} class="body-list">${items}</${tag}>`;
      }

      case "code": {
        const language = esc(block.language || "text");
        const filename = block.filename ? esc(block.filename) : "snippet";
        return `<div class="code-block">
  <div class="code-block__bar"><span class="code-block__file">${filename}</span><span class="code-block__language">${language}</span><button type="button" class="code-block__copy" data-copy>コピー</button></div>
  <pre tabindex="0"><code>${esc(block.code || "")}</code></pre>
</div>`;
      }

      case "callout": {
        const tone = ["info", "warn", "parody"].includes(block.tone) ? block.tone : "info";
        const icon = tone === "warn" ? "!" : tone === "parody" ? "?" : "i";
        return `<aside class="callout callout--${tone}">
  <span class="callout__icon" aria-hidden="true">${icon}</span>
  <div class="callout__body">
    ${block.title ? `<p class="callout__title">${inline(block.title)}</p>` : ""}
    <p>${inline(block.text)}</p>
  </div>
</aside>`;
      }

      case "tags":
        return `<div class="tag-cloud">${(block.items || [])
          .map((tag) => `<span class="tag">#${esc(tag)}</span>`)
          .join("")}</div>`;

      case "figure":
        return `<figure class="article-figure">
  ${block.src ? `<img src="${attr(block.src)}" alt="${attr(block.alt || "")}" loading="lazy">` : `<div class="article-figure__missing" role="img" aria-label="${attr(block.alt || "画像が設定されていません")}">画像が設定されていません</div>`}
  <figcaption><span>${inline(block.caption || "")}</span>${block.credit ? `<span class="article-figure__credit">${esc(block.credit)}</span>` : ""}</figcaption>
</figure>`;

      case "quote":
        return `<blockquote class="article-quote"><p>${inline(block.text)}</p>${
          block.cite ? `<cite>${esc(block.cite)}</cite>` : ""
        }</blockquote>`;

      case "divider":
        return `<hr class="article-divider">`;

      default:
        return "";
    }
  }

  function renderSection(section) {
    const isSub = Number(section.level) === 3;
    const headingTag = isSub ? "h3" : "h2";
    const blocks = (section.blocks || []).map((block) => renderBlock(block)).join("\n");
    const rule = isSub ? "" : '<span class="section__rule" aria-hidden="true"></span>';
    return `<section class="section${isSub ? " section--sub" : ""}" id="${attr(section.id)}" data-section>
  <div class="section__heading">
    <${headingTag} class="section__title">${esc(section.title)}<a class="section__anchor" href="#${attr(section.id)}" aria-label="${attr(section.title)}へのリンク" title="このセクションへのリンク">#</a></${headingTag}>
    ${rule}
  </div>
  <div class="section__content">
${blocks}
  </div>
</section>`;
  }

  /* ------------------------------------------------------------------ *
   * Page pieces
   * ------------------------------------------------------------------ */

  // Fixed text shown under every article. Not editable and not stored in JSON.
  const ABOUT_TEXT =
    "「うちのこ百科事典」は、ピクシブ百科事典の記事ページを参考に制作した非公式のパロディサイトです。自分の創作キャラクター（うちの子）の紹介ページを作るためのテンプレートとして使えます。pixiv株式会社とは関係ありません。";

  /* Article header links and the hero image are empty links: they look like
     links but do nothing when clicked (main.js cancels `data-empty-link`). */
  function renderArticleActions(article) {
    return (article.actions || [])
      .filter((action) => String(action.label ?? "").trim())
      .map(
        (action) =>
          `<li><a class="article-action${action.primary ? " is-primary" : ""}" href="#" data-empty-link><span>${esc(action.label)}</span><span class="article-action__chevron" aria-hidden="true">›</span></a></li>`,
      )
      .join("");
  }

  // Gray labels above the article title. Plain text, not links.
  function renderCategories(article) {
    const items = (Array.isArray(article.categories) ? article.categories : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    if (!items.length) return "";
    return `<ul class="article-categories" aria-label="カテゴリ">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
  }

  function renderToc(sections) {
    return sections
      .map(
        (section) => `<li class="toc__item${Number(section.level) === 3 ? " toc__item--sub" : ""}">
  <a href="#${attr(section.id)}"><span class="toc__num">${section.number}</span><span>${esc(section.title)}</span></a>
</li>`,
      )
      .join("\n");
  }

  function renderArticleElement(state) {
    const { article = {} } = state;
    const sections = numberSections(article.sections || []);
    const hero = article.hero || {};
    const heroMedia = hero.src
      ? `<img class="hero__image" src="${attr(hero.src)}" alt="${attr(hero.alt || "")}" width="240" height="240" fetchpriority="high">`
      : `<span class="hero__image hero__image--missing" role="img" aria-label="${attr(hero.alt || "画像が設定されていません")}">画像未設定</span>`;

    return `<article class="article" id="top">
        <header class="article-head">
          <figure class="hero">
            <a class="hero__link" href="#" data-empty-link aria-label="${attr(hero.caption || hero.alt || "記事画像")}">
              ${heroMedia}
              <span class="hero__overlay">
                <span class="hero__caption">${esc(hero.caption || "")}</span>
                ${hero.credit ? `<span class="hero__credit">by ${esc(hero.credit)}</span>` : ""}
              </span>
            </a>
          </figure>

          <div class="article-head__main">
            ${renderCategories(article)}
            <div class="title-row">
              <h1 class="article-title" id="article-name">${esc(article.title || "無題の記事")}</h1>
              <button type="button" class="bookmark" data-action="bookmark" aria-pressed="false" aria-label="この記事を保存">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                <span class="bookmark__label">保存</span>
              </button>
            </div>
            <p class="article-reading">${esc(article.reading || "")}</p>
            <p class="article-summary">${inline(article.summary || "")}</p>
            <ul class="article-actions">${renderArticleActions(article)}</ul>
          </div>
        </header>

        <div class="article-meta">
          <span>最終更新：${esc(article.updated || "—")}</span>
          <span class="article-meta__sep" aria-hidden="true">・</span>
          <span>ver. ${esc(article.version || "1.0")}</span>
          <span class="article-meta__spacer"></span>
          <span class="parody-pill">非公式パロディ</span>
        </div>

        <details class="toc" open>
          <summary><span>目次</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
          <ol class="toc__list">
            ${renderToc(sections)}
          </ol>
        </details>

        <div class="article-body">
          ${sections.map((section) => renderSection(section)).join("\n")}
        </div>

        <section class="about" id="about" aria-labelledby="about-title">
          <div class="section__heading">
            <h2 class="section__title" id="about-title">このサイトについて<a class="section__anchor" href="#about" aria-label="このサイトについてへのリンク">#</a></h2>
            <span class="section__rule" aria-hidden="true"></span>
          </div>
          <p>${esc(ABOUT_TEXT)}</p>
        </section>
      </article>`;
  }

  function renderSidebar(state) {
    const { article = {} } = state;
    const sections = article.sections || [];
    const blocks = sections.reduce((sum, section) => sum + (section.blocks?.length || 0), 0);

    return `<aside class="sidebar" aria-label="補助情報">
        <section class="side-card">
          <div class="side-card__head"><h2>この記事のデータ</h2></div>
          <dl class="article-stats">
            <div><dt>セクション</dt><dd>${sections.length}</dd></div>
            <div><dt>ブロック</dt><dd>${blocks}</dd></div>
            <div><dt>最終更新</dt><dd>${esc(article.updated || "—")}</dd></div>
          </dl>
          <p class="side-card__note side-card__note--tiny">本文データから自動計算しています。</p>
        </section>

        <section class="side-card side-card--edit">
          <div class="side-card__head"><h2>この記事を編集</h2></div>
          <p>このページのまま編集モードを開けます。変更はこのブラウザに自動保存され、記事へ戻るとすぐに反映されます。</p>
          <a class="button button--blue button--wide" href="#editor" data-open-editor>編集モードを開く</a>
          <a class="side-card__text-link" href="guide.html">使い方を見る <span aria-hidden="true">›</span></a>
        </section>
      </aside>`;
  }

  function renderHeader(state) {
    const { site = {} } = state;
    const header = site.header || {};
    const submitHref = safeHref(header.submitHref || "#editor");
    return `<header class="site-header" id="site-header">
    <div class="site-header__inner">
      <div class="site-header__left">
        <button type="button" class="icon-button menu-open" aria-label="メニューを開く" aria-expanded="false" aria-controls="site-menu" data-menu-toggle>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <a class="brand" href="#top" aria-label="${attr(`${site.site?.name || "百科事典"}（パロディ）`)}">
          <img class="brand__mark" src="${attr(site.site?.mark || "assets/images/mark.svg")}" alt="" width="32" height="32">
          <span class="brand__name">${esc(site.site?.name || "百科事典")}</span>
          <span class="brand__badge">${esc(site.site?.badge || "PARODY")}</span>
        </a>
      </div>

      <div class="search" id="site-search">
        <label class="sr-only" for="search-input">${esc(header.searchLabel || "サイト内を検索")}</label>
        <div class="search__field">
          <svg class="search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="search-input" class="search__input" type="search" name="q" placeholder="${attr(header.searchPlaceholder || "けんさく...")}" aria-label="${attr(header.searchLabel || "サイト内を検索")}" autocomplete="off" spellcheck="false">
          <kbd class="search__key" aria-hidden="true">/</kbd>
        </div>
      </div>

      <div class="site-header__right">
        <a class="button button--white header-submit" href="${attr(submitHref)}"${openEditorAttr(submitHref)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="2"/></svg>
          <span class="header-submit__long">${esc(header.submitLabel || "この記事を編集")}</span>
          <span class="header-submit__short">編集</span>
        </a>
        <button type="button" class="button button--blue" data-action="login" data-message="${attr(header.loginMessage || "")}">${esc(header.loginLabel || "登録/ログイン")}</button>
      </div>
    </div>
    <nav class="site-menu" id="site-menu" aria-label="サイトメニュー" hidden>
      <ul class="site-menu__list">
        <li><a class="site-menu__link" href="#top">記事トップ</a></li>
        <li><a class="site-menu__link" href="${attr(submitHref)}"${openEditorAttr(submitHref)}>${esc(header.submitLabel || "この記事を編集")}</a></li>
        <li><a class="site-menu__link" href="#about">このサイトについて</a></li>
        <li><a class="site-menu__link" href="guide.html">使い方</a></li>
      </ul>
    </nav>
  </header>`;
  }

  function renderFooter(state) {
    const { site = {} } = state;
    return `<footer class="site-footer" id="site-footer">
  <div class="footer__inner">
    <div class="footer__brand">
      <a class="footer-brand" href="#top">
        <img src="${attr(site.site?.mark || "assets/images/mark.svg")}" alt="" width="28" height="28">
        <span>${esc(site.site?.name || "百科事典")}<em>${esc(site.site?.badge || "PARODY")}</em></span>
      </a>
    </div>
    <div class="footer__legal">
      <p>${esc(site.footer?.disclaimer || "")}</p>
    </div>
  </div>
</footer>`;
  }

  function renderNotice(state) {
    const notice = state.site?.notice;
    if (!notice?.enabled) return "";
    return `<div class="parody-notice" data-notice data-storage-key="${attr(notice.storageKey || "pixpedia-parody-notice")}">
    <p>${esc(notice.text || "")}</p>
    <button type="button" class="parody-notice__close" data-notice-close>${esc(notice.button || "了解")}</button>
  </div>`;
  }

  /* ------------------------------------------------------------------ *
   * Documents
   * ------------------------------------------------------------------ */

  function renderSite(state) {
    return `<a class="skip-link" href="#article-name">本文へスキップ</a>
  ${renderNotice(state)}
  ${renderHeader(state)}
  <main class="page" id="main">
    <div class="layout">
      ${renderArticleElement(state)}
      ${renderSidebar(state)}
    </div>
  </main>
  ${renderFooter(state)}
  <button type="button" class="back-to-top" id="back-to-top" aria-label="ページ先頭へ">↑</button>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  }

  function renderExportBody(state) {
    const { site = {} } = state;
    return `<header class="site-header site-header--export" id="site-header">
  <div class="site-header__inner">
    <div class="site-header__left">
      <a class="brand" href="#top">
        <img class="brand__mark" src="${attr(site.site?.mark || "assets/images/mark.svg")}" alt="" width="32" height="32">
        <span class="brand__name">${esc(site.site?.name || "百科事典")}</span>
        <span class="brand__badge">${esc(site.site?.badge || "PARODY")}</span>
      </a>
    </div>
    <span class="parody-pill">非公式パロディ</span>
  </div>
</header>
<main class="page" id="main">
  ${renderArticleElement(state)}
</main>
${renderFooter(state)}
<p class="export-note">このページは「${esc(site.site?.name || "百科事典")}」から書き出した静的なHTMLです。</p>`;
  }

  function renderExportDocument(state, cssText = "") {
    const { site = {}, article = {} } = state;
    const title = `${article.title || "記事"}${article.reading ? ` (${article.reading})` : ""}｜${site.site?.name || "百科事典"}`;
    return `<!doctype html>
<html lang="${attr(site.site?.lang || "ja")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(plainText(article.summary || site.site?.description || ""))}">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<style>${cssText}</style>
</head>
<body class="export-page">
${renderExportBody(state)}
</body>
</html>`;
  }

  window.WikiRender = {
    esc,
    attr,
    safeHref,
    inline,
    plainText,
    numberSections,
    renderSite,
    renderExportBody,
    renderExportDocument,
  };
})();
