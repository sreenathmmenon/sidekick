# Sidekick Browser Extension Surface

This is the Sidekick **Browser Extension Surface** for Chrome/Edge-compatible Manifest V3 browsers.

It is a thin client. It does not own memory, ranking, commitments, lessons, or planning. It sends current-page context to the **Local Companion** and reads capability outputs from the same shared local brain as the Memory Console and Editor Surface.

## What It Does

- Captures the active browser tab as a `WorkContextEvent`.
- Reads the active page DOM when allowed, so capture can include page title, H1, selected text, and page excerpt.
- Infers basic event kind from URL:
  - GitHub -> `reviewing_pr`
  - Jira/Linear -> `opened_ticket`
  - everything else -> `read_doc`
- Shows active Focus Session state.
- Starts or completes a Focus Session.
- Calls all five capabilities:
  - **Resume**
  - **Triage**
  - **Commitments**
  - **Recall**
  - **Plan**

## Run

1. Start the Local Companion:

```bash
cd ../companion
SIDEKICK_TOKEN=dev-local-token npm start
```

2. Open Chrome or Edge extension settings.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select `sidekick/browser-extension`.
6. Open the Sidekick extension popup.
7. Set:

```text
Companion URL: http://127.0.0.1:4317
Token: dev-local-token
```

## Product Role

The browser extension is for in-the-flow web work: GitHub, Jira/Linear, docs, Outlook, Teams, Confluence, Notion, and other browser-based tools.

The Memory Console remains the inspection/control surface. The Browser Extension Surface is for capture and lightweight action while browsing.
