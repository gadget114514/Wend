# Wend アーキテクチャ進化 設計ドキュメント作成プラン

## Context

Wend は「Behavior Tree で AI パイプラインを構築・実行するローカルファースト Electron IDE」。現状の課題:

- **骨格とデータの境界が不明瞭**: レシピ (`frontend/defaults/recipes-*.json`) とプロバイダ (`electron/providers/*.js` 自動発見) はデータ/プラグイン化済みだが、ノード定義は `frontend/bt-actions.js` にハードコード。操作ペインのフィールド表示も `app.js:9600-9874` で DOM グループ直書き。
- **データフロー表現がない**: ノード間のデータ受け渡しは blackboard の文字列キー共有のみ。型・ポート・エッジの概念がない。
- **未完成機能**: `invoke` アクションはバックエンド IPC ハンドラ欠如 (`bt_invoke_command` は `frontend/bt-actions.js` のみ、`electron/main.js` に受け手なし → Promise が永久に未解決)。`filepath` 入力型は UI のみ (`app.js:9776`) で `bt.js` `_runAI` (1099行付近) は text/media しか分岐しない。
- **神オブジェクト**: `frontend/app.js` 13,405行、`electron/main.js` 5,374行。
- **普及戦略の不在**: Windows のみ、共有フォーマット・配布チャネルなし。

ユーザー決定事項:
1. **成果物は設計ドキュメントのみ**(実装は次セッション以降)。`Assets/designdoc/` ではなく本リポジトリの `designdoc/` に格納(GPUMeshi ルールは別プロジェクトのもの)。
2. 演算ノードは **BTリーフ内サブグラフ方式**(BT=制御フロー、グラフ=データフローの分担)。
3. ノードパックは **JS module 形式を同意ダイアログ付きで許可**(宣言的データは無条件、コード入りはオプトイン)。

## 成果物: designdoc/ に4つの設計ドキュメント(日本語、既存docsに合わせMarkdown)

### 1. `designdoc/core-data-separation.md` — 骨格/データ分離設計

- **分離原則**: 「何を実行するか」= データ、「実行の仕組み」= コード(骨格)。
- 骨格に残すもの: BT 実行セマンティクス (`bt.js`)、Blackboard、レジストリランタイム (`bt-registry.js` → `WendNodes` へ発展)、パラメータ記述子→ウィジェットの自動UIレンダラ、プロバイダ実行クラス、Storage/IPC/HTTP API、ツリーレンダラ。
- 外部データ化するもの: **ノードパック**(新規)、レシピ(既存)、ウィザード、サンプルパイプライン、言語ファイル。
- **ノードパック JSON スキーマ**(本設計の核): `packFormat`/`id`/`version`/`requires` + `nodes[]`。各ノードは `type`、多言語 `label`、`category`、`ports.in/out`(型付き)、`params[]`(型・default・`ui` ウィジェットヒント)、`impl`、`compat`(既存 `btAction`/`btLocalFilePath` 等レガシーフィールドへの `paramMap` で後方互換)。
- **impl の4階層**(信頼境界の設計):
  1. `builtin` — 本体登録済みハンドラ名を参照。既存11アクションを `frontend/nodepacks/wend.core.json` として再宣言。
  2. `provider` — 純データ。プロバイダ+レシピ+プロンプトテンプレート+customParams 宣言。ComfyUI ワークフロー JSON を `customParams.workflow` に埋め込めば(`providers/comfyui.js:15-22` で既対応)任意の ComfyUI ワークフローが配布可能な型付きノードになる。**AI が自律改善する主対象**。
  3. `pipeline` — プリミティブ演算(template/regex/jsonpath/math/http/bbRead/bbWrite/branch)の合成。eval なし・構造的に安全。AI 作成可。
  4. `module` — パック同梱 JS ファイル。初回にユーザー同意ダイアログ必須、パックマネージャで明示表示。
