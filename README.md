# うちのこ百科事典（C言語）

ピクシブ百科事典の記事ページを参考にした、C言語の非公式パロディ百科事典です。
記事本文・画像・カテゴリ・項目数はJSONから生成され、HTMLを直接編集せずに更新できます。

- 記事ページ: `index.html`
- 編集ガイド（サイト内）: `guide.html`
- コンテンツエディタ: `editor.html`

> このサイトはpixiv株式会社、ピクシブ百科事典、および記事内で言及される各団体・人物とは関係のない非公式パロディです。

## クイックスタート

Node.js 18以降が必要です。外部パッケージのインストールは不要です。

```bash
npm run dev
```

- 記事: <http://localhost:4173/>
- エディタ: <http://localhost:4173/editor.html>
- ガイド: <http://localhost:4173/guide.html>

| コマンド | 動作 |
| --- | --- |
| `npm run dev` | ローカルサーバーを起動し、`content/*.json` の変更を監視して自動ビルド |
| `npm run build` | `index.html` を一度だけ再生成 |
| `npm start` | `npm run dev` と同じ |
| `npm run preview` | 監視なしで静的ファイルを配信 |

`npm run dev` と `npm start` は `PORT` 環境変数でポートを変更できます。

```bash
PORT=8080 npm run dev
```

## ファイル構成

```text
.
├── index.html              # 生成物（直接編集しない）
├── editor.html             # コンテンツエディタ
├── guide.html              # サイト内の編集ガイド
├── robots.txt              # 検索エンジンのクロール拒否
├── content/
│   ├── site.json           # サイト名・ヘッダー・フッター・メニュー
│   ├── article.json        # 記事本文・画像・タグ・履歴
│   └── categories.json     # カテゴリ一覧と収録項目
├── assets/
│   ├── css/style.css       # 記事ページのスタイル
│   ├── css/editor.css      # エディタのスタイル
│   ├── css/guide.css       # ガイドのスタイル
│   ├── js/main.js          # 検索・ドロワー・目次・ダイアログなど
│   ├── js/editor.js        # エディタの状態管理・保存・書き出し
│   └── images/             # ロゴと挿絵（オリジナルSVG）
├── scripts/
│   ├── build.mjs           # ゼロ依存の静的サイトジェネレーター
│   └── serve.mjs           # 開発サーバー・監視・保存API
├── reference/              # 参考にしたページの保存資料
└── package.json
```

`index.html` は `scripts/build.mjs` が生成します。直接編集しても次のビルドで上書きされます。

## エディタ

`npm run dev` を起動して <http://localhost:4173/editor.html> を開きます。

- **基本情報**: タイトル、読み、概要、ヒーロー画像、パンくず、リンク語句、履歴など
- **本文**: セクションとブロックの追加・削除・並べ替え
- **カテゴリ**: グループと収録項目の追加・削除・並べ替え
- **サイト設定**: サイト名、注意バー、ヘッダー、注目リンク、フッター、モバイルメニュー
- **JSON**: 3ファイルを直接編集、構文チェック、個別ダウンロード

「保存してビルド」を押すと、3つのJSONを保存して `index.html` を再生成します。
検証またはビルドに失敗した場合、3ファイルは保存前の状態へ自動的に戻ります。
`Ctrl` / `Cmd` + `S` でも保存できます。

「書き出し」は3ファイルを `pixpedia-content.zip` としてダウンロードします。
「ファイルから読み込む」では、手元のJSONを選択して復元できます。

### 保存API

エディタの保存機能はローカルサーバー専用です。

- `POST /api/save`
  - `Content-Type: application/json`
  - ルートキー `site`, `article`, `categories` を持つJSON
  - 保存後にビルドを実行。失敗時はHTTP 422を返し、3ファイルをロールバック
- `POST /api/build`
  - コンテンツを変更せずに再ビルド

## データ構造

3ファイルはすべてUTF-8のJSONです。コメントは書けません。

