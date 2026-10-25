/* ==========================================================================
   Client-side exports: JSON / HTML / PNG / PDF.

   - JSON  : one bundle containing site, article and categories.
   - HTML  : a standalone document with the stylesheet and images inlined.
   - PNG   : a full-length capture of the article card.
   - PDF   : the same capture split across A4 pages.

   No dependencies. Exposes `window.WikiExport`.
   ========================================================================== */

(() => {
  "use strict";

  const downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const sanitizeName = (value) =>
    String(value || "article")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 60) || "article";

  function fileBase(state) {
    const date = new Date().toISOString().slice(0, 10);
    return `uchinoko-${sanitizeName(state.article?.title)}-${date}`;
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} を読み込めませんでした（HTTP ${response.status}）。`);
    return response.text();
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("画像を読み込めませんでした。"));
      reader.readAsDataURL(blob);
    });
  }

  async function imageToDataURL(src) {
    const value = String(src || "").trim();
    if (!value || value.startsWith("data:")) return value;
    if (/^https?:\/\//i.test(value)) {
      try {
        return await blobToDataURL(await (await fetch(value, { mode: "cors" })).blob());
      } catch {
        // Cross-origin images may refuse CORS. Keep the absolute URL instead.
        return new URL(value, window.location.href).href;
      }
    }
    const url = new URL(value, window.location.href);
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`画像「${value}」を読み込めませんでした。`);
    return blobToDataURL(await response.blob());
  }

  async function inlineImages(container) {
    const images = Array.from(container.querySelectorAll("img[src]"));
    await Promise.all(
      images.map(async (image) => {
        const src = image.getAttribute("src");
        if (!src) return;
        try {
          image.setAttribute("src", await imageToDataURL(src));
        } catch (error) {
          console.warn(error);
        }
      }),
    );
  }

  /* ------------------------------------------------------------------ *
   * JSON
   * ------------------------------------------------------------------ */

  function exportJSON(state) {
    const payload = {
      format: "uchinoko-wiki",
      version: 1,
      exportedAt: new Date().toISOString(),
      site: state.site,
      article: state.article,
      categories: state.categories,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(`${fileBase(state)}.json`, blob);
  }

  /* ------------------------------------------------------------------ *
   * HTML
   * ------------------------------------------------------------------ */

  async function exportHTML(state) {
    const [css] = await Promise.all([fetchText("assets/css/style.css")]);
    const documentHTML = WikiRender.renderExportDocument(state, css);
    const parsed = new DOMParser().parseFromString(documentHTML, "text/html");
    await inlineImages(parsed);

    const html = `<!doctype html>\n${parsed.documentElement.outerHTML}\n`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    downloadBlob(`${fileBase(state)}.html`, blob);
  }

  /* ------------------------------------------------------------------ *
   * Capture shared by PNG / PDF
   * ------------------------------------------------------------------ */

  const CAPTURE_WIDTH = 900;
  const CAPTURE_PADDING = 32;
  const MAX_CANVAS = 16384;
  const IMAGE_DECODE_TIMEOUT = 3000;

  // Images must be loaded before the stage is measured, otherwise the capture
  // height is too short and the bottom of the article is cut off. decode()
  // alone is not enough (it can stay pending for a stage image), so wait for
  // load/error first and cap decode().
  async function waitForImage(image) {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }
    if (!image.decode) return;
    await Promise.race([
      image.decode().catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, IMAGE_DECODE_TIMEOUT)),
    ]);
  }

  async function captureArticle(state) {
    const css = await fetchText("assets/css/style.css");

    const parser = document.createElement("div");
    parser.innerHTML = WikiRender.renderExportBody(state);
    const article = parser.querySelector(".article");
    if (!article) throw new Error("書き出す記事が見つかりませんでした。");
    // Lazy images never load inside the off-screen stage.
    for (const image of article.querySelectorAll("img[loading]")) image.removeAttribute("loading");
    await inlineImages(article);

    const stage = document.createElement("div");
    stage.className = "capture-stage";
    stage.setAttribute("aria-hidden", "true");
    // Inside <foreignObject> there is no <body>, so the body font rules from
    // style.css are repeated on the stage to keep measurement and rendering in sync.
    stage.innerHTML = `<style>${css}</style>
<style>
.capture-stage{width:${CAPTURE_WIDTH}px;padding:${CAPTURE_PADDING}px;box-sizing:border-box;background:#eef1f4;color:var(--text-2);font-family:var(--font-sans);font-size:14px;line-height:1.6;text-rendering:optimizeLegibility;}
.capture-stage .article{box-shadow:0 8px 26px rgba(20,35,55,.10);}
.capture-stage .section__anchor{display:none;}
</style>
${article.outerHTML}`;

    // The stage itself must stay in normal flow: its inline style is
    // serialized into the SVG, so `position: fixed; left: -10000px` on it
    // would render the capture off-canvas (blank image). Hide an outer host
    // instead, which is not part of the serialized markup.
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.zIndex = "-1";
    host.appendChild(stage);
    document.body.appendChild(host);

    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(Array.from(stage.querySelectorAll("img")).map(waitForImage));

      const width = Math.ceil(stage.getBoundingClientRect().width) || CAPTURE_WIDTH;
      const height = Math.max(1, Math.ceil(stage.scrollHeight));

      // HTML is only rendered inside an SVG through <foreignObject>; placed
      // directly under <svg> it is ignored and only the background remains.
      // XMLSerializer emits the XHTML namespace on the stage element itself.
      const serializer = new XMLSerializer();
      const stageXML = serializer.serializeToString(stage);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${stageXML}</foreignObject></svg>`;

      // Load the SVG from a data URL, not a blob URL: Chrome taints the canvas
      // when a blob-URL SVG containing <foreignObject> is drawn, which makes
      // toBlob() fail. Base64 via FileReader keeps long Japanese text compact.
      const svgURL = await blobToDataURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      image.decoding = "sync";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("記事の描画に失敗しました。"));
        image.src = svgURL;
      });

      let scale = Math.min(2, MAX_CANVAS / width, MAX_CANVAS / height);
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas を初期化できませんでした。");
      context.fillStyle = "#eef1f4";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      return { canvas, width, height, scale };
    } finally {
      host.remove();
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("画像を生成できませんでした。"))),
        type,
        quality,
      );
    });
  }

  async function exportPNG(state) {
    const { canvas } = await captureArticle(state);
    const blob = await canvasToBlob(canvas, "image/png");
    downloadBlob(`${fileBase(state)}.png`, blob);
  }

  /* ------------------------------------------------------------------ *
   * PDF (minimal writer, JPEG image split across A4 pages)
   * ------------------------------------------------------------------ */

  // Page layout in PDF points (origin at the bottom-left). Each page clips a
  // fixed window at the top of the page and shifts the full-height image up
  // by `segmentTop`, so page N shows the N-th slice of the capture.
  function planPdfPages(scaledHeight, usableHeight, pageHeight, margin) {
    const pageCount = Math.max(1, Math.ceil(scaledHeight / usableHeight));
    return Array.from({ length: pageCount }, (_, index) => {
      const segmentTop = index * usableHeight;
      const segmentHeight = Math.max(0.1, Math.min(usableHeight, scaledHeight - segmentTop));
      return {
        segmentTop,
        segmentHeight,
        clipBottom: pageHeight - margin - segmentHeight,
        imageBottom: pageHeight - margin - scaledHeight + segmentTop,
      };
    });
  }

  function buildPDF(jpegBytes, imageWidth, imageHeight) {
    const encoder = new TextEncoder();
    const chunks = [];
    let length = 0;
    const offsets = [];

    const pushBytes = (bytes) => {
      chunks.push(bytes);
      length += bytes.length;
    };
    const pushText = (text) => pushBytes(encoder.encode(text));

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 28;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const scale = usableWidth / imageWidth;
    const scaledHeight = imageHeight * scale;
    const pages = planPdfPages(scaledHeight, usableHeight, pageHeight, margin);
    const pageCount = pages.length;

    const totalObjects = 3 + pageCount * 2;
    const pageId = (index) => 4 + index;
    const contentId = (index) => 4 + pageCount + index;

    // Header line first, then a binary comment marking the file as binary.
    pushText("%PDF-1.4\n");
    pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const begin = (id) => {
      offsets[id] = length;
      pushText(`${id} 0 obj\n`);
    };
    const end = () => pushText("endobj\n");

    begin(1);
    pushText("<< /Type /Catalog /Pages 2 0 R >>\n");
    end();

    begin(2);
    pushText(
      `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${pageId(index)} 0 R`).join(" ")}] >>\n`,
    );
    end();

    begin(3);
    pushText(
      `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    );
    pushBytes(jpegBytes);
    pushText("\nendstream\n");
    end();

    for (let index = 0; index < pageCount; index += 1) {
      begin(pageId(index));
      pushText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 3 0 R >> >> /Contents ${contentId(index)} 0 R >>\n`,
      );
      end();
    }

    for (let index = 0; index < pageCount; index += 1) {
      const { segmentHeight, clipBottom, imageBottom } = pages[index];
      const stream = [
        "q",
        `${margin.toFixed(2)} ${clipBottom.toFixed(2)} ${usableWidth.toFixed(2)} ${segmentHeight.toFixed(2)} re`,
        "W n",
        `${usableWidth.toFixed(2)} 0 0 ${scaledHeight.toFixed(2)} ${margin.toFixed(2)} ${imageBottom.toFixed(2)} cm`,
        "/Im0 Do",
        "Q",
      ].join("\n");

      begin(contentId(index));
      pushText(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream\n`);
      end();
    }

    const xrefOffset = length;
    pushText(`xref\n0 ${totalObjects + 1}\n`);
    pushText("0000000000 65535 f \n");
    for (let id = 1; id <= totalObjects; id += 1) {
      pushText(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
    }
    pushText(
      `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    const output = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      output.set(chunk, position);
      position += chunk.length;
    }
    return output;
  }

  async function exportPDF(state) {
    const { canvas, width, height } = await captureArticle(state);
    const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const pdf = buildPDF(jpegBytes, canvas.width, canvas.height);
    downloadBlob(`${fileBase(state)}.pdf`, new Blob([pdf], { type: "application/pdf" }));
    return { width, height };
  }

  window.WikiExport = {
    exportJSON,
    exportHTML,
    exportPNG,
    exportPDF,
    downloadBlob,
    fileBase,
  };
})();