- **発見機構**: `main.js:308` の `custom_providers` スキャンと同じパターンで `%APPDATA%/Wend/nodepacks/*/pack.json` + 同梱 `frontend/nodepacks/` をスキャン、JSON Schema 検証、`reload_node_packs` でホットリロード。
- **AI 自律改善ループ**: MCP ツール `list_node_packs` / `get_node_pack` / `validate_node_pack` / `save_node_pack`(module 種は設定フラグなしでは MCP から保存拒否)。実行ログ観察→パック取得→テンプレート改善→検証→保存→再実行、の閉ループを記述。
- パラメータ記述子→ウィジェット対応表(text/textarea/prompt/number/slider/select/checkbox/file/bbkey/json/choices)。値は `node.btParams` バッグに集約、`compat.paramMap` で旧フィールドと相互変換。

### 2. `designdoc/graph-node-design.md` — 演算ノード(BTリーフ内サブグラフ)設計

- **方式決定の根拠**: BT=制御フロー(retry/selector/human-in-the-loop)、グラフ=データフロー(型付き変換連鎖)。ComfyUI には制御フローがなく、n8n は型が弱い — 両取りが差別化。フル DAG エディタ移行・型付き blackboard 単独案は却下(理由も記載)。
- **型システム** (`wend-types.js` 想定): `text`/`number`/`boolean`/`json`/`filepath`/`media`(+ `media/image|audio|video`)/`any`。代入可否ルール + 自動 coercion 表(text→number、filepath→media は既存 `fileToMedia` 再利用、等)。ランタイム値は既存 slot 形状 `{text|media|data}` + 型タグ = blackboard スロットと同一構造。
- **グラフスキーマ**: `btAction: "graph"` のリーフが `btGraph: { nodes[], edges[], inputs[], outputs[] }` を保持。グラフノード型は**ノードパックレジストリと共通**(1定義が BT リーフとしてもグラフノードとしても使える)。境界の `inputs[].bbKey` / `outputs[].bbKey` でのみ blackboard に接続、内部は明示エッジ。
- **実行エンジン設計** (`graph-engine.js` 想定、~300行): Kahn トポロジカルソート、保存時サイクル検証、入力充足ノードの `Promise.all` 並列実行、グラフ全体が1つの BT リーフとして success/failure を返す → 既存デコレータ(retry 等)がそのまま巻ける。`_runNode` 変更ゼロ。
- **エディタ段階論**: まず headless(構造化ダイアログ + MCP ツールで編集 — エージェントにキャンバス不要)、次に同梱済み `frontend/lib/cytoscape.min.js` によるモーダルキャンバス(ポート付きノード、型検証付きエッジ作成)。
- **既存リーフへの型適用**: パック定義からポート型を導出し、ツリー walk で bb 書込/読出をシミュレートする warn-only lint (`validate_tree`)。レガシーツリーは絶対にブロックしない。

### 3. `designdoc/node-api-spec.md` — 拡張ノード API 仕様

- **登録ライフサイクル**: 起動時スキャン → スキーマ検証 → `requires` 解決 → `WendNodes` 登録 → module 種は同意記録チェック。実行中ツリーは旧定義で完走。
- **`window.WendNodes` API**: `registerPack` / `registerHandler` / `get` / `byCategory` / `validateParams` / `apiVersion`。既存 `window.btActions` は薄い後方互換ファサードとして維持。
- **ctx コントラクト v1**: 現行 ctx (`bt.js:1027-1032`) のスーパーセット。`{ apiVersion, node, path, params, inputs, io.read/write, bb.*, log.*, signal(AbortSignal), services: { http, file, provider, ui.manual } }` + レガシーエイリアス維持。**module 種ハンドラには raw `app`/`bt` を渡さない**(builtin のみ)— これが API の信頼境界。
- **粒度の細かい MCP ツール群**(現状 `create_bt` 全置換のみの欠陥を解消): `get_bt` / `add_node` / `update_node` / `remove_node` / `move_node` / `set_param` / `list_node_types` / `describe_node_type` / `validate_tree` / グラフ系 `graph_add_node` / `graph_connect` / `graph_set_io` / パック系4種。エージェントの増分編集ワークフロー例を記載。
- バージョニング方針: メジャー内は加算的変更のみ。

