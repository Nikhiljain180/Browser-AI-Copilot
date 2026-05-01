# Browser AI Copilot

A Chrome extension that acts as an intelligent agent for web automation. It uses a ReAct (Reason + Act) loop, Vue.js UI, and a Node.js LLM proxy backend to reason about web pages, understand user intents, and perform browser actions with a human-in-the-loop safety gate.

## Features

- **Autonomous execution:** Uses a ReAct loop to reason and act on web pages.
- **Efficient perception:** Extracts and uses the Accessibility Tree instead of raw DOM for token efficiency.
- **Safe interactions:** Requires explicit user approval for destructive actions (e.g., submitting forms, deleting items).
- **Multi-turn conversations:** Maintains context awareness across interactions.
- **Dual-Mode Intelligence:** Automatically routes between direct informational answers and tool-based action loops.
- **LLM Agnostic:** Supports OpenAI and Anthropic models via a unified backend proxy.

## Implementation Status (mapped to assignment requirements)

| Requirement | Status | Where |
|---|---|---|
| Manifest v3 Chrome extension | ✅ Done | [`apps/extension/manifest.json`](apps/extension/manifest.json) |
| Content scripts for DOM interaction | ✅ Done | [`apps/extension/src/content/`](apps/extension/src/content/) |
| Node.js backend | ✅ Done — stateless LLM proxy | [`apps/backend/server.js`](apps/backend/server.js) |
| Vue.js sidebar/chat UI | ✅ Done | [`apps/extension/src/ui/Popup.vue`](apps/extension/src/ui/Popup.vue) |
| Multi-turn conversation with page context | ✅ Done | Chat history kept client-side, page context re-read each turn |
| `read_page` tool | ✅ Real | Accessibility-tree snapshot of live DOM |
| `click_element` tool | ✅ Real | Synthetic click compatible with React/Vue/Angular |
| `fill_input` tool | ✅ Real | Native prototype setter so React-controlled inputs persist |
| `extract_data` tool | ✅ Real | Tables / lists / role-tagged regions, sanitized text output |
| `draft_reply` tool | ✅ LLM-authored, deterministic fallback | See "Tool Design" section |
| `summarize_page` tool | ✅ Real | LLM summarizes trimmed main-region text |
| Separation of chat / agent / browser layers | ✅ Done | Vue UI ↔ service worker (ReAct loop, modular under `src/background/`) ↔ content script |
| Human-in-the-loop on destructive actions | ✅ Done | `click_element` submit/delete and similar are gated; risk level + description shown in modal |
| Multi-step task (read → think → act → re-read) | ✅ Done | ReAct loop in [`src/background/agent/`](apps/extension/src/background/agent/) |
| Single-retry on tool failure | ✅ Done | [`tool-executor.js`](apps/extension/src/background/tools/tool-executor.js) |
| Unit / integration / E2E tests | ✅ Done | Vitest + Playwright |

## Architecture

The system is engineered for maximum privacy and performance. It is split into a stateful Chrome Extension and a stateless Node.js backend proxy. 

**Crucially: Page context always stays client-side.** The backend only pipes requests to the LLM and streams the response back. No user data, DOM content, or chat history is stored on the backend.

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Chrome Browser                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   Vue.js UI      │  │ Service Worker   │  │   Content    │  │
│  │   (Sidebar)      │◄─►  (Agent Logic)  │◄─►  Script      │  │
│  │                  │  │  (ReAct Loop)    │  │ (DOM Tools)  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                             │                                    │
│                             │ (HTTP: 127.0.0.1:3000)             │
└─────────────────────────────┼────────────────────────────────────┘
                              ▼
                    ┌────────────────────┐
                    │  Node.js Backend   │
                    │  (Express Server)  │
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │  LLM API           │
                    │  (OpenAI/Claude)   │
                    └────────────────────┘
```

### The ReAct Loop

For action-oriented tasks, the autonomous agent follows a strict ReAct (Reason + Act) loop, making intelligent decisions at every step.

```text
User Request
    │
    ▼
┌──────────────────────────┐
│ 1. Read Page             │ ◄── Perception (Content Script)
│    (Accessibility Tree)  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ 2. Call LLM              │ ◄── Thinking (Service Worker -> Backend)
│    (Reason about goal)   │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ 3. Parse Response        │ ◄── Decision Making
│    (JSON, tool select)   │
└──────┬───────────────────┘
       │
       ├─► final_answer? ──► Return to user
       │
       └─► Tool Action?
               │
               ▼
           ┌──────────────────┐
           │ 4. Safety Gate   │ ◄── HITL Approval for Destructive actions
           └─────┬────────────┘
                 │
                 ▼
           ┌──────────────────┐
           │ 5. Execute Tool  │ ◄── Action (Content Script)
           └─────┬────────────┘
                 │
                 ▼
           [Loop back to step 2]
