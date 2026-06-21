# Wend Application Design

## Overview

Wend is a desktop application for **managing** and **executing** AI prompt strings. It is an "IDE for prompts" — users can create, edit, organize, run AI pipelines, and accumulate results — all within a tree-based node structure with multiple tabs.

**Architecture:** Electron (Node.js) + HTML/JS/CSS frontend.

## Directory Structure

```
Wend/                              ← プロジェクトルート
├── package.json                      ← npm root（electron/ へ委譲）
├── main.js                           ← ルートコピー（electron/main.js と同一内容）
├── CMakeLists.txt                    ← 旧 Win32 版のビルドスクリプト（現在は未使用）
├── build.sh / copy.sh                ← ビルド・配布スクリプト
├── designdoc/                        ← 設計ドキュメント
├── electron/                         ← Electron バックエンド
│   ├── package.json                  ← Electron エントリポイント（main: "main.js"）
│   ├── main.js                       ← メインプロセス（Storage / PipelineRunner / Bridge）
│   ├── preload.js                    ← contextBridge で window.__promptsBridge を公開
│   └── test.js                       ← Node.js ユニットテスト（node --test）
└── frontend/                         ← レンダラープロセス（HTML/JS/CSS）
    ├── index.html                    ← エントリポイント
    ├── app.js                        ← メインロジック（Tree/Prompt/Input/Output/Messages）
    ├── style.css
    ├── lang/                         ← 翻訳ファイル（JSON）
    │   ├── en.json
    │   ├── ja.json
    │   ├── fr.json
    │   ├── es.json
    │   ├── pt.json
    │   └── de.json
    ├── wizards/                      ← ウィザード定義
    └── lib/
        ├── marked.min.js             ← Markdown → HTML 変換
        ├── mark.min.js               ← 検索ハイライト
        ├── mermaid.min.js            ← フロー図自動生成（Basic モード）
        └── cytoscape.min.js          ← インタラクティブノードエディタ（Expert モード将来）
```

## UserData Storage

```
%APPDATA%/Wend/
├── config.json          ← Global configuration
├── providers.json       ← API keys (NOT in source tree, NOT in git)
├── recipes.json         ← Global recipe definitions
├── pipeline.json        ← Global pipeline definitions (no keys)
├── session.json         ← Tab list (authoritative; lone source of truth for startup)
├── data/
│   ├── general.json     ← Initial/default per-tab tree data
│   ├── project-20260609_180000.json ← Created when a new project/tab is created
│   └── ...
├── blobs/               ← External media files from pipeline runs
│   ├── pipeline_20250530_153042_0.png
│   ├── pipeline_20250530_153042_1.webp
│   └── ...
└── history/              ← Pipeline execution history
    └── run_20250530_153042.json
```

### Blob Garbage Collection

| タイミング | 動作 |
|-----------|------|
| **アプリ起動時** | `blobs/` をスキャン、全 `data/*.json` の `attachments[].file` から参照されていないファイルを削除（確認なし） |
| **Node 削除時** | その node の attachment が参照する blob ファイルを削除 |
| **手動** | Config に "Clean up unreferenced blobs" ボタン |

参照チェック: 全 `data/*.json` + `history/run_*.json` をパースし、`attachments[].file` に登場するパスのみ保持。それ以外を削除する。
history が参照している blob ファイルは、history が存在する限り削除しない（history 削除時に合わせて削除）。

## Architecture

```
 ┌──────────────────────────────────────────────────────────┐
 │  Electron Main Process（Node.js）                         │
 │  electron/main.js                                        │
 │  Storage / PipelineRunner / AIProvider                   │
 │  Bridge (ipcMain ↔ ipcRenderer)                          │
 ├──────────────────────────────────────────────────────────┤
 │  Electron Renderer Process（Chromium BrowserWindow）      │
 │  frontend/index.html + app.js + style.css                │
 │  Tree | Prompt | Input | Output | Messages               │
 └──────────────────────────────────────────────────────────┘
```

## UI Architecture（Vanilla JS 原則）

**視覚的な UI はすべてレンダラープロセス（HTML+JS）で実装する。**
メインプロセスは OS レベルの操作のみを担当し、Bridge 経由で JS と連携する。

### メインプロセス（electron/main.js）が担う操作

| 操作 | API |
|------|-----|
| ファイル開く/保存ダイアログ | `dialog.showOpenDialogSync` / `dialog.showSaveDialogSync` |
| ファイル I/O | `fs.readFileSync` / `fs.writeFileSync` / `fs.mkdirSync` 等 |
| PipelineRunner | Node.js `https`/`http` モジュール（SSE ストリーミング） |
| コマンド実行 | `child_process.execFile` / `spawn` |
| メニューバー | Electron `Menu.buildFromTemplate` |

### レンダラープロセス（frontend/）が担う UI

| UI 要素 | 実装方法 |
|---------|---------|
| ペインレイアウト | CSS Grid/Flex（Tree/Prompt/Input/Output） |
| コンテキストメニュー | HTML カスタムドロップダウン（`contextmenu` イベントで OS メニューを抑制） |
| Config ダイアログ | HTML モーダルパネル（CSS overlay） |
| Pipeline Runner ダイアログ | HTML モーダルパネル + mermaid.js フロー図 |
| Splitter | CSS/JS リサイズ（`vertical-resize-handle` / `horizontal-resize-handle`） |
| ノード DnD（並び替え） | HTML5 DnD API |
| ファイル DnD（ドロップ） | `drop` イベントでファイル取得 → Bridge でメインプロセスに渡す |
| 検索バー | HTML インライン UI |
| メディア再生（WAV 等） | HTML `<audio>` / `<video>` タグ |

### UI ライブラリ方針

Vanilla JS（フレームワーク・バンドラ不使用）で実装する。

- **状態管理**: `app.state = { tabs, activeTab, selectedOpPath, selectedDataPath, ... }`
- **UI 更新**: Bridge メッセージ受信 → state 更新 → `renderTree()` / `renderInput()` / `renderOutput()` / `renderPrompt()` を呼ぶ
- **ファイル構成**: `index.html` / `app.js` / `style.css` の3ファイル + `lang/` + `lib/`
- **依存ライブラリ**: marked.js / mark.js / mermaid.js / cytoscape.js（すべてバンドル同梱）

### Bridge（IPC）フロー

```
// JS → メインプロセス
window.__promptsBridge.postMessage({ type: "open_file_dialog", payload: {...} })

// メインプロセス → JS
mainWindow.webContents.send('bridge-message', { type: "open_file_dialog_result", payload: {...} })
```

`preload.js` が `contextBridge.exposeInMainWorld('__promptsBridge', {...})` で
`postMessage` / `addEventListener` / `removeEventListener` を公開。
`app.js` 側は `window.__promptsBridge` か `window.chrome.webview`（互換エイリアス）を使用。

### ファイルダイアログの Bridge フロー（全 Open/Save 共通）

```
JS:   __promptsBridge.postMessage({ type: "open_file_dialog", payload: { filter: "json" } })
Main: dialog.showOpenDialogSync(...) → パス取得
Main: mainWindow.webContents.send('bridge-message', { type: "open_file_dialog_result", payload: { path } })
JS:   結果を受け取って処理
```

### frontend/ 配信方法

Electron では `BrowserWindow.loadFile(path.join(FRONTEND_ROOT, 'index.html'))` でローカルファイルを直接ロード。
開発中はソース直接編集可能、DevTools (F12) 使用可。パッケージ版では `process.resourcesPath/frontend/` を参照。

## Localization

6 言語対応。JS 側（UI 文字列）と C++ 側（Messages ペインのログ）の両方に適用する。

### 対応言語

| コード | 言語 |
|--------|------|
| `en` | English |
| `ja` | 日本語 |
| `fr` | Français |
| `es` | Español |
| `pt` | Português |
| `de` | Deutsch |

### 実装方式

JYEditor と同様の C++ static map 方式 + WebView2 JS 側の JSON 翻訳ファイルの2層構造。

**C++ 側（Messages ログ、Config ダイアログの固定文字列）:**

```cpp
class WendLocalization {
    std::string m_currentLang = "en";
    std::wstring GetString(const std::string &key) const;
    // 内部: static map<string, map<string, wstring>> で全言語の翻訳を保持
};
```

**JS 側（UI 全般）:**

```
frontend/
├── index.html
├── app.js
├── style.css
├── lib/ ...
└── lang/                           ← 翻訳ファイル
    ├── en.json
    ├── ja.json
    ├── fr.json
    ├── es.json
    ├── pt.json
    └── de.json
```

起動時に C++ → JS: `init` メッセージに `{ language: "ja" }` を含めて通知。
JS 側は `fetch("lang/ja.json")` で該当ファイルを読み込み、UI 文字列を差し替える。

### 類似ソフトウェアとの比較

Wend は n8n のローカル特化版 + プロンプト管理に相当する。

#### n8n 詳細比較

| カテゴリ | 項目 | n8n | Wend |
|---------|------|-----|---------|
| **基本設計** | アーキテクチャ | Web (React) + Node.js バックエンド | Win32 + WebView2 (HTML/JS) |
| | 実行環境 | SaaS / Docker self-hosted | ローカル Win32 ネイティブ |
| | オフライン動作 | ❌ 一部不可 | ✅ 完全オフライン |
| | データ保存 | 内部 DB (SQLite/PostgreSQL) + エクスポート | ローカル JSON ファイル (`%APPDATA%`) |
| | ライセンス | Sustainable Use License (SSPL 類似) | 独自（ecode 準拠） |
| **ノード/ステップ** | 総ノード数 | 200+（サービス別コネクタ） | 5 種汎用ステップ + OS コマンド委譲 |
| | AI ノード | OpenAI / Anthropic / Ollama / HuggingFace 等 | `ai` (4 プロバイダ統合) |
| | ファイル変換 | CSV / XML / JSON / Excel 専用ノード | `command` (任意 CLI) |
| | 画像処理 | なし（専用ノードなし） | `command` (ffmpeg/ImageMagick) + image ノード |
| | ユーザー確認 | Wait + Webhook（間接的） | `manual` (view/edit/select) + `choices[]` |
| | 外部サービス連携 | 200+ ノード（各サービス専用） | `fetch` + auth (providers.json) |
| **実行制御** | 条件分岐 | IF / Switch ノード | `onSelect.goto_step`（ループ含む）/ `condition` ステップ |
| | 並列実行 | Split / Merge In Batches | `"parallel"` ステップ（Basic 互換）/ Cytoscape.js Expert モード（将来） |
| | エラーハンドリング | Error Trigger / Retry | `retry.count` / `delayMs` / `onSelect` |
| | 実行中編集 | ❌ 不可 | ✅ Dynamic Queue (`std::deque`) |
| | 手動トリガー | Manual Trigger ノード | Toolbar `[▶ Run Pipeline]` |
| **UI/UX** | フロー図 | インタラクティブノードエディタ | mermaid.js 自動生成（Basic）/ Cytoscape（Expert） |
| | 実行中ハイライト | ✅ ノード色変更 | ✅ ハイライト + 点滅 |
| | プログレス表示 | 全体の進行状況バー | ステップ単位バー + スピナー |
| | ログ表示 | Execution タブ | Messages 第4ペイン |
| | 実行履歴 | ✅ 全実行記録・ステップ別入出力確認 | ✅ `history/` + History UI |
| **データ管理** | プロンプト編集 | ❌ なし（専用エディタなし） | ✅ 内蔵エディタ (text/RTF/HTML/image) |
| | プロンプト蓄積・再利用 | ❌ なし | ✅ ツリーノード + 子ノード履歴 |
| | 添付ファイル | ❌ なし | ✅ attachments + `blobs/` |
| | 全文検索 | ❌ なし | ✅ Ctrl+F 全タブ横断 |
| | エクスポート | JSON ワークフロー定義 | ZIP (Node + blobs) |
| **拡張性** | カスタムコード | Code / Function ノード (JS/Python) | `command` (任意言語) |
| | テンプレート変数 | Expression (`{{ $json.xxx }}`) | `variables[]` + `{content}` / `{result}` |
| | サブルーチン | Sub-workflow ノード | Dynamic Queue `[+ Pipeline]` |
| | コミュニティ共有 | n8n.io ワークフロー公開 | 設計段階（将来検討） |

#### Wend の独自優位点（対 n8n）

1. **プロンプト管理 + 実行の一体化** — 単なるパイプラインエディタではなく、プロンプトをツリーで管理・蓄積・再利用する
2. **ローカルファースト完全オフライン** — 設定・データ・パイプラインがすべてローカルファイル。API キーもローカル保存
3. **マルチモーダルノード** — text / RTF / HTML / image を単一ノードに格納 + 添付ファイル
4. **Dynamic Queue 実行中編集** — パイプライン実行中に待機ステップの追加・編集・削除・順序変更が可能
5. **OS ツール統合** — awk/sed/ffmpeg/ImageMagick 等の CLI ツールや GUI アプリを直接パイプラインに統合
6. **ecode 埋め込み** — エディタ内でタブとして利用可能

## UI スケッチ

### コンセプト図

```
  素材 (ノード)           レシピ (パイプライン)          成果物 (子ノード)
  ─────────────────  ×   ──────────────────────  =   ─────────────────────
  あなたのコンテンツ       AIへの指示の連鎖               AI処理結果
  テキスト/画像/PDF        プロンプト+モデル+順序          ✨ 子ノードとして保存
                                                         作り方が埋め込まれる
                                                         成果物→次の素材に使える
```

ノードには2種類ある:

| 種類 | 外観 | 説明 |
|------|------|------|
| 📄 素材ノード | 白文字・通常 | ユーザーが作成したコンテンツ |
| ✨ 成果物ノード | 青みがかった色・✨アイコン | AI パイプラインが生成した結果 |

---

