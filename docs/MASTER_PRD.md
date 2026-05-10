# Browser AI Copilot — Master PRD

## Product Vision

A browser-based AI copilot that understands webpages and acts on them — filling forms, extracting data, drafting replies, and summarizing content — all through a side panel chat interface backed by LLM reasoning.

## Core Capabilities

### Form Automation

- Detect all forms and standalone inputs on a page
- Fill fields intelligently using user-provided or LLM-inferred values
- Ask targeted follow-up questions for missing required fields
- Support all input types: text, select, checkbox, radio, date/time, range, color, contenteditable
- Multi-step form handling (continue/next button flow)
- Submit with human-in-the-loop approval
- Edit individual fields after filling
- Clear/reset forms

### Data Extraction

- Extract structured data from tables, cards, lists, and repeating items
- Preserve record-level relationships (name, rating, price, etc. per item)
- Extract key-value pairs and heading-anchored content
- Pattern-based extraction for unstructured content

### Content Interaction

- Draft and insert replies in textareas, rich-text editors, and iframe-based editors
- Summarize page content with structured output
- Click buttons, links, and interactive elements with full event simulation
- Navigate SPAs by detecting client-side route changes

### Agent Architecture

- ReAct-style reasoning loop: read page → reason → act → re-read
- Specialized form workflow bypasses generic loop for structured tasks
- Human-in-the-loop approval gating for risky actions (submit, delete, confirm)
- Persistent state across service worker restarts

## User Experience

- **Side panel UI** — extension-owned surface, no CSS collision with target page
- **Reactive chat** — real-time status updates, thought display, approval modals
- **Per-tab isolation** — each tab maintains its own chat history and form session
- **New Chat** — clear session and start fresh
- **Navigation continuity** — visual separators when switching tabs or pages

## Technical Architecture

```
Vue Side Panel (UI)
    ↕ chrome.runtime.sendMessage
Service Worker (Orchestration)
    ↕ chrome.tabs.sendMessage
Content Script (DOM Interaction)
    ↕ fetch
Node.js Backend (LLM Proxy)
    ↕ SDK
OpenAI / Anthropic
```

## Success Criteria

- User can say "fill the form" and the copilot fills all detectable fields
- Required fields are identified and user is prompted for missing values
- Form submission requires explicit user approval
- User can edit, clear, extract, draft, and summarize across different pages
- State survives service worker suspension and side panel reopen

## Future Roadmap

- Native LLM tool calling (replace text-prompted JSON)
- Streaming responses in chat UI
- Screenshot-based visual understanding as DOM fallback
- Multi-step workflow recording and replay
- Backend authentication, rate limiting, and caching
- Cross-browser support (Firefox, Safari)