### 4. `designdoc/roadmap-and-product.md` — ロードマップ + プロダクト戦略

- **即修正すべき既知バグ/未完成**(Phase 1 冒頭に列挙): ① `bt_invoke_command` バックエンドハンドラ追加(`child_process.execFile` + タイムアウト + `allowCommandExecution` 設定、クライアント側タイムアウトも追加し「応答なしでハング」を構造的に排除)、② `filepath` 入力型のランタイム対応(`_runAI` で path→media 解決)、③ `typeToAction` マップ重複排除(`bt.js:957`/`984`)、④ パッケージから `style.css.bak`・`test-b3-*.html` 除外、⑤ behavior3js レイヤは**コンバータ専用と宣言**し bt.js を唯一のエンジンと文書化。
- **段階的モジュール分割**(バンドラ不要、`<script>` 追加抽出): app.js → op-pane.js / tree-model.js / ipc.js / run-context.js、main.js → storage.js / runner.js / http-api.js / bt-bridge.js。
- **5フェーズロードマップ**: P1 基盤(スキーマ+wend.core パック+自動UI+バグ修正+MCP 粒度API)→ P2 データ定義ノード(provider/pipeline 種+パックマネージャ+`.wendpack` 入出力)→ P3 型システム+lint → P4 グラフノード(headless→cytoscape キャンバス、ComfyUI ラッパーパックをショーケースに)→ P5 分割・electron-builder クロスプラットフォーム・配布。全フェーズで既存ツリー完全互換。
- **率直なプロダクト評価**: ComfyUI(メディア生成グラフ)/n8n・Dify(業務自動化)/LangFlow(LLMチェーン試作)と機能競争では勝てない。Wend 固有の強み: ① **制御フローが第一級**(retry・fallback・human-in-the-loop — 「判断と再試行ができるエージェントパイプライン」は空白ニッチ)、② **MCP ネイティブ**(エージェントが IDE 自体を操作・改善できる)、③ **日本ローカル AI エコシステム対応**(VOICEVOX/LM Studio/ComfyUI — 日本のローカル AI コミュニティが到達可能な初期ユーザー層)。
- **普及の障害(深刻度順)**: Windows 限定 → 共有ループ不在(パック/レシピ/パイプラインの交換フォーマット・チャネルなし)→ ドキュメントサイト・デモ GIF 不在 → 一行ポジショニング不明確。**共有ループが戦略の要**: `.wendpack` エクスポート/インポート + GitHub トピック (`wend-pack`) ベースのアプリ内ブラウザ(サーバーコスト0、初期 ComfyUI Manager 方式)+ ファーストパーティパック10個で種まき。ポジショニング候補: 「リトライし、分岐し、人に尋ねられる、ローカルファーストの AI パイプライン IDE」。

## 実施手順

1. 4ドキュメントを上記構成で `designdoc/` に執筆(既存 `designdoc/wend-app.md` 等とトーンを揃える。既存docsは日英混在だが今回は日本語主体+スキーマ/コードは英語)。
2. `designdoc/wend-app.md` は変更しないが、新ドキュメント側から「wend-app.md の Win32/WebView2 記述は旧世代」と明記して参照関係を整理。
3. README との整合: 変更せず、roadmap 文書内に「README に反映すべき事項」節を設ける。

## 検証

- コード変更なし(ドキュメントのみ)のため、検証は整合性レビュー:
  - 文書中の全ファイルパス・行番号参照が実コードと一致するか(`bt.js:950-1101`、`app.js:9600-9874`、`main.js:308`/`4575-4637` 等)を Grep で確認。
  - ノードパックスキーマ例が既存11アクション(`bt-actions.js`)のフィールドを漏れなく `compat.paramMap` で表現できているか突き合わせ。
  - `sample/radio/03-simple-flow/radio.json` を新スキーマの後方互換ルールで読めるか机上トレース。