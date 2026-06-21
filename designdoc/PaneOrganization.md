# Pane Organization (Node View Mode)

## Layout

```
| ツリー (200px) | 演算 (flex:1) | 入力 (flex:1) | 出力 (flex:1) |
|                |               |               |               |
|─────────────────────────────────────────────────────────────────|
| メッセージ (150px, resize可)                                     |
```

## Pane Content by Selection State

| 選択状態 | 演算(prompt) | 入力(input) | 出力(output) |
|---------|-------------|-------------|-------------|
| **未選択** | 空 | 空 | 空 |
| **Opのみ** | Op内容（テンプレート編集） | `tempInputAttachments` のテキストエリア＋添付ファイル（編集可） | 実行履歴（linked） |
| **Dataのみ** | 元Op内容（編集可、originalOpNodeに連動） | `dataNode.input`（読取専用テキストエリア）＋`dataNode.inputAttachments`（snapshot添付ファイル） | Data出力＋添付ファイル |
| **Combined** | Op内容（テンプレート編集） | **Opのみと同じ表示**（Data出力が `tempInputAttachments` に pre-filled） | **実行履歴（linked）** |

## `tempInputAttachments` データモデル

Opノードに付随する一時入力データ。実行まで有効で、実行後にクリアされる。

```javascript
opNode.tempInputAttachments = {
  text: "入力テキスト",   // テキストエリアの内容
  files: [                // 入力用添付ファイル（旧 inputAttachments）
    { file: "...", mimetype: "...", content: "...", size: ... }
  ]
}
```

### ライフサイクル

```
Opノード選択 → tempInputAttachments が存在すればその内容を表示
              なければ空のテキストエリア
                ↓
Combined に入る → Dataノードの出力を tempInputAttachments に上書きコピー
                ↓
ユーザーが編集 → onTempContentInput() で随時保存
                ↓
「▶ 処理実行」 → delete node.tempInputAttachments（クリア）
```

## Selection State Logic

```javascript
// Defined in app.js
state.selectedOpPath    // path of selected operation node, '' when none
state.selectedDataPath  // path of selected data node, '' when none
```

Four states:
- **None**: `selectedOpPath === '' && selectedDataPath === ''`
  - All three panes show nothing
- **Op only**: `selectedOpPath !== '' && selectedDataPath === ''`
  - input: `tempInputAttachments.text` in editable textarea + `tempInputAttachments.files`
  - output: linked run history
- **Data only**: `selectedOpPath === '' && selectedDataPath !== ''`
  - input: data node's `input` field or `pipelineMeta.steps[0].input` (read-only)
  - output: data node output content + attachments
- **Combined**: `selectedOpPath !== '' && selectedDataPath !== ''`
  - input: falls through to op-only path (after copying data output to `tempInputAttachments`)
  - output: linked run history

### Tree Node Sizing, Styling & Color Invariants

- **Sizing Layout**:
  - Tree Pane width is `200px` (`min-width: 120px` in `style.css`).
  - Messages/Log Pane height is `150px` (`min-height: 80px` in `style.css`).
- **DOM Styling Classes**:
  - Selected Op Node gets `.selected` (Green: `#1a6b2a`) and `.current-op` (underlined with left-border).
  - Selected Data Node gets `.selected-data` (Orange: `#8a5a1a`) and `.current-data` (underlined with left-border).
  - Completed nodes get `.completed` (Dark Green: `#1a4f1a`).
- **Test / Class Invariants**:
  - The runtime validation `checkNodeColorInvariants()` and tests in `test.js` ensure that color classes (`selected`, `selected-data`, `selected-linked`, `selected-input`, `selected-result`) are appropriately assigned and that data and op node colors do not cross-contaminate.

## Key Functions

### `renderInput()`

```
if (viewMode === 'pipeline')      → renderPipelineInput()
else if (no selection)            → clear pane
else if (combined)                → _copyDataOutputToTempInput(dataNode, opNode)
                                     inputData = opNode.tempInputAttachments.text
                                     → fall through to op-only rendering path
else if (data only)               → show dataNode.input (readonly textarea)
                                   + dataNode.inputAttachments (snapshot)
                                   → return (separate rendering, no fallthrough)
else if (op only)                 → inputData = node.tempInputAttachments.text
                                     → fall through to common rendering

// Common rendering (op-only / combined fallthrough):
srcPath = isCombined ? selectedOpPath : (selectedOpPath || currentPath)
srcNode = getNodeByPath(srcPath)
ti = srcNode.tempInputAttachments || {}
textarea (editable, oninput → onTempContentInput)
   + tempInputAttachments.files display
```

### `_copyDataOutputToTempInput(dataNode, opNode)`

```
1. Extract output text from dataNode:
   - pipelineMeta.steps[last].output (優先)
   - atob(dataNode.content) (fallback)
2. Extract output files:
   - pipelineMeta.steps[last].outputAttachments (優先)
   - dataNode.attachments (fallback)
3. opNode.tempInputAttachments = { text: outputText, files: outputFiles }
4. saveCurrentTab()
```

### `renderOutput()`

```
if (viewMode === 'pipeline') → renderPipelineOutput()
else if (no selection)       → clear pane
else if (op only)            → renderLinkedRunHistory(linkedRuns, false)
else if (combined)           → renderLinkedRunHistory(linkedRuns, false)
else if (data only)          → show data node output + run selector dropdown
else (default)               → fallback logic using currentNodePath
```

### `renderPrompt()`

```
if (viewMode === 'pipeline')      → renderPipelinePrompt()
else if (no selection)            → clear pane
else                              → resolve promptNodePath = selectedOpPath || currentNodePath
                                    if promptNodePath is data node and has originalOpNode:
                                        resolve node = node.originalOpNode
                                    show resolved node content (editable textarea)
                                    + recipe settings & selector
                                    + machine attachments (node.attachments)
```

### `onTempContentInput(value)`

```javascript
node.tempInputAttachments.text = value
saveCurrentTab()
```

### `toggleLinkedDetail(idx, section)`

```javascript
const el = document.getElementById(`linked-${section}-${idx}`)
if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
```

DOM 直接操作、再描画なし。

## History

- 2026-06-13: Initial combined mode pane assignment.
- 2026-06-13: Rev 2 — Combined mode now copies data output to `opNode.tempInputAttachments` and shows editable textarea (falls through to op-only path). Removed `_renderDataOutputContent()`. Removed `node.inputAttachments[]` in favor of `node.tempInputAttachments: { text, files }`. Added `_copyDataOutputToTempInput()`, `onTempContentInput()`, `toggleLinkedDetail()`. Unlinked run history cards: collapsed send/recv toggles + save/discard/chest buttons in card header.
- 2026-06-13: Rev 3 — Fixed combined fallthrough: `inputData` now set from `opNode.tempInputAttachments.text`, attachment source uses `srcPath` resolving to op node instead of `currentNodePath`. Data-only mode split to independent rendering (readonly textarea, `dataNode.inputAttachments` snapshot).
- 2026-06-13: Rev 4 — Updated documentation to align with source code details (editable prompt on data node selection, single-quotes to backticks correction in `toggleLinkedDetail`, and detailed tree node selection styling classes and invariants).
