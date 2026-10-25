# AGENTS.md

依存パッケージなしの Node.js 静的サイト。単一の日本語パロディ百科事典記事を、ブラウザで JSON から描画する。UI 文言とコンテンツはすべて日本語なので、そのまま日本語で保つ。

## 実装の注意点

- GitHub Pagesでの公開を想定。
- クライアントサイドで完結する静的サイトとして実装する。
- サーバーサイドでの処理はホスティングのみとし、編集・保存はクライアントサイドで完結させる。
- `index.html` は手書きのシェルであり、ビルド生成物ではない。記事部分は実行時に `assets/js/render.js` が組み立てる。

## 編集時の注意点

- AGENTS.mdをはじめとした仕様とコード記述内容が食い違う場合は、無理に仕様に合わせてコードを変更せずに既存のコードを優先する。
- その後、作業終了時に仕様とコードが食い違う箇所を列挙し、変更の可否をユーザに判断させる。
- ユーザーから明示的に指示されない限り、コミット・amend・履歴の書き換え・push を行わない。変更後は差分を提示し、確認を待つ。

## コマンド

- `npm run dev` — <http://localhost:4173> で静的サーバー起動（記事 `/`、編集モード `/#editor`、ガイド `/guide.html`）。ファイル監視・自動ビルド・保存APIはない。ポート変更は `PORT=8080 npm run dev`。
- `npm run build` — `content/*.json` を検証する。`index.html` は生成しない。これが唯一の検証手順。テスト・lint・型チェック・依存パッケージ・lockfile はない。`npm install` は実行しない。
- `npm run check` — `npm run build` と同じ。
- `npm run preview` — `npm run dev` と同じ静的サーバー。

Node.js 18 以上が必要。

## 正となる情報源

- `content/site.json`、`content/article.json`、`content/categories.json` — ページの初期データと文言。**1記事のみ**のサイトであり、複数記事ジェネレーターではない。
- `index.html` — 記事シェルと編集モードのオーバーレイ。手書き。記事本文は含まない。
- `assets/js/render.js` — 記事・目次・検索インデックス・HTML書き出し用のレンダラー。`WikiRender` を公開。
- `assets/js/store.js` — `content/*.json` の読込、localStorage の保存・削除、クライアント側の検証。`WikiStore` を公開。
- `assets/js/main.js` — 記事の初期化、検索、ドロワー、ダイアログ、編集モード起動。`WikiSite` を公開。
- `assets/js/editor.js` — 記事ページ内の編集モード。フォーム、自動保存、画像、JSON編集。`WikiEditor` を公開。
- `assets/js/exporter.js` — JSON / HTML / PNG / PDF の書き出しとダウンロード。`WikiExport` を公開。
- `scripts/build.mjs` — 依存なしのコンテンツ検証スクリプト。HTMLテンプレートは持たない。
- `scripts/serve.mjs` — 依存なしの静的開発サーバー。API・監視処理は持たない。
- `editor.html` — 旧URL。`index.html#editor` へリダイレクトするだけ。
- `guide.html`、`assets/css/{style,editor,guide}.css` — 手書き。生成物ではない。
- `reference/` — ローカルの調査用スナップショット。`reference/*` で gitignore 済み。配布物に含めない。

## 検証とクセ

- 非ゼロ終了になる条件: `site.name`、`article.title` / `article.sections`、`categories.groups` の欠落、section / category id の重複、ローカルの hero / figure 画像ファイルの欠落。
- 警告のみ（終了コードは 0）: 未知の block `type`、`article.linkTerms` にない `[[term]]`、`2` / `3` 以外の section `level`、対応するグループがない記事カテゴリ。
- ローカル画像パスはリポジトリルート基準で確認される。`https://` と `data:` URL は対象外。
- `WikiRender.safeHref()` が許可するのは `#`、`/`、相対パス、`http(s)://`、`mailto:` のみ。それ以外のスキームは `#` になる。未知の block type は記事に何も描画しない。
- section id がない場合は実行時に `section-N` が割り当てられるが、**ファイルには書き戻されない**。メニュー・フッター・パンくずのリンクが id に直書きされているため、安定した id を使う。
- 節番号、ブロック数、カテゴリ数、項目数、タグ数、検索インデックスは、ブラウザでの描画時に計算される。ハードコードしない。
- 検証ルールは `scripts/build.mjs` と `assets/js/store.js` の両方にある。追加・変更する場合は両方をそろえる。
- 一部の表示文言・リンクは JSON ではなく `assets/js/render.js` に直書きされている: about セクションの pixiv 参考 URL と取得日、フッターの英語版「準備中」メッセージ、モバイルドロワーの CTA リンク。
- 記事上部のカテゴリはチップとして表示する。カテゴリ一覧・収録項目の一覧は記事ページには描画しない。`categories.json` は編集モード用のデータとして保持する。

## エディタと保存

- 編集モードは `index.html` 内の `#editor-overlay` にあり、ページ遷移せずに開閉する。`editor.html` は互換用リダイレクトのみ。
- 保存先は localStorage。`uchinoko-wiki:content:v1` に `{ site, article, categories }`、`uchinoko-wiki:content:v1:savedAt` に保存日時を入れる。
- サーバー保存APIはない。`npm run dev` は静的配信のみで、`file://` では `content/*.json` の `fetch` が失敗する。
- 入力は自動保存される。「今すぐ保存」と `Ctrl` / `Cmd` + `S` も同じ保存処理を使う。
- アップロード画像は `FileReader` で data URL にして表示するが、localStorage 保存時に `article.hero.src` と `figure` の `src` を空文字へ置換する。再訪時は再選択を促す。
- 編集内容をリポジトリの `content/*.json` へ直接書き戻す機能はない。JSONを書き出し、必要に応じて手動で `content/` を更新する。
- 書き出しは JSON（3データを1ファイル）・HTML（CSSと画像を埋め込んだ単体ファイル）・PNG（記事全体）・PDF（A4複数ページ）。PNG/PDF は SVG `foreignObject` を canvas に描画する方式で、長い記事は自動縮小される。
- 読み込みは本サイトのJSONバンドル、または `site.json` / `article.json` / `categories.json` の複数選択に対応する。`WikiStore.validate()` でエラーがある場合は反映しない。

## コンテンツ編集

- JSON は2スペースインデント、UTF-8、コメントなし、末尾改行あり。`content/*.json` と書き出しJSONの両方でこの形式を使う。
- インライン記法: `[[term]]`、`[[term|label]]`、`[label](url)`、`**bold**`、`` `code` ``。
- ブロック種別: `paragraph`、`list`、`code`、`callout`（`info` / `warn` / `parody`）、`tags`、`figure`、`quote`、`divider`。
- スキーマの詳細は `README.md` に集約する。`guide.html` はサイト利用者向けの使い方であり、詳細なスキーマは置かない。
- ブロック種別やフィールドを追加する場合は、`assets/js/render.js` の `renderBlock()`、`assets/js/editor.js` の `BLOCK_TYPES` とフォーム項目、`scripts/build.mjs` の `scanBlocks()` を更新する。必要に応じて `README.md` と `guide.html` も更新する。