### メインウィンドウ (Standalone)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ File  Pipeline  Providers  View  Help                                        │  ← Win32 メニューバー
├──────────────────────────────────────────────────────────────────────────────┤
│ [📄] [📂] [💾] [💾▾] │ [▶] [⚡] │ [🔍] [⚙] │  ← ツールバー
├──────────────────────────────────────────────────────────────────────────────┤
│ [General ×]  [Code ×]  [+ New Tab]                                           │  ← タブバー
├────────────────────┬─────────────────────────────────────────────────────────┤
│ 📂 素材            │ 📋 会議メモ の直下                          ▲ ◀Up ▶Down  │
│                    ├──────────────────────────────────────────────────────── │
│ 📂 プロジェクトA   │  📄 2024-12-01 議事録                    [▶] [📋]        │
│  ├📄 原稿.txt      │  ✨ 英訳 (Claude)          ← AI生成:青   [▶] [📋]        │
│  ├📄 会議メモ ●    │  ✨ 英訳 (GPT-4)           ← AI生成:青   [▶] [📋]        │
│  │ ├✨英訳(Claude) │  ✨ 翻訳+レビュー済み       ← AI生成:青   [▶] [📋]        │
│  │ ├✨英訳(GPT-4)  ├──────────────────────────────────────────────────────── │
│  │ └✨翻訳+レビュー│ ✏ タイトル: [会議メモ                                  ] │
│  └📷 diagram.png  │ ──────────────────────────────────────────────────────── │
│ 📂 プロジェクトB   │  2024年12月1日 定例会議                                  │
│                    │  参加者: 田中、鈴木、佐藤                                │
│                    │  議題: Q1予算について...                                 │
│                    │                                                         │
│                    │ [📋 text/plain ▾] [➕ 子追加] [💾 更新] [🗑 削除] [📋 Copy]│
│                    │ ──────────────────────────────────────────────────────── │
│                    │ 📎 添付なし                                              │
├────────────────────┴─────────────────────────────────────────────────────────┤
│ [📝 ログ] ▼  [21:45:02] ✅ Pipeline "翻訳→レビュー" completed                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### メインウィンドウ (--embedded モード)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [☰] [📄] [📂] [💾] [💾▾] │ [▶ Run] [⚡ レシピ] │ [🔍 検索...    ] [⚙] [🧪]  │  ← ツールバーのみ（メニューバーなし）
├──────────────────────────────────────────────────────────────────────────────┤
│ [General ×]  [Code ×]  [+]                                                   │
├────────────────────┬─────────────────────────────────────────────────────────┤
│  ← 以降は Standalone と同一レイアウト →                                      │
```

`☰` クリック時:

```
┌─────────────────────────────┐
│ ─ File ─────────────────── │
│   📄 New Tab      Ctrl+T   │
│   📂 Open...      Ctrl+O   │
│   💾 Save         Ctrl+S   │
│   💾 Save As...            │
│   📦 Import ZIP...         │
│   📤 Export Node...        │
│   Recent Files ▶           │
│ ─ Pipeline ──────────────  │
│   ▶ Run Pipeline...  F5    │
│   ⚡ Recipe Manager  Ctrl+P│
│   📜 History         Ctrl+H│
│ ─ Providers ─────────────  │
│   ⚙ Configure...           │
│ ─ View ──────────────────  │
│   Toggle Tree      Ctrl+1  │
│   Toggle Messages  Ctrl+4  │
└─────────────────────────────┘
```

---

### ✨ 成果物ノードの表示（エディタ下部のメタパネル）

成果物ノード（AI生成）を選択したとき、エディタ下部に「作り方」が表示される。

```
┌──────────────────────────────────────────────────────────────────────┐
│  こんにちは世界！これはテスト翻訳です。                               │  ← content
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ 📋 翻訳→比較選択        2026-06-04 21:45:00  [✔] [✕] [🔄] [📤] [📥]  │
│ ─────────────────────────────────────────────────────────────────── │
│  1  Translate   ai   anthropic   claude-sonnet-4-6      312 tok      │
│  2  Compare     manual compare   (人間が選択)                        │
│  3  Review      ai   openai      gpt-4.1                180 tok      │
└──────────────────────────────────────────────────────────────────────┘
```

| アイコン | tooltip |
|----------|---------|
| `[✔]` | この出力を保存 |
| `[✕]` | この履歴エントリを削除 |
| `[🔄]` | このパイプラインを再実行 |
| `[📤]` | チェストに送信 (Send to Chest) |
| `[📥]` | チェストから受信 (Receive from Chest) |

---

### レシピマネージャ (Pipeline Manager)

`[⚡ レシピ]` ボタンまたはメニュー `Pipeline > Recipe Manager` で開く。

```
┌─ レシピ (パイプライン) ─────────────────────────────────────────────────────────┐
│ [翻訳→比較選択] [要約] [日報生成] [+ 新規レシピ]                                │
├────────────────────────────────────────────────────────────────────────────────┤
│ 名前: [翻訳→比較選択                        ]                                  │
│ ─────────────────────────────────────────────────────────────────────────────  │
│ ステップ:                                      フロー図:                       │
│  ┌──────────────────────────────────────┐    ┌──────────────────────────────┐ │
│  │ 1  🤖 Multi-translate  [parallel] ↕ │    │ [素材]                        │ │
│  │       Claude / GPT-4 / Grok          │    │   ↓                          │ │
│  │  2  👁 比較選択        [compare]  ↕ │    │ [Multi-translate]             │ │
│  │  3  🤖 Review          [ai]       ↕ │    │   ↓ ← 実行中はここが点滅      │ │
│  │                                      │    │ [比較選択] ← 人間待ち         │ │
│  │  [+ ステップ追加 ▾]   [💾 保存]     │    │   ↓                          │ │
│  └──────────────────────────────────────┘    │ [Review]                     │ │
│                                               │   ↓                          │ │
│  出力: [child ▾]  リトライ: [3× 2s ▾]        │ [出力ノード]                  │ │
│                             [🗑 削除]  [▶ 今すぐ実行]  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

ステップ編集フォーム（`[✏]` クリック時、type=ai の場合）:

```
┌─ ステップ編集 ────────────────────────────────────────────┐
│ 名前: [Translate                                        ] │
│ 種類: [🤖 AI Call ▾]                                      │
│ ─────────────────────────────────────────────────────── │
│ プロバイダ: [Anthropic ▾]   モデル: [claude-sonnet-4-6 ▾] │
│ システム:  [You are a professional translator.         ]  │
│ プロンプト:[以下を英語に翻訳してください:               ]  │
│           [{content}                                   ]  │
│  💡 変数: {content} {result} {step.N.result}              │
│ 温度: [0.3]   最大トークン: [4096]                        │
│ ─────────────────────────────────────────────────────── │
│                              [✓ 保存]  [✕ キャンセル]    │
└───────────────────────────────────────────────────────────┘
```

---

### パイプライン実行ダイアログ

```
┌─ 実行中: 翻訳→比較選択 ─────────────────────────────────────────────────┐
│                                                                          │
│  [素材] ──→ [Multi-translate] ──→ [比較選択] ──→ [Review] ──→ [出力]   │
│                  ✅ 完了            ⏳ 待機                               │
│                                                                          │
├──────────────────────────────────────┬───────────────────────────────────┤
│ キュー                                │ 出力 (ストリーミング)              │
│  ✅ Multi-translate [ロック]          │ 【Claude】                        │
│  ⏳ 比較選択        [編集不可]        │ Hello world! This is...           │
│  ⏳ Review         [✏][🗑]           │ 【GPT-4】                         │
│  [+ ステップ追加]                     │ Hi world. This is a...            │
│  [+ レシピを追加]                     │ 【Grok】                          │
│                                       │ Hello world, this...              │
├──────────────────────────────────────┴───────────────────────────────────┤
│  [████████████░░░░]  Step 2/3     [⏸ 一時停止]  [✕ キャンセル]           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 比較選択モーダル

#### パターンA: 複数AI（`parallel` ステップ後）

```
┌─ 比較選択  Step 2  ─────────────────────────────────────────────────────────┐
│  最も良い翻訳を選んでください                                                │
│                                                                             │
│  ┌─ Claude ───────────────────────┐  ┌─ GPT-4 ────────────────────────┐   │
│  │ Hello, world! This is a test   │  │ Hi world. This is a translation │   │
│  │ translation of the original    │  │ test of the original Japanese   │   │
│  │ Japanese text. The system      │  │ content. It has been            │   │
│  │ works correctly and fluently.  │  │ successfully converted.         │   │
│  │                                │  │                                 │   │
│  │         [✓]                     │  │         [✓ これを選ぶ]          │   │
│  └────────────────────────────────┘  └─────────────────────────────────┘   │
│  ┌─ Grok ─────────────────────────┐                                        │
│  │ Hello world, this translation  │                                        │
│  │ demonstrates the capabilities  │                                        │
│  │ of the AI pipeline system.     │                                        │
│  │         [✓]                     │                          [Cancel]      │
│  └────────────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### パターンB: 単一AI・複数候補（`splitBy: "---"` で分割）

```
┌─ 比較選択  Step 2  ─────────────────────────────────────────────────────────┐
│  最も良いスタイルを選んでください  （1つのAIが生成した3案）                 │
│                                                                             │
│  ┌─ 候補 1 ───────────────────────┐  ┌─ 候補 2 ───────────────────────┐   │
│  │ [Formal]                       │  │ [Casual]                        │   │
│  │ Hello, world. This translation │  │ Hey world! Just testing this    │   │
│  │ adheres to formal standards    │  │ translation thing out, seems    │   │
│  │ of professional communication. │  │ to work pretty well!            │   │
│  │         [✓]                     │  │         [✓ これを選ぶ]          │   │
│  └────────────────────────────────┘  └─────────────────────────────────┘   │
│  ┌─ 候補 3 ───────────────────────┐                                        │
│  │ [Technical]                    │                                        │
│  │ Input: "Hello world" →         │                                        │
│  │ Output: Translation verified.  │                          [Cancel]      │
│  │         [✓]                     │                                        │
│  └────────────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Manual Step モーダル（view / edit / select）

```
┌─ 確認  Step 3  ──────────────────────────────────┐   ← view モード
│  翻訳結果を確認してください                       │
│ ┌──────────────────────────────────────────────┐ │
│ │ Hello, world! This is a test translation...  │ │  ← 前ステップの出力（読み取り専用）
│ └──────────────────────────────────────────────┘ │
│                           [Continue]  [Cancel]   │
└──────────────────────────────────────────────────┘

┌─ 編集  Step 3  ──────────────────────────────────┐   ← edit モード
│  内容を編集してから Continue を押してください     │
│ ┌──────────────────────────────────────────────┐ │
│ │ Hello, world! This is a test translation...  │ │  ← 編集可能 textarea
│ │ （ここを直接編集できる）                       │ │
│ └──────────────────────────────────────────────┘ │
│                           [Continue]  [Cancel]   │
└──────────────────────────────────────────────────┘

