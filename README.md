# 🚀 Browser AI Copilot - Production-Grade Chrome Extension

A sophisticated, autonomous AI agent Chrome extension that reasons about web pages, understands user intents, and takes intelligent browser actions with **human-in-the-loop safety gates**. Built with a ReAct (Reason + Act) loop, Vue.js UI, and Node.js LLM proxy backend.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Design Decisions](#key-design-decisions)
4. [Project Structure](#project-structure)
5. [Setup Instructions](#setup-instructions)
6. [Running Locally](#running-locally)
7. [Demo Reproduction Guide](#demo-reproduction-guide)
8. [Implementation Status](#implementation-status)
9. [Testing](#testing)
10. [Trade-offs & Limitations](#trade-offs--limitations)
11. [Future Enhancements](#future-enhancements)

---

## 🎯 Overview

**Browser AI Copilot** is a Chrome extension that acts as an intelligent agent for web automation. Unlike traditional chatbots, it:

- ✅ **Reasons autonomously** using a ReAct (Reason + Act) loop
- ✅ **Understands pages** via Accessibility Tree extraction (token-efficient)
- ✅ **Takes actions** (click, fill, extract data) with real browser events
- ✅ **Requires approval** for destructive actions (human-in-the-loop safety)
- ✅ **Supports multi-turn conversations** with full context awareness
- ✅ **Shows thinking in real-time** via a transparent reasoning window
- ✅ **Handles errors gracefully** with retry logic and degradation

### Real-World Use Cases

| Use Case | Example |
|----------|---------|
| **Summarization** | "Summarize this news article" |
| **Data Extraction** | "Extract all products from this table as JSON" |
| **Form Filling** | "Fill this form with sample data" |
| **Multi-Step Workflows** | "Find the most expensive product, click it, and extract details" |
| **Content Generation** | "Draft a professional reply to this LinkedIn message" |
| **Question Answering** | "What are the key metrics on this dashboard?" |

---

## 🏗️ Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chrome Browser                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   Vue.js UI      │  │ Service Worker   │  │   Content    │  │
│  │   (Sidebar)      │◄─►  (Agent Logic)  │◄─►  Script      │  │
│  │                  │  │  (ReAct Loop)    │  │ (DOM Tools)  │  │
│  │  • Chat          │  │                  │  │              │  │
│  │  • Reasoning     │  │  • Message       │  │  • read_page │  │
│  │  • Approval      │  │    routing       │  │  • click     │  │
│  │  • Error State   │  │  • Tool dispatch │  │  • fill      │  │
│  └──────────────────┘  │  • State persist │  │  • extract   │  │
│                        │  • Retry logic   │  │  • sanitize  │  │
│                        └──────────────────┘  └──────────────┘  │
│                             │                                    │
│                             │ (HTTP: 127.0.0.1:3000)             │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Node.js Backend   │
                    │  (Express Server)  │
                    │                    │
                    │  • LLM Gateway     │
                    │  • API Streaming   │
                    │  • Config mgmt     │
                    │  • Health checks   │
                    │                    │
                    │  PORT: 3000        │
                    └────────┬───────────┘
                             │
                    ┌────────▼──────────┐
                    │  LLM API          │
                    │  (OpenAI/Claude)  │
                    │  (Server-side     │
                    │   keys only!)      │
                    └───────────────────┘
```

### Information Flow: ReAct Loop

```
User Input
    │
    ▼
┌──────────────────────────┐
│ 1. Read Page             │ ◄── Perception
│    (Accessibility Tree)  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ 2. Call LLM              │ ◄── Thinking
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
           │ 4. Check if      │ ◄── Safety Gate
           │ Destructive?     │
           │ (click submit,   │
           │  delete, etc.)   │
           └─────┬──────┬─────┘
                 │      │
                 │      └─► Show Approval Modal
                 │          (Wait for user)
                 │
                 ▼
           ┌──────────────────┐
           │ 5. Execute Tool  │ ◄── Action
           │    (DOM action)  │
           └─────┬────────────┘
                 │
                 ▼
           Tool Result ─────┐
                            │
                            ▼
           Add to Chat History
                 │
                 ▼
           [Loop back to step 2]
           OR stop if max iterations
```

---

## 🧠 Key Design Decisions

### 1. **Accessibility Tree vs. Raw DOM**

**Decision:** Use Accessibility Tree for page perception

**Why:**
- ✅ **Token-efficient**: Typically 60-70% fewer tokens than raw DOM
- ✅ **Semantically rich**: Captures intent (button vs. link vs. heading)
- ✅ **LLM-friendly**: Aligns with how LLMs understand interfaces
- ✅ **Robust**: Tolerates CSS/layout changes

**Implementation:**
```javascript
// Extracts semantic structure, not raw HTML
{
  url: "https://example.com",
  elements: [
    { 
      id: "elem_0",
      tagName: "button",
      text: "Submit",
      ariaLabel: "Send form",
      selector: ".btn-submit"
    }
  ],
  forms: [{ fields: [...], submitButtons: [...] }],
  tables: [{ headers: [...], rows: [...] }],
  links: [{ text: "...", href: "..." }]
}
```

### 2. **Token Budget Management**

**Strategy:**
1. Prioritize **visible viewport elements** first
2. Summarize **off-screen** elements as `[... N more items]`
3. Limit **tables** to headers + first 5 rows
4. Use **sliding window** for conversation (last 10 messages + summary)
5. Truncate **text content** to max available tokens

**Impact:** Keeps page context under 3,000 tokens while preserving actionability

### 3. **ReAct Loop with Explicit Iterations**

**Design:**
- Structured JSON response format enforces agent discipline
- Max 10 iterations (configurable) prevents infinite loops
- Real-time feedback shows user what agent is thinking/doing
- Each iteration is a clear state transition

```json
{
  "thought": "User wants to extract products. I should read the page first.",
  "action": "read_page",
  "action_input": { "focus_area": "table.products" },
  "answer": null
}
```

### 4. **Human-in-the-Loop (HITL) Approval Gate**

**Safety Rules:**
- Destructive actions (submit, delete, click "buy") require explicit approval
- Modal shows **what**, **why**, **risk level**, and **expected side effects**
- User can approve/reject each action in real-time
- Timeout after 2 minutes (prevents blocking user workflows)

**Benefits:**
- ✅ Prevents unintended form submissions
- ✅ Protects against malicious prompts
- ✅ Maintains user control over critical actions
- ✅ Builds trust in autonomous automation

### 5. **Stateless Backend, Stateful Extension**

**Backend (Node.js):**
- ✅ **Stateless**: Only pipes LLM API calls, no data stored
- ✅ **Configurable**: LLM provider/model can change via API
- ✅ **Secure**: API keys remain server-side, never leaked to frontend

**Extension:**
- ✅ **Stateful**: Persists agent state via `chrome.storage.local`
- ✅ **Resilient**: Resumes from last known state if Service Worker restarts
- ✅ **Offline-aware**: Can show clear offline state if backend unavailable

---

## 📁 Project Structure

```
browser-ai-copilot/
├── apps/
│   ├── extension/                          # Chrome Extension
│   │   ├── src/
│   │   │   ├── ui/
│   │   │   │   ├── Popup.vue               # Main Vue.js component
│   │   │   │   └── popup.js                # Entry point
│   │   │   ├── content/
│   │   │   │   └── content-script.js       # DOM tools & perception
│   │   │   ├── background/
│   │   │   │   ├── service-worker.js       # MV3 SW entrypoint (importScripts)
│   │   │   │   ├── agent/                  # ReAct loop + fallbacks
│   │   │   │   ├── workflows/              # Form workflows
│   │   │   │   ├── tools/                  # Tool executor + approvals
│   │   │   │   ├── llm/                    # LLM proxy client
│   │   │   │   ├── core/                   # config/state/ui/tabs helpers
│   │   │   │   ├── intents.js              # intent routing helpers
│   │   │   └── tools/
│   │   │       ├── tool-registry.js        # Tool definitions
│   │   │       ├── sanitizer.js            # DOMPurify wrapper
│   │   │       └── token-budget.js         # Context optimization
│   │   ├── public/
│   │   │   ├── popup.html                  # UI shell
│   │   │   ├── icon-16.png                 # Extension icons
│   │   │   ├── icon-48.png
│   │   │   └── icon-128.png
│   │   ├── manifest.json                   # MV3 manifest
│   │   └── package.json
│   │
│   └── backend/                            # Node.js Express Proxy
│       ├── server.js                       # Express server (LLM + forms plan)
│       └── package.json
│
├── tests/
│   ├── unit/
│   │   └── agent.test.js                   # ReAct loop tests
│   ├── integration/
│   │   └── backend.test.js                 # Backend proxy tests
│   ├── e2e/
│   │   └── playwright.config.js            # E2E config
│   └── fixtures/
│       └── ecommerce.html                  # Products table + contact form + reply textarea
│
├── demo/
│   ├── demo-video.md                       # Demo recording guide
│   └── demo-script.md                      # Exact reproduction steps
│
├── .env.example                            # Configuration template
├── package.json                            # Root workspace config
└── README.md                               # This file
```

---

## ⚙️ Setup Instructions

### Prerequisites

- Node.js 18+ 
- npm 9+
- Chrome browser (for extension testing)
- OpenAI API key (or Claude API key for Anthropic)

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/yourusername/browser-ai-copilot.git
cd browser-ai-copilot

# Install dependencies (uses npm workspaces)
npm run install:all

# Or manually:
npm install
npm install --workspace=apps/extension
npm install --workspace=apps/backend
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# LLM_PROVIDER=openai
# LLM_MODEL=gpt-4
# OPENAI_API_KEY=sk-xxxxxx...
# PROXY_HOST=127.0.0.1
# PROXY_PORT=3000
```

### 3. Build Extension

```bash
# Build Vue.js UI and assets
npm run build --workspace=apps/extension

# Or in watch mode (development):
npm run dev --workspace=apps/extension
```

---

## 🏃 Running Locally

### Option 1: Development Mode (Recommended)

**Terminal 1 - Start Backend**
```bash
npm run dev:backend
# Expected output:
# ✓ LLM Provider initialized: openai
# ╔════════════════════════════════════════════════╗
# ║  Browser AI Copilot Backend                    ║
# ║  Listening on port 3000                        ║
# ║  Provider: openai                              ║
# ║  Model: gpt-4                                  ║
# ╚════════════════════════════════════════════════╝
```

**Terminal 2 - Load Extension**
```bash
# Open Chrome
open -a "Google Chrome"

# Go to: chrome://extensions/
# Enable "Developer mode" (top right)
# Click "Load unpacked"
# Select: browser-ai-copilot/apps/extension
```

**When you change the UI code**
```bash
# Rebuild the extension UI bundle
npm run build --workspace=apps/extension

# Then in chrome://extensions click "Reload" on the extension
```

**Optional: UI dev server (preview only)**
```bash
# Runs a standalone preview at http://localhost:5173/public/popup.html
# (Chrome extension still uses the built files, not this server)
npm run dev --workspace=apps/extension
```

### Option 2: Production Build

```bash
# Build all
npm run build

# Start backend
npm run start --workspace=apps/backend

# Load extension from dist/public in Chrome
```

---

## 📝 Demo Reproduction Guide

### Demo Scenario 1: Single-Step Summarization

**Setup:**
1. Navigate to any news article or blog post (e.g., https://en.wikipedia.org/wiki/Artificial_intelligence)
2. Open the AI Copilot extension (puzzle icon in top right)

**Steps:**
1. Type: `"Summarize this page in 2-3 sentences"`
2. Click `Send`
3. **Observe:**
   - Reasoning window shows: "I should read the page first"
   - Action: `read_page`
   - Extension extracts page content
   - LLM generates summary
   - Chat shows result with tool badge: `🔧 read_page`

**Expected Output:**
```
✅ Summary of key points from the article
[Timestamp: 2:34 PM]
```

---

### Demo Scenario 2: Multi-Step Workflow

**Setup:**
- Open test fixture: `file:///path/to/tests/fixtures/ecommerce.html`
- This page has a product table with 5 products

**Steps:**
1. Type: `"Find the most expensive product, click on it, and extract its details"`
2. Watch the **Reasoning Window**:
   - Iteration 1: Thought: "I need to read the page to see products"
     - Action: `read_page` → Gets table data
   - Iteration 2: Thought: "Most expensive is '4K Monitor' at $599.99. I should click on it"
     - Action: `click_element` with selector for the "View Details" button
   - Iteration 3: Thought: "Now extract the product details"
     - Action: `extract_data` → Returns structured product info

3. Chat history shows:
   - User: "Find the most expensive product..."
   - Assistant with 3 tool badges: `🔧 read_page, click_element, extract_data`
   - Extracted JSON data of the product

**Expected JSON Output:**
```json
{
  "product": "4K Monitor",
  "price": "$599.99",
  "category": "Electronics",
  "stock": 5
}
```

---

### Demo Scenario 3: HITL Approval Gate

**Setup:**
- Open test fixture: `file:///path/to/tests/fixtures/ecommerce.html`

**Steps:**
1. Type: `"Fill out the contact form with sample data and submit it"`
2. **First Part (No Approval Needed):**
   - Agent reads page
   - Fills "Name" field with sample data
   - Fills "Email" field
   - Fills "Message" field
   - Chat shows `🔧 fill_input` badges for each field

3. **Second Part (Approval Required):**
   - Before clicking the "Submit Form" button, an **⚠️ Approval Modal** appears:
   ```
   ⚠️ Action Approval Required
   🔴 HIGH RISK
   
   Action: click_element - Submit Form
   Input Parameters:
   {
     "selector": "button[data-action='submit']",
     "description": "Submit form"
   }
   
   This action may have side effects. Review carefully.
   
   [❌ Reject]  [✅ Approve]
   ```

4. Click `Approve` → Form submits
5. Chat shows: `✅ Form submitted successfully`

---

### Demo Scenario 4: Error Recovery

**Setup:**
- Open test fixture

**Steps:**
1. Type: `"Click the button with id 'nonexistent'"`
2. **Error Handling:**
   - Agent tries to click non-existent element
   - Receives: `Error: Element not found: #nonexistent`
   - Automatically retries once
   - After retry fails, reports clearly to user:
     ```
     ❌ I tried to click the button but it wasn't found on the page. 
     The DOM may have changed or the selector is incorrect.
     ```

3. Chat shows error state with option to retry manually

---

## 🧩 What's Real vs. Mocked

- **Real**
  - Chrome extension (Manifest v3) side panel UI + background service worker + content script.
  - Page context extraction from the live DOM (forms/inputs/buttons/tables/text).
  - Tool execution via real browser events (`click_element`, `fill_input`) in the content script.
  - Backend LLM gateway (Node/Express) calling real provider APIs (OpenAI / Anthropic).
  - Human-in-the-loop approval gate for high-stakes clicks (submit/post/apply/send).
- **Not implemented / intentionally simplified**
  - True token streaming to the UI (the endpoint is JSON-over-HTTP; the UI shows phase/progress updates).
  - Visual understanding (no screenshots/OCR).
  - Robust, schema-guided extraction for arbitrary websites (current `extract_data` is heuristic-based for tables/lists).

---

## ✅ Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Core ReAct Loop** | ✅ Implemented | Full agent loop with iterations |
| **Perception (Accessibility Tree)** | ✅ Implemented | Token-efficient page extraction |
| **Tool Execution** | ✅ Implemented | read_page, click, fill, extract, draft, summarize |
| **LLM Integration** | ✅ Implemented | OpenAI (Claude/Gemini configurable) |
| **HITL Approval Gate** | ✅ Implemented | Modal approval for destructive actions |
| **Vue.js UI** | ✅ Implemented | Chat, reasoning window, approval modal |
| **Error Handling** | ✅ Implemented | Retry logic, timeout handling, graceful degradation |
| **State Persistence** | ✅ Implemented | chrome.storage.local for SW restarts |
| **Backend Proxy** | ✅ Implemented | Express server for LLM + form-plan endpoints (JSON) |
| **Unit Tests** | ✅ Implemented | Vitest (agent logic) |
| **Integration Tests** | ✅ Implemented | Jest + Supertest (backend routes) |
| **E2E Tests** | 🟡 Scaffolded | Playwright scenarios included (environment-dependent) |
| **Demo Video** | 🟡 Scaffolded | Recording guide provided |
| **Documentation** | ✅ Complete | Comprehensive README with diagrams |

**Legend:** ✅ = Complete | 🟡 = Scaffolded/Partial | ❌ = Not implemented

---

## 🧪 Testing

### Unit Tests (ReAct Loop, Tools)

```bash
npm run test:unit

# Tests include:
# ✓ Agent loop guardrails (iteration limits, finalization)
# ✓ Response parsing behavior (JSON / fallback)
```

### Integration Tests (Backend Proxy)

```bash
npm run test:integration

# Tests include:
# ✓ LLM endpoint
# ✓ Retry endpoint (JSON-only enforcement)
# ✓ Health check
# ✓ Config update
# ✓ Forms plan endpoint
# ✓ Error handling (missing params)
```

### End-to-End Tests (Full Workflows)

```bash
npm run test:e2e

# Scenarios:
# 1. Single-step summarization on real page
# 2. Multi-step workflow (find → click → extract)
# 3. HITL approval gate interaction
# 4. Error handling & recovery
```

---

## 📊 Trade-offs & Limitations

### Token Budget Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Accessibility Tree** (chosen) | Semantic, efficient | Loses some visual context |
| **Full DOM** | Complete visual info | Token-heavy, LLM confusion |
| **Screenshot + OCR** | Visual fidelity | Expensive, slow, unreliable |

### Iteration Limits

- **Max 10 iterations** (configurable): Prevents infinite loops but may fail on very complex tasks
- **Solution:** User can break multi-step task into smaller goals

### Latency

- **LLM call**: 2-5 seconds (depends on provider)
- **Tool execution**: <500ms typically
- **Total per iteration**: 3-6 seconds
- **For 3-step task**: ~10-20 seconds

### Browser Limitations

- ✅ Works in Chrome/Edge (MV3)
- ❌ Cannot access cross-origin pages (security restriction)
- ❌ Cannot interact with OS dialogs or native popups
- ⚠️ Slow on very large DOM trees (>10K elements)

### LLM Constraints

- **Context window**: 4K (GPT-4) or 100K (Claude) - we use ~3K for page
- **Rate limits**: Subject to API provider quotas
- **Costs**: $0.01-0.03 per request (depending on provider/model)

---

## 🚀 Future Enhancements

### Phase 2: Advanced Features

- [ ] **Screenshot + OCR fallback** for visual-only content
- [ ] **Custom tool creation** (user-defined tools via UI)
- [ ] **Workflow recording** (record manual actions, replay with agent)
- [ ] **Integration with APIs** (REST/GraphQL calls as tools)
- [ ] **Multi-tab coordination** (agent works across tabs)

### Phase 3: Enterprise Features

- [ ] **Audit logging** (track all agent actions for compliance)
- [ ] **Admin dashboard** (manage organization settings, costs)
- [ ] **Prompt templates** (pre-built prompts for common tasks)
- [ ] **Advanced analytics** (usage patterns, ROI)

### Phase 4: Community

- [ ] **Open-source marketplace** for custom tools/agents
- [ ] **Community templates** shared workflows
- [ ] **Integration with popular services** (Zapier, IFTTT, etc.)

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 💬 Questions?

- 📖 See [ARCHITECTURE.md](ARCHITECTURE.md) for deep dives
- 🐛 [Submit issues](https://github.com/yourusername/browser-ai-copilot/issues)
- 💡 [Discussions](https://github.com/yourusername/browser-ai-copilot/discussions)

---

**Built with ❤️ for web automation enthusiasts**