```
For action-oriented tasks, the agent follows this sequence:
1. **Read Page**: Extract current accessibility tree.
2. **Call LLM**: Reason about the goal based on page context.
3. **Decision**: Select a tool (e.g., `click_element`, `fill_input`) or return a `final_answer`.
4. **Safety Check**: If the tool is destructive, block and request user approval.
5. **Execute**: Run the action via content scripts and loop back to step 1.

## Project Structure

```
browser-ai-copilot/
├── apps/
│   ├── extension/       # Chrome Extension (Vue.js, Manifest v3)
│   └── backend/         # Node.js Express Server for LLM proxy
├── tests/               # Unit, Integration, and E2E tests
├── demo/                # Demo assets and scripts
├── .env.example
└── package.json
```

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm 9+
- OpenAI or Anthropic API key

### Installation

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/yourusername/browser-ai-copilot.git
cd browser-ai-copilot
npm run install:all
```

2. Configure environment variables:
```bash
cp .env.example .env
```
Edit `.env` to include your API keys and provider preferences. Supported providers are `openai` (e.g., `gpt-4`) and `anthropic` (e.g., `claude-3-opus`).

### Build

```bash
# Build the Chrome extension UI
npm run build --workspace=apps/extension
```

## Running Locally

1. **Start the Backend Proxy:**
```bash
npm run dev:backend
```
The server will start on port 3000.

2. **Load the Extension in Chrome:**
- Open Chrome and navigate to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked" and select `browser-ai-copilot/apps/extension`

## Tool Design — What's Real vs. Fallback

The agent exposes six tools to the LLM. All DOM interactions are real. The table below makes the implementation honest about which tool has a deterministic fallback path and why.

| Tool | Implementation | Notes |
|---|---|---|
| `read_page` | Real | Builds an accessibility-tree snapshot from the live DOM. |
| `click_element` | Real | Resolves by `agentId` or CSS selector and dispatches a synthetic click compatible with React/Vue/Angular. |
| `fill_input` | Real | Sets `.value` and dispatches `input` + `change` events so framework state updates. |
| `extract_data` | Real | Walks tables / lists / role-tagged regions and returns structured rows. |
| `summarize_page` | Real | Returns trimmed `innerText` from the main content region; the LLM does the actual summarization upstream. |
| `draft_reply` | **LLM-authored by default, deterministic template fallback** | See below. |

### `draft_reply` — honest scope

The LLM composes the reply text and passes it as `action_input.draft`. The content-script tool inserts that string into the target field and dispatches the framework events. This is the path the agent takes on every well-formed call.

