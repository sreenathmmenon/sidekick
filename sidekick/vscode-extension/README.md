# Sidekick Editor Surface

This is the Sidekick **Editor Surface**, implemented as a VSIX-compatible extension.

Product language should call this the **Editor Surface**, not only the VS Code extension. The current adapter works in VS Code-compatible editors such as VS Code, Cursor, Windsurf, VSCodium, and other VS Code extension-host compatible environments.

It is a thin client. It captures editor context and asks the **Local Companion** for Sidekick capabilities. It does not own memory or reasoning.

## What It Does

- Captures edited files as `WorkContextEvent` records.
- Captures active file changes as `opened_file` context signals.
- Shows capability answers in Markdown panels:
  - **Resume**
  - **Triage**
  - **Commitments**
  - **Recall**
  - **Plan**
- Starts and completes Focus Sessions.
- Shows Focus Session state in the status bar.
- Treats active editor changes as ambient work signals, not just edits.

## Run

1. Start the Local Companion:

```bash
cd ../companion
SIDEKICK_TOKEN=dev-local-token npm start
```

2. Open `sidekick/vscode-extension` in VS Code or a VSIX-compatible editor.
3. Set workspace settings:

```json
{
  "sidekick.companionUrl": "http://127.0.0.1:4317",
  "sidekick.authToken": "dev-local-token"
}
```

4. Press `F5` to launch an Extension Development Host.
5. Edit a workspace file.
6. Use the command palette:

```text
Sidekick: Where was I?
Sidekick: What needs me now?
Sidekick: What did I promise?
Sidekick: What did I learn?
Sidekick: What's realistic today?
Sidekick: Start Focus Session
Sidekick: Complete Focus Session
Sidekick: Show Captured Events
```
