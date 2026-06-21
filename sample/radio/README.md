# Radio Behavior Tree Samples

A collection of Behavior Tree (BT) samples demonstrating the "Radio" workflow:
**fetch music info, create an article, and log the broadcast**.

Each sample is a loadable JSON node tree file that can be opened directly in the Wend app via **Project > Open BT**, or loaded remotely via the **MCP server**.

---

## Project Structure

Radio samples use a dedicated project named `samples/radio` for isolated storage.

**Note:** The project name contains a slash (`/`), which creates a nested folder structure:

```
<appData>/
└── projects/
    └── samples/
        └── radio/          ← project "samples/radio"
            ├── blobs/      ← generated media files
            ├── data/
            └── history/
```

This is intentional and works correctly. The nested structure keeps radio sample data separate from other projects.

When you open any `radio.json` file from `sample/radio/`, the app automatically switches to this project.

---

## Projects Root Folder

You can configure where all project data is stored:

1. Go to **Project > Projects Root Folder...**
2. Click **Browse...** to select a custom location
3. Click **Apply** to save
4. **Restart the app** for changes to take effect

If left empty, the default location (`%APPDATA%/Wend` on Windows) is used.

---

## Prerequisites

### Local Recipes

These samples use **4 local recipes** defined in `recipes.json`. When you open any sample file, these recipes are automatically loaded and merged into your recipe list.

| Recipe Name | Provider | Model | Purpose |
|-------------|----------|-------|---------|
| `Radio Music Fetcher` | gemini | gemini-2.5-flash | Fetch/summarize music metadata |
| `Radio Article Writer` | gemini | gemini-2.5-pro | Write radio DJ articles |
| `Radio Theme Generator` | gemini | gemini-2.5-flash | Generate creative themes |
| `Radio Log Writer` | gemini | gemini-2.5-flash | Summarize broadcast logs |

### Provider Configuration

Before running the samples, ensure you have configured the required provider in **Project > Providers > Configure...**:

- **Google Gemini** -- Required for all text generation (uses gemini-2.5-flash and gemini-2.5-pro)

---

## Samples Overview

| # | Sample | BT Pattern | Key Concept |
|---|--------|------------|-------------|
| 01 | [Basic Sequential](01-basic-sequential/) | `sequence` | Simple linear flow: Fetch → Write |
| 02 | [Parallel](02-parallel/) | `parallel` | Load local MP3 → Theme → [Describe ‖ Write] |
| 03 | [Simple Flow](03-simple-flow/) | `sequence` | Basic Fetch → Write |
| 04 | [Article Writing](04-article-writing/) | `sequence` | Fetch → Write |
| 05 | [Validate and Write](05-validate-and-write/) | `sequence` | Fetch → Validate → Write |
| 06 | [Local Music](06-local-music/) | `sequence` | Load local MP3 → Describe → Write |
| 07 | [Streaming](07-streaming/) | `sequence` | Fetch → Write → Log |
| 08 | [Continuous Station](08-continuous-station/) | nested `sequence` | 3× [Fetch → Write] |

---

## How to Load a Sample

### Via Wend App

1. Launch the Wend app
2. Go to **Project > Open BT...**
3. Navigate to `sample/radio/<sample-name>/radio.json`
4. Select the file and click **Open**
5. The node tree will load in a new tab
6. Local recipes are automatically loaded
7. Click **Run Tree** in the BehaviorTree menu to execute

### Via MCP Server

```javascript
// Load a sample
load_sample("D:/ws/Wend/sample/radio/01-basic-sequential/radio.json")

// Run the BT
run_bt("")

// Monitor progress
get_blackboard()
```

---

## Blackboard Key Convention

All samples use a consistent blackboard naming convention:

| Key | Type | Purpose |
|-----|------|---------|
| `music_info` | text | Song/artist/genre description |
| `music_audio` | media | Loaded audio file |
| `article` | text | Written article text |
| `topic` | text | Music theme/genre seed |
| `stream_info` | text | Now-playing metadata from API |
| `log` | text | Broadcast log |

---

## BT Node Configuration

Each leaf node in the samples has BT-specific settings configured in the **BT Settings** accordion:

### BT Action

- **Process Prompt** (default) -- Execute AI prompt with recipe
- **Load Local File** -- Load a local file into the blackboard

### For Process Prompt action:

- **BT Prompt** -- The prompt used during BT execution (supports `{bb:key}` placeholders)
- **Input Key** -- Blackboard key to read input from
- **Input Type** -- `text` or `media` (which blackboard slot to read)
- **Output Key** -- Blackboard key to write output to

### For Load Local File action:

- **Local File Path** -- Path to the file (relative to the .json file, or absolute)
- **Output Key** -- Blackboard key to store the loaded file

---

## Local File Loading

Samples 02 and 06 use the `loadLocalFile` BT action to load local audio files.

To use these samples:

1. Place an audio file (e.g., `music.mp3`) in the same directory as the `radio.json` file
2. Or update the `btLocalFilePath` in the node to point to your audio file

The loaded file is stored in the blackboard as a media attachment, which can then be used as input to other nodes.

---

## License

These samples are provided as-is under the MIT License.
