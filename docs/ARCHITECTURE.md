# Browser AI Copilot — Architecture Document

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
   - [1.1 System Overview](#11-system-overview)
   - [1.2 Logical Separation](#12-logical-separation)
   - [1.3 Full Data Flow](#13-full-data-flow)
   - [1.4 Design Decisions](#14-why-each-architectural-decision-was-made)
   - [1.5 Chrome Extension Internals](#15-chrome-extension-internals)
   - [1.6 Sidebar Injection Strategy](#16-sidebar-injection-strategy)
   - [1.7 State Management](#17-state-management-across-components)
2. [Every Component Explained (File-by-File)](#2-every-component-explained-file-by-file)
3. [Tool-Based Agent Design](#3-tool-based-agent-design)
4. [Key Concepts](#4-key-concepts)
5. [Quick Reference](#5-quick-reference-cheat-sheet)

---

# 1. High-Level System Architecture

## 1.1 System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Chrome Browser                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────┐                                          │
│  │ Vue Side Panel UI             │                                          │
│  │ `apps/extension/src/ui/`      │                                          │
│  │ - Popup.vue                   │                                          │
│  │ - composables                 │                                          │
│  │ - chat/feed/composer/modal    │                                          │
│  └───────────────┬───────────────┘                                          │
│                  │ chrome.runtime.sendMessage                               │
│                  ▼                                                          │
│  ┌───────────────────────────────┐                                          │
│  │ Background Service Worker     │                                          │
│  │ `src/background/service-worker.js`                                       │
│  │ - message router              │                                          │
│  │ - state orchestration         │                                          │
│  │ - navigation tracking         │                                          │
│  │ - agent start/stop            │                                          │
│  └───────────────┬───────────────┘                                          │
│                  │                                                          │
│                  │ calls modular background subsystems                      │
│                  ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Background Modules                                                    │  │
│  │ - `agent/agent-runner.js`      ReAct loop                             │  │
│  │ - `llm/llm.js`                 backend call + JSON parsing            │  │
│  │ - `tools/tool-executor.js`     approval + retries                     │  │
│  │ - `core/state.js`              persisted state                        │  │
│  │ - `core/tabs.js`               tab access + script injection          │  │
│  │ - `workflows/*`                form-specialized workflow              │  │
│  └───────────────┬───────────────────────────────────────────────────────┘  │
│                  │ chrome.tabs.sendMessage / chrome.scripting               │
│                  ▼                                                          │
│  ┌───────────────────────────────┐                                          │
│  │ Content Script                │                                          │
│  │ `src/content/content-script.js`                                          │
│  │ - tool registry               │                                          │
│  │ - message listener            │                                          │
│  │ - input validation            │                                          │
│  └───────────────┬───────────────┘                                          │
│                  │ executes page tools in DOM context                       │
│                  ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Page Interaction Layer                                                │  │
│  │ `src/content/tools/`                                                  │  │
│  │ - `read_page.js`                                                      │  │
│  │ - `click_element.js`                                                  │  │
│  │ - `fill_input.js`                                                     │  │
│  │ - `extract_data.js`                                                   │  │
│  │ - `draft_reply.js`                                                    │  │
│  │ - `summarize_page.js`, `reset_form.js`                                │  │
│  │                                                                       │  │
│  │ Support modules:                                                      │  │
│  │ - `core/registry.js`      agentId to element mapping                  │  │
│  │ - `core/selector.js`      selector generation                         │  │
│  │ - `core/sanitizer.js`     text cleanup                                │  │
│  │ - `core/token-budget.js`  page context trimming                       │  │
│  │ - `observers/navigation.js` SPA change detection                      │  │
│  └───────────────┬───────────────────────────────────────────────────────┘  │
│                  │ HTTP fetch                                                │
└──────────────────┼──────────────────────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Node.js Backend (Express)                            │
│  `apps/backend/src/`                                                        │
│  - `server.ts`                                                              │
│  - `routes/llmRoutes.ts`                                                    │
│  - `routes/formRoutes.ts`                                                   │
│  - `services/llmService.ts`                                                 │
│  - `providers/llmClient.ts`                                                 │
│  - `prompts/index.ts`                                                       │
└──────────────────┬──────────────────────────────────────────────────────────┘
                   │ SDK call
                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LLM Provider API                                   │
│                       OpenAI or Anthropic                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.2 Logical Separation

The system is cleanly separated into three layers:

### Chat Layer

- `apps/extension/src/ui/`
- Renders chat history, collects prompts, shows status, handles approval UI
- Should not directly manipulate the DOM of the target page

### Agent Logic Layer

- `apps/extension/src/background/`
- Orchestration, reasoning loop, state management, approvals, retries, backend communication
- The "brain" that decides what to do next

### Browser Interaction Layer

- `apps/extension/src/content/`
- Reads the DOM and performs concrete actions on the actual page
- The "hands and eyes" of the system

This separation makes the system explainable, testable, and safer than mixing LLM logic directly inside the content script.

## 1.3 Full Data Flow

### End-to-End Flow

```text
1. User types a request in side panel UI
2. `Popup.vue` sends `startAgent` via `chrome.runtime.sendMessage`
3. Service worker receives `startAgent`
4. Service worker loads saved state and finds active tab
5. Service worker ensures content scripts are injected
6. Service worker asks content script to `readPage`
7. Content script runs `extractAccessibilityTree()`
8. Structured page context returns to service worker
9. Agent runner stores page context and appends user message to chat history
10. Agent runner calls `CopilotSw.callLLM()`
11. Background LLM module sends goal + chatHistory + pageContext to backend
12. Backend builds messages using system prompt + summarized page context
13. Backend calls OpenAI or Anthropic SDK
14. LLM returns structured JSON with:
    - `thought`
    - `action`
    - `action_input`
    - `answer`
15. If `action = final_answer`, service worker stores assistant response and stops
16. Otherwise service worker executes tool through `tool-executor.js`
17. Tool executor may request human approval first
18. Tool request is sent to content script via `executeTool`
19. Content script validates tool input and dispatches to tool implementation
20. Tool reads or mutates DOM and returns result
21. Service worker records tool result in chat history
22. Service worker re-runs `readPage` to refresh current state
23. Loop repeats until final answer or max iterations
24. UI receives progress/status/runtime messages and renders them
```

### Message Passing Architecture

**A. Popup ↔ Service Worker:**

```
chrome.runtime.sendMessage / chrome.runtime.onMessage
```

- Popup sends: `startAgent`, `stopAgent`, `clearChat`, `approveAction`, `rejectAction`, `getChatHistory`
- SW broadcasts: `updateStatus`, `updateReasoning`, `updateProgress`, `requestApproval`, `navigationSeparator`

**B. Service Worker → Content Script (tab):**

```
chrome.tabs.sendMessage / chrome.runtime.onMessage (content script)
```

- SW sends: `ping`, `readPage`, `executeTool`
- Content script responds with tool results

**C. Content Script → Service Worker (one-way):**

```
chrome.runtime.sendMessage (from content script)
```

- Content script sends: `pageContextChanged`

**D. Extension ↔ Backend:**

```
HTTP fetch to http://localhost:3000
```

- `POST /api/llm/chat`, `POST /api/llm/retry` (ReAct agent loop)
- `POST /api/forms/plan` (form fill planning)

---

# 1.4 Why Each Architectural Decision Was Made

## Manifest V3 instead of V2

The correct choice for a production-minded assignment. MV3 enforces better security defaults, moves long-lived background pages to service workers, and is future-proof.

**Trade-off:** Service workers can be suspended, so state must be persisted carefully.

## Why a service worker

The service worker is the right place for orchestration because it has access to extension APIs, can coordinate UI and content scripts, and stays isolated from page DOM concerns.

**Trade-off:** The service worker can be killed when idle, which is why state is persisted via `chrome.storage.local` in `core/state.js`.

## Why content script isolation

The content script runs in the webpage context boundary where it can inspect and manipulate DOM safely, but still stays separated from the extension UI and agent logic. That separation reduces coupling and lowers the blast radius of bugs.

## Why Vue.js for the side panel

Vue gives reactive rendering, component modularity, and fast development without a lot of boilerplate. For a chat interface with composables, modal state, live status, and streaming-like updates, Vue is a pragmatic fit.

## Why a Node.js backend

The backend acts as a provider abstraction layer and trust boundary. It hides API keys, normalizes provider differences, centralizes prompt construction, and allows the extension to remain lightweight and provider-agnostic.

**Trade-off:** Adds latency compared with direct client-side calls, and adds another deployable component.

---

# 1.5 Chrome Extension Internals

## Message Passing

- UI to background: `chrome.runtime.sendMessage`
- Background to UI: `chrome.runtime.sendMessage` (via `broadcastUI`)
- Background to content: `chrome.tabs.sendMessage`
- Both service worker and content script use `return true` in the message listener to keep the channel open for async responses

## Content Script Injection

Two patterns:

1. **Declarative injection** — defined in `manifest.json` under `content_scripts`, automatically loads on `<all_urls>` at `document_idle`
2. **Programmatic injection fallback** — `core/tabs.js` calls `chrome.scripting.executeScript` if `ping` fails

## Permissions Model

- `activeTab`: temporary access to current tab
- `tabs`: query active tab and metadata
- `scripting`: inject content scripts when needed
- `storage`: persist agent state
- `sidePanel`: show the sidebar UI
- `<all_urls>`: enables wide content script reach and agent continuity across pages

---

# 1.6 Sidebar Injection Strategy

This repo uses the official Chrome `side_panel` entry rather than injecting a floating chat widget into every page.

### Side panel approach

- **Pros:** Clean CSS separation, no DOM collision, official Chrome surface, easier to maintain stable UI
- **Cons:** Chrome-specific, less "embedded" feeling

### Alternatives considered

- **Iframe injected into page:** Strong CSS isolation but must manage positioning and lifecycle, may hit site CSP
- **Shadow DOM widget:** Good style isolation but still shares page process, some CSS/z-index issues remain
- **Direct DOM injection:** Simplest but worst CSS collision risk, page styles can break the UI

---

# 1.7 State Management

## Persistent agent state

- `apps/extension/src/background/core/state.js`
- Stored in `chrome.storage.local` under `agentState`
- Fields: `chatHistory`, `currentGoal`, `pageContext`, `iterationCount`, `isRunning`, `formSession`

## UI-local reactive state

- Vue composables:
  - `useChat.js` — visible messages, live thought lines
  - `useAgent.js` — current phase and action
  - `useApproval.js` — pending approval modal state

## Why split state this way

- Persistent state is needed because service workers are ephemeral
- UI state should stay fast and reactive
- Not every UI concern should be written to persistent storage

## Minor details worth mentioning

- **Navigation separators:** Synthetic `navigation` chat entries when user changes tabs/pages
- **Focused context:** `background/llm/llm.js` trims context differently for informational vs action queries
- **Human-in-the-loop safety gate:** `tool-executor.js` classifies `click_element` as medium or high risk

---

# 2. Every Component Explained (File-by-File)

## 2.1 Extension Manifest And Entry Points

### `apps/extension/manifest.json`

- Declares MV3 extension: service worker, side panel, content scripts, permissions, icons
- Loads `src/background/service-worker.js`, `public/popup.html`, and the content toolchain
- Uses `<all_urls>` plus a least-privilege alternative manifest

### `apps/extension/manifest.least-privilege.json`

- Lower-permission alternative manifest showing deliberate thinking about security trade-offs

## 2.2 Background Layer

### `apps/extension/src/background/service-worker.js`

- Main entry point. Imports all modular scripts via `importScripts`.
- Registers runtime message handlers: `startAgent`, `stopAgent`, `clearChat`, `approveAction`, `rejectAction`, `getChatHistory`, `pageContextChanged`
- Manages navigation separators and tab lifecycle

### `apps/extension/src/background/core/config.js`

- Central constants: backend URL (`localhost:3000`), `MAX_REACT_ITERATIONS = 10`, LLM timeout (60s), tool timeout (60s)

### `apps/extension/src/background/core/state.js`

- Defines `AgentState` class with `save()`, `load()`, `clear()`
- Persists to `chrome.storage.local` under key `agentState`

### `apps/extension/src/background/core/ui.js`

- `broadcastUI()` sends events to UI via `chrome.runtime.sendMessage`
- `updateAgentStatus()` broadcasts phase/detail changes

### `apps/extension/src/background/core/tabs.js`

- `getUsableTab()` — finds active tab
- `isRestrictedUrl()` — detects chrome:// etc.
- `ensureContentScriptInjected()` — pings content script, injects if missing
- `sendMessageToTab()` — sends and retries if content script missing

### `apps/extension/src/background/intents.js`

- Lightweight heuristics for: form fill, form submit, follow-up values, structured extraction
- Pure string-matching optimization, not a classifier

### `apps/extension/src/background/tools/tool-executor.js`

- `classifyAction()` — determines if action needs approval (submit/delete = high risk)
- `executeToolWithApproval()` — gates execution behind user approval
- `executeTool()` — sends to content script with retries

### `apps/extension/src/background/tools/approvals.js`

- `waitForApproval()` — creates a Promise resolved by user approve/reject
- `handleApproveAction()` / `handleRejectAction()` — resolves the promise

### `apps/extension/src/background/llm/llm.js`

- `buildFocusedPageContext()` — trims context based on query type
- `callLLM()` — POSTs to backend `/api/llm/chat` and `/api/llm/retry`
- `parseStructuredResponse()` — extracts JSON from potentially messy LLM output

### `apps/extension/src/background/agent/agent-runner.js`

- ReAct loop implementation
- `handleStartAgent()` — entry point: load state, read page, dispatch
- `handleFormWorkflow()` — tries form workflow first
- `runAgentLoop()` — iterative LLM → tool → re-read loop
- `clearAgentSession()` — reset all state

### `apps/extension/src/background/workflows/*`

**`form-workflow.js`** — Main orchestration for fill/clear/edit/submit:

- `tryDirectFormWorkflow()` — intent routing
- `handleFreshFormFill()` — LLM plan → fill fields → missing fields → submit
- `consumeFollowUpAnswers()` — process user values for pending fields
- `handleSubmitConfirmation()` — submit with approval
- `handleEditFlow()` — field editing
- `handleClearFlow()` — clear/reset fields
- `handleExplicitSubmit()` — direct submit with plan

**`form-detection.js`** — Predicates for multi-step forms, validation errors, confirmation dialogs

**`form-api.js`** — `requestFormFillPlan()` → POST `/api/forms/plan`

**`form-session.js`** — Session lifecycle: `ensureFormSessionState()`, `setFormSession()`, `clearFormSession()`, `splitUserValues()`

**`form-questions.js`** — `askForField()`, `isSubmitIntent()`, `isNegativeIntent()`

**`form-buttons.js`** — `resolveSubmitButton()`, `isLikelySubmitButton()`

**`form-fields.js`** — `buildFormsInventory()`, `findEditField()`, `validateFormWorkflowPlan()`

## 2.3 Content Script Layer

### `apps/extension/src/content/content-script.js`

- Thin entry point: message listener, tool registry, parameter validation
- Routes `readPage` and `executeTool` messages to appropriate handlers

### `apps/extension/src/content/core/registry.js`

- `pageElementRegistry` — maps `agentId` to live DOM elements
- `registerElement()`, `resolveElement()`

### `apps/extension/src/content/core/selector.js`

- `generateSelector()` — builds robust CSS selectors from element features

### `apps/extension/src/content/core/sanitizer.js`

- Text normalization and sanitization to prevent noisy DOM from bloating prompts

### `apps/extension/src/content/core/utils.js`

- Shared DOM helpers: visibility checks, `setNativeValue()`, `fireFieldEvents()`, `getFieldLabel()`, `isFieldFilled()`

### `apps/extension/src/content/core/token-budget.js`

- `applyTokenBudget()` — splits budget across buttons, links, elements, text, sections

### `apps/extension/src/content/observers/navigation.js`

- SPA navigation detection: hooks `pushState`, `replaceState`, `popstate`, `hashchange`
- `MutationObserver` for DOM changes
- Notifies background via `pageContextChanged` message

## 2.4 Tool Modules

### `apps/extension/src/content/tools/read_page.js`

- `extractAccessibilityTree()` — structured page snapshot: metadata, viewport state, modals, landmarks, headings, sections, forms, buttons, links, inputs, tables, lists, cards, text
- `extractAllForms()` — per-form field inventory with labels, types, required status, values

### `apps/extension/src/content/tools/click_element.js`

- `clickElement()` — full event sequence: pointerdown, mousedown, pointerup, mouseup, click + native `.click()` fallback
- Visibility/disabled/interactability checks, viewport scrolling, hover support
- Single/double/right click modes

### `apps/extension/src/content/tools/fill_input.js`

- `fillInput()` — dispatches to type-specific handlers:
  - Text/textarea: `setNativeValue()` + `fireAllEvents()`
  - Select: 5-level smart matching (exact value, exact text, contains, reverse, fuzzy)
  - Checkbox/radio: value matching + event dispatch
  - Date/time/range/color: format-aware filling
  - Contenteditable: innerHTML + input event

### `apps/extension/src/content/tools/extract_data.js`

- Structured extraction from tables, repeating cards, headings, key-value pairs
- Per-item relationship preservation

### `apps/extension/src/content/tools/draft_reply.js`

- Locates reply fields (textarea, contenteditable, iframe editors like Quill, TinyMCE, Draft.ts)
- Supports replace/append/prepend modes

### `apps/extension/src/content/tools/summarize_page.js`

- Structured summaries from extracted page content

### `apps/extension/src/content/tools/reset_form.js`

- Clear/reset forms with undo support

## 2.5 UI Layer

### `apps/extension/src/ui/Popup.vue`

- Side panel shell: header, chat feed, composer, approval modal, error banner
- `submitPrompt()` — sends `startAgent` to service worker
- Runtime message handler for status/approval/thought updates

### Composables

- `useRuntime.js` — wraps `chrome.runtime.sendMessage` in a Promise
- `useChat.js` — messages, scroll, live thoughts, history sync from storage
- `useAgent.js` — phase, action labels, run state
- `useApproval.js` — approval request state, approve/reject handlers
- `useHealth.js` — backend connectivity tracking

### Components

- `ShellHeader.vue` — header with status, stop, new chat
- `ChatFeed.vue` — message list rendering
- `ChatMessage.vue` — individual message
- `PendingMessage.vue` — in-flight status
- `ComposerBar.vue` — prompt input
- `ApprovalModal.vue` — approve/reject UI
- `ErrorBanner.vue` — offline/error display

## 2.6 Backend Layer

### `apps/backend/src/server.ts`

- Express boot: CORS, morgan, JSON body parser (10mb limit)

### `apps/backend/src/config/index.ts`

- Env-based config: provider, model, port, host, timeout, API keys

### `apps/backend/src/providers/llmClient.ts`

- Lazy-initializes OpenAI or Anthropic SDK client

### `apps/backend/src/routes/llmRoutes.ts`

- `POST /api/llm/chat` — primary LLM call
- `POST /api/llm/retry` — stricter "VALID JSON only" retry

### `apps/backend/src/routes/formRoutes.ts`

- `POST /api/forms/plan` — structured form fill planning

### `apps/backend/src/routes/healthRoutes.ts`

- Health check endpoint

### `apps/backend/src/routes/configRoutes.ts`

- Config introspection

### `apps/backend/src/services/llmService.ts`

- `buildConversationMessages()` / `buildFormFillMessages()` — message array construction
- `callLLMWithTimeout()` — retries and timeouts

### `apps/backend/src/prompts/index.ts`

- `SYSTEM_PROMPT` — general copilot agent
- `FORM_FILL_SYSTEM_PROMPT` — form fill planning schema

### `apps/backend/src/utils/pageContext.ts`

- `summarizePageContext()` — compact textual representation for LLM

### `apps/backend/src/types/index.ts`

- TypeScript type definitions: page context, chat message, LLM response, form plan

### `apps/backend/src/middleware/errorHandler.ts`

- Global Express error handler

## 2.7 Tests

- `apps/backend/tests/integration/routes.test.ts`
- `apps/backend/tests/unit/helpers.test.ts`
- `apps/extension/tests/unit/tools/*.test.js`
- `tests/unit/agent.test.js`
- `tests/integration/backend.test.js`
- `tests/e2e/scenarios.spec.js`

---

# 3. Tool-Based Agent Design

## 3.1 Agent vs Chatbot

- **Chatbot:** Answers in natural language, usually single-shot, does not act on environment
- **Agent:** Has a goal, observes environment, chooses tools/actions, updates plan, stops when goal achieved

In this codebase, the service worker plus content tools form the agent. The LLM is the reasoning engine inside a larger control loop.

## 3.2 How The Tool System Works

1. Tool definitions exist in the content script registry
2. LLM returns structured action (`{thought, action, action_input}`)
3. Background validates and executes (may require approval)
4. Content script dispatches to actual DOM tool
5. Result goes back into the loop

## 3.3 How The LLM Decides Which Tool To Call

Current approach is ReAct-style structured JSON output:

- Model emits JSON with `thought`, `action`, `action_input`, `answer`
- Provider-agnostic across OpenAI and Anthropic
- Downside: model can return invalid JSON, requires parsing and retry logic

Better production version: provider-native tool/function calling.

## 3.4 Tool Execution Loop

```text
Loop start
  read page
  call LLM
  if final answer → stop
  else classify action risk
  if approval needed → ask user
  execute tool
  record result
  refresh page context
  iterate
stop after max iterations or completion
```

## 3.5 Tool Details

### `read_page`

- Semantic extraction (not raw DOM)
- Structured tree: metadata, state, headings, sections, forms, buttons, links, tables, lists, cards, text
- Token budget and section focusing for context management

### `click_element`

- Identification by agentId or selector
- Visibility, disabled, and interactability checks
- Full event simulation (pointer/mouse sequence + native `.click()`)

### `fill_input`

- Supports all major input types
- Native value setter for React/Vue/Angular compatibility
- Event dispatch: input, change, blur

### `extract_data`

- Repeating item detection for relationship-preserving extraction
- Table, card, and key-value heuristics

### `draft_reply`

- Reply field detection across textarea, contenteditable, and iframe editors
- Replace/append/prepend modes

## 3.6 Error Handling And Fallbacks

- Tool-level try/catch
- Tool retries (2 attempts with 250ms delay)
- JSON extraction with retry route
- LLM timeout
- User stop with AbortController
- Approval cancel path
- Max-iteration fallback answer

---

# 4. Key Concepts

## 4.1 Manifest V3 Lifecycle

- Service workers instead of persistent background pages
- Wake on events, suspend when idle
- State must be persisted for continuity
- `core/state.js` exists largely because of this lifecycle

## 4.2 Service Workers vs Background Pages

**Service worker:** event-driven, lower resource usage, can be suspended
**Background page:** persistent, easier to keep in-memory state, older model

## 4.3 Content Script Isolation

- Content scripts run in an isolated world
- Can access DOM but not page JS scope directly
- Good for safety, but limits integration with page JS internals

## 4.4 Message Passing Patterns

- UI ↔ background: `chrome.runtime.sendMessage`
- Background → content: `chrome.tabs.sendMessage`
- Reinjection: `chrome.scripting.executeScript`
- Async listeners return `true`

## 4.5 Vue Reactivity

- `ref()` — reactive primitives/objects
- `computed()` — derived display state
- Composables — reusable state logic
- `watch` — triggers scroll/UI sync

## 4.6 LLM Function Calling / Tool Use

- Model outputs structured action rather than only prose
- In this system: prompt-driven JSON (not provider-native tool calling)
- Control loop validates and executes

## 4.7 ReAct Pattern

Reason + Act: observe → reason → act → observe again → repeat

## 4.8 DOM Traversal And Manipulation

**Reading:** `querySelector`, semantic extraction, visible text sanitization
**Writing:** click simulation, native input setters, event dispatch

## 4.9 Event Simulation

- Real pages depend on more than final values
- Dispatching pointer/mouse events for clicking
- input/change/click events for form controls

## 4.10 Prompt Engineering For Structured Outputs

- Define exact schema
- Define tool names
- Constrain final answer shape
- Add examples
- Include repair path for malformed outputs

## 4.11 Token Management

- Page context can explode quickly
- Prune early in content script
- Focus in background
- Summarize again in backend
- Layered compression is a key design choice

## 4.12 WebSocket vs SSE vs Polling

- **Polling:** simplest, inefficient for streaming
- **SSE:** good for one-way token stream, simpler than WebSocket
- **WebSocket:** bi-directional, more complex

---

# 5. Quick Reference Cheat Sheet

## 5.1 One-Page Architecture Summary

```text
Vue Side Panel
  → runtime message
Service Worker
  → read page
Content Script
  → structured page context
Service Worker
  → backend LLM call
Backend
  → provider SDK
Provider returns JSON action
Service Worker
  → approval if risky
  → execute tool in content script
  → re-read page
  → finalize answer
```

## 5.2 Key Talking Points

### Page understanding

- semantic snapshot, not raw DOM
- token budgeting
- section focusing

### Chat UI

- side panel isolation
- Vue composables
- live status + approval UX

### Agent loop

- ReAct style
- read-act-read
- max iterations

### Tool safety

- allowlisted tools
- approval gating
- retries + structured errors

### Backend

- key isolation
- provider abstraction
- prompt centralization

## 5.3 10 Things To Remember

1. System split into UI, orchestration, and DOM tool layers
2. Service worker is the control plane in MV3
3. Content script is where page reading and actions happen
4. ReAct loop: read page → call model → execute tool → read page again
5. Structured semantic snapshot, not raw DOM
6. Agent state persisted because MV3 service workers are ephemeral
7. Risky actions are approval-gated
8. Forms get a specialized workflow
9. Backend hides API keys and abstracts providers
10. Biggest future improvements: native tool calling, streaming, stronger locator resilience
