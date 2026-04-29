# 🚀 Browser AI Copilot - Production-Grade Chrome Extension

A sophisticated, autonomous AI agent Chrome extension that reasons about web pages, understands user intents, and takes intelligent browser actions with **human-in-the-loop safety gates**. Built with a ReAct (Reason + Act) loop, Vue.js UI, and Node.js LLM proxy backend.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Dual-Mode Intelligence](#dual-mode-intelligence)
4. [LLM Output Contract](#llm-output-contract)
5. [Key Design Decisions](#key-design-decisions)
6. [Tool & Action Design](#tool--action-design)
7. [Project Structure](#project-structure)
8. [Setup Instructions](#setup-instructions)
9. [LLM Configuration](#llm-configuration)
10. [Running Locally](#running-locally)
11. [Error Handling & Resilience](#error-handling--resilience)
12. [Demo Reproduction Guide](#demo-reproduction-guide)
13. [Implementation Status](#implementation-status)
14. [Testing](#testing)
15. [Trade-offs & Limitations](#trade-offs--limitations)
16. [Future Enhancements](#future-enhancements)

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

## 🎯 Dual-Mode Intelligence

The agent intelligently chooses between two flows based on the user's query:

### **Flow 1: Informational Mode** (Direct Answer)
**When:** User asks for page analysis, summaries, or questions about page content

**Example Prompts:**
- "Summarize this page"
- "What are the key metrics on this dashboard?"
- "List all products with their prices"

**Agent Behavior:**
1. Extract page context (Accessibility Tree)
2. Call LLM with page context already in system prompt
3. LLM responds with `action: "final_answer"` immediately
4. Return answer to user in 1-2 seconds

**Why This Matters:** Page context is already provided to the LLM in the system prompt. There's no need for a tool call loop—just ask, get answer, done. This is **fast and efficient** for read-only queries.

```json
{
  "thought": "The user wants a summary. I have the page content in the system prompt already.",
  "action": "final_answer",
  "answer": "- Key Metric 1: 95% uptime\n- Key Metric 2: 2M active users\n- Key Metric 3: $50B market cap"
}
```

---

### **Flow 2: Action Mode** (ReAct with Tools)
**When:** User asks for DOM manipulation, form filling, clicking, extracting structured data, etc.

**Example Prompts:**
- "Fill this form with dummy data"
- "Click the 'Next' button and extract the product list"
- "Find the most expensive item and click on it"

**Agent Behavior:**
1. Read page context (Accessibility Tree)
2. Call LLM to decide next tool
3. Execute tool (click, fill, extract, etc.)
4. Observe result
5. Loop back to step 2 until `action: "final_answer"`
6. May take 10-30 seconds for multi-step tasks

**Why This Matters:** Actions require up-to-date DOM state. The agent loops, executes, and re-reads the page after each action to detect DOM changes (SPA navigation, lazy-loaded content, form responses, etc.).

```json
// Iteration 1
{
  "thought": "User wants to fill a form. I need to read the page first to see the form structure.",
  "action": "read_page",
  "action_input": {}
}

// Iteration 2
{
  "thought": "Now I see the form fields. I should fill them with sample data.",
  "action": "fill_input",
  "action_input": {"selector": "input[name='email']", "value": "user@example.com"}
}

// Iteration 3
{
  "thought": "Form filled. Now submit it.",
  "action": "final_answer",
  "answer": "✅ Form filled and ready. Tell me to submit if you want me to submit it."
}
```

---

### **Decision Logic**
The LLM **automatically detects the query type** from the system prompt instructions:
- "If the user's question can be answered from the page context already provided, respond immediately with `final_answer`."
- "Only use tools when you need to interact with the page or need updated/more specific page data."

**No hardcoded routing needed**—the LLM decides based on the request. ✨

---

## 📋 LLM Output Contract

Every response from the LLM **must** be valid JSON matching this exact schema:

```json
{
  "thought": "string — the agent's internal reasoning about the current state and what to do next (always provided)",
  
  "action": "string — the tool name to invoke, or 'final_answer' if task is complete
             Valid values: read_page | click_element | fill_input | extract_data | draft_reply | summarize_page | request_approval | final_answer",
  
  "action_input": {
    "description": "object — tool-specific parameters. Tool-specific keys depend on 'action'
                    Example for click_element: { 'selector': '#submit-btn', 'description': 'Submit form' }
                    Example for fill_input: { 'selector': '#email', 'value': 'test@example.com' }"
  },
  
  "answer": "string | null — the final natural-language response to the user
             Only populated when action = 'final_answer'
             Can be a single string or an array of bullet strings for readability
             Can include markdown formatting (links, emphasis, lists)"
}
```

### **Parsing Rules**

1. **Valid JSON:** If response is valid JSON, parse directly
2. **Malformed JSON:** Use regex fallback: `/\{[\s\S]*\}/` to extract JSON object
3. **Regex Extract Fails:** Log error, inform user ("I received an unexpected response from the AI. Retrying..."), retry once
4. **Retry Fails:** Display error clearly in chat and allow manual retry

### **Example Responses**

**Example 1: Read Page Tool**
```json
{
  "thought": "User asked about products. I need to read the page first to see them.",
  "action": "read_page",
  "action_input": { "focus_area": "table.products" },
  "answer": null
}
```

**Example 2: Direct Answer (Informational)**
```json
{
  "thought": "The user asked about page metrics. I can answer directly from the page context provided.",
  "action": "final_answer",
  "answer": "- **Conversion Rate:** 3.2%\n- **Avg Order Value:** $145\n- **Bounce Rate:** 42%"
}
```

**Example 3: Multi-Tool Sequence (Action Mode)**
```json
{
  "thought": "User wants to fill and submit a form. First, I should click the 'Edit' button to enable the form.",
  "action": "click_element",
  "action_input": { 
    "selector": "button[data-action='edit']",
    "description": "Enable form editing"
  },
  "answer": null
}
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

## � Tool & Action Design

### Tool Registry

The agent has access to 7 tools, each handling a specific task. Requests for destructive actions (form submit, delete, buy) trigger the HITL approval gate.

| Tool | Purpose | Parameters | Requires Approval |
|------|---------|------------|-------------------|
| **read_page** | Extract fresh page structure (Accessibility Tree) | `focus_area?` (CSS selector) | No |
| **click_element** | Click an element using stable selectors | `selector` (CSS), `description` (human text) | Yes* |
| **fill_input** | Fill form fields with framework-compatible events | `selector` (CSS), `value` (string) | No |
| **extract_data** | Extract structured data as JSON | `target` (selector), `schema?` (object) | No |
| **draft_reply** | Generate professional reply and auto-fill | `selector` (CSS), `context` (string), `tone?` | No |
| **summarize_page** | Concise summary of page content | `max_length?` (number) | No |
| **request_approval** | Pause execution for user approval | `action_description` (string), `risk_level` ("medium"\|"high") | N/A |

**\*Conditional:** `click_element` requires approval **only** if it's a destructive action (contains "submit", "send", "apply", "buy", "delete", etc.)

### Tool Selection Logic

The agent uses this logic to pick tools:

```
User Request
    ↓
[Informational? (summarize, explain, Q&A)]
    ├─→ YES: Return final_answer directly (no tools needed)
    └─→ NO: Continue to next step
         ↓
[Need updated page data?]
    ├─→ YES: Call read_page first
    └─→ NO: Use cached page context
         ↓
[Action required?]
    ├─→ click_element: User wants to interact (click, navigate)
    ├─→ fill_input: User wants to fill forms
    ├─→ extract_data: User wants structured data from page
    ├─→ draft_reply: User wants to compose and send reply
    └─→ summarize_page: User wants page summary
         ↓
[Is it destructive? (submit, post, send, delete, buy)]
    ├─→ YES: Call request_approval
    └─→ NO: Execute directly
         ↓
Execute tool → Observe result → Loop back to LLM
```

### Example Tool Sequences

**Example 1: Simple Extraction**
```
User: "Extract all products from this page"
        ↓
1. read_page
2. extract_data (target: "table.products")
3. final_answer (return structured JSON)
```

**Example 2: Multi-Step Workflow**
```
User: "Find the most expensive product, click on it, and get its details"
        ↓
1. read_page (scan all products)
2. click_element (click on "View Details" for expensive product)
3. read_page (updated page after click)
4. extract_data (get product details from new page)
5. final_answer (return structured product info)
```

**Example 3: Form Fill + Submit with HITL Gate**
```
User: "Fill out the contact form and submit it"
        ↓
1. read_page (inspect form structure)
2. fill_input (fill "Name" field)
3. fill_input (fill "Email" field)
4. fill_input (fill "Message" field)
5. request_approval (user clicks Submit button - HIGH RISK)
6. [USER APPROVES in modal]
7. click_element (submit button)
8. final_answer ("Form submitted successfully")
```

---

## �📁 Project Structure

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
│   │   │   │   └── (no starter prompts)    # prompt chips removed per requirements
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

## 🔑 LLM Configuration

The extension supports **multiple LLM providers** and can be reconfigured at runtime without code changes.

### Supported Providers

| Provider | Model(s) | Default | Cost | Context |
|----------|----------|---------|------|---------|
| **OpenAI** | gpt-4, gpt-4-turbo, gpt-3.5-turbo | gpt-4 | ~$0.03/req | 8K-128K tokens |
| **Anthropic** | claude-3-opus, claude-3-sonnet, claude-3-haiku | claude-3-opus | ~$0.015/req | 100K tokens |
| **Google** | gemini-pro (reserved for future) | N/A | TBD | TBD |

### Environment Setup

1. **Get API Keys:**
   - **OpenAI:** https://platform.openai.com/api-keys
   - **Anthropic:** https://console.anthropic.com/
   - **Google:** https://makersuite.google.com/app/apikey

2. **Set in `.env`:**
   ```bash
   # LLM Provider (openai | anthropic)
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-4
   
   # API Keys (keep these SAFE!)
   OPENAI_API_KEY=sk-xxxxxx...
   ANTHROPIC_API_KEY=sk-ant-xxxxxx...
   GOOGLE_API_KEY=xxxxxx...
   ```

### Runtime Configuration

**Change LLM via API Endpoint:**
```bash
curl -X POST http://localhost:3000/api/config/update \
  -H "Content-Type: application/json" \
  -d '{
    "LLM_PROVIDER": "anthropic",
    "LLM_MODEL": "claude-3-sonnet-20240229"
  }'

# Response:
# { "success": true, "config": { "provider": "anthropic", "model": "claude-3-sonnet..." } }
```

**Check Current Config:**
```bash
curl http://localhost:3000/api/health

# Response includes active provider, model, and status
```

### Model Selection Guide

- **gpt-4** (OpenAI)
  - Best for: Complex reasoning, multi-step tasks
  - Cost: Higher (~$0.03/req)
  - Speed: Slower (~3-5s)
  - Use when: Accuracy matters more than speed

- **gpt-3.5-turbo** (OpenAI)
  - Best for: Fast, simple tasks
  - Cost: Lower (~$0.001/req)
  - Speed: Fast (~1-2s)
  - Use when: Budget is tight, tasks are simple

- **claude-3-opus** (Anthropic)
  - Best for: Very complex reasoning, 100K context
  - Cost: Medium (~$0.015/req)
  - Speed: Moderate (~2-3s)
  - Use when: Need large context window

- **claude-3-sonnet** (Anthropic)
  - Best for: Balanced speed/quality, 100K context
  - Cost: Low (~$0.003/req)
  - Speed: Fast (~1-2s)
  - Use when: Want cheap + smart

### Fallback & Retry

- **Automatic Retry:** If LLM times out or returns rate-limit error, auto-retry once after 800ms
- **Timeout:** Default 30 seconds (configurable via `LLM_TIMEOUT_MS`)
- **Fallback:** If LLM fails after retry, show error in chat with manual retry button

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

## ⚠️ Error Handling & Resilience

The agent is designed to fail gracefully and recover intelligently.

### Tool Execution Failures

**Scenario:** Agent tries to click a button that doesn't exist or has moved

```
User: "Click the submit button"
    ↓
Agent calls: click_element({ selector: "#submit-btn" })
    ↓
Tool returns: { error: "Element not found: #submit-btn" }
    ↓
Agent automatically RETRIES ONCE (fresh page read)
    ↓
If still fails: Reports to user with clear message
    ↓
User can manually retry or provide different instruction
```

**Implementation:**
- First attempt: Execute tool as requested
- Second attempt: Re-read page + retry tool
- If still fails: Show error in chat, don't crash
- Message: "I tried to click the 'Submit' button but it wasn't found. The DOM may have changed or the selector is incorrect."

---

### LLM Response Parsing Failures

**Scenario:** LLM returns malformed JSON or unexpected format

```
Attempt 1: Try to parse response as JSON
    ↓ (if valid JSON) ✅ Process and continue
    ↓ (if invalid JSON) Extract JSON using regex: /\{[\s\S]*\}/
         ↓ (regex found JSON) ✅ Parse extracted JSON
         ↓ (regex failed) Inform user & retry
```

**Retry Logic:**
- If JSON extraction fails: Show message "I received an unexpected response from the AI. Retrying..."
- Automatic retry: Yes, once
- If retry also fails: Display error clearly, offer manual retry button
- Error message: "The AI model didn't respond in the expected format. Please try again."

---

### Timeout Handling

**Scenario:** LLM API takes too long or network is slow

| Event | Timeout | Action |
|-------|---------|--------|
| LLM API Call | 30 seconds (configurable: `LLM_TIMEOUT_MS`) | Abort request, show "LLM request timed out" |
| Tool Execution | 30 seconds (configurable: `TOOL_TIMEOUT_MS`) | Abort execution, mark as failed |
| Approval Modal | 120 seconds (2 minutes) | Auto-reject if no user response |

**User Experience:**
- Chat shows: "The request took too long. [Retry]"
- User can click Retry or try a different task
- No silent failures—always inform user

---

### Offline / Backend Unavailable

**Scenario:** Backend proxy server (http://127.0.0.1:3000) is not running

**Detection:**
- Health check on load: `GET /api/health`
- Continuous monitoring: Retry health check if backend unreachable

**UI Display:**
```
🔴 OFFLINE
Backend Unavailable — The AI Copilot proxy server is unreachable

[↻ Retry]
```

**What happens if user tries to send message while offline:**
1. UI disables send button
2. Shows error banner: "Backend is offline. Please start the server."
3. Provides retry button
4. Periodic auto-retry every 5 seconds

**Recovery:**
1. User starts backend: `npm run dev:backend`
2. Extension detects health check passes
3. UI clears offline banner, enables send button
4. No message loss (chat history is in chrome.storage.local)

---

### Service Worker Restart (State Recovery)

**Scenario:** Chrome closes the Service Worker or it crashes mid-task

**Resilience:**
- Agent state saved to `chrome.storage.local` after every iteration
- State includes: chat history, current goal, page context, iteration count
- On Service Worker restart: Load state from storage and resume from last known point
- No task loss—user sees full chat history + can continue

**What is persisted:**
```javascript
{
  chatHistory: [...],        // All messages (user, assistant, tool)
  currentGoal: "...",        // User's current request
  pageContext: {...},        // Last known page data
  iterationCount: 3,         // How many iterations completed
  isRunning: false           // Whether task is in progress
}
```

---

### Max Iteration Guard

**Scenario:** Agent gets stuck in a loop trying the same thing repeatedly

**Protection:**
- Max iterations: 10 (configurable: `MAX_REACT_ITERATIONS`)
- When limit reached: Stop loop, generate fallback answer from context
- Fallback answer uses page data + tool results to synthesize response

**User Message:**
```
The agent completed 10 iterations without finishing the task.
Here's what I found so far:
- [Extracted data / summary]

You can try a simpler version of the request, or provide more specific guidance.
```

---

### Destructive Action Safety (HITL)

**Scenario:** User asks agent to submit a form or delete something

**Safety Gate:**
1. Agent detects destructive action keyword: "submit", "post", "send", "delete", "buy", "apply", "complete", "finish"
2. Agent pauses and sends `request_approval` message
3. UI shows modal with:
   - ⚠️ Risk level (HIGH for destructive actions)
   - What action will be taken
   - Why approval is needed
   - [Reject] [Approve] buttons

**What if user rejects?**
- Agent stops execution
- Message in chat: "Action cancelled by user"
- Task terminates gracefully

**What if timeout (2 minutes)?**
- Auto-reject
- Message: "Approval timed out. Action was cancelled."

**What if user approves?**
- Proceed with action
- Execute tool
- Continue or finalize

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