### `content/article.json`

| キー | 型 | 内容 |
| --- | --- | --- |
| `title` | string | 記事タイトル（必須） |
| `reading` | string | 読み。ページタイトルに表示 |
| `summary` | string | 冒頭の説明。meta descriptionにも使用 |
| `breadcrumb` | array | `{ label, href }` の配列 |
| `categories` | string[] | 記事ヘッダーのカテゴリ名。`categories.json` のグループ名と対応 |
| `hero` | object | `src`, `alt`, `caption`, `credit`, `creditHref` |
| `actions` | array | `{ label, href, primary? }` |
| `updated` | string | 最終更新日（`YYYY-MM-DD`） |
| `version` | string | バージョン表記 |
| `linkTerms` | object | `[[語句]]` のリンク先 |
| `sections` | array | 本文セクション（必須） |
| `relatedTags` | string[] | 関連タグ |
| `history` | array | `{ date, note }` の配列 |
| `about` | object | `{ title, text }` |

セクションの構造:

```json
{
  "id": "overview",
  "level": 2,
  "title": "概要",
  "blocks": [
    { "type": "paragraph", "text": "本文です。" }
  ]
}
```

- `id` は目次アンカー。ファイル内で一意にします（必須）。
- `level` は `2`（大見出し）または `3`（小見出し）を推奨。
- `title` は必須。
- `blocks` は配列。省略時は空として扱われます。

### `content/categories.json`

```json
{
  "title": "カテゴリ一覧",
  "description": "一覧の説明文",
  "groups": [
    {
      "id": "general",
      "name": "一般",
      "color": "#5b7c99",
      "description": "グループの説明",
      "items": [
        { "name": "C言語", "href": "#top", "current": true },
        { "name": "未作成の項目", "soon": true }
      ]
    }
  ]
}
```

- `groups` は必須。`name` は必須、`items` 省略時は空。
- `id` は一意にします。省略時は `category-1` のような値が割り当てられます。
- `current: true` で「この記事」バッジ。
- `soon: true` で未作成項目のトースト表示。
- `href` 省略時は `#categories` へリンク。

### `content/site.json`

| キー | 内容 |
| --- | --- |
| `site` | `name`, `badge`, `mark`, `tagline`, `description`, `lang`, `themeColor` |
| `notice` | 上部の注意バー。`enabled`, `text`, `button`, `storageKey` |
| `header` | 検索プレースホルダー、投稿ボタン、ログインボタンの文言とリンク |
| `spotlight` | 「注目」リンク。`query` は検索、`href` は通常リンク |
| `footer` | `blurb`, `columns`, `copyright`, `disclaimer` |
| `menu` | モバイルドロワーの `title` と `sections` |

`footer.columns[].links[]` は次のいずれかです。

- `{ "label": "...", "href": "..." }` — 通常リンク
- `{ "label": "...", "action": "history" }` — 編集履歴ダイアログ
- `{ "label": "...", "action": "soon" }` — 準備中トースト

## 本文ブロック

| `type` | 主なキー | 表示 |
| --- | --- | --- |
| `paragraph` | `text` | 段落 |
| `list` | `title?`, `items[]`, `ordered?` | 箇条書き。`ordered: true` で番号付き |
| `code` | `language`, `filename`, `code` | コピー付きコードブロック |
| `callout` | `tone`, `title?`, `text` | 注記。`tone` は `info` / `warn` / `parody` |
| `tags` | `items[]` | 検索できるタグクラウド |
| `figure` | `src`, `alt`, `caption`, `credit?` | 画像とキャプション |
| `quote` | `text`, `cite?` | 引用 |
| `divider` | なし | 区切り線 |

未対応の `type` はビルド時に警告され、生成HTMLにはコメントとして残ります。

### インライン記法

段落、リスト、注記、引用、キャプションで使用できます。

