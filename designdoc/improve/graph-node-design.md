# 演算ノード設計 — BT リーフ内データフローサブグラフ

> 対象バージョン: Wend 0.2 系以降 (roadmap Phase 3–4)
> 関連文書: [core-data-separation.md](core-data-separation.md), [node-api-spec.md](node-api-spec.md), [roadmap-and-product.md](roadmap-and-product.md)

## 1. 背景と方式決定

### 1.1 現状

Wend のノード間データ受け渡しは Blackboard の**文字列キー共有**のみである:

- ノード A が `btOutputKey="x"` に書き、ノード B が `btInputKey="x"` で読む。配線 = 離れた場所での文字列一致。
- 型の概念がなく、slot `{text, media[], data, reasoning}` のどのモダリティが入っているかは実行時の自動判定 (`bt.js` `_runAI`)。
- タイポや書き忘れは実行するまで分からない。ComfyUI 的な「ポートを線で繋ぐ」明示的データフローは存在しない。

### 1.2 検討した 3 方式と決定

| 方式 | 内容 | 評価 |
|---|---|---|
| (1) 型付き Blackboard のみ | 既存キーに型を付けて検証・lint。エッジは作らない | 安価で価値はあるが、キーは依然「離れた文字列一致」。ComfyUI 的配線 UX は得られない。**検証レイヤとして採用**(§6) |
| **(2) BT リーフ内サブグラフ** ✅ | BT ツリーはそのまま制御フロー担当。リーフノード 1 個の中に型付きポート+エッジのデータフローグラフを持たせる | **採用**。BT=制御・グラフ=データフローの分担が明確で、既存ツリーと完全互換 |
| (3) フル DAG エディタ移行 | ComfyUI 同様の自由配置キャンバスを主編集画面にする大改修 | 却下。ツリー UI と競合する第二の編集パラダイムになり工数大。BT という Wend の独自性が薄れ「劣化 ComfyUI」になる |

**方式 (2) を採用する根拠 — 分担が差別化になる:**

- **BT = 制御フロー**: retry / selector(フォールバック)/ ループ / human-in-the-loop(manual)/ FSM(leaf_next)。ComfyUI には実質的な制御フローがない(「良い結果が出るまでリトライ」が書けない)。
- **グラフ = データフロー**: 型付き変換の連鎖。n8n は型が弱く、Dify の分岐は浅い。
- 両方を持つツールは空白地帯であり、「リトライし、分岐し、人に尋ねられるパイプライン」という Wend のポジショニング([roadmap-and-product.md](roadmap-and-product.md) §5)の技術的裏付けになる。

## 2. 全体像

```
BT ツリー(制御フロー)                リーフ内グラフ(データフロー)
sequence
├─ leaf: processPrompt ──── bb["topic"]
├─ retry(3)
│   └─ leaf: graph ◄──────── btGraph ────────────────────────┐
│        inputs:  subject ← bb["topic"]                       │
│        ┌──────────┐      ┌──────────────┐                   │
│        │ template │─out─►│ comfy.sdxl   │─image─► outputs:  │
│        │          │      │ (provider種) │         image →   │
│        └──────────┘      └──────────────┘         bb["result"]
└─ leaf: pipelineOutput ── bb["result"]
```

- グラフ全体は **1 個の BT リーフ**(`btAction: "graph"`)。success/failure を返すので、retry / selector / decorator が**無変更で**グラフを巻ける。
- Blackboard との接続は**グラフ境界のみ**(`inputs[].bbKey` / `outputs[].bbKey`)。グラフ内部は明示エッジで、文字列キー一致は使わない。
- グラフノードの型定義は**ノードパックレジストリと共通**([core-data-separation.md](core-data-separation.md) §3)。ポートを持つパックノードはグラフノードとして、`bbDefault` ポートを持つものは BT リーフとしても使える — **1 定義で両文脈対応**。

## 3. 型システム (`frontend/wend-types.js`)

### 3.1 型一覧

```
text | number | boolean | json | filepath
media | media/image | media/audio | media/video
any
```

### 3.2 代入可否

1. 完全一致 → OK
2. `any` ↔ 任意の型 → OK
3. `media/x` → `media` → OK(サブタイプの upcast)
4. 登録済み coercion(自動変換アダプタ)があれば → OK(エッジ上に変換バッジ表示)

### 3.3 Coercion 表(自動挿入アダプタ)

| from → to | 実装 |
|---|---|
| `text` → `number` | parseFloat、NaN なら実行時エラー |
| `number` → `text` | String() |
| `json` → `text` | JSON.stringify |
| `text` → `json` | JSON.parse、失敗で実行時エラー |
| `text` → `filepath` | そのまま(パス文字列とみなす) |
| `filepath` → `media` | 既存 `fileToMedia` の IPC (`bt_load_local_file`) を再利用 |
| `media` → `filepath` | 既存 `mediaToFile` の IPC (`bt_media_to_file`) を再利用 |

### 3.4 ランタイム値表現

**Blackboard スロットと同一構造 + 型タグ**とする。新しい値コンテナは作らない:

```js
// TypedValue
{ type: 'media/image', slot: { text: '', media: [ {content, mimetype, file} ], data: null } }
```

これにより境界での bb 読み書きが無変換で済み、既存の `bbWrite(key, value, scope, field)` / `_bbReadText` / `_bbReadMedia` をそのまま使える。

## 4. グラフスキーマ(保存形式)