┌─ 選択  Step 3  ──────────────────────────────────┐   ← select モード
│  生成された WAV を聴いて判定してください          │
│ ┌──────────────────────────────────────────────┐ │
│ │ (生成コンテンツのプレビュー)                   │ │
│ └──────────────────────────────────────────────┘ │
│  [✅ OK — 次のステップへ]                         │
│  [🔄 Re-generate（最初からやり直す）]             │
│  [✕ Cancel pipeline]                             │
└──────────────────────────────────────────────────┘
```

---

### Config モーダル（⚙）

```
┌─ Config ────────────────────────────────────────────────────────┐
│  [Providers]  [General]                                 ×       │
├────────────────────────────────────────────────────────────────┤
│  ┌─ OpenAI ──────────────────────────────────────────────────┐  │
│  │  API Key   [sk-••••••••••••••••••••••••••••••••••••] 👁   │  │
│  │  Base URL  [https://api.openai.com/v1              ]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌─ Anthropic ───────────────────────────────────────────────┐  │
│  │  API Key   [sk-ant-••••••••••••••••••••••••••••••••] 👁   │  │
│  │  Base URL  [https://api.anthropic.com               ]     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌─ Gemini ──────────────────────────────────────────────────┐  │
│  │  API Key   [AI••••••••••••••••••••••••••••••••••••••] 👁  │  │
│  │  Base URL  [https://generativelanguage.googleapis.com]    │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌─ Ollama (ローカル) ────────────────────────────────────────┐  │
│  │  API Key   [(不要)                                  ] 👁   │  │
│  │  Base URL  [http://localhost:11434                  ]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌─ カスタム (OpenAI互換) ─────────────────────────────────────┐ │
│  │  名前      [Grok                                    ]      │  │
│  │  API Key   [xai-••••••••••••••••••••••••••••••••••••] 👁  │  │
│  │  Base URL  [https://api.x.ai/v1                     ]     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              [Test Connection]  [Save]          │
└────────────────────────────────────────────────────────────────┘
```

---

### 右クリック コンテキストメニュー

```
┌────────────────────────────────┐
│  ➕ 子ノードを追加              │
│  ➕ 兄弟ノードを追加            │
│  ────────────────────────────  │
│  ✂  切り取り                   │
│  📋 コピー                     │
│  📋 内容をコピー               │
│  📄 貼り付け                   │
│  ────────────────────────────  │
│  🗑 削除                       │
│  ✏  名前を変更                 │
│  ────────────────────────────  │
│  ▲ 上へ移動                    │
│  ▼ 下へ移動                    │
│  ────────────────────────────  │
│  コンテンツ種類  ▶             │
│  ▶ レシピを適用  ▶             │  ← パイプライン一覧サブメニュー
│  ────────────────────────────  │
│  🔍 検索 (Ctrl+F)              │
│  ────────────────────────────  │
│  📦 ノードをエクスポート (ZIP)  │
│  ▶ すべて折りたたむ            │
│  ▶ すべて展開                  │
└────────────────────────────────┘
```

---

## Layout

```
Menu* → Toolbar → Tab bar → WebView2 全体 UI（3-pane(Tree / List / Editor) + Bottom(Messages)）
RTF ノード選択時のみ RichEdit HWND をエディタエリアに重ねて表示
```
- `*` Menu bar visible in standalone mode only (hidden with `--embedded`)

### --embedded モード詳細

| 項目 | Standalone | Embedded (`--embedded`) |
|------|-----------|------------------------|
| メニューバー | ✅ 表示 | ❌ 非表示 |
| ウィンドウ枠 | `WS_OVERLAPPEDWINDOW` | `WS_POPUP`（ecode が `SetParent` 後に `WS_CHILD` を付与） |
| タイトルバー | 標準タイトルバー | なし |
| サイズ変更 | 手動リサイズ可 | ecode の `WM_SIZE` に追随 |
| 閉じる動作 | `WM_CLOSE` → `SaveData` → `DestroyWindow` | `WM_CLOSE` → `SaveData` → `PostQuitMessage(0)` |
| プロセス管理 | なし | ecode が `hProcess` を管理、`TerminateProcess` 可能 |
| 多重起動 | 可能（独立ウィンドウ） | 不可（ecode が 1 タブ = 1 プロセスとして管理） |

### Panes

| Pane | Position | Content | Collapsible | DOM ID |
|------|----------|---------|-------------|--------|
| Tree | Left (200px) | ノード階層ツリー | ✅ | `tree-pane` |
| Prompt（演算） | Center-left | 選択ノードのコンテンツ編集 + レシピ選択 | ✅ | `prompt-pane` |
| Input（入力） | Center-right | `tempInputAttachments` の編集（Op選択時）/ 過去入力の読取（Data選択時） | ✅ | `input-pane` |
| Output（出力） | Right | 実行結果一覧（linked run history）/ Data ノード出力 | ✅ | `output-pane` |
| Messages | Bottom (150px) | 操作ログ・パイプラインストリーム出力 | ✅ | `messages-pane` |

ペイン表示の詳細（ノード選択状態 × 各ペインの表示内容）は [`designdoc/PaneOrganization.md`](PaneOrganization.md) を参照。

### Toolbar

`[📄 New] [📂 Open] [💾 Save] [💾 Save As] │ [▶ Run Pipeline] ⚙ Config`

### Splitters

- Vertical: Tree ↔ Right panes
- Horizontal: List ↔ Editor
- Cross splitter (drag to resize)

## Node Data Format

```json
{
  "title": "base64...",
  "content": "base64...",
  "mimetype": "text/plain | text/html | application/rtf | image/png | image/jpeg | image/webp",
  "nodeType": "root | assemble | placeholder | data",
  "attachments": [
    {
      "id": "img_001",
      "mimetype": "image/png",
      "inline": true,
      "content": "base64..."            ← small files inline
    },
    {
      "id": "img_002",
      "mimetype": "image/webp",
      "file": "blobs/pipe_2025...png",  ← pipeline media: external ref
      "size": 52428800
    }
  ],
  "children": [ ... ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | base64. If empty, auto-generated from content |
| `content` | string | base64 body |
| `mimetype` | string | One of 6 types |
| `nodeType` | string | ノード種別（下表参照）。省略時は `assemble` 相当 |
| `attachments` | array | Optional. Media attached to the node |
| `children` | array | Recursive child nodes |

### nodeType 値

| nodeType | 役割 | ツリー表示 |
|----------|------|-----------|
| `root` | タブのルートノード（最上位・編集不可） | 非表示 |
| `assemble` | ユーザーが作成した **Op（演算）ノード** — プロンプトテンプレートを保持 | 通常表示。緑 `.selected` |
| `placeholder` | `assemble` 直下の「Processed」コンテナ（自動生成） | 非表示または折りたたみ |
| `data` | パイプラインが生成した **Data（成果物）ノード** — `pipelineMeta` を保持 | ✨アイコン付き。オレンジ `.selected-data` |

ノード選択状態（Op only / Data only / Combined）とペイン表示の詳細は [`designdoc/PaneOrganization.md`](PaneOrganization.md) 参照。

### Title Display Rules

| Condition | Display |
|-----------|---------|
| `title` non-empty | decode and display |
| `title` empty + `text/plain` | first 3-5 words + `...` |
| `title` empty + `text/html` | `[HTML] nnn bytes` |
| `title` empty + `application/rtf` | `[RTF] nnn bytes` |
| `title` empty + `image/*` | `[Image] nnn KB` |

### Media Storage Rules

| Source | Storage | Format |
|--------|---------|--------|
| Manually attached (DnD, small) | `data/*.json` inline | base64 (`inline: true`) |
| Pipeline-generated media | `blobs/` directory | External file ref (`file: "blobs/..."`) |

Threshold: `< 1 MB` inline, `>= 1 MB` external (configurable).

## session.json

起動時に全 `tabs[]` を読み込む。`initialLoadFiles` は存在せず、`tabs` が唯一のタブリスト。

```json
{
  "tabs": [
    { "name": "General", "file": "data/general.json" },
    { "name": "Code",    "file": "data/code.json" }
  ]
}
```

## Bridge（Electron IPC 通信）

Main → Renderer: `mainWindow.webContents.send('bridge-message', {type, payload})`
Renderer → Main: `window.__promptsBridge.postMessage({type, payload})`（`preload.js` 経由 `ipcRenderer.send('bridge', ...)`）

### メッセージ一覧

| 方向 | type | payload | 説明 |
|------|------|---------|------|
| Main→JS | `init` | `{tabs, nodes, pipelines, language, embedded}` | 起動時の全データ送信 |
| Main→JS | `node_updated` | `{tabId, node}` | ノード変更後の同期 |
| Main→JS | `stream_chunk` | `{stepIndex, text}` | ストリーミングチャンク |
| Main→JS | `step_done` | `{stepIndex, tokens, ms}` | ステップ完了 |
| Main→JS | `pipeline_error` | `{stepIndex, message}` | エラー通知 |
| Main→JS | `step_started` | `{index, name}` | ステップ開始（mermaid ハイライト用） |
| Main→JS | `pipeline_completed` | `{pipelineName, outputContent, steps[]}` | パイプライン完了・出力ノード作成トリガー |
| Main→JS | `pipeline_init` | `{steps[]}` | 実行開始時のステップ一覧通知 |
| Main→JS | `trigger_fired` | `{pipelineName, triggerType}` | トリガー発火通知 |
| Main→JS | `trigger_list_result` | `{triggers[]}` | 登録済みトリガー一覧（`trigger_list` への応答） |
| Main→JS | `open_file_dialog_result` | `{path, content, mimetype, size}` | ファイルダイアログ結果 |
| Main→JS | `manual_step_pause` | `{index, mode, prompt, content, choices[]}` | ユーザー入力待ちへ移行 |
| Main→JS | `providers_result` | `{openai, anthropic, gemini, ollama, ...}` | プロバイダ設定の応答 |
| Main→JS | `history_list_result` | `{runs[]}` | 実行履歴一覧 |
| JS→Main | `save_node` | `{tabId, node}` | ノード保存要求 |
| JS→Main | `run_prompt_process` | `{pipelineName, content, attachments, inputAttachments, userPrompt, ...}` | パイプライン実行 |
| JS→Main | `run_pipeline_queue` | `{steps[], nodeId}` | 動的キューで実行 |
| JS→Main | `cancel_pipeline` | `{}` | キャンセル |
| JS→Main | `update_pending_step` | `{index, step}` | 実行中に待機ステップを編集 |
| JS→Main | `remove_pending_step` | `{index}` | 待機ステップを削除 |
| JS→Main | `append_step` | `{step}` | 実行中に単一ステップをキュー末尾追加 |
| JS→Main | `append_pipeline_steps` | `{pipelineName}` | 別パイプラインの全ステップをキュー末尾に展開 |
| JS→Main | `export_node` | `{nodeId}` | ZIP エクスポート |
| JS→Main | `enable_trigger` | `{pipelineName, triggerType, enable}` | トリガーの有効/無効切替 |
| JS→Main | `trigger_list` | `{}` | 登録済みトリガー一覧要求 |
| JS→Main | `open_file_dialog` | `{filter, purpose}` | ファイルダイアログ要求 |
| JS→Main | `get_providers` | `{}` | プロバイダ設定取得 |
| JS→Main | `save_providers` | `{openai, anthropic, ...}` | プロバイダ設定保存 |
| JS→Main | `history_list` | `{pipelineName?}` | 実行履歴一覧取得 |
| JS→Main | `manual_step_resume` | `{content, action?, gotoStep?}` | Continue / 選択結果を送信 |
| JS→Main | `manual_step_cancel` | `{}` | パイプラインを中断 |

## Editor — Per-mimetype Controls

全ペーン（Tree / List / Editor / Messages / Toolbar）は WebView2 内の HTML+JS で実装する。
C++ 側は Bridge 経由でデータを送受信し、Storage / PipelineRunner / AIProvider を担当する。

### text/plain

- WebView2 内の `<textarea>` または `contenteditable` で実装
- 編集中の内容は JS → C++ へ `save_node` メッセージで通知 → 自動保存

### text/html

- WebView2 内で `marked.js` を使って Markdown → HTML 変換してレンダリング
- **View/Source toggle**: ボタンで `<textarea>`（ソース編集）と `<div>`（プレビュー）を切り替え
- AI 出力受け取り時に `text/plain` → `text/html` 変換オプション（Config で on/off）
- WebView2 初期化完了前にノード選択 → JS 側で **"Loading..."** プレースホルダ表示、`init` メッセージ受信後に描画

### image/png | image/jpeg | image/webp

- WebView2 内の `<img>` タグで表示（C++ 側が base64 → data URI に変換して渡す）
- DnD で画像ファイルをドロップ → JS が C++ に通知 → C++ が blob 保存 → node 更新

### application/rtf（ハイブリッド）

RTF ノード選択時の動作:

1. JS → C++: `get_rtf_position { rect: {x,y,w,h} }`（エディタエリアの座標を要求）
2. C++ → RichEdit: `MoveWindow(hRichEdit, x, y, w, h, TRUE)` + `ShowWindow(SW_SHOW)`
3. C++ → WebView2: `rtf_position` メッセージで JS のエディタエリアを `visibility: hidden`（透過）
4. RTF ノードの content を RichEdit に `EM_STREAMIN` でロード

非 RTF ノード選択時:

1. RichEdit の内容を `EM_STREAMOUT` で取得 → C++ が base64 encode → `save_node` で保存
2. `ShowWindow(hRichEdit, SW_HIDE)`
3. JS のエディタエリアを再表示（`visibility: visible`）

ウィンドウリサイズ時: WebView2 が `get_rtf_position` を送り直す → C++ が `MoveWindow` で追従。

**フォーマットツールバー（B/I/U/S/Font/Size/Color/Align/Bullets）:**
HTML ツールバーとして WebView2 側に配置。各ボタンクリック → JS → Bridge → C++ → `EM_SETCHARFORMAT` / `EM_SETPARAFORMAT` で制御。

### Attachments section in Editor

```
Attachments:
┌─────────────────────────────────────┐
│ [img: diagram.png]        [✕][👁]  │
│ [img: photo.jpg]          [✕][👁]  │
│ [+ Add File...]                     │
└─────────────────────────────────────┘
```

- `[+ Add File...]` → JS → Bridge → C++: `open_file_dialog` → `GetOpenFileName` → ファイル読み込み → small files inline, large to `blobs/` → 結果を JS に返す
- `[✕]` → remove attachment
- `[👁]` → preview（<img> / <audio> / <video> で data URI 表示）

## Context Menu (Right-click on Tree/List)

HTML カスタムドロップダウンとして WebView2 内に実装（`contextmenu` イベントで OS メニューを抑制）。

```
Create Child
Create Sibling
──────────────
✂ Cut Node
📋 Copy Node
📋 Copy Content
📄 Paste
──────────────
🗑 Remove
✏ Rename
Update
──────────────
▲ Move Up
▼ Move Down
──────────────
Content Type  →  text/plain / text/html / application/rtf / image/png / image/jpeg / image/webp
▶ Run Pipeline →  [pipeline list from pipeline.json] / Custom...
──────────────
🔍 Search Node (Ctrl+F)
──────────────
📦 Export Node with Media  (ZIP)
▶ Collapse All
▶ Expand All
```

### Copy / Cut / Paste

クリップボード操作は Bridge 経由で C++ と JS が連携する。

| Operation | Action |
|-----------|--------|
| **Copy Content（text/plain, text/html）** | JS: `navigator.clipboard.writeText()` — WebView2 内で完結 |
| **Copy Node（JSON）** | JS → Bridge → C++: `SetClipboardData(CF_UNICODETEXT, json)` |
| **Copy Content（RTF）** | JS → Bridge → C++: `SetClipboardData(CF_RTF, rtf)` |
| **Cut** | Copy + Remove（Bridge 経由） |
| **Paste** | JS → Bridge → C++: `GetClipboardData` → 結果を JS に返す → JSON パース → 子ノード追加。Fallback: `{content: rawtext}` |
| **Export Node** | JS → Bridge → C++: `SaveFileDialog` → Node JSON + blobs → ZIP |

## Drag & Drop

| Context | Operation |
|---------|-----------|
| Tree DnD | Change parent |
| List DnD | Reorder within same level |
| Tree ↔ List | Inter-pane reorder/parent change |
| RTF Editor | Image drop → embed in RTF |
| Image Editor | Image file drop → update content |
| Attachments | File drop → add as attachment |

## Search (Ctrl+F)

ツールバーまたは `Ctrl+F` で検索バーを表示。全タブ・全ノードの `title` / `content` を対象に全文検索。

### Search Scope

| スコープ | 対象 |
|----------|------|
| **All tabs** | 全タブの全ノード（デフォルト） |
| **Current tab only** | 現在のタブのみ |
| **Selected node & children** | Tree で選択中のノード以下のサブツリーのみ |
| **Specific tabs...** | ユーザーが選んだタブのみ（サブダイアログで複数選択） |

- デフォルトスコープは Config で変更可能
- 結果は Messages ペーンに表示（専用結果リストは作らない）
- 結果行はクリック可能。クリックで該当タブに切替 + Tree/List で該当ノードを選択

### 検索クエリ Bridge フロー

```
JS:  postMessage({ type: "search", query: "hello", scope: "all_tabs" })
C++: 全 data/*.json をパース、title/content(base64decode) を grep
C++: PostWebMessageAsJson({ type: "search_results",
       results: [{ tabId, nodeId, title, excerpt }] })
JS:  Messages ペインに結果リスト描画。クリックで該当ノードにジャンプ
```

## Auto Save

- 1.5s debounce after last edit
- Tab switch: save current tab before switching
- Application exit: save current tab + `session.json`

## Config Dialog (⚙)

HTML モーダルパネル（CSS overlay）として WebView2 内に実装。

### General
- Tab list management (add/remove tabs; each tab = one `.json` file)
- Media inline size limit (default 1024 KB)
- Default search scope (default: All tabs)
- Multi-media output mode: `attachments` / `children` / `ask`
- Max attachments per node (default 5) — 超過分は警告なしで切り捨てる。上限は Config で変更可能
- Blob storage directory (read-only display)

### Provider Settings (stored in `providers.json`)
```
┌──────────────────────────────────┐
│  Provider: [OpenAI____________]  │
│  API Key:  [••••••••••••••] 👁  │
│  Base URL: [https://api.ope...]  │
│  [Test Connection]               │
│  [Save] [Cancel]                 │
└──────────────────────────────────┘
```

Supported providers: OpenAI, Anthropic, Gemini, Ollama

`command` / `tool` ステップにより任意の OS コマンド（sed, awk, ffmpeg, ImageMagick 等）をパイプラインに統合可能。外部プログラムの豊富さがそのまま Wend のノード数となる（Unix 哲学: 小さなツールを組み合わせる）。

## AI Pipeline Feature

### Concept

```
Input Node → Step 1 (AI) → Step 2 (AI) → ... → Output Node
                                                   ├─ title: {pipeline_name}_{timestamp}
                                                   ├─ content: last step output
                                                   ├─ attachments: inherited (external blob refs)
                                                   └─ children: if multiMedia="children"
```

- Each step output becomes `{result}` for the next step
    - `{content}` / `{title}` also available as placeholders  
      `{attachments}` is NOT used as a text placeholder — media is passed via API multi-modal payload (`attachMedia` field)
    - **Step 1**: `{result}` is synonymous with `{content}` (input node content)
    - **Inter-step images**: if `Step N` produces `mediaOutputs`, those are inherited by `Step N+1` via `AIRequest.attachments` when `attachMedia: "all"`. `{result}` remains text-only.
    - **`{result.field}` syntax** (for `resultAs: "json"` only): dot-separated key path, e.g. `{result.data.text}` → `response["data"]["text"]`. Array access: `{result.items[0]}`. Unparseable paths return empty string.
- Media from pipeline → always stored as external files in `blobs/`
- Output node placed as child or sibling of input node (see `outputMode` below)

### Pipeline Mode（Basic / Expert）

| Mode | UI | 将来拡張 |
|------|----|----------|
| **Basic** | 直列 JSON ステップ一覧 + **mermaid.js** によるフロー図自動生成。実行中ノードをハイライト表示 | デフォルト |
| **Expert** | **Cytoscape.js** によるインタラクティブノードエディタ。分岐・並列実行・条件分岐に対応（将来実装） | 未実装 |

Basic モードの pipeline.json は `steps[]` の直列リスト。Expert モードでは `nodes[]` / `edges[]` の DAG 形式。  
両形式は相互変換可能 — Basic の直列リストは Expert の `nodes: [s1,s2,...], edges: [{from:s1,to:s2}, {from:s2,to:s3}, ...]` の線形特殊ケースとして表現できる。

```json
// Basic 形式（現行）
{ "steps": [ { "name": "A" }, { "name": "B" } ] }

// Expert 形式（将来）
{ "nodes": [{ "id": "A" }, { "id": "B" }],
  "edges": [{ "from": "A", "to": "B" }] }
```

pipeline.json には `"mode": "basic"`（デフォルト）または `"mode": "expert"` をパイプラインレベルで指定する。

#### Pipeline UI レイアウト（Basic モード）

```
┌────────────────────────────────────────────────────┐
│ Pipeline: Translate → Review    [Basic] [Expert]   │
├──────────────────────┬─────────────────────────────┤
│ Step List (編集)      │ Flow View (mermaid 自動生成) │
│                      │                             │
│ 1. [ai] Translate    │ [Input]→[Translate]         │
│    provider: openai  │     ↓                       │
│    model: gpt-4.1    │ [Review]→[Output]           │
│    [prompt: ...]     │                             │
│                      │ 実行中: [Translate] 点滅     │
│ 2. [ai] Review       │                             │
│    provider: anthropic│                            │
│    [prompt: ...]     │                             │
│                      │                             │
│ [+ Add Step]         │                             │
├──────────────────────┴─────────────────────────────┤
│ Input: "selected node"    [▶ Run] [⏸ Pause] [✕]    │
└────────────────────────────────────────────────────┘
```

### Dynamic Execution Queue

パイプライン実行中、未実行の待機ステップは C++ 側で `std::deque<Step>` として管理する。

| 操作 | タイミング | 動作 |
|------|-----------|------|
| **追加（Step）** | 実行中 | 待機キュー末尾に Step を追加（JS → Bridge → C++ `append_step`） |
| **追加（Pipeline）** | 実行中 | 別パイプラインの全 Step を現在のキュー末尾に展開（JS → Bridge → C++ `append_pipeline_steps`） |
| **削除** | 実行中 | 待機キューから指定 Step を削除 |
| **編集** | 実行中 | 待機キュー内の Step パラメータを変更（model, prompt, temperature 等） |
| **順序変更** | 実行中 | 待機キュー内の Step を移動 |
| **スキップ** | 実行中 | 現在実行中の Step 完了後、次をスキップしてその次の Step へ |

- 実行中の Step は変更不可（完了後にキューから除去される）
- キャンセル時はキューをクリア
- フロー図はメッセージ受信のたびに JS 側で再描画（mermaid.js）
- 「追加（Pipeline）」により、1 つのパイプライン実行中に別のパイプライン定義をキューにインジェクト可能（サブルーチン的利用）

### pipeline.json (`%APPDATA%/Wend/pipeline.json`)

```json
{
  "pipelines": [
    {
      "name": "Translate → Review",
      "retry": { "count": 3, "delayMs": 2000, "on": ["*"] },
      "test_input": "Hello, world!",
      "onError": { "action": "cancel" },
      "steps": [
        {
          "name": "Translate",
          "provider": "openai",
          "model": "gpt-4.1",
          "systemPrompt": "You are a translator.",
          "userPrompt": "Translate to Japanese:\n\n{content}",
          "temperature": 0.3,
          "maxTokens": 4096,
          "attachMedia": "all"
        },
        {
          "name": "Review",
          "provider": "anthropic",
          "model": "claude-sonnet-4-6",
          "systemPrompt": "You review translations.",
          "userPrompt": "Review:\n\n{result}",
          "temperature": 0.5,
          "maxTokens": 2048,
          "attachMedia": "all"
        }
      ],
      "outputMode": "child",
      "outputNaming": "{pipeline_name}_{timestamp}",
      "multiMedia": "attachments"
    }
  ]
}
```

### pipeline.json — Field Reference

#### outputMode

| 値 | 動作 |
|----|------|
| `"child"` | 出力ノードを入力ノードの**子**として追加。ツリーが深くなる（デフォルト） |
| `"sibling"` | 出力ノードを入力ノードの**兄弟**として追加（同じ親の末尾）。結果を横に並べる |
| `"replace"` | 入力ノードの `content` をパイプライン結果で上書き。添付ファイルも入れ替わる |

#### outputMode × multiMedia 組み合わせ

| outputMode | multiMedia | 動作 |
|-----------|-----------|------|
| `child` | `attachments` | 出力ノードを子に追加、メディアは attachments（デフォルト） |
| `child` | `children` | 出力ノードを子に追加、メディアはさらにその子ノード |
| `sibling` | `attachments` | 出力ノードを兄弟に追加、メディアは attachments |
| `sibling` | `children` | 出力ノードを兄弟に追加、メディアはその子ノード |
| `replace` | `attachments` | 入力ノードを上書き、attachments を入れ替え |
| `replace` | `children` | 入力ノードの content を上書き、既存の子を保持しメディア子を追加 |

#### attachMedia

| 値 | 動作 |
|----|------|
| `"all"` | 入力ノードの全 attachments を AI にマルチモーダル送信（デフォルト） |
| `"none"` | attachments を送信しない（テキストのみ） |
| `"first"` | `attachments[0]` のみ送信 |
| `"selected"` | パイプライン実行前にユーザーが選択（ダイアログ表示） |

### Pipeline Step Types

Each step in `pipeline.json` has a `type` field. Default: `"ai"`.

| Type | Description | block UI? |
|------|-------------|-----------|
| `"ai"` | AI API call (OpenAI / Anthropic / Gemini / Ollama) | No (streaming) |
| `"manual"` | User review/edit pause point | Yes (dialog) |
| `"command"` | Non-interactive CLI command execution | No |
| `"tool"` | Interactive external GUI tool launch | Yes (waits for tool exit) |
| `"fetch"` | HTTP GET/POST to arbitrary URL | No |
| `"condition"` | 前ステップ出力を評価して分岐・ループ制御 | No（自動） |
| `"history"` | 実行履歴から入出力を取得 → `{result}` に設定 | No |
| `"transform"` | JS/CSS セレクタ様式でテキスト変換（正規表現・JSON Path・テンプレート） | No |
| `"call_pipeline"` | 別パイプラインをサブルーチンとして呼び出し、結果を `{result}` に格納 | No |
| `"foreach"` | 配列入力を1件ずつループ処理。子ステップを各要素に対して実行 | Yes |
| `"parallel"` | 複数子ステップを並列実行、全完了後に出力を集約 | Yes |
| `"wait"` | 指定秒数待機、または条件が満たされるまで待機 | No |

#### `"manual"` — User review step

単一ステップの定義:

```json
{ "type": "manual", "mode": "edit", "prompt": "結果を確認し、編集してから Continue を押してください" }
```

| mode | 動作 |
|------|------|
| `"view"` | 読み取り専用表示、[Continue] / [Cancel] のみ |
| `"edit"` | 編集可能なテキストエリア、[Continue] で編集内容を `{result}` として次へ |
| `"select"` | 前ステップの出力を自動分割、または `choices[]` で明示的に定義した選択肢を UI 表示 → ユーザー選択 → `onSelect` に従い進行制御 |

`select` モードには3種類の選択肢定義方式がある:

| 方式 | 定義方法 | ユースケース |
|------|---------|-------------|
| **自動分割** | 前ステップ出力を `\n---\n` で分割 | AI が複数候補を列挙 → 選択 |
| **choices[] 明示** | ステップ定義内に `choices[]` 配列を記述 | 固定操作選択（OK/Re-generate/Cancel） |
| **動的 JSON** | 前ステップ出力を JSON パース → 配列を選択肢化 | `resultAs: "json"` で出力されたリストから動的生成 |

`choices[]` + `onSelect` の定義例:

```json
{
  "type": "manual",
  "mode": "select",
  "prompt": "生成された WAV を聴いて判定してください",
  "choices": [
    { "label": "✅ OK — 次のステップへ", "action": "next_step" },
    { "label": "🔄 Re-generate",         "action": "goto_step", "index": 0 },
    { "label": "✕ Cancel pipeline",      "action": "cancel" }
  ]
}
```

| action | 動作 |
|--------|------|
| `"next_step"` | 通常通り次ステップへ進行（デフォルト） |
| `"goto_step"` | 指定 `index` のステップに戻る（ループ実現） |
| `"skip"` | 指定 `count` だけステップをスキップ |
| `"cancel"` | パイプライン中断 |

`goto_step` により「WAV を聴いて気に入らなければ最初から再生成」のループが可能。実質的な条件分岐とループ制御を提供する。

#### `"command"` — CLI command step

```json
{
  "type": "command",
  "command": "python",
  "args": ["script.py", "{content_file}"],
  "timeout": 30,
  "workingDir": "%APPDATA%/Wend/",
  "resultAs": "text"    // "text" | "exitcode"
}
```

- `{content_file}` = content を base64 デコード後、mimetype に応じたエンコーディングで一時ファイルに書き出したパス（ステップ終了後に削除）

  | mimetype | エンコーディング |
  |----------|----------------|
  | `text/plain`, `text/html` | UTF-8 |
  | `application/rtf` | ASCII（\uN エスケープ済み RTF そのまま。RTF は 7-bit ASCII ベース） |
  | `image/*` | 生バイナリ（そのまま） |

- `resultAs: "text"` = stdout を `{result}` に格納
- `resultAs: "exitcode"` = 終了コードを文字列化

#### `"tool"` — Interactive external tool step

```json
{
  "type": "tool",
  "command": "mspaint.exe",
  "args": ["{content_file}"],
  "waitForExit": true,
  "resultAs": "file",         // "file" | "clipboard" | "exitcode" | "attachment"
  "resultFile": "{content_file}",
  "confirm": true             // 起動前に確認ダイアログを表示（デフォルト true）
}
```

| フェーズ | 動作 |
|----------|------|
| 起動 | `{content}` を一時ファイルに書き出し、`CreateProcess` で外部ツールを起動 |
| 待機 | `WaitForSingleObject(hProcess, INFINITE)` — ツール終了までパイプライン停止 |
| 結果取得 | `resultAs` に従い結果を収集 |
| クリーンアップ | 一時ファイル削除 |
| 継続 | 収集した結果を `{result}` として次ステップへ |

`resultAs`:

| 値 | 動作 |
|----|------|
| `"file"` | `resultFile` を読み込んで `{result}` に格納 |
| `"clipboard"` | クリップボードの内容を `{result}` に格納 |
| `"exitcode"` | 終了コードを文字列化して `{result}` に格納 |
| `"attachment"` | `resultFile` を `blobs/` にコピーして添付ファイル化 |

`waitForExit: false` 時はプロセス起動後に即座に次ステップへ進むため、`resultAs: "file"` / `"clipboard"` / `"attachment"` は意味をなさない（無効）。`"exitcode"` のみ例外的に許可（`WaitForSingleObject(hProcess, 0)` で終了していれば取得）。プロセスがまだ終了していない場合（`WAIT_TIMEOUT`）は `{result}` を空文字列とする。

#### `"fetch"` — Web fetch step

認証が必要な場合は `providers.json` のプロバイダ認証情報を参照する（pipeline.json に直接キーを書かない）。

```json
{
  "type": "fetch",
  "url": "{content}",
  "method": "GET",
  "auth": "openai",       // providers.json のプロバイダ名を参照。省略可
  "resultAs": "text"      // "text" | "attachment" | "json"
}
```

| resultAs | 動作 |
|----------|------|
| `"text"` | レスポンス本文を `{result}` に格納 |
| `"attachment"` | レスポンス本文を `blobs/` に保存し、添付ファイルとして参照 |
| `"json"` | レスポンスを JSON パース → ドット区切りキーで子フィールド参照可能（例: `{result.data.text}`）。配列は `{result.items[0]}`。ネスト非対応の場合は空文字を返す |

#### `"condition"` — Automatic branch / loop step

前ステップ出力を評価し、結果に応じて分岐・ループ制御を自動実行する。

```json
{
  "type": "condition",
  "expression": "{result}",
  "operator": "contains",
  "value": "error",
  "onTrue":  { "action": "goto_step", "index": 0 },
  "onFalse": { "action": "next_step" }
}
```

| operator | 評価内容 |
|----------|---------|
| `"contains"` | `{expression}` に `value` が含まれるか |
| `"equals"` | `{expression}` が `value` と完全一致するか |
| `"startsWith"` | `{expression}` が `value` で始まるか |
| `"regex"` | `{expression}` が正規表現 `value` にマッチするか |
| `"json_path"` | `{expression}` を JSON パース → `value` の JSON Path が存在するか |

`action` は `onSelect` と同じ: `"next_step"` / `"goto_step"` / `"skip"` / `"cancel"`。

これにより「AI が 'error' と出力したら最初からやり直す」のような自動ループが可能。

#### `"history"` — Execution history reference step

実行履歴 (`history/run_*.json`) から特定ステップの入出力を取り出し、`{result}` に設定する。

```json
{
  "type": "history",
  "runId": "run_20250530_153042",
  "stepIndex": 0,
  "field": "output"    // "input" | "output"
}
```

- `runId`: 履歴ファイル名（拡張子なし）
- `stepIndex`: 参照するステップ番号（省略時は最終ステップ）
- `field`: `"input"` または `"output"`
- 戻り値: 指定されたステップの入出力テキストが `{result}` に格納される

**プレースホルダー構文**: 全ステップの任意の入出力を以下の構文で参照可能:

| 構文 | 内容 |
|------|------|
| `{history[runId].steps[n].input}` | 指定 run の n 番目ステップの入力 |
| `{history[runId].steps[n].output}` | 指定 run の n 番目ステップの出力 |

### Step Variable Reference（拡張プレースホルダー）

`{content}` / `{result}` に加え、以下の構文で全ステップの入出力を参照可能:

| 構文 | 内容 | 使用可能ステップ |
|------|------|----------------|
| `{input}` | 入力ノードの content（`{content}` と同義） | 全ステップ |
| `{step.N.result}` | N 番目ステップの出力 | N が現在より前のステップ |
| `{step.Name.result}` | name が "Name" のステップの出力 | 同上（同名が複数ある場合は最初の1つ） |
| `{step.N.input}` | N 番目ステップの入力 | 同上 |
| `{step.Name.input}` | name が "Name" のステップの入力 | 同上 |

### New Step Type Definitions

#### `"transform"` — Text/JSON transformation step

```json
{
  "type": "transform",
  "engine": "regex",       // "regex" | "json_path" | "template" | "js"
  "expression": "s/foo/bar/g",
  "input": "{result}",     // 入力値（省略時は前ステップ出力）
  "output": "{result}"     // 格納先
}
```

| engine | expression 例 | 動作 |
|--------|--------------|------|
| `"regex"` | `s/foo/bar/g` | sed 形式の置換 |
| `"json_path"` | `$.data.items[0].text` | JSON Path で抽出 |
| `"template"` | `Result: {result}` | テンプレート文字列の展開 |
| `"js"` | `return input.toUpperCase()` | JavaScript 評価（実装依存） |

#### `"call_pipeline"` — Sub-routine pipeline call

```json
{
  "type": "call_pipeline",
  "pipelineName": "Summarize",
  "input": "{result}",        // 呼び出し先パイプラインの入力
  "inheritAttachments": true, // 添付ファイルを継承するか
  "resultAs": "{result}"      // 呼び出し先の最終出力をこのステップの出力に
}
```

呼び出し先パイプラインが完了するまで現在のパイプラインは待機（同期呼び出し）。
実行履歴には呼び出し元・先がそれぞれ別の `run_*.json` として記録され、`steps[].childRunId` で関連付けられる。

#### `"foreach"` — Batch loop step

```json
{
  "type": "foreach",
  "input": "{result}",         // 改行区切り or JSON 配列 → 1件ずつループ
  "itemVariable": "item",      // 各要素を {item} で参照可能
  "steps": [
    { "type": "ai", "userPrompt": "Process: {item}" }
  ],
  "concurrency": 1              // 並列数（1 = 逐次）
}
```

ループ内の各ステップは `{item}` で現在の要素を参照可能。
ループ全体の出力は各要素の結果を改行連結した文字列。

#### `"parallel"` — Parallel branch execution

```json
{
  "type": "parallel",
  "branches": [
    { "name": "summary", "steps": [ { "type": "ai", ... } ] },
    { "name": "keywords", "steps": [ { "type": "ai", ... } ] }
  ],
  "outputMode": "merge"        // "merge" | "first" | "branch.*"
}
```

全ブランチを並列実行。全完了後に結果を集約。
`{branch.summary}` で個別ブランチの出力を参照可能。

#### `"wait"` — Delay / conditional wait step

```json
{
  "type": "wait",
  "durationMs": 5000,          // 固定待機（ミリ秒）
  "until": "{result}",         // 条件式（省略時は durationMs のみ）
  "pollIntervalMs": 1000,      // 条件チェック間隔
  "timeoutMs": 60000           // 最大待機時間（超過時はエラー）
}
```

`until` が空文字以外の場合、`{result}` を式として評価し `"true"`（大文字小文字不区別）が返るまでポーリングする。
ファイルが存在するまで待機、API が特定の値を返すまで待機、等に使用。

### Per-Step Retry / On-Error Filter

パイプライン全体の `retry` に加え、ステップ単位でも `retry` を指定可能（ステップ単位の設定がパイプライン全体を上書き）。

```json
{
  "steps": [
    {
      "type": "ai",
      "retry": { "count": 5, "delayMs": 1000, "on": ["rate_limit", "timeout", "network"] }
    }
  ]
}
```

`on[]` フィルタ:

| フィルタ値 | 対象エラー |
|-----------|-----------|
| `"rate_limit"` | HTTP 429 |
| `"timeout"` | 60s タイムアウト |
| `"network"` | ネットワーク / DNS / 接続エラー |
| `"auth"` | HTTP 401（リトライ不可＝デフォルトでは対象外） |
| `"*"` | 全エラー（非推奨） |

省略時は全エラー種別をリトライ対象とする（現在の動作と同一）。

### Pipeline-Level On-Error

```json
{
  "name": "My Pipeline",
  "onError": { "action": "goto_step", "index": 0 },
  "steps": [ ... ]
}
```

`onError` の `action` は `onSelect` / `condition` と同じ: `"next_step"` / `"goto_step"` / `"skip"` / `"cancel"`。
全てのステップでエラーが発生した場合のデフォルト動作。ステップ個別の `retry` を使い切った後に発動する。

### Trigger Definitions

パイプラインを自動起動するトリガーを定義可能。

```json
{
  "name": "Auto Summarize",
  "triggers": [
    {
      "type": "schedule",
      "cron": "0 9 * * 1-5",     // 平日 9:00
      "inputNodeId": "node_abc"
    },
    {
      "type": "file_watcher",
      "path": "%APPDATA%/Wend/inbox/",
      "pattern": "*.txt",
      "action": "new_file"        // "new_file" | "modified"
    },
    {
      "type": "webhook",
      "port": 9876,
      "endpoint": "/trigger/summarize",
      "method": "POST",
      "auth": "provider_name"     // providers.json の認証情報を参照
    }
  ]
}
```

| Trigger | 起動条件 |
|---------|---------|
| `"schedule"` | CRON 式に従い定期実行 |
| `"file_watcher"` | 指定ディレクトリにファイルが作成/変更されたら実行。新規ファイルを `{content}` として入力 |
| `"webhook"` | HTTP サーバーを起動し、指定エンドポイントへのリクエストで実行 |

Bridge メッセージ:

| 方向 | type | payload | 説明 |
|------|------|---------|------|
| C++→JS | `trigger_fired` | `{pipelineName, triggerType}` | トリガー発火通知 |
| JS→C++ | `enable_trigger` | `{pipelineName, triggerType, enable}` | トリガーの有効/無効切替 |
| C++→JS | `trigger_list_result` | `{triggers[]}` | 登録済みトリガー一覧（`trigger_list` への応答） |
| JS→C++ | `trigger_list` | `{}` | 登録済みトリガー一覧要求 |

Webhook の依存: `ws2_32.lib`（ローカル TCP サーバとして実装）。

### Test Mode & Test Input

パイプライン実行前に `"test_input"` を指定すると、選択ノードを実際の入力とせずテスト用入力を使用する。

```json
{
  "name": "Translate → Review",
  "test_input": "Hello, world!",
  "steps": [ ... ]
}
```

ツールバーに `[🧪 Test Mode]` トグルボタンを追加。
- オン: パイプライン実行時、任意の選択ノードがなくても `test_input` を入力として使用
- オフ: 通常通り選択ノードを入力として使用（デフォルト）

Test Mode オン時の実行は履歴の `steps[].test = true` で識別可能。

### Execution History — 追加フィールド

`run_*.json` の各ステップに以下を追加:

```json
{
  "steps": [{
    "test": false,              // Test Mode での実行か
    "retries": 2,               //  このステップのリトライ回数
    "iterations": 0,            // foreach ループ内での合計反復数
    "childRunId": null,         // call_pipeline の呼び出し先 run ID
    "errorPipelineRunId": null  // onError で起動されたエラー処理パイプラインの run ID
  }]
}
```

### Template Variables

pipeline.json のパイプラインに `variables` フィールドを追加。実行時にダイアログで値入力。

```json
{
  "name": "Translate",
  "variables": [
    { "key": "target_language", "default": "Japanese" },
    { "key": "tone", "default": "formal" }
  ],
  "steps": [
    { "type": "ai", "userPrompt": "Translate to {target_language} in {tone} tone:\n\n{content}" }
  ]
}
```

### Custom Pipeline

コンテキストメニューの「Custom...」は pipeline.json に保存せず一時的にステップを組んで実行するインラインパイプラインエディタダイアログ。
- ステップリスト（追加/削除/並び替え可）
- 各ステップ: type + provider + model + prompt + temperature を編集可能
- 実行後「名前を付けて保存」ボタンで pipeline.json に追記可能

### Pipeline Runner Dialog (Streaming)

WebView2 モーダルパネル（CSS overlay）として実装。**mermaid.js フロー図**を上部に表示。

Basic モードでは直列の矢印 + 実行中ノードのハイライト。Dynamic Queue 操作用に Queue パネルと Output パネルを並置。

```
┌──────────────────────────────────────────────┐
│  [Input]→[Translate]→[Review]                │  ← mermaid フロー図
│             🟢実行中    ⏳待機                 │
├────────────────────────┬─────────────────────┤
│  Queue                 │  Output             │
│  ▶ Translate [locked]  │  こんにちは...      │
│  ⏳ Review   [✏][🗑]   │  [waiting...]       │
│  [+ Add Step]          │                     │
│  [+ Pipeline]          │                     │
├────────────────────────┴─────────────────────┤
│  [████████░░] Step 1/2  [▶][⏸][✕]    │
└──────────────────────────────────────────────┘
```

実行中のノードは mermaid 図内でハイライト（CSS クラスで色変更）。
完了ノードはチェックマーク、エラーノードは赤表示。

### Execution History

パイプライン実行ごとにステップ別の入出力を記録し、後から参照・再利用できる。

#### 保存形式

```
%APPDATA%/Wend/history/run_YYYYMMDD_HHmmss.json
```

`run_*.json` の構造:

```json
{
  "id": "run_20250530_153042",
  "pipelineName": "Translate → Review",
  "inputNodeId": "node_abc",
  "startedAt": "2025-05-30T15:30:42Z",
  "status": "completed",
  "steps": [
    {
      "index": 0,
      "name": "Translate",
      "type": "ai",
      "input": "Hello world",
      "output": "こんにちは世界",
      "tokens": { "prompt": 120, "completion": 45 },
      "durationMs": 2300,
      "status": "completed"
    }
  ],
  "outputNodeId": "node_xyz"
}
```

#### History UI

Messages ペイン内または専用ペインで以下を表示:

- 実行一覧（日時 / パイプライン名 / ステータス / 所要時間）
- クリックで展開 → ステップ別の入出力を確認
- `[🔄]` (tooltip: 「この実行から再実行」): 同じ入力 + パイプラインで再実行
- `history` ステップまたはプレースホルダー構文 `{history[runId].steps[n].output}` で入出力を再利用可能

#### 保持ポリシー

- 保持件数: Config で設定（デフォルト 100 件）
- 超過分は古い順に自動削除
- Blob GC との連携: history が参照している blob ファイルは削除しない（history 削除時に合わせて削除）

### AI Provider Interface（electron/main.js）

```javascript
// PipelineRunner.executeStep() 内で AI リクエストを送信
async function callAI(provider, step, inputContent, attachments) {
    // provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai_compat'
    // SSE レスポンスをチャンクごとに postBridge('stream_chunk', {stepIndex, text}) で送信
    // 完了時に postBridge('step_done', {stepIndex, tokens, ms})
}
```

### SSE Parsing

Node.js `https.request` でレスポンスを受信。`response.on('data', chunk => ...)` で逐次処理。

```
チャンク受信ループ:
1. response.on('data') でバイト列取得
2. 内部バッファに追記
3. "\n" で行分割し、完全な行のみ処理。不完全な末尾はバッファに残す
4. "data: " プレフィックスの行を JSON.parse でパース
5. "[DONE]" または接続終了で完了
```

プロバイダごとの SSE フォーマット差異:

| Provider | content の取得パス | 備考 |
|----------|--------------------|------|
| OpenAI | `choices[0].delta.content` | 標準 SSE、`data: ` 行のみ |
| Anthropic | `event: content_block_delta` → 直後の `data.delta.text` | `event:` 行と `data:` 行がペア。`event: content_block_delta` の場合のみ data をパース、他は無視 |
| Gemini | `candidates[0].content.parts[]` を全走査 | **parts は複数要素になる場合がある**。各 part は `text` または `inlineData` のどちらか。`inlineData` は `{ mimeType, data (base64) }` 形式で画像等を返す。**`parts[0].text` だけを見ると画像が欠落する** → 全 parts を走査して text を結合し、inlineData を `outputAttachments` に収集すること |
| Ollama | `message.content` | 標準 SSE |

#### Gemini レスポンスパース（非ストリーミング）

```
candidates[0].content.parts[] を走査:
  - part.text      → textContent に追記
  - part.inlineData → { mimeType, data(base64) } → outputAttachments に追加

戻り値:
  content           = 結合した textContent（画像のみの場合は "[Gemini: N image(s)]"）
  outputAttachments = [{ file, mimetype, content(base64), size }, ...]
```

### Error Handling

Pipeline 実行中に発生するエラーはすべて **Messages ペインに赤文字 + エラーコード** で表示される。

| エラー種別 | 動作 |
|-----------|------|
| **Network error** | `retry.count` 回リトライ（間隔 `retry.delayMs`）。尽きたら中断し Messages に表示 |
| **Rate limit (429)** | `Retry-After` ヘッダがあればその秒数待機、なければ 5s 待機してリトライ |
| **Auth failure (401)** | リトライせず即中断。Messages に "API key invalid" 表示 |
| **Model unavailable** | 中断、Messages に表示。Config でモデル一覧の再取得を促す |
| **Timeout** | 各 API コール 60s でタイムアウト → `retry` に従いリトライ |
| **Streaming disconnect** | ストリーミング API はステートレスのため途中再開不可。該当ステップを**先頭からリトライ**する（部分取得データは破棄） |

### Execution Model

#### 実行モデル

Node.js シングルスレッド + 非同期 I/O（`async/await`）。

```
Main Process (Node.js event loop):
  ipcMain.on('bridge', ...) → handleBridgeMessage()
  PipelineRunner.run() → async step loop
  response.on('data') → postBridge('stream_chunk') → mainWindow.webContents.send()
```

**キャンセル:** `PipelineRunner.cancelled = true` をセット。次の `await` ポイントで検知して中断。
進行中の `https.request` は `req.destroy()` で即座に切断。

#### Progress Log (Messages 第4ペイン)

パイプライン実行の進捗はすべて Messages ペインに逐次追記される。

| タイミング | 出力例 |
|-----------|--------|
| ステップ開始 | `[Pipeline] [1/3] Translating... (gpt-4.1)` |
| ステップ完了 | `[Pipeline] [1/3] Done (2.3s, 412 tokens)` |
| エラー | `[Pipeline] [1/3] ERROR: Rate limited, retrying (2/3)...` |
| キャンセル | `[Pipeline] Canceled by user` |
| パイプライン完了 | `[Pipeline] Completed → New node: "Translate_20250530_153042"` |

Messages ペインの各行は自動スクロール（最新行が常に表示範囲に入る）。

#### Progress Bar

**Pipeline Runner ダイアログ内**にプログレスバーを表示。
「Step N / 全ステップ数」をバーに反映。ステップ内はスピナー表示（不定）。
Messages ペインはログテキストのみ（バーは表示しない）。

#### Cancel Behavior

- キャンセル時点でのステップ結果は破棄（出力ノード作成しない）
- 生成済み blob ファイルは削除する
- Messages ペインに「キャンセルされました」を表示

### API Key Security

- `providers.json` stored in UserData (`%APPDATA%/`), NOT in source tree
- `providers.json` NEVER committed to git
- Pipeline definitions (`pipeline.json`) contain no keys — only references to provider names
- Config Dialog supports "Test Connection" before saving

## Dependencies

| Component | Library | 用途 |
|-----------|---------|------|
| Electron | `electron` (^31.7.7) | デスクトップアプリシェル（Chromium + Node.js） |
| marked.js | `frontend/lib/marked.min.js` | Markdown → HTML 変換（ソース同梱） |
| mark.js | `frontend/lib/mark.min.js` | 検索ハイライト（ソース同梱） |
| mermaid.js | `frontend/lib/mermaid.min.js` | フロー図自動生成（Basic モード、ソース同梱） |
| cytoscape.js | `frontend/lib/cytoscape.min.js` | インタラクティブノードエディタ（Expert モード将来、ソース同梱） |
| Node.js `https`/`http` | 標準モジュール | AI API SSE ストリーミング |
| Node.js `child_process` | 標準モジュール | `command` ステップの CLI 実行 |
| Node.js `fs` | 標準モジュール | Storage（JSON / blob I/O） |

## Build & Integration

```bash
# 開発起動
npm --prefix electron start     # electron . を実行

# テスト
npm --prefix electron test      # node --test test.js

# パッケージ（Win32 x64）
npm --prefix electron run build
# → electron/bin/Release/Wend-win32-x64/Wend.exe
```

- `electron-packager` で `--extra-resource=../frontend` により `frontend/` を同梱
- パッケージ版: `FRONTEND_ROOT = process.resourcesPath/frontend`
- 開発版: `FRONTEND_ROOT = __dirname/../frontend`
- ecode 組み込みの場合は `--embedded` フラグで起動（`init` メッセージ内 `embedded: true` で JS に通知）

## Pipeline Manager

パイプラインの作成・編集・管理を行う専用 UI。Toolbar `[⚡ Pipelines]` ボタンで開く HTML モーダルパネル。

### 概要

設計書の Basic/Expert 2モードを包含するコンテナとして実装する。

```
[⚡ Pipelines] ボタン → Pipeline Manager を開く

Pipeline Manager
├── 左列: パイプライン一覧 + [+ New]
└── 右列（選択中パイプラインの編集）
    ├── [Basic] タブ  ← ステップリスト + mermaid プレビュー（現実装ターゲット）
    └── [Expert] タブ ← Cytoscape.js ノードエディタ（将来実装）
```

### レイアウト（Basic タブ）

```
┌────────────────────────────────────────────────────────┐
│ Pipelines                                  [+ New]     │
├──────────────────┬─────────────────────────────────────┤
│ Translate→Review │  Name: [Translate → Review        ] │
│ Summarize        │                          [Basic][Expert]│
│ DailyReport 🕐   │                                     │
│                  │  Steps:                             │
│                  │  ┌─────────────────────────────┐   │
│                  │  │ 1. [ai] Translate  [✏][🗑][↕]│   │
│                  │  │ 2. [ai] Review    [✏][🗑][↕]│   │
│                  │  │ [+ Add Step ▾]               │   │
│                  │  └─────────────────────────────┘   │
│                  │  Flow Preview (mermaid):            │
│                  │  [Input]→[Translate]→[Review]→[Out] │
│                  │  ← ステップ追加・削除でリアルタイム更新│
│                  │                                     │
│                  │  Triggers: [+ Add Trigger ▾]        │
│                  │  Output: [child ▾]  Retry: [3x 2s▾] │
│                  │                                     │
│                  │  [▶ Run Now]  [💾 Save]  [🗑 Delete] │
└──────────────────┴─────────────────────────────────────┘
```

- 左列：パイプライン一覧。🕐 はスケジュールトリガー付きを示す
- Basic タブ：ステップフォームリスト + mermaid リアルタイムプレビュー
- Expert タブ：Cytoscape.js インタラクティブノードエディタ（将来実装）
- Basic → Expert 変換は自動（線形グラフ）。Expert → Basic は線形グラフのみ可能

### ステップ追加 UI（`[+ Add Step ▾]`）

```
┌──────────────────────────────────────────────────────┐
│  🤖 AI Call       — AI プロバイダへのプロンプト送信   │
│  📝 Manual Review — 人間によるレビュー・選択ポイント  │
│  ⚙️  CLI Command   — コマンド実行・スクリプト連携    │
│  🔧 External Tool — GUI アプリ起動・結果取得         │
│  🌐 HTTP Fetch    — Web API / サービス連携           │
│  🔀 Condition     — 自動分岐・ループ制御             │
│  🔄 Transform     — 正規表現・JSON Path・整形         │
│  📦 Call Pipeline — 別パイプラインをサブルーチン呼び出し│
│  🔁 Foreach       — 配列を1件ずつループ処理          │
│  ⚡ Parallel      — 複数ステップを並列実行           │
│  ⏱️  Wait          — 時間待機・条件待ち              │
│  📜 History       — 実行履歴から入出力を再利用       │
└──────────────────────────────────────────────────────┘
```

### ステップ編集フォーム（`[✏]` クリック時）

```
┌─────────────────────────────────────────────────────┐
│ ✏ Step: Translate                                   │
│ Type: [ai ▾]                                       │
│ Provider: [openai ▾]  Model: [gpt-4.1 ▾]           │
│ System Prompt: [You are a professional translator.] │
│ User Prompt:   [Translate to Japanese:\n{input}   ] │
│ 💡 使用可能変数: {input} {result} {step.N.result}   │
│ Temperature: [0.3]    Max Tokens: [4096]            │
│ Retry: count [3]  delay [2000] ms                  │
│        on: [rate_limit ✕] [timeout ✕] [+]          │
│ [✓ Save]  [✕ Cancel]                               │
└─────────────────────────────────────────────────────┘
```

step type ごとにフォームのフィールドが切り替わる。

| Type | 表示フィールド |
|------|--------------|
| `ai` | Provider / Model / System Prompt / User Prompt / Temperature / MaxTokens / attachMedia |
| `command` | Command / Args / WorkingDir / Timeout / resultAs |
| `tool` | Command / Args / waitForExit / resultAs / resultFile / confirm |
| `fetch` | URL / Method / Headers / Body / auth / resultAs |
| `condition` | expression / operator / value / onTrue / onFalse |
| `transform` | engine / expression / input |
| `manual` | mode / prompt / choices[] |
| `call_pipeline` | pipelineName / input / inheritAttachments |
| `foreach` | input / itemVariable / steps / concurrency |
| `parallel` | branches[] / outputMode |
| `wait` | durationMs / until / pollIntervalMs / timeoutMs |
| `history` | runId / stepIndex / field |

### Trigger 追加 UI（`[+ Add Trigger ▾]`）

```
┌────────────────────────────────────────┐
│  🕐 Schedule  — CRON 式で定期実行      │
│  📂 File Watch — ファイル変更で起動     │
│  🌐 Webhook   — HTTP リクエストで起動  │
└────────────────────────────────────────┘
```

### Toolbar 変更

```
[📄 New] [📂 Open] [💾 Save] [💾 Save As] │ [⚡ Pipelines] [▶ Run Pipeline] ⚙ Config
```

### Context Menu 追加

```
▶ Run Pipeline  →  [pipeline list] / Custom...
✏ Edit Pipeline →  [pipeline list]     ← 追加
+ New Pipeline                          ← 追加
```

### Bridge メッセージ追加

| 方向 | type | payload | 説明 |
|------|------|---------|------|
| JS→C++ | `save_pipeline` | `{pipeline}` | パイプライン定義を保存 |
| JS→C++ | `delete_pipeline` | `{pipelineName}` | パイプライン定義を削除 |
| C++→JS | `pipeline_list` | `{pipelines[]}` | パイプライン一覧（起動時 + 保存後） |

---

## File Operations

### Recent Files

最近開いたファイルを `recent_files.json` に保存し、起動時に `init` メッセージで JS へ送信する。

```
%APPDATA%/Ecode/Wend/recent_files.json
{ "files": ["C:\\path\\to\\a.json", "C:\\path\\to\\b.json", ...] }
```

- 最大保持件数: 10（`MAX_RECENT_FILES`）
- 追加時: 先頭に挿入、重複削除、超過分を末尾から削除
- `init` payload の `recentFiles[]` フィールドに含めて JS へ通知

### init メッセージの完全 payload

`Bridge::SendInit` は廃止し、`App::SendFullInit` に置き換える。

```json
{
  "type": "init",
  "payload": {
    "language": "ja",
    "tabs": [{"name": "General", "file": "general.json"}],
    "nodes": {
      "general.json": { ...Node tree... }
    },
    "pipelines": [...],
    "recentFiles": ["C:\\path\\to\\a.json", ...]
  }
}
```

`SendFullInit` は `init_complete` メッセージ受信後に呼ぶ（WebView2 初期化完了後）。

### File Dialog Bridge フロー

#### Open Tab（`[📂 Open]`）

```
JS: postMessage({type: "open_tab"})
C++: GetOpenFileNameW(filter="JSON Files|*.json|All|*.*")
  → キャンセルなら return
  → storage_.AddToRecentFiles(path)
  → session に新 tab 追加、SaveSession()
  → SendFullInit() で全状態を再送信
```

#### Save As（`[💾 Save As]`）

```
JS: postMessage({type: "save_tab_as", payload: {tabId: "..."}})
C++: GetSaveFileNameW(defaultExt="json")
  → storage_.SaveTabData(newPath, node)
  → storage_.AddToRecentFiles(newPath)
  → session の tab.file を更新、SaveSession()
  → bridge_.PostToJS("tab_saved_as", {newPath})
```

#### New Tab（`[📄 New]`）

```
JS: postMessage({type: "new_tab", payload: {name: "Untitled"}})
C++: 新規 Node を生成（空のルートノード）
  → storage_.SaveTabData("untitled_TIMESTAMP.json", emptyNode)
  → session に追加、SaveSession()
  → SendFullInit()
```

### save_node ハンドラ

```
JS: postMessage({type: "save_node", payload: {tabId: "general.json", node: {...}}})
C++: JsonToNode(payload.node) でデシリアライズ
  → storage_.SaveTabData(tabId, node)
  → bridge_.PostToJS("node_saved", {tabId})
```

### Storage 実装状況

| メソッド | 状態 |
|---------|------|
| `LoadSession` / `SaveSession` | ✅ 実装済み |
| `LoadTabData` / `SaveTabData` | ✅ 実装済み |
| `LoadBlob` / `SaveBlob` / `RemoveBlob` / `GarbageCollectBlobs` | ✅ 実装済み |
| `LoadProviders` / `SaveProviders` | ✅ 実装済み |
| `LoadPipelines` | ✅ 実装済み |
| `SavePipelines` | ❌ TODO スタブ → 要実装 |
| `SaveHistory` / `ListHistory` | ❌ TODO スタブ → 要実装 |
| `LoadRecentFiles` / `AddToRecentFiles` | ❌ 未実装 → 要追加 |

---

## Implementation TODO

### 次の優先タスク

- [ ] `command` ステップ（`child_process.spawn` + stdout pipe → `stream_chunk`）
- [ ] `tool` ステップ（GUI アプリ起動・結果取得）
- [ ] `fetch` / `transform` / `foreach` / `parallel` / `wait` ステップ
- [ ] Trigger (schedule / file_watcher / webhook)
- [ ] Blob GC（起動時スキャン）
- [ ] Recent Files
- [ ] Expert モード（Cytoscape.js ノードエディタ）

---

## Test Specification

### Unit Tests（Node.js — `electron/test.js`）

`npm --prefix electron test`（`node --test test.js`）で実行。VM コンテキスト上で `app.js` ロジックを直接テスト。

| テスト対象 | テストケース |
|-----------|------------|
| `selectNode` / 選択状態管理 | Op only / Data only / Combined 各状態遷移 |
| `buildTreeHTML` / ノードカラー不変条件 | `.selected` / `.selected-data` のクロスコンタミネーション防止 |
| `renderInput()` | Op選択時に `tempInputAttachments.text` を表示、Combined fallthrough |
| `renderPrompt()` | Data ノード選択時に `originalOpNode` のプロンプトを表示 |
| `_copyDataOutputToTempInput` | pipelineMeta.steps[last].output を opNode.tempInputAttachments にコピー |
| `processPrompt` | `run_prompt_process` メッセージの payload 検証 |
| `onPipelineCompleted` | Data ノード作成・inputAttachments コピー |
| Recipe 選択・customParams | `originalOpNode.selectedRecipe` への保存、JSON パース送信 |
| Variable 展開 | `{input}` `{step.0.result}` `{step.Translate.result}` |
| `condition` 評価 | contains / equals / startsWith / regex / json_path |
| Retry ロジック | `on[]` フィルタ一致時のみリトライ・count 超過で中断 |
| SSE パーサ | 複数チャンク分割・不完全行バッファ残留・`[DONE]` 検出 |

### Integration Tests（手動確認）

| シナリオ | 確認内容 |
|---------|---------|
| アプリ起動 | session.json から全タブ復元、Tree/List/Editor が表示される |
| New Tab | 新規タブが作成され session.json に保存される |
| Open Tab | GetOpenFileName → ファイル読み込み → recentFiles に追加 |
| Save As | GetSaveFileName → 別パスに保存 → タブ名更新 |
| Recent Files | 再起動後に前回開いたファイルが一覧に表示される |
| ノード編集・保存 | text/plain / text/html / RTF / 画像でラウンドトリップ |
| パイプライン実行 | ストリーム出力が Messages に表示、完了後に子ノード作成 |
| Dynamic Queue | 実行中にステップ追加・削除・編集が反映される |
| キャンセル | 即座に停止、blob 削除、ハンドル競合なし |
| Execution History | run_*.json が作成され、History UI で参照・再実行できる |
| File Watcher Trigger | 監視フォルダへのファイル追加でパイプライン自動実行 |
| Webhook Trigger | `curl -X POST http://localhost:PORT/...` でパイプライン起動 |
| RTF overlay | RTF ノード選択で RichEdit 表示、リサイズ追従 |
| --embedded | ecode から SetParent してサイズ追随・多重起動不可 |
| Localization | Config で言語切り替え後に UI 文字列が切り替わる |

### Edge Cases

| ケース | 期待動作 |
|--------|---------|
| pipeline.json が存在しない | エラーなし、空リストで起動 |
| providers.json が存在しない | 実行時に "API key not configured" |
| blob ファイル欠損 | `[missing]` 表示、クラッシュしない |
| WebView2 未インストール | 起動時にフォールバック UI 表示 |
| 並列ステップ中にキャンセル | 全スレッド停止、リソースリークなし |
| foreach の入力が空 | ループ0回、`{result}` は空文字列 |
| goto_step で無限ループ | 最大繰り返し回数（デフォルト 100）でキャンセル |
| recent_files.json が存在しない | エラーなし、空リストで起動 |

---

## Menu System — Standalone vs Embedded

### 設計原則

| モード | ウィンドウ管理者 | メニュー提供方法 |
|--------|----------------|----------------|
| Standalone | Wend.exe 自身 | Win32 ネイティブメニューバー |
| `--embedded` | ecode（親プロセス） | ツールバー内 `☰` HTML ドロップダウン |

embedded モードではネイティブメニューバーを非表示にし、ツールバーの `☰` ボタンで同等の機能を提供する。Win32 タイトルバーもないため、操作に必要な全エントリをツールバーに集約する。

---

### Standalone メニューバー（Win32 ネイティブ）

```
File    Edit    Pipeline    Providers    View    Help
```

#### File

| 項目 | ショートカット | 動作 |
|------|-------------|------|
| New Tab | Ctrl+T | 新規タブ（空ルートノード）を作成 |
| Open... | Ctrl+O | GetOpenFileName → JSON ファイルを新タブで開く |
| Save | Ctrl+S | 現在のタブを上書き保存 |
| Save As... | Ctrl+Shift+S | GetSaveFileName → 別名保存 |
| Import ZIP... | | ノード + blob を ZIP から復元 |
| Export Node... | | 選択ノード + blob を ZIP に書き出し |
| Recent Files ▶ | | `recent_files.json` から最大 10 件サブメニュー |
| ─── | | |
| Exit | Alt+F4 | 保存確認後に終了 |

#### Pipeline

| 項目 | ショートカット | 動作 |
|------|-------------|------|
| Run Pipeline... | F5 | 選択ノードに適用するパイプラインを選ぶサブメニュー |
| Pipeline Manager | Ctrl+P | Pipeline Manager モーダルを開く |
| Execution History | Ctrl+H | History パネルを開く |
| ─── | | |
| Cancel | Esc | 実行中パイプラインを中断 |

#### Providers

| 項目 | 動作 |
|------|------|
| Configure... | Config モーダルの Providers タブを開く |
| Test Connection | 登録済み全プロバイダへの疎通テスト |

#### View

| 項目 | ショートカット | 動作 |
|------|-------------|------|
| Toggle Tree | Ctrl+1 | Tree ペインを折りたたみ / 展開 |
| Toggle List | Ctrl+2 | List ペインを折りたたみ / 展開 |
| Toggle Editor | Ctrl+3 | Editor ペインを折りたたみ / 展開 |
| Toggle Messages | Ctrl+4 | Messages ペインを折りたたみ / 展開 |
| ─── | | |
| Full Screen | F11 | ウィンドウを最大化 |

#### Help

| 項目 | 動作 |
|------|------|
| Documentation | 設計ドキュメントを既定ブラウザで開く |
| About Wend | バージョン情報ダイアログ |

---

### Embedded モード — `☰` ドロップダウン

ネイティブメニューバーは非表示。ツールバー先頭の `☰` ボタンが HTML カスタムドロップダウンを展開する。

```
☰ | 📄 New | 📂 Open | 💾 Save | 💾 Save As | | ▶ Run | ⚡ Pipelines | ⚙ Config | [Search...] | 🧪 Test
```

#### `☰` ドロップダウン内容

```
┌─ File ───────────────────────────────┐
│  📄 New Tab          Ctrl+T          │
│  📂 Open...          Ctrl+O          │
│  💾 Save             Ctrl+S          │
│  💾 Save As...       Ctrl+Shift+S    │
│  📦 Import ZIP...                    │
│  📤 Export Node...                   │
│  Recent Files ▶                      │
├─ Pipeline ───────────────────────────┤
│  ▶ Run Pipeline...   F5              │
│  ⚡ Pipeline Manager Ctrl+P          │
│  📜 Execution History Ctrl+H         │
│  ✕ Cancel            Esc             │
├─ Providers ──────────────────────────┤
│  ⚙ Configure...                      │
├─ View ────────────────────────────────┤
│  Toggle Tree         Ctrl+1          │
│  Toggle List         Ctrl+2          │
│  Toggle Editor       Ctrl+3          │
│  Toggle Messages     Ctrl+4          │
├─ Help ────────────────────────────────┤
│  About Wend                        │
└───────────────────────────────────────┘
```

#### 実装方法

`☰` ボタンの `onclick` で HTML 要素を動的生成し、`document.body` に `position: fixed` でオーバーレイ。外側クリックで閉じる。

```javascript
// app.js
showHamburger() {
    const menu = document.createElement('div');
    menu.className = 'hamburger-menu';
    menu.innerHTML = `...`; // 上記メニュー HTML
    document.body.appendChild(menu);
    // 外側クリックで閉じる
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
},
```

#### Standalone / Embedded の判定

C++ 起動時に `--embedded` フラグを `init` メッセージの `embedded` フィールドで JS へ通知。

```json
{ "type": "init", "payload": { "embedded": true, ... } }
```

JS 側:
```javascript
case 'init':
    this.state.embedded = msg.payload.embedded || false;
    if (this.state.embedded) {
        document.getElementById('btn-hamburger').style.display = '';
    }
    break;
```

#### Electron メニューバーの実装

`electron/main.js` の `buildMenuTemplate()` で `Menu.buildFromTemplate(...)` を生成し、`Menu.setApplicationMenu(menu)` で設定。各メニュー項目の `click` ハンドラで `mainWindow.webContents.send('bridge-message', ...)` を呼ぶ。

embedded モードでは `Menu.setApplicationMenu(null)` でメニューバーを非表示にし、ツールバーの `☰` HTML ドロップダウンに切り替える。

---

## Provider Config UI（実装済み）

### 概要

⚙ Config ボタン → Config モーダル → Providers タブ で全 AI プロバイダの API Key / Base URL を設定・保存する。

### 対応プロバイダ一覧

| ID | 表示名 | デフォルト Base URL | 備考 |
|----|--------|---------------------|------|
| `openai` | OpenAI | `https://api.openai.com/v1` | GPT-4.x / o1 / o3 系 |
| `anthropic` | Anthropic | `https://api.anthropic.com` | Claude 系 |
| `gemini` | Gemini | `https://generativelanguage.googleapis.com` | Gemini 2.x 系 |
| `ollama` | Ollama | `http://localhost:11434` | ローカル LLM |
| `openai_compat` | Custom (OpenAI互換) | （ユーザー入力） | Grok / Groq / LM Studio 等 |

### OpenAI 互換プロバイダ

ほとんどの新興 AI プロバイダは OpenAI 互換 API エンドポイントを提供している。`openai_compat` タイプを追加することで、専用アダプタなしに任意のプロバイダを利用できる。

| プロバイダ | Base URL |
|-----------|---------|
| Grok (xAI) | `https://api.x.ai/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together AI | `https://api.together.xyz/v1` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |
| LM Studio | `http://localhost:1234/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |

### Bridge フロー

```
JS:  postMessage({ type: "get_providers" })
C++: storage_.LoadProviders() → providers.json 読み込み
C++: PostToJS("providers_result", { openai: {apiKey, baseUrl}, ... })
JS:  Config モーダルの各入力フィールドに反映

JS:  postMessage({ type: "save_providers", payload: { openai: {...}, ... } })
C++: storage_.SaveProviders() → providers.json 書き込み
C++: runner_.RegisterProvider() で PipelineRunner にも反映
```

### UI レイアウト

```
┌─ Config ──────────────────────────────────┐
│ [Providers]  [General]                    │
├───────────────────────────────────────────┤
│ ┌─ OpenAI ────────────────────────────┐   │
│ │ API Key  [••••••••••••••••••] 👁    │   │
│ │ Base URL [https://api.openai.com/v1] │   │
│ └──────────────────────────────────────┘   │
│ ┌─ Anthropic ─────────────────────────┐   │
│ │ API Key  [••••••••••••••••••] 👁    │   │
│ │ Base URL [https://api.anthropic.com] │   │
│ └──────────────────────────────────────┘   │
│        ...                                 │
│              [Test Connection]  [Save]     │
└───────────────────────────────────────────┘
```

API Key フィールドは `type="password"` 。👁 ボタンで表示/非表示切り替え。

---

## Manual Step — 人間による確認・編集・選択

### 概要

パイプラインの途中で実行を一時停止し、人間がレビュー・編集・選択を行ってから次ステップへ進む仕組み。

### 3 つのモード

#### `view` — 読み取り専用確認

```
┌─ 確認 ─ Step 2 ────────────────────────────┐
│  翻訳結果を確認してください                  │  ← prompt
│ ┌────────────────────────────────────────┐  │
│ │ こんにちは、世界！                       │  │  ← 前ステップの出力（編集不可）
│ │ これはテストの翻訳です。                 │  │
│ └────────────────────────────────────────┘  │
│                     [Continue]  [Cancel]    │
└─────────────────────────────────────────────┘
```

Continue → 前ステップの出力をそのまま `{result}` として次ステップへ。

#### `edit` — 内容編集

```
┌─ 編集 ─ Step 2 ────────────────────────────┐
│  内容を編集してから Continue を押してください │
│ ┌────────────────────────────────────────┐  │
│ │ こんにちは、世界！（編集可能）           │  │  ← textarea
│ └────────────────────────────────────────┘  │
│                     [Continue]  [Cancel]    │
└─────────────────────────────────────────────┘
```

Continue → textarea の内容を `{result}` として次ステップへ。

#### `select` — 選択肢から選ぶ

```
┌─ 選択 ─ Step 3 ────────────────────────────┐
│  生成された WAV を聴いて判定してください     │
│ ┌────────────────────────────────────────┐  │
│ │ 生成されたテキスト内容のプレビュー...    │  │
│ └────────────────────────────────────────┘  │
│  [✅ OK — 次のステップへ]                   │
│  [🔄 Re-generate（最初からやり直す）]       │
│  [✕ Cancel pipeline]                       │
└─────────────────────────────────────────────┘
```

選択した `action` に従い次の遷移先が決まる（`next_step` / `goto_step` / `cancel`）。

### 実行停止の仕組み

`manual` ステップ到達時:

1. `PipelineRunner.executeStep()` が `this.waitingForManual = true` にセット
2. `postBridge('manual_step_pause', { index, mode, prompt, content, choices[] })` を JS へ送信
3. `runNextStep()` を呼ばずに即リターン → パイプラインは「待機状態」（`ipcMain.on('bridge', ...)` がキューを処理）

ユーザーが Continue または選択肢をクリック時:

1. JS: `__promptsBridge.postMessage({ type: "manual_step_resume", payload: { content } })`
2. Main: `handleBridgeMessage` → `runner.resumeManual(content)`
3. `PipelineRunner.resumeManual`: `waitingForManual = false`、historyStep に output を記録 → `runNextStep()`

### Bridge メッセージ

| 方向 | type | payload | 説明 |
|------|------|---------|------|
| C++→JS | `manual_step_pause` | `{index, mode, prompt, content, choices[]}` | ユーザー入力待ちへ移行 |
| JS→C++ | `manual_step_resume` | `{content, action?, gotoStep?}` | Continue / 選択結果を送信 |
| JS→C++ | `manual_step_cancel` | `{}` | パイプラインを中断 |

### pipeline.json 定義例

```json
{
  "type": "manual",
  "mode": "select",
  "prompt": "生成された結果を確認して選択してください",
  "choices": [
    { "label": "✅ OK — 次へ",      "action": "next_step" },
    { "label": "🔄 再生成",          "action": "goto_step", "index": 0 },
    { "label": "✕ キャンセル",       "action": "cancel" }
  ]
}
```

---

## Pipeline Metadata — 散逸防止・再現性確保

### 問題

AI ワークフローで「良い結果が得られた」とき、以下が散逸しやすい:
- どのプロンプトを使ったか
- どの順番でどの AI に投げたか  
- モデル・温度設定

後から同じ処理を再現しようとしても手がかりが残らない。

### 解決: 成果物ノードへのメタデータ埋め込み

パイプライン実行完了時、出力ノードの `pipelineMeta` フィールドに実行記録を JSON で埋め込む。

```json
{
  "title": "翻訳→レビュー — 2026-06-04 21:45:00",
  "content": "base64(こんにちは世界...)",
  "mimetype": "text/plain",
  "pipelineMeta": "{\"pipelineName\":\"翻訳→レビュー\",\"executedAt\":\"2026-06-04T21:45:00Z\",\"steps\":[{\"name\":\"Translate\",\"type\":\"ai\",\"provider\":\"anthropic\",\"model\":\"claude-sonnet-4-6\",\"systemPrompt\":\"...\",\"userPrompt\":\"...\",\"output\":\"...\",\"tokens\":312},{\"name\":\"Review\",\"type\":\"ai\",\"provider\":\"openai\",\"model\":\"gpt-4.1\",\"output\":\"...\",\"tokens\":180}]}"
}
```

### pipelineMeta フィールドの構造

```typescript
interface PipelineMeta {
  pipelineName: string;       // パイプライン名
  executedAt:   string;       // ISO 8601 timestamp
  outputContent: string;      // 最終ステップの出力テキスト
  steps: {
    name:         string;
    type:         string;     // "ai" | "command" | "manual" | ...
    provider?:    string;     // "openai" | "anthropic" | "gemini" | "ollama"
    model?:       string;     // "gpt-4.1" | "claude-sonnet-4-6" | ...
    systemPrompt?: string;
    userPrompt?:  string;
    temperature?: number;
    output?:      string;     // このステップの出力
    tokens?:      number;     // 消費トークン数
  }[];
}
```

### Pipeline Metadata パネル（Editor ペイン下部）

ノード選択時、`pipelineMeta` が存在する場合にエディタ下部に表示。

```
┌─────────────────────────────────────────────────────┐
│ 📋 翻訳→レビュー    2026-06-04 21:45:00  [🔄]      │
├─────────────────────────────────────────────────────┤
│ 1  Translate    ai  anthropic  claude-sonnet-4-6  312 tok │
│ 2  Review       ai  openai     gpt-4.1            180 tok │
└─────────────────────────────────────────────────────┘
```

- **`[🔄]`** (tooltip: 「再実行」): 現在選択中のノードを入力として同名パイプラインを再実行
- ステップ行をクリック: そのステップのプロンプトと出力をポップアップ表示

### 「パイプラインとして保存」フロー

アドホック実行後、成果物ノードのメタデータから正式なパイプライン定義を生成できる。

```
成果物ノードを選択
  → Pipeline Metadata パネルの [💾 パイプラインとして保存] ボタン
  → 名前入力ダイアログ（デフォルト: pipelineName）
  → pipelineMeta.steps[] から PipelineStep[] を再構築
  → pipeline.json に追記
  → Pipeline Manager に即座に反映
```

これにより「アドホックに試した → うまくいった → 名前をつけて保存 → 以後いつでも再利用」というフローが完結する。

### 実装: buildMetaJson()

`PipelineRunner.buildMetaJson()` は全ステップ完了時に呼ばれ、ステップ定義と実行結果を結合してメタオブジェクトを返す。

```javascript
// electron/main.js
buildMetaJson() {
    // Returns: { outputContent, pipelineName, executedAt, steps: [...] }
}
```

完了時に `postBridge('pipeline_completed', JSON.stringify(buildMetaJson()))` を呼び、JS が `pipeline_completed` を受信して出力 Data ノードを作成・保存する。

### Storage: pipelineMeta の永続化

`node.pipelineMeta` は `saveNode()` / `loadTabData()` で `"pipelineMeta"` キーとして JSON に保存される。空文字列の場合はキー自体を省略。

---

## メディアタイプ戦略

### 設計原則: ノードはコンテナ、型は詳細

```
❌ 型中心設計（避けるべき）:
  画像ノード、PDFノード、動画ノード ... → 型ごとに異なるUI → Messy

✅ 内容中心設計（採用）:
  ノード = タイトル + コンテンツ（何でも）
  型はノードの属性（小さなバッジで表示）
  パイプラインは型を直接扱わない
```

### ノードのコンテンツタイプ

| mimetype | エディタ表示 | パイプライン入力 |
|----------|------------|----------------|
| `text/plain` | `<textarea>` | テキストとして渡す |
| `text/html` | marked.js レンダリング + ソース編集 | HTML テキストとして渡す |
| `application/rtf` | RichEdit HWND オーバーレイ | RTF テキストとして渡す |
| `image/png` `image/jpeg` `image/webp` | `<img>` タグ表示 | base64 → `{content_file}` でファイル化 or multi-modal |
| `application/pdf` | `[PDF] nnn KB` + 外部アプリで開く | `{content_file}` でパス渡し |
| `video/*` | `<video>` タグ / ファイル名表示 | `{content_file}` でパス渡し |
| `audio/*` | `<audio>` タグ | `{content_file}` でパス渡し |
| `application/vnd.openxmlformats-officedocument.*` | ファイル名 + サイズ | `{content_file}` |

### 型変換パターン（`command` ステップ）

型変換は外部 CLI ツールに委ねる。Wend 自身は変換ロジックを持たない。

```json
// PDF → テキスト
{ "type": "command", "command": "pdftotext", "args": ["{content_file}", "-"], "resultAs": "text" }

// 画像 → テキスト説明（AI vision）
{ "type": "ai", "provider": "openai", "model": "gpt-4o", "attachMedia": "all",
  "userPrompt": "この画像を詳しく説明してください" }

// 音声 → テキスト (Whisper)
{ "type": "command", "command": "whisper", "args": ["{content_file}", "--output_format", "txt"], "resultAs": "text" }

// 動画 → 音声
{ "type": "command", "command": "ffmpeg",
  "args": ["-i", "{content_file}", "-vn", "-acodec", "mp3", "{output_file}"],
  "resultAs": "file", "resultFile": "{output_file}" }

// PPTX → テキスト
{ "type": "command", "command": "python", "args": ["-c",
  "import pptx,sys; [print(s.text) for sl in pptx.Presentation(sys.argv[1]).slides for s in sl.shapes if s.has_text_frame]",
  "{content_file}"], "resultAs": "text" }
```

### `{content_file}` プレースホルダー

`command` / `tool` ステップで `{content_file}` を使うと、C++ がノードの content を一時ファイルに書き出してそのパスに置換する。

| mimetype | エンコーディング |
|----------|----------------|
| `text/*` | UTF-8 |
| `application/rtf` | ASCII |
| `image/*` `video/*` `audio/*` | 生バイナリ |
| その他 | 生バイナリ |

ステップ終了後に一時ファイルを削除する。

### UIでのMessy回避ルール

1. **ノードのアイコン/バッジは最小限** — 型を示す小さなバッジ（📄 📷 🎵 🎬）のみ
2. **型固有UIは最小面積** — テキスト以外は「ファイル名 + サイズ + [外部アプリで開く]」のみ
3. **パイプラインは型を宣言しない** — `{content_file}` として任意のバイナリを扱える
4. **変換は外部ツール** — ffmpeg / whisper / pdftotext 等を `command` ステップで利用

### 大容量メディアの扱い

1 MB 以上のメディアは `blobs/` ディレクトリに外部保存し、ノード JSON には `file` パスのみ記録（inline: false）。パイプライン実行時は `blobs/` のファイルパスを `{content_file}` として渡す。

---

## Command Step — CLI ツール統合（実装TODO）

### 概要

外部コマンド（ffmpeg / whisper / pdftotext / python / codex / claude 等）をパイプラインステップとして実行する。stdout を `{result}` に格納して次ステップへ渡す。

### pipeline.json 定義

```json
{
  "type": "command",
  "command": "whisper",
  "args": ["{content_file}", "--output_format", "txt", "--language", "ja"],
  "timeout": 300,
  "workingDir": "%APPDATA%/Ecode/Wend/",
  "resultAs": "text"
}
```

| フィールド | 説明 | デフォルト |
|-----------|------|---------|
| `command` | 実行ファイル名またはフルパス | 必須 |
| `args` | 引数配列。`{content_file}` / `{result}` 等プレースホルダー利用可 | `[]` |
| `timeout` | タイムアウト秒数 | 60 |
| `workingDir` | 作業ディレクトリ | appDataPath |
| `resultAs` | `"text"` = stdout を `{result}` に / `"exitcode"` = 終了コードを `{result}` に / `"file"` = `resultFile` を読み込む | `"text"` |
| `resultFile` | `resultAs: "file"` 時の出力ファイルパス | — |
| `env` | 追加環境変数 `{ "KEY": "VALUE" }` | — |

### 非同期実行（Node.js）

`command` ステップは時間がかかる可能性（Codex CLI、whisper等）があるため、`child_process.spawn` で非同期実行してイベントループをブロックしない。

```
Node.js event loop:
  executeStep(type='command')
    → spawn(command, args, { stdio: ['pipe','pipe','pipe'] })
    → process.stdout.on('data', chunk) → postBridge('stream_chunk', ...)
    → process.on('exit', code) → postBridge('step_done') → runNextStep()
```

**実装方針:**

```javascript
// executeStep 内 (type === 'command')
const proc = spawn(step.command, expandedArgs, { cwd: workingDir });
proc.stdout.on('data', chunk => postBridge('stream_chunk', { stepIndex, text: chunk.toString() }));
proc.on('exit', code => {
    historyStep.output = stdout;
    postBridge('step_done', { stepIndex, tokens: 0, ms: elapsed });
    runNextStep();
});
```

### Codex CLI 統合例

OpenAI Codex CLI は `--approval-mode full-auto` でバッチ実行可能。

```json
{
  "type": "command",
  "command": "codex",
  "args": ["--approval-mode", "full-auto", "{content}"],
  "timeout": 600,
  "workingDir": "C:\\your\\project",
  "resultAs": "text"
}
```

同様に Claude Code:

```json
{
  "type": "command",
  "command": "claude",
  "args": ["-p", "{content}"],
  "timeout": 600,
  "workingDir": "C:\\your\\project",
  "resultAs": "text"
}
```

---

## Implementation Status（最新）

### 実装済み ✅

| 機能 | ファイル |
|------|---------|
| Electron ウィンドウ + BrowserWindow 初期化 | `electron/main.js` |
| Bridge (ipcMain / ipcRenderer / preload.js) | `electron/main.js`, `electron/preload.js` |
| Storage (JSON read/write, blob, session) | `electron/main.js` |
| Node + pipelineMeta フィールド | `electron/main.js` |
| PipelineRunner — ai ステップ (Node.js https SSE) | `electron/main.js` |
| PipelineRunner — condition / manual ステップ | `electron/main.js` |
| PipelineRunner — BuildMetaJson (pipeline_completed) | `electron/main.js` |
| PipelineRunner — Dynamic Queue | `electron/main.js` |
| AIProvider (OpenAI / Anthropic / Gemini / Ollama) | `electron/main.js` |
| Bridge: get_providers / save_providers | `electron/main.js` |
| Bridge: manual_step_resume / manual_step_cancel | `electron/main.js` |
| Bridge: save_node / run_prompt_process | `electron/main.js` |
| Tree / Prompt / Input / Output ペインレイアウト | `frontend/app.js`, `style.css` |
| ノード選択状態管理 (Op/Data/Combined) | `frontend/app.js` |
| tempInputAttachments / _copyDataOutputToTempInput | `frontend/app.js` |
| Config モーダル (Providers タブ) | `frontend/index.html`, `app.js`, `style.css` |
| Manual Step モーダル (view / edit / select) | `frontend/index.html`, `app.js`, `style.css` |
| Pipeline Metadata パネル | `frontend/app.js`, `style.css` |
| Execution History UI (linked run cards) | `frontend/app.js` |
| Pipeline Manager UI | `frontend/app.js` |
| ローカライゼーション (6 言語) | `frontend/lang/*.json` |
| ユニットテスト (node --test) | `electron/test.js` |

### 未実装 / TODO

| 機能 | 優先度 |
|------|--------|
| `command` ステップ (child_process + stdout pipe) | 高 |
| `tool` / `fetch` / `transform` / `foreach` / `parallel` / `wait` ステップ | 中 |
| Trigger (schedule / file_watcher / webhook) | 低 |
| Expert モード (Cytoscape.js) | 低 |
| Blob GC (起動時スキャン) | 中 |
| Recent Files | 低 |


---

## パイプライン機能拡張 — Claude の提案

> **用語注記**: ここで「拡張」はパイプラインの実行エンジン（ステップ種別・変数・トリガー等）に関する設計提案を指す。
> AI agent の文脈・記憶・設定のライフサイクル管理は別概念「**AI Agent ハーネス**」として後節で定義する。

### 追加ステップタイプ

既存の Step Types テーブルへの追加候補。

| Type | Description | block UI? |
|------|-------------|-----------|
| `"cache"` | 入力ハッシュで結果をキャッシュ。ヒット時はAI呼び出しをスキップ | No |
| `"assert"` | 出力を検証し、条件不満足時にエラーまたは警告 | No |
| `"set_var"` | 任意の値を名前付き変数に格納 → `{var.NAME}` で参照 | No |
| `"notify"` | Windows トースト通知を送信（長時間バックグラウンド実行用） | No |

---

#### `"cache"` — 結果キャッシュステップ

高コストな AI コールや外部 API の結果をキャッシュし、同一入力では再実行をスキップする。

```json
{
  "type": "cache",
  "key": "{content}",
  "ttl": 3600,
  "namespace": "translate_v1",
  "onMiss": { "type": "ai", "provider": "openai", "model": "gpt-4.1", "userPrompt": "..." }
}
```

| フィールド | 説明 | デフォルト |
|-----------|------|---------|
| `key` | キャッシュキー（プレースホルダー展開後に SHA-256 ハッシュ） | `{content}` |
| `ttl` | TTL 秒数（0 = 永続） | 0 |
| `namespace` | キャッシュ名前空間。プロンプト変更時にバージョンアップして無効化 | `"default"` |
| `onMiss` | キャッシュミス時に実行するインラインステップ定義 | 必須 |

保存先: `%APPDATA%/Ecode/Wend/cache/<namespace>/<hash>.json`
Config に "Clear Cache" ボタンを追加。

---

#### `"assert"` — バリデーション・テストステップ

条件を満たさない場合にパイプラインを停止またはログ警告を出す。Test Mode と組み合わせてパイプラインの自動テストに使える。

```json
{
  "type": "assert",
  "expression": "{result}",
  "operator": "contains",
  "value": "翻訳:",
  "message": "翻訳プレフィックスが見つかりません",
  "onFail": "cancel"
}
```

| `onFail` 値 | 動作 |
|-------------|------|
| `"cancel"` | パイプライン中断（`onError` と同じ扱い） |
| `"warn"` | Messages ペインに黄色警告行を出して継続 |
| `"goto_step"` | 指定 `index` のステップに戻る |

`operator` は `condition` ステップと共通（`contains` / `equals` / `startsWith` / `regex` / `json_path`）。

---

#### `"set_var"` — 名前付き変数の格納

ステップ出力や展開済みプレースホルダーを名前付き変数に格納する。後続ステップで `{var.NAME}` として参照可能。

```json
{
  "type": "set_var",
  "vars": {
    "original": "{content}",
    "translated": "{result}",
    "run_date": "{date}"
  }
}
```

- `{var.NAME}` は同一パイプライン実行内でのみ有効（セッション変数）
- 複数の `set_var` で同名キーを使うと上書き
- 用途: 入力を保存して後続ステップで `{result}` が変わっても元の内容を参照できる。`{step.N.result}` より可読性が高い

---

#### `"notify"` — Windows 通知ステップ

長時間パイプラインの途中で Windows トースト通知を送る。バックグラウンド実行時に有用。

```json
{
  "type": "notify",
  "title": "{pipeline.name} Checkpoint",
  "message": "Step {step.current}/{step.total} 完了: {result}",
  "sound": false
}
```

Windows Action Center に表示。`winrt` Toast API または `ShellExecute` で実装（依存追加なし）。

---

### 変数プレースホルダー追加

既存の `{content}` / `{result}` / `{step.N.result}` への追加候補。

| 構文 | 内容 |
|------|------|
| `{date}` | 実行開始日（`YYYY-MM-DD` 形式） |
| `{time}` | 実行開始時刻（`HH:mm:ss` 形式） |
| `{node.title}` | 入力ノードのタイトル |
| `{node.id}` | 入力ノードの内部 ID |
| `{node.mimetype}` | 入力ノードの MIME タイプ |
| `{pipeline.name}` | 実行中パイプライン名 |
| `{step.current}` | 現在のステップ番号（1 始まり） |
| `{step.total}` | パイプラインの総ステップ数 |
| `{env.VAR_NAME}` | Windows 環境変数（例: `{env.USERNAME}`） |
| `{var.NAME}` | `set_var` ステップで格納した名前付き変数 |

`{date}` / `{time}` / `{node.*}` / `{pipeline.name}` / `{step.current}` / `{step.total}` はパイプライン実行開始時に確定し、全ステップで同じ値を保持する。
`{env.VAR_NAME}` は `GetEnvironmentVariableW` で取得。存在しない変数名は空文字列に展開する。

---

### Command ステップへの stdin 対応

`jq` / `sed` / `python -c` など、stdin からデータを受け取るコマンドへの対応。`stdin` フィールドを追加。

```json
{
  "type": "command",
  "command": "jq",
  "args": [".data.text"],
  "stdin": "{result}",
  "resultAs": "text"
}
```

`stdin` が指定された場合、展開後の文字列を UTF-8 でエンコードして子プロセスの stdin に書き込む。`{content_file}` との併用も可（stdin と args にそれぞれ異なるデータを渡せる）。

---

### Trigger 追加: `node_created`

アプリ内イベントをトリガーにする。特定ノードの配下に子ノードが作成されたとき（貼り付け・DnD・別パイプラインの出力）にパイプラインを自動起動。

```json
{
  "type": "node_created",
  "parentNodeTitle": "受信トレイ",
  "inputMimetype": "text/plain"
}
```

| フィールド | 説明 |
|-----------|------|
| `parentNodeTitle` | 監視する親ノードのタイトル（部分一致） |
| `inputMimetype` | フィルタする MIME タイプ（省略時は全タイプ） |

**用途例**:
- `受信トレイ` ノード配下への貼り付けで自動要約パイプラインが走る
- 別パイプラインの出力ノード作成がトリガーになり、パイプラインを連鎖できる（`node_created` trigger が `call_pipeline` の代替として機能）

---

### foreach ステップへの `aggregateAs` 追加

現在は結果を改行連結するのみ。集約方式を選べるようにする。

```json
{
  "type": "foreach",
  "input": "{result}",
  "itemVariable": "item",
  "steps": [ { "type": "ai", "userPrompt": "Summarize: {item}" } ],
  "concurrency": 3,
  "aggregateAs": "json_array"
}
```

| `aggregateAs` 値 | 動作 |
|-----------------|------|
| `"newline"` | 改行連結（現行デフォルト） |
| `"json_array"` | JSON 配列 `["result1", "result2", ...]` |
| `"numbered_list"` | `1. result1\n2. result2\n...` |
| `"csv"` | カンマ区切り（RFC 4180 エスケープ） |

`"json_array"` にしておくと後続の `condition` / `transform`（`json_path` engine）と組み合わせて要素アクセスが容易になる。

---

### Pipeline レベル: 入力バリデーション

`inputSpec` フィールドをパイプライン定義に追加し、実行前に入力ノードを検証する。

```json
{
  "name": "PDF 要約",
  "inputSpec": {
    "mimetypes": ["application/pdf"],
    "minAttachments": 1,
    "contentNotEmpty": true
  },
  "steps": [...]
}
```

バリデーション失敗時は「このパイプラインは PDF ノードにのみ対応しています」とダイアログ表示して実行を中断。
Context Menu の「▶ Run Pipeline」サブメニューでも `inputSpec` 不適合のパイプラインをグレーアウト表示できる。

---

## AI Agent ハーネス

> **定義**: ここで「ハーネス」とは、AI agent が特定のタスクに専念するために必要な **文脈・記憶・スキル・設定のセット** を指す。
> パイプライン（ステップの実行順序）とは別物。パイプラインは「何をどの順番で実行するか」を定義し、ハーネスは「その AI がどういう存在であるか」を定義する。

### ハーネスの構成要素

```json
{
  "name": "technical_translator",
  "systemPrompt": "You are a professional technical translator specializing in software documentation.",
  "memory": [
    "ユーザーはヘビメタ好きで、ユーモアを好む",
    "プロジェクト固有用語: 'ハーネス' = agent context bundle"
  ],
  "skills": ["search_web", "read_file"],
  "config": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "temperature": 0.3
  },
  "baseline": "technical_translator_v1"
}
```

| フィールド | 内容 |
|-----------|------|
| `systemPrompt` | agent の役割・制約・スタイルを定義するシステムプロンプト |
| `memory[]` | 過去のやり取りや蓄積された事実。実行のたびに増える |
| `skills[]` | この agent が利用できるツール・コマンドの識別子 |
| `config` | デフォルトのモデル・プロバイダ・パラメータ |
| `baseline` | リセット時に戻すスナップショット名 |

### ライフサイクル: 保存 / 強化 / 再利用 / リセット

```
保存 (save)     ──→  harnesses/<name>.json に現在の状態をスナップショット
強化 (enhance)  ──→  memory[] に追記、systemPrompt を更新、skills を追加
再利用 (reuse)  ──→  別パイプライン実行や別ノードに同じハーネスをロード
リセット (reset) ──→  baseline スナップショットに巻き戻し（memory をクリア）
```

### ストレージ

```
%APPDATA%/Ecode/Wend/
└── harnesses/
    ├── technical_translator.json      ← 現在の状態（memory が蓄積される）
    ├── technical_translator_v1.json   ← baseline スナップショット
    └── code_reviewer.json
```

- **現在状態** (`<name>.json`): パイプライン実行のたびに memory が追記される生きたファイル
- **ベースライン** (`<name>_<tag>.json`): `save` 操作で明示的に作成するスナップショット。`reset` の戻り先

### パイプラインとの関係

ハーネスはパイプラインの「ai」ステップに `harness` フィールドで指定する。

```json
{
  "type": "ai",
  "harness": "technical_translator",
  "userPrompt": "以下を翻訳してください:\n\n{content}"
}
```

- `harness` が指定された場合、そのハーネスの `systemPrompt` / `config` を使用
- `systemPrompt` / `provider` / `model` の直接指定はハーネス設定を上書き（オーバーライド可）

### ハーネス操作ステップ

パイプライン内でハーネスのライフサイクルを操作するステップ型。

#### `"harness_enhance"` — 強化ステップ

パイプライン実行中に得た情報をハーネスの memory に追記する。

```json
{
  "type": "harness_enhance",
  "harness": "technical_translator",
  "add_memory": "{result}",
  "save_snapshot": false
}
```

| フィールド | 説明 |
|-----------|------|
| `add_memory` | memory[] に追記する文字列（プレースホルダー展開後） |
| `save_snapshot` | `true` にすると enhance 前の状態をベースラインとして保存 |

#### `"harness_reset"` — リセットステップ

ハーネスを baseline スナップショットに巻き戻す。蓄積された memory をクリアする。

```json
{
  "type": "harness_reset",
  "harness": "technical_translator",
  "to": "technical_translator_v1"
}
```

`to` を省略した場合、`baseline` フィールドが指す名前を使用。

#### `"harness_save"` — 保存ステップ

現在のハーネス状態を名前付きスナップショットとして保存する。

```json
{
  "type": "harness_save",
  "harness": "technical_translator",
  "tag": "after_project_x"
}
```

保存先: `harnesses/technical_translator_after_project_x.json`

### Harness Manager UI

Pipeline Manager と同様に、ハーネスの一覧・編集・スナップショット管理を行う専用パネル。

```
┌────────────────────────────────────────────────────┐
│ Harnesses                              [+ New]     │
├──────────────────┬─────────────────────────────────┤
│ technical_trans  │  Name: [technical_translator   ]│
│ code_reviewer    │                                 │
│                  │  System Prompt:                 │
│                  │  [You are a professional...   ] │
│                  │                                 │
│                  │  Memory (3 entries):            │
│                  │  ┌───────────────────────────┐  │
│                  │  │ ユーザーはヘビメタ好き     │  │
│                  │  │ 用語: ハーネス = ...       │  │
│                  │  │ [+ Add]  [✕ per item]     │  │
│                  │  └───────────────────────────┘  │
│                  │                                 │
│                  │  Snapshots:                     │
│                  │  [v1 (baseline)]  [after_prj_x] │
│                  │  [📸 Save now]  [🔄 Reset to ▾] │
│                  │                                 │
│                  │  [💾 Save]  [🗑 Delete]         │
└──────────────────┴─────────────────────────────────┘
```

### Bridge メッセージ

| 方向 | type | payload | 説明 |
|------|------|---------|------|
| JS→C++ | `save_harness` | `{harness}` | ハーネス定義を保存 |
| JS→C++ | `reset_harness` | `{name, to}` | ベースラインにリセット |
| JS→C++ | `snapshot_harness` | `{name, tag}` | 現在状態をスナップショット保存 |
| C++→JS | `harness_list` | `{harnesses[]}` | ハーネス一覧（起動時 + 保存後） |

### CLAUDE.md / memory との対比（参考）

Wend アプリのハーネスは、Claude Code の設定ファイル群と概念的に対応する。

| Wend ハーネス | Claude Code 相当 | 内容 |
|----------------|----------------|------|
| `systemPrompt` | `CLAUDE.md` | agent の役割・ルール定義 |
| `memory[]` | `memory/*.md` (auto memory) | 蓄積された事実・フィードバック |
| `skills[]` | `.claude/skills/*.md` | 再利用可能なスキル定義 |
| `config` | `settings.json` | モデル・権限・フック設定 |
| snapshot (baseline) | git commit / branch | 状態のバージョン管理 |

この対比を念頭に置くと、Wend のハーネス設計の意図が明確になる:
**「CLAUDE.md + memory が git で管理されるように、Wend のハーネスもスナップショットで管理できる」**。