| 書き方 | 結果 |
| --- | --- |
| `[[C++]]` | `linkTerms` のリンク先で「C++」をリンク |
| `[[C++\|Cプラプラ]]` | 表示名を変えてリンク |
| `[ラベル](https://example.com)` | 通常のリンク。外部URLは新しいタブ |
| `**強調**` | 太字 |
| `` `コード` `` | インラインコード |

- `[[語句]]` が `linkTerms` にない場合は平文で表示され、ビルド時に警告が出ます。
- URLは `safeHref()` で検証されます。`javascript:` などは `#` に置き換わります。
- HTMLタグはエスケープされ、そのままでは埋め込まれません。
- コードブロック内の `code` にはインライン記法を適用しません。

## 画像

画像は `assets/images/` に置き、`assets/images/ファイル名` の相対パスで指定します。

- `article.hero` — 記事上部のヒーロー画像
- `figure` ブロック — 本文中の画像
- ローカル画像が見つからない場合、ビルドはエラーで停止します。
- 外部URL（`https://`）と `data:` URLは存在チェックの対象外です。
- 画像には内容を説明する `alt` を付け、出典は `credit` に記載します。

現在のロゴ・C言語アイコン・ポインタ図は、このパロディ用に作成したオリジナルSVGです。

## 自動計算

次の値はJSONから自動計算され、HTMLに直接書きません。

- 節番号（`level: 2` で大番号、`level: 3` で小番号）
- 本文ブロック数
- カテゴリ数
- 収録項目数（延べ）と重複を除いた数
- 関連タグ数
- 検索インデックス（セクション本文・カテゴリ・タグ）

## 静的ホスティング

`npm run build` 後、次のファイルをアップロードします。

```text
index.html
guide.html
editor.html
robots.txt
assets/
content/
```

`content/` はエディタが読み込むために必要です。エディタを公開しない場合は省略できますが、
再ビルド用にリポジトリ側で保管してください。

静的ホスティングでは保存APIが使えないため、更新は次の流れになります。

1. エディタで編集し、「書き出し」でZIPを取得
2. ZIP内の3つのJSONを `content/` に上書き
3. `npm run build` を実行
4. 変更したファイルをアップロード

## 検索避け

このサイトは公開状態でも検索エンジンに登録されないよう、次の2つを設定しています。

- `index.html`、`guide.html`、`editor.html` の `<head>` に
  `<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">` を指定
- リポジトリ直下の `robots.txt` で `Disallow: /`

`robots.txt` はサイトのルートに置かれた場合のみ有効です。GitHub Pages のプロジェクトページ
（`https://example.github.io/repo/`）ではオリジン直下の `robots.txt` が読まれないため、
各ページの `noindex` が主な対策になります。

これらは検索結果への掲載を避けるための設定であり、アクセス制限ではありません。
URLを知っている人は誰でも閲覧できます。完全に非公開にしたい場合は、ホスティング側の
アクセス制限やパスワード保護を使用してください。

## 補足・トラブルシューティング

- **記事が更新されない**: `npm run dev` のログでビルド成功を確認し、ブラウザを再読み込みしてください。
- **保存できない**: エディタは `npm run dev` 経由で開く必要があります。`file://` では動きません。
- **ビルドが失敗する**: エラーメッセージにファイル名とキーが表示されます。必須項目、IDの重複、画像パスを確認してください。
- **JSONの構文エラー**: エディタの「JSON」タブで該当ファイルを開き、構文チェックを行ってください。
- **バックアップ**: 大きな変更の前にエディタの「書き出し」でZIPを保存してください。

## 参考資料

`reference/` に、参考にしたページの保存資料と出典をまとめています。このディレクトリは
`.gitignore` の対象で、リポジトリや配布物には含まれません。

## ライセンス・免責

このリポジトリの文章・ロゴ・挿絵は、このパロディサイト用に作成したものです。
pixiv百科事典の本文をそのまま転載したものではありません。
pixiv株式会社、ピクシブ百科事典、および記事内で言及される各団体・人物とは関係ありません。
