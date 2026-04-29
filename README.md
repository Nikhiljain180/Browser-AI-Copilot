# Browser AI Copilot

A Chrome extension that acts as an intelligent agent for web automation. It uses a ReAct (Reason + Act) loop, Vue.js UI, and a Node.js LLM proxy backend to reason about web pages, understand user intents, and perform browser actions with a human-in-the-loop safety gate.

## Features

- **Autonomous execution:** Uses a ReAct loop to reason and act on web pages.
- **Efficient perception:** Extracts and uses the Accessibility Tree instead of raw DOM for token efficiency.
- **Safe interactions:** Requires explicit user approval for destructive actions (e.g., submitting forms, deleting items).
- **Multi-turn conversations:** Maintains context awareness across interactions.
- **Dual-Mode Intelligence:** Automatically routes between direct informational answers and tool-based action loops.
- **LLM Agnostic:** Supports OpenAI and Anthropic models via a unified backend proxy.

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

### Least-Privilege Manifest (Optional)

The default `apps/extension/manifest.json` uses `<all_urls>` host permissions so the content script can run automatically.

If you want a stricter, interview-friendly setup that relies only on `activeTab`, use `apps/extension/manifest.least-privilege.json`:

1. Replace `apps/extension/manifest.json` with the least-privilege file (or copy its contents over).
2. Reload the extension in `chrome://extensions/`.

In this mode the extension injects `src/content/content-script.js` on-demand (via `chrome.scripting.executeScript`) when the agent first needs page context.

## Testing

```bash
# Run unit tests (agent logic)
npm run test:unit

# Run backend integration tests
npm run test:integration

# Run E2E tests (Playwright)
npm run test:e2e
```

## License

MIT License. See `LICENSE` for details.
