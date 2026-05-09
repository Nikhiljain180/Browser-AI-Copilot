# Browser AI Copilot — Module-Level PRD & Knowledge Source

## Table of Contents

1. [Pros, Cons, and Trade-Offs](#4-pros-cons-and-trade-offs)
2. [Security and Edge Cases](#5-security-and-edge-cases)
3. [Live Coding Scenarios](#7-live-coding-scenarios)
4. [System Design Variations](#8-system-design-variations)

---

# 4. Pros, Cons, and Trade-Offs

## 4.1 LLM Choice

**What was done:** Abstracted provider choice through backend config, supports OpenAI and Anthropic.

**Why:** Keeps extension provider-agnostic, makes demos flexible.

**Downside:** Lowest-common-denominator abstraction means not fully using provider-native tool-calling features.

**Improve:** Add provider-native structured/tool calling adapters, add benchmark-driven model selection per task type.

**Alternative:** Single-provider optimized integration for lower complexity.

## 4.2 Prompt Design

**What was done:** Explicit JSON schema prompt, separate prompt for form planning.

**Why:** Easier parsing and predictable control loop.

**Downside:** JSON-in-text prompting is still brittle.

**Improve:** Strict JSON schema validation and repair, provider-native tool calling, per-tool examples in prompt.

## 4.3 DOM Extraction Strategy

**What was done:** Built semantic structured page context rather than raw DOM serialization.

**Why:** Better signal-to-noise ratio, lower token cost.

**Downside:** Some fidelity is lost, hidden or non-semantic UI can be missed.

**Improve:** Optional screenshot/vision fallback, shadow DOM traversal, iframe-aware extraction.

## 4.4 Element Selection Strategy

**What was done:** agent IDs plus generated selectors.

**Why:** agent IDs are more stable than plain selectors across a single page snapshot.

**Downside:** Registry is not stable across navigation/re-render, selectors can become stale.

**Improve:** Richer locator object: agentId, selector, text, role, parent context.

## 4.5 Security Concerns

**What was done:** Approval gating, backend key isolation, no arbitrary page script execution path, least-privilege alternative manifest.

**Downside:** `<all_urls>` is still broad, page context is sent to external LLM provider.

**Improve:** Domain allowlist mode, client-side redaction, PII filtering, enterprise audit logging.

## 4.6 Performance

**What was done:** Token budget, focused context, recent-history clipping, specialized form workflow.

**Downside:** Full re-read after every tool can be expensive, 150ms wait before read is fixed not adaptive.

**Improve:** Incremental DOM diffing, partial region re-read, cache stable page regions.

## 4.7 Scalability

**What was done:** Stateless-ish backend design.

**Why:** Easier to scale horizontally.

**Downside:** Current implementation is still a simple Express process, no rate limiting, no queueing, no distributed cache.

**Improve:** Add auth, rate limiting, Redis cache, worker queues, observability.

## 4.8 Error Handling

**What was done:** Retries, timeouts, stop/cancel, fallback answers.

**Downside:** Not all failures are typed or recoverable.

**Improve:** Introduce explicit error taxonomy: perception error, action resolution error, provider error, permission error, approval rejection.

## 4.9 Testing Approach

**What was done:** Unit tests, integration tests, E2E tests.

**Downside:** Browser agents are hard to deterministically test across arbitrary live websites.

**Improve:** Deterministic HTML fixtures, more contract tests around tool outputs, synthetic SPA fixtures.

---

# 5. Security and Edge Cases

## 5.1 CSP Issues With Chrome Extensions

Extension CSP and webpage CSP are different concerns. Content scripts are isolated from page JS globals. Using the side panel avoids many on-page UI CSP headaches.

## 5.2 Cross-Origin Restrictions

Content scripts operate in the current page DOM. Cross-origin iframes remain a boundary — a production system would detect inaccessible frames and explain the limitation.

## 5.3 Dynamic SPA Pages

**Current handling:**
- `navigation.ts` hooks `pushState`, `replaceState`, `popstate`, `hashchange`
- `MutationObserver` watches DOM updates
- Service worker refreshes page context on `pageContextChanged`

**Limitation:** DOM mutation watching can be noisy, no deep semantic diffing yet.

## 5.4 Iframes

Same-origin iframes can be supported with additional traversal. Cross-origin iframes remain a browser security boundary.

## 5.5 Shadow DOM

Not a major explicit first-class path in the current extractor. Could be improved with recursive shadow root traversal and host metadata in selectors/agent IDs.

## 5.6 Rate Limiting And Token Management

Token budgets exist, backend retries exist, but no full rate limiting yet. Future improvements: per-user quota, provider-level concurrency limit, result caching for repeated informational asks.

## 5.7 User Data Privacy

API keys are protected on backend. Page context is not persisted by backend, but selected context is sent to the LLM provider for reasoning. The backend is stateless and does not persist it.

## 5.8 DOM Changes Between Read And Action

**Why this happens:** SPA rerenders, lazy loading, modal transitions, virtual DOM remount.

**Current mitigation:** agent IDs, content reinjection, tool retry, page re-read after every action.

**Better mitigation:** Validate target still matches expected text/role right before action, trigger re-localization on mismatch.

## 5.9 Other Edge Cases

- Disabled submit button until validation passes
- Autocomplete widgets with async dropdowns
- Hidden duplicate elements
- Offscreen elements inside virtualized lists
- Content loaded after fixed 150ms wait
- Sites that block synthetic interaction patterns
- Permission-denied pages like browser internal URLs

---

# 7. Live Coding Scenarios

For each scenario, the pattern is: identify which layer changes, define new data contract, explain algorithm, mention edge cases.

## 7.1 Auto-Detect And Fill All Forms On A Page

**Implementation plan:**
- Extend form inventory extraction to include all visible forms with grouped fields
- Add a background workflow mode: `fill_all_forms`
- Send all forms to backend `/api/forms/plan` or a new `/api/forms/plan-all`
- Execute fills form-by-form
- Pause for missing required values
- Require approval only for submit/post steps

**Key talking points:**
- Do not flatten unrelated forms together
- Preserve per-form submit boundaries
- Ask follow-up questions only when needed

## 7.2 Remember Context Across Different Tabs

**Implementation plan:**
- Introduce a memory map keyed by `tabId` or URL
- Store: chat history, last page context summary, last active goal, tab title/url

**Data model:**
```ts
type TabSession = {
  tabId: number;
  url: string;
  title: string;
  chatHistory: ChatMessage[];
  pageContextSummary: string;
  currentGoal?: string;
};
```

**Risks:** tab contamination, memory growth, confusing the model with unrelated pages.

## 7.3 Add Screenshot Capture And Visual Understanding

**Implementation plan:**
- Capture screenshot from extension API
- Attach to backend request for multimodal model
- Use DOM-first mode normally
- Trigger vision mode when DOM extraction is sparse, page is canvas-heavy, or element resolution repeatedly fails

**Key design principle:** Vision should be a fallback or augmentation, not the default.

## 7.4 Implement Rate Limiting And Caching On The Backend

**Implementation plan:**
- Add auth-aware middleware
- Add per-user request counters in Redis
- Cache safe informational responses using goal + page hash + model hash

## 7.5 Multi-Step Workflow: "Find all emails and draft a reply to each"

**Implementation plan:**
- Add extraction step for emails
- Generate a list of targets
- For each target: navigate or locate reply field, draft reply, stop for approval before send

**Key concern:** This becomes batch automation — sending actions must be gated very carefully.

## 7.6 Add Keyboard Shortcuts

**Implementation plan:**
- Use manifest `commands`
- Map shortcuts to background actions (open side panel, summarize page, stop current run)

**Edge cases:** command conflicts, avoid destructive shortcuts without confirmation.

## 7.7 Make It Work Better On SPAs

**Implementation plan:**
- Improve mutation debouncing
- Add semantic page signatures
- Re-scan only changed regions when possible
- Keep per-route context markers

## 7.8 Add A Record And Replay Macro Feature

**Implementation plan:**
- Capture approved tool events and relevant page anchors
- Serialize macro as ordered steps
- Replay with validation after each step

**Must mention:** Do not record raw secrets, revalidate target text/role before replay step.

## 7.9 Implement Streaming Responses In Chat UI

**Implementation plan:**
- Backend uses SSE
- UI appends chunks
- Background differentiates between status/thought stream and final action JSON

**Hard part:** Structured action agents and token streaming do not fit together cleanly unless you separate control output from user-facing output.

## 7.10 Add Authentication And User Session Management

**Implementation plan:**
- Backend: login, session token, per-user quotas
- Extension: secure token storage and refresh handling
- API: include auth header on `/api/llm/*` and `/api/forms/*`

**Edge cases:** token expiry, multiple profiles, local demo mode vs hosted mode.

---

# 8. System Design Variations

## 8.1 How To Scale To 10,000 Concurrent Users

**Architecture changes:**
- Load balancer in front of backend
- Stateless API replicas
- Redis for rate limiting/caching/session metadata
- Job queue for heavy tasks
- Observability stack

**Key concerns:** provider API quotas, prompt cost, latency spikes, per-user fairness.

## 8.2 How To Add Firefox And Safari Support

**Firefox:** Easiest next step — adapt MV3/extension API differences, side panel behavior may differ.

**Safari:** Likely needs more adaptation and packaging differences.

**Advice:** Keep browser-specific APIs behind a thin adapter.

## 8.3 How To Build It Without A Backend

**Possible:** Ask user for API key, call provider directly from extension.

**Trade-offs:** Weaker key security, harder rate limiting, tighter provider coupling.

## 8.4 How To Add Collaboration

**Design:** Shared session object on backend, collaborative history timeline, per-user cursors/permissions.

**Risks:** Privacy, conflicting actions, concurrent state drift.

## 8.5 How To Add Offline Capabilities

**Possible:** Limited local-only features: DOM extraction, local heuristics, canned workflows.

**Not possible offline:** Remote LLM reasoning unless using on-device model.

## 8.6 How To Add Analytics And Monitoring

**Add:** Backend metrics, structured logs, request IDs, opt-in extension telemetry.

**Be careful:** Browser page data is sensitive — analytics must be minimized and consent-based.