`btAction: "graph"` のリーフノードが `btGraph` を保持する。既存ツリーフォーマットの**加算的スーパーセット**であり、旧バージョンの Wend はこのリーフを未知アクションとして扱うだけで壊れない。

```jsonc
{
  "btAction": "graph",
  "btGraph": {
    "nodes": [
      { "id": "g1", "type": "wend.core.template",
        "params": { "template": "photo of {in:subject}" }, "pos": [40, 80] },
      { "id": "g2", "type": "wend.comfy.sdxl",
        "params": { "steps": 30 }, "pos": [280, 80] }
    ],
    "edges": [
      { "from": ["g1", "out"], "to": ["g2", "prompt"] }
    ],
    "inputs":  [ { "name": "subject", "type": "text",        "bbKey": "topic" } ],
    "outputs": [ { "name": "image",   "type": "media/image", "bbKey": "result", "scope": "run" } ]
  }
}
```

- `nodes[].type` はノードパックの `type` を参照。`params` はパックの `params` 記述子で検証。`pos` はキャンバスエディタ用(headless 実行では無視)。
- `edges[].from/to` は `[nodeId, portName]`。保存時に型検証(§3.2)とサイクル検証を行う。
- `inputs` / `outputs` はグラフの外部インターフェース。`bbKey` で Blackboard に接続(scope は既存の run/tab/project/chest)。

## 5. 実行エンジン (`frontend/graph-engine.js`, 想定 ~300 行)

```
run(btGraph, ctx):
  1. 検証: 参照ノード型の存在、エッジ型整合、Kahn 法でトポロジカルソート(サイクル → 即失敗)
  2. inputs[] を bbKey から読み、TypedValue 化して境界値 Map に投入
  3. ready-set 実行ループ:
     - 全入力ポートが充足したノードを Promise.all で並列実行
       (ComfyUI 同様の並列性が自動で得られる。requestId ベースの既存
        コールバック機構 bt.js `_pendingCallbacks` を再利用し並行安全)
     - 各ノードの実行 = WendNodes ハンドラ呼び出し(ctx はグラフモード:
       inputs = Map<port, TypedValue>、io.write(port, value) — node-api-spec.md §3)
     - 結果を Map<"nodeId.port", TypedValue> に格納、coercion はエッジ通過時に適用
  4. ノード失敗 → グラフ全体を failure で終了(部分結果は破棄。
     リトライ戦略は外側の BT デコレータに委ねる — 二重にリトライ機構を持たない)
  5. outputs[] を bbKey に bbWrite → BT リーフとして success を返す
```

**`bt.js` への変更は最小**: `graph` は `wend.core` パックの builtin アクションとして登録するため、`_runLeaf` → `_runAction` の既存ディスパッチに乗る。**`_runNode` の変更はゼロ**。stop 時は ctx の AbortSignal で実行中ノードに中断を伝播する。

## 6. 既存 BT リーフへの型適用(方式 (1) の lint レイヤ)

グラフを使わない従来のリーフにも型の恩恵を与える:

- パック定義のポート型から、各リーフの `btInputKey` / `btOutputKey` の期待型を導出。
- `validate_tree`(MCP ツール兼アプリ内検証、[node-api-spec.md](node-api-spec.md) §4): ツリーを walk し、BT の実行順序に沿って bb への書き込み/読み出しをシミュレート。以下を警告:
  - 一度も書かれないキーの読み出し(タイポ検出)
  - 型不一致(text を期待するポートに media キー、等)
  - どこからも読まれない書き込み(デッドデータ)
- **warn-only**。レガシーツリーの実行は絶対にブロックしない。警告はツリーペインのバッジ + Messages ペインに表示。

## 7. エディタ — 段階導入

### Phase A: Headless(キャンバスなしで出荷)

- グラフの作成・編集は **MCP ツール**(`graph_add_node` / `graph_connect` / `graph_set_io` — [node-api-spec.md](node-api-spec.md) §4)と、操作ペインの**構造化ダイアログ**(ノードリスト + エッジリスト + 入出力表のフォーム編集)で行う。
- AI エージェントにはキャンバスは不要 — JSON と検証 API があれば十分。「エージェントが組み、人が眺めて微調整する」という Wend の使われ方に合致し、実行エンジンの安定化を UI 開発から切り離せる。
- 実行時はグラフ内部の進行状況を Messages/Tasks ペインにノード単位で表示。

### Phase B: キャンバスエディタ

- **同梱済みの `frontend/lib/cytoscape.min.js` を使用**(現在未使用。新規依存の追加なし)。
- モーダル(または出力ペイン差し替え)で開くキャンバス: パックノードのパレット、ポートスタブ付きノード箱、ドラッグでエッジ作成。
- エッジ作成時に `wend-types.js` で検証: 不可なら赤で拒否、coercion 可なら変換バッジ付きで許可。
- ノード選択でパラメータ編集 — [core-data-separation.md](core-data-separation.md) §4 の**自動 UI レンダラをそのまま再利用**(操作ペインとキャンバスで同一コード)。

## 8. ショーケース: ComfyUI ラッパーパック

導入価値を示す最初の実例として、first-party パック `wend.comfy` を作る:

- provider 種ノード数個(txt2img / img2img / upscale 等)。各ノードは `customParams.workflow` に ComfyUI ワークフロー JSON を内蔵し、`{param:steps}` 等でパラメータを露出。
- ユーザーは ComfyUI 側の API フォーマット書き出しをパックに貼るだけで自作ワークフローをノード化できる。
- 「BT でリトライ/人間判断を巻いた ComfyUI 生成」= 両ツールの良いとこ取りのデモになる。
