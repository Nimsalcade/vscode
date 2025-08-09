# SWE Agent (VS Code Extension)

A side-panel AI SWE agent with full codebase context and edit/apply capabilities.

## Features
- Activity bar view with chat UI (open with Cmd/Ctrl+K then Cmd/Ctrl+A)
- Reads and writes files via WorkspaceEdits
- Preview diffs before applying changes
- Configurable model provider, base URL, and model name

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build:
   ```bash
   npm run compile
   ```
3. Press F5 in VS Code to run the extension.

## Configuration
- `sweAgent.provider`: `openai` | `anthropic` | `ollama` | `custom`
- `sweAgent.apiKey`: API key for your provider
- `sweAgent.baseUrl`: Optional custom base URL
- `sweAgent.model`: Model name (e.g., `gpt-4o-mini`, `claude-3.5-sonnet`, `llama3.1:70b`)

## Security
- By default, the agent previews edits. Enable `sweAgent.allowDirectApply` only if you trust automated edits.