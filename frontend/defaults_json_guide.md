# Default Configuration Files Guide (`app*.json`)

This document provides schema specifications and generation guidelines for the default JSON configuration files located under `frontend/defaults/` in the Wend application. These guidelines can be fed directly to an AI to generate or extend these files.

---

## 1. `appconfig.json`

### Purpose
Seeds the default application settings. It defines basic settings like history retention limits, defaults for model selection, and the active visual theme.

### Schema Spec
A single JSON object:
* **`historyRetention`** (`integer`, default: `50`): The maximum number of past execution histories (runs) retained per project.
* **`defaultProvider`** (`string`): The ID of the default provider (matches an `id` field in `appproviders.json`, e.g., `"openai"`).
* **`defaultModel`** (`string`): The default model identifier (can be empty).
* **`theme`** (`string`): The default visual theme (e.g., `"dark"`, `"light"`, `"blue"`, `"green"`, `"mono"`).

### Example
```json
{
    "historyRetention": 50,
    "defaultProvider": "openai",
    "defaultModel": "",
    "theme": "dark"
}
```

---

## 2. `appproviders.json`

### Purpose
Contains the master registry of API providers. It defines endpoints, format types, request/polling logic, and capability tags which govern the UI's badges and selectors.

### Schema Spec
A JSON array of provider objects. Each object contains:
* **`id`** (`string`, required): Unique identifier for the provider (e.g., `"openai"`, `"gemini"`, `"replicate"`).
* **`label`** (`string`, required): User-facing display name.
* **`defaultUrl`** (`string`): The default base URL endpoint.
* **`defaultApiPath`** (`string`): The default endpoint route path (can contain `{model}` for dynamic path substitution).
* **`defaultFormat`** (`string`): The formatter used by the backend wrapper (e.g. `"openai"`, `"anthropic"`, `"gemini"`, `"replicate"`).
* **"formatLabel"** (`string`): Description of the formatted output protocol.
* **`apiType`** (`"simple" | "polling"`):
  * `"simple"`: Direct synchronous request returning a payload.
  * `"polling"`: Triggers a job and polls an endpoint periodically for completion.
* **`input`** (`array of strings`): Supported input modalities. Options include: `"text"`, `"image"`, `"audio"`, `"video"`.
* **`output`** (`array of strings`): Supported output modalities. Options include: `"text"`, `"image"`, `"audio"`, `"video"`.
* **`maxOutputs`** (`integer`, optional): Max outputs generated in parallel by this provider.
* **`description`** (`string`): Brief explanation of capabilities.

### AI Generation Tips
When generating a new provider, make sure:
1. The **`defaultFormat`** matches a supported parser in the backend.
2. The **`input`** and **`output`** list matches the physical modal capabilities to enable visual helper badges.

---

## 3. `apprecipes.json`

### Purpose
Seeds predefined execution templates (recipes). Recipes contain standard API prompts, models, parameters, and commands that users can instantly load into step nodes.

### Schema Spec
A JSON array of recipe objects. Each object contains:
* **`name`** (`string`, required): Unique descriptive name for the recipe.
* **`type`** (`"ai" | "command"`):
  * `"ai"`: Sends a request to an LLM / generation model.
  * `"command"`: Spawns a local operating system command.
* **`provider`** (`string`): Matches a provider `id` from `appproviders.json` (empty if `type` is `"command"`).
* **`model`** (`string`): Model name identifier (e.g., `"gpt-4o-mini"`, `"gemini-3.1-flash-image"`).
* **`temperature`** (`number`): Floating-point value from `0.0` to `2.0` indicating output randomness.
* **`systemPrompt`** (`string`): Base context instruction injected into the system instruction block.
* **`command`** (`string`): CLI execution string (only if `type` is `"command"`).
* **`useCustomApiPath`** (`boolean`): If `true`, overrides the provider's default API path with the recipe's local `apiPath`.
* **`apiPath`** (`string`): Route path used if `useCustomApiPath` is `true`.
* **`apiType`** (`"simple" | "polling"`): Requests execution protocol.
* **`customParams`** (`object`): Key-value arguments passed into the JSON payload body. Supported params depend on the provider type:
  * **`aspectRatio`** (`string`): E.g., `"1:1"`, `"16:9"`, `"5:4"`.
  * **`imageSize`** (`string`): E.g., `"1K"`, `"2K"`.
  * **`responseModalities`** (`array of strings`): E.g., `["TEXT", "IMAGE"]`.
  * **`tools`** (`array of objects`): E.g., `[{"google_search": {}}]` for Google Search grounding.
  * **`file_data`** (`object`): E.g., `{"file_uri": "youtube_url"}` for Youtube context insertion.

### AI Generation Prompt Template
Use the following prompt to generate additions to `apprecipes.json`:
> "Add a new AI recipe object to `apprecipes.json` for provider `{provider_id}`.
> Name: `{recipe_name}`
> Model: `{model_id}`
> Modality: `{T2T | T2I | I2I | V2I | Grounding | TTS | Music}`
> If Image-to-Image (I2I), make sure to specify target custom parameters `aspectRatio` and `imageSize`.
> If Grounding, add the search tool block inside `customParams` and request both TEXT and IMAGE in `responseModalities`.
> Ensure all custom paths and endpoints follow appropriate API route overrides."
