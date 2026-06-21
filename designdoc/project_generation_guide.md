# Project Workspace & Pipeline Generation Guide

This document defines the schema, serialization rules, and generation guidelines for creating new Wend project workspaces and prompt pipelines. This guide is designed to help an AI automatically generate ready-to-run prompt flows, manifests, and local recipes.

---

## 1. Project Directory Structure
A complete, distributable project package (e.g., a sample directory) follows this layout:
```text
<project-folder>/
├── manifest.json            # Project identification details
├── projectrecipes.json      # Local recipes specific to this project
└── <tab-name>.json          # One or more tab pipeline node files
```

---

## 2. Project Manifest (`manifest.json`)
Defines the user-facing metadata of the prompt package.

### Schema
```json
{
  "projectName": "string (alphanumeric unique identifier, e.g. 'sales_helper')",
  "displayName": "string (formatted display title, emojis allowed)",
  "description": "string (brief summary of the workflow)"
}
```

---

## 3. Project-Specific Recipes (`projectrecipes.json`)
Defines custom models, prompts, or scripts locally scoped to this project. It has the same format as `apprecipes.json`.

### Example
```json
[
  {
    "name": "Custom Analyzer",
    "type": "ai",
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.3,
    "systemPrompt": "You are a technical analyst...",
    "command": "",
    "useCustomApiPath": false,
    "apiPath": "/chat/completions",
    "apiType": "simple",
    "customParams": {}
  }
]
```

---

## 4. Pipeline Nodes File (`<tab-name>.json`)
This file defines the interactive prompt trees that render in the application's left Tree Pane and execute sequentially or in parallel.

### ⚠️ CRITICAL RULE: Base64 Encoding
To prevent character encoding errors, JSON injection, and prompt formatting breakage:
* **`title`** MUST be base64-encoded.
* **`btPrompt`** MUST be base64-encoded.

*Example:* 
* Title `"Fetch Music Info"` → base64 `"RmV0Y2ggTXVzaWMgSW5mbw=="`
* Prompt `"Search for songs"` → base64 `"U2VhcmNoIGZvciBzb25ncw=="`

### Schema of Nodes
The file starts with a **Root Node** object:
* **`title`** (`string`, base64): The name of the tab node (usually empty `""` for root).
* **`content`** (`string`): Markdown text content of the node (usually empty `""` for root).
* **`mimetype`** (`string`, default: `"text/plain"`): Modal type of content.
* **`attachments`** (`array`, default: `[]`): Attached media objects.
* **`nodeType`** (`string`): Set to `"root"`.
* **`btType`** (`"sequence" | "parallel" | "selector"`): Execution format:
  * `"sequence"`: Runs children nodes one by one.
  * `"parallel"`: Runs children concurrently.
  * `"selector"`: Runs children in order until one succeeds.
* **`children`** (`array of Node objects`): Step/operation nodes.

#### Children Nodes (Operations/Steps)
Inside the `children` array, you place step nodes. Each step node has:
* **`nodeType`** (`string`): Usually `"assemble"` (represents an operation node that sends prompt templates).
* **`title`** (`string`, base64, required): The label of the step shown in the Tree Pane.
* **`btPrompt`** (`string`, base64, required): The actual template prompt. Variables can be inserted using the syntax `{bb:key_name}`.
* **`selectedRecipe`** (`string`, required): Name of the recipe (from global `apprecipes.json` or `projectrecipes.json`) used to execute this step.
* **`btInputKey`** (`string`, optional): The blackboard key from which the step consumes inputs.
* **`btInputType`** (`"text" | "media"`, default: `"text"`): The type of input expected.
* **`btOutputKey`** (`string`, optional): The blackboard key to write the model output to.

### Example Tab Node Tree File (`radio.json`)
```json
{
  "title": "",
  "content": "",
  "mimetype": "text/plain",
  "attachments": [],
  "nodeType": "root",
  "btType": "sequence",
  "children": [
    {
      "title": "RmV0Y2ggTXVzaWMgSW5mbw==",
      "content": "",
      "mimetype": "text/plain",
      "attachments": [],
      "children": [],
      "nodeType": "assemble",
      "selectedRecipe": "Radio Music Fetcher",
      "btOutputKey": "music_info",
      "btPrompt": "U2VhcmNoIGZvciBhIHRyZW5kaW5nIG11c2ljIHRyYWNrLiBSZXR1cm4gdGhlIHRpdGxlLCBhcnRpc3QsIGdlbnJlLCBhbmQgYSBicmllZiBkZXNjcmlwdGlvbiBvZiB0aGUgbW9vZCBhbmQgc3R5bGUu"
    },
    {
      "title": "V3JpdGUgQXJ0aWNsZQ==",
      "content": "",
      "mimetype": "text/plain",
      "attachments": [],
      "children": [],
      "nodeType": "assemble",
      "selectedRecipe": "Radio Article Writer",
      "btInputKey": "music_info",
      "btInputType": "text",
      "btOutputKey": "article",
      "btPrompt": "V3JpdGUgYSAyMDAtd29yZCByYWRpbyBESiBhcnRpY2xlIGFib3V0IHRoZSBmb2xsb3dpbmcgbXVzaWM6IHtiYjptdXNpY19pbmZvfS4gSW5jbHVkZSBiYWNrZ3JvdW5kIGNvbnRleHQsIHdoeSBpdCBpcyB3b3J0aCBsaXN0ZW5pbmcgdG8sIGFuZCBhbiBlbmdhZ2luZyBpbnRyb2R1Y3Rpb24gZm9yIHJhZGlvIHBsYXliYWNrLg=="
    }
  ]
}
```

---

## 5. AI Prompt Instructions for generating Node Trees
When asking an AI to generate a pipeline, provide this instruction block:
> "Generate a Wend application tab node tree JSON. 
> 1. Determine a step-by-step workflow for `{task_goal}`.
> 2. Create the root node with `"btType": "sequence"`.
> 3. Add children nodes with `"nodeType": "assemble"`.
> 4. Ensure you specify `"selectedRecipe"`, `"btInputKey"`, and `"btOutputKey"` for input-output data flow using `{bb:key_name}` variable interpolation in prompts.
> 5. Convert all titles and `btPrompt` prompts to base64 encoding before writing the JSON. Do not include raw string values for these keys."