If — and only if — the LLM omits `draft`, the tool falls back to a tone-aware scaffold built by [`buildFallbackDraftReply`](apps/extension/src/content/content-script.js#L668). The fallback is intentionally bounded:

- It echoes only the `context` string the agent already supplied (truncated to 280 chars, whitespace-collapsed).
- It picks an opener from `{casual, formal, professional}`.
- It never invents names, facts, or specifics — there is no second LLM call.

This trade-off is deliberate: a deterministic fallback is provably hallucination-safe, whereas a hidden retry-with-LLM path would be silent and unauditable. The fallback exists for resilience during the demo, not as the primary behavior.

## Permissions & Security

The extension ships with two manifests so the trade-off between agent capability and least-privilege is explicit:

| File | Host permissions | Content scripts | Use when |
|---|---|---|---|
| `manifest.json` (default) | `<all_urls>` | Auto-injected at `document_start` | You want the full autonomous agent experience |
| `manifest.least-privilege.json` | none — `activeTab` only | Injected on-demand via `chrome.scripting` | You need the strictest possible permission surface |

### Why the default uses `<all_urls>`

`<all_urls>` is **not** a convenience choice — it is required for the agent behavior described in this assignment. Specifically:

1. **Persistent observation of dynamic content.** Modern targets (LinkedIn, CRMs, dashboards, SPAs) render most of their meaningful DOM after initial paint and continue mutating it as the user navigates client-side routes. The content script must be present from `document_start` to attach `MutationObserver`s, capture late-rendered forms, and keep an up-to-date accessibility tree. `activeTab` only grants a transient, per-gesture permission — every new SPA route would lose context.

2. **Multi-step agent flows.** The ReAct loop reads the page, acts, and reads again. Between iterations the page often re-renders (new modal, route change, AJAX-loaded panel). With `activeTab` alone, the second read can fail or return stale state because the original grant has lapsed. `<all_urls>` keeps the tool surface stable across the entire task.

3. **Continuity across tabs.** A multi-step task ("extract leads from this page, then draft an email in Gmail") spans tabs. `activeTab` is scoped to the tab the user clicked the action on; `<all_urls>` lets the agent follow the workflow.

### Compensating controls

Broad host permissions are mitigated by the safety architecture, not waved away:

- **Page context never leaves the client.** The Node.js backend is a stateless LLM proxy — it sees prompts, not DOM. No data, no chat history, no tool results are persisted server-side.
- **Human-in-the-loop gate on destructive actions.** Submits, deletes, navigations, and any tool flagged destructive require explicit user approval in the sidebar before execution.
- **Tool-bounded actions.** The agent can only invoke the four declared tools (`read_page`, `click_element`, `fill_input`, `extract_data`) plus `draft_reply` / `summarize_page`. There is no generic JS execution path from the LLM.
- **Local-only backend.** The proxy binds to `127.0.0.1:3000` and is not exposed to the network.

### When to switch to the least-privilege manifest

Use `manifest.least-privilege.json` if your threat model cannot tolerate `<all_urls>` and you accept the UX cost: the agent only activates when the user clicks the extension action on the current tab, and dynamic-content observation is bounded to that grant. Most multi-step tasks still work; long-running observation and cross-tab flows do not.

To switch:

1. Replace `apps/extension/manifest.json` with the contents of `manifest.least-privilege.json`.
2. Reload the extension in `chrome://extensions/`.

The agent code path automatically falls back to on-demand injection via `chrome.scripting.executeScript` when no declarative content script is present.

## Trade-offs & Known Limitations

### Privacy boundary — be precise

The backend is a stateless proxy: nothing is persisted, no logs of prompts or DOM. *However*, every LLM call necessarily transmits the page-context snapshot the agent extracted, because that's what the model reasons over. "Page context stays client-side" is true relative to *our* infrastructure — it is not a claim about the third-party LLM provider. Treat the LLM provider as a trust boundary you've explicitly opted into, same as any other AI feature.

### Why an accessibility-tree snapshot, not raw DOM?

Raw DOM blows the context window and includes layout-only nodes the agent doesn't need. The content script walks the page and emits an accessibility-flavoured tree (text, role, label, computed selector, agentId) that is:

- ~10–20× smaller in tokens than the equivalent serialized DOM
- Stable across re-renders (agentIds survive minor mutations)
- Hallucination-resistant (the LLM picks from a finite list of agentIds, not invented selectors)

Trade-off: heavily-canvas or shadow-DOM apps may render features the tree can't describe. For those, the agent will report what it can see and ask for guidance rather than invent.

### Pre-LLM intent shaping (`src/background/intents.js`)

Keyword helpers like `isFormFillGoal` / `isStructuredExtractionGoal` exist but **do not bypass the LLM** — they shape which page-context slice and tool hints get included in the prompt. The LLM still chooses tools and produces actions. This is a latency/cost optimization for the most common assignment use cases (form fill, lead extraction). A production version would replace it with a tiny classifier model or a structured first-pass LLM call; the current approach is documented as a deliberate scope choice rather than hidden routing.

### `draft_reply` fallback

Covered in the Tool Design section above: LLM-authored by default, with a deterministic, hallucination-safe template fallback if the LLM omits the `draft` field. The fallback never invents facts.

### Content-script architecture

The content layer is split into focused modules loaded in manifest order: `core/` (sanitizer, registry, selector, utils, token-budget), `observers/navigation.js`, `tools/` (one file per tool), and a thin `content-script.js` entry point (~54 lines) that only wires the message listener. This avoids cross-file ordering bugs at `document_start` while keeping each concern independently readable and testable.

### Backend `server.js`

Single-file Express server (~625 lines) carrying routes, prompts, and provider adapters. Functional and tested, but a production version would split into `routes/`, `services/providers/`, `services/prompts/`. Deferred for the same reason.

### Out of scope (intentionally)

- No OAuth or user accounts — the extension is single-user, local.
- No long-term memory across browser sessions beyond chat history in `chrome.storage`.
- No iframe traversal — content script runs in the top frame only.
- No streaming UI on the chat side (responses arrive fully formed; ReAct progress updates do stream).

## Testing

```bash
# Run unit tests (agent logic — Vitest)
npm run test:unit

# Run backend integration tests (Jest + ts-jest)
npm run test:integration

# Run E2E tests (Playwright)
npm run test:e2e

# Run all tests (backend + extension)
npm test
```

## License

MIT License. See `LICENSE` for details.
