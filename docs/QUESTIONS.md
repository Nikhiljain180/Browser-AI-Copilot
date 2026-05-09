

# Browser AI Copilot — Interview Questions

2Answer framework:
1. State the design principle
2. Explain what this codebase does
3. Admit the trade-off
4aft. Describe the next production improvement

---

# 6.1 Architecture And Design Questions

### Q1. Walk me through the architecture of your Browser AI Copilot.

The system has three clear layers. The Vue side panel is the chat interface, the MV3 service worker is the orchestration layer, and the content script is the browser interaction layer. The service worker reads the page through the content script, sends a summarized page context plus chat history to the Node backend, gets a structured JSON action back from the LLM, and either finalizes or executes a tool and loops again. This separation keeps UI, reasoning, and DOM mutation concerns isolated and easier to test.

**Key points:** Chat layer, agent layer, browser layer. Service worker is the control plane. Content script is the DOM execution boundary.

**Common mistakes:** Saying "the LLM does everything." Ignoring the content script or approval layer.

---

### Q2. Why did you choose Manifest V3?

MV3 is the correct choice for modern Chrome extension development. It uses service workers instead of persistent background pages, which aligns with Chrome's current security and lifecycle model. I wanted the assignment to look production-aware, even though MV3 adds complexity around state persistence and worker suspension.

**Key points:** modern standard, event-driven lifecycle, better security defaults.

**Common mistakes:** Claiming MV3 is only a checkbox requirement. Not mentioning service worker lifecycle trade-offs.

---

### Q3. Why a service worker instead of a persistent background page?

In MV3, the service worker is the standard orchestration mechanism. It is a good fit because the agent mostly reacts to UI events, tab updates, and tool results rather than needing a constantly running process. The main downside is ephemerality, which I handled by persisting agent state to `chrome.storage.local`.

**Key points:** event-driven, extension API access, persisted state compensates for worker suspension.

**Common mistakes:** Forgetting that MV3 background pages are gone.

---

### Q4. Why split chat, agent, and browser interaction into separate layers?

The split makes the system understandable and safe. The UI should not know how to click DOM nodes, and the content script should not own conversation orchestration or API keys. That separation also makes testing easier, because you can test prompt building, tool execution, and DOM extraction independently.

**Key points:** separation of concerns, smaller failure surface, easier testing and maintenance.

**Common mistakes:** Answering only in abstract terms without mapping to your folders.

---

### Q5. Why do you need a backend at all?

The backend protects API keys, abstracts provider differences, centralizes prompts, and is the right place for retries and timeouts. If I put provider calls directly in the extension, key management and provider coupling would get worse immediately. The backend also gives me a cleaner path to production features like auth, rate limiting, and analytics.

**Key points:** key isolation, provider abstraction, future scalability features.

**Common mistakes:** Saying "just because the assignment asked for Node."

---

### Q6. Why not make the entire system client-side?

A fully client-side version is possible, but it would either expose provider credentials or require the user to paste their own API key into the extension, which is weaker operationally. Client-side calls also make provider switching, logging policy, and quota enforcement harder. For an interview assignment, the backend demonstrates better security and design maturity.

**Key points:** credential safety, provider abstraction, operational control.

**Common mistakes:** Claiming client-side is impossible.

---

### Q7. Why use Vue for the side panel?

The UI is small but stateful, which makes Vue a strong fit. I needed reactive updates for chat messages, live execution status, approval modal state, and offline health checks, and Vue composables provided a clean way to organize that without much boilerplate.

**Key points:** reactive UI, composable state, fast development.

**Common mistakes:** Over-explaining framework preference instead of tying it to this use case.

---

### Q8. Why did you use the Chrome side panel instead of injecting a widget into the page?

The side panel gives me a stable extension-owned UI surface that is isolated from arbitrary site CSS. If I injected a widget into every page, I would have to constantly fight layout, z-index, and style collisions. For a browser agent that must work across many unrelated pages, the side panel is the most robust default.

**Key points:** UI isolation, less CSS collision, official Chrome surface.

**Common mistakes:** Ignoring the alternative approaches and trade-offs.

---

### Q9. How do messages move through the system?

The UI sends `chrome.runtime.sendMessage` to the service worker. The service worker uses `chrome.tabs.sendMessage` to the content script for tab-specific page reads and tool execution. The service worker also sends UI updates back through runtime messaging, which the Vue app listens to in `Popup.vue`.

**Key points:** runtime vs tabs messaging, async listener with `return true`, tab-specific messaging for content script.

**Common mistakes:** Mixing up background-to-content and UI-to-background channels.

---

### Q10. Why does the service worker re-read the page after each tool call?

Because browser state is not static. After a click or fill action, the DOM may change, a modal may open, validation errors may appear, or navigation may occur. Re-reading the page prevents the agent from planning on stale assumptions, which is one of the most common failure modes in browser automation.

**Key points:** state changes after action, prevents stale context, core agent design pattern.

**Common mistakes:** Saying it is just for logging or debugging.

---

### Q11. Why do you keep chat history in persistent storage?

MV3 service workers are not guaranteed to remain alive, so keeping agent state only in memory would be fragile. By storing history, goal, page context, iteration count, and form session in `chrome.storage.local`, the UI can rehydrate and the agent can recover more gracefully from lifecycle interruptions.

**Key points:** worker suspension, UI rehydration, resilience.

**Common mistakes:** Forgetting to mention MV3 lifecycle.

---

### Q12. Why do you have a specialized form workflow instead of using the generic agent loop for everything?

Forms are highly structured, and generic ReAct loops can waste iterations inferring obvious patterns like required fields, next buttons, and missing values. The specialized workflow gives a better UX by asking targeted follow-up questions, keeping per-field state, and handling continue-versus-submit safely.

**Key points:** structured domain, fewer wasted LLM steps, better follow-up UX.

**Common mistakes:** Presenting it as a completely separate product instead of an optimized sub-workflow.

---

### Q13. Why not use raw DOM as the page context?

Raw DOM is too noisy and expensive. It contains presentation markup, duplicated text, hidden nodes, and layout scaffolding that the model does not need. A semantic snapshot with landmarks, sections, buttons, forms, and text excerpts gives better reasoning quality per token.

**Key points:** token efficiency, signal vs noise, better grounding.

**Common mistakes:** Saying raw DOM is impossible rather than suboptimal.

---

### Q14. Why is the backend route called `/stream` if it is not true streaming?

That naming is a little optimistic in the current version. The route currently returns a full JSON response after the LLM finishes, so it behaves more like a standard inference endpoint than true streaming. If I were polishing it, I would either rename it for accuracy or implement actual SSE token streaming.

**Key points:** be honest, current behavior vs desired behavior, clear improvement path.

**Common mistakes:** Pretending it is already true streaming.

---

### Q15. Why do you support both OpenAI and Anthropic?

It demonstrates provider abstraction and avoids hard-wiring the product to one SDK. From a system-design perspective, that gives flexibility for pricing, model quality, availability, and task-specific benchmarking. The trade-off is that the abstraction currently uses a common denominator rather than fully leveraging provider-native tool APIs.

**Key points:** abstraction layer, flexibility, lowest-common-denominator trade-off.

**Common mistakes:** Hand-waving around provider differences.

---

### Q16. Why use heuristic intent detection at all?

Heuristic intent detection is a latency and efficiency optimization, especially for forms and extraction tasks that are common and structurally predictable. I kept it lightweight and honest rather than pretending it is a robust classifier. In a production version I would likely replace or supplement it with a structured routing model.

**Key points:** practical optimization, not a perfect classifier, honest trade-off.

**Common mistakes:** Overselling heuristics as smart AI.

---

### Q17. Why keep the content script thin?

The entrypoint is intentionally thin so message handling stays stable while tools remain modular. Browser agents already have enough complexity, so reducing the entrypoint to message routing, validation, and dispatch makes the boundary easier to reason about and test.

**Key points:** stable boundary, modular tools, testability.

**Common mistakes:** Ignoring that content script complexity grows fast.

---

### Q18. Why does `click_element` always require approval in the current design?

The safest default in a hiring assignment is to assume clicks can have side effects, especially around navigation, submit, delete, or confirm flows. I classified click actions as at least medium risk because accidental clicks can be costly, and I wanted the human-in-the-loop design to be explicit and defensible.

**Key points:** safety-first, side-effect uncertainty, human-in-the-loop.

**Common mistakes:** Saying every click is harmless.

---

### Q19. What are the drawbacks of putting approval logic in the background layer?

The background layer is the correct trust boundary, but it also means approval UX and action policy are coupled to extension orchestration rather than embedded in tool definitions themselves. Over time I might move to a richer policy system where each tool declares risk metadata and the background enforces it uniformly.

**Key points:** central policy is good, current coupling can improve, tool metadata could be richer.

**Common mistakes:** Treating the current version as perfect.

---

### Q20. Why is chat history not shown with tool messages in the UI?

Tool messages are useful for machine context but often noisy for end users. The UI intentionally filters them out in `useChat.ts`, while still keeping them in stored history so the agent has access to execution results. That gives a cleaner conversational experience without losing reasoning context.

**Key points:** human-friendly UI, machine-readable hidden state, context retained.

**Common mistakes:** Forgetting that hidden does not mean discarded.

---

### Q21. Why do you summarize page context again on the backend if you already budget it on the client?

It is a second compression boundary. The content script extracts and budgets structured context, and the backend then formats it into a provider-friendly textual summary with explicit previews of buttons, links, forms, tables, and section text. Multiple budget layers are intentional because prompt windows are expensive.

**Key points:** layered compression, provider-friendly formatting, defense against oversized context.

**Common mistakes:** Calling it redundant without justification.

---

### Q22. Why use `chrome.storage.local` instead of something more complex?

For this assignment, `chrome.storage.local` is the simplest correct persistence layer. It survives worker suspension, is available in extension contexts, and is enough for chat history and session state. A more complex store would add cost without much benefit at this scale.

**Key points:** simplest correct choice, extension-native, enough for current scale.

**Common mistakes:** Suggesting localStorage in the service worker context.

---

### Q23. Why does navigation tracking exist both in the content layer and background tab listeners?

They cover different failure modes. The background catches top-level tab activation and completed navigations, while the content observer handles SPA-style client-side transitions and heavy DOM changes. Using both gives better continuity across modern browsing behavior.

**Key points:** top-level navigation vs SPA navigation, complementary signals, continuity.

**Common mistakes:** Saying one completely replaces the other.

---

### Q24. Why use retries for tools and LLM calls?

These are both unreliable boundaries. Tools can fail because the DOM changed mid-action, and LLM calls can fail because of timeouts or provider issues. A small bounded retry budget improves resilience without hiding persistent failures forever.

**Key points:** unreliable boundaries, bounded retries, resilience without infinite loops.

**Common mistakes:** Retrying blindly without considering new state.

---

### Q25. Why not keep the entire page context in the UI store?

The UI does not need to own the world model. The background layer is the orchestrator and source of truth for agent execution state, while the UI should focus on user-facing render state and controls. Keeping full execution state in the UI would increase coupling and complicate recovery.

**Key points:** single orchestration owner, less UI coupling, easier recovery.

**Common mistakes:** Making the UI the de facto agent controller.

---

### Q26. How would you explain the "control plane vs data plane" in this system?

The background service worker is the control plane because it decides what happens next, coordinates state, and manages safety. The content script is the data plane for browser interaction because it actually reads and mutates the page. The backend is a reasoning service dependency, not the whole control plane.

**Key points:** background controls, content executes, LLM is a reasoning component not the full system.

**Common mistakes:** Equating the backend with the entire brain.

---

### Q27. What is the most defensible design choice in this project?

The strongest choice is the strict separation between orchestration and page interaction, plus the read-act-read loop. Those decisions are fundamental to why the system is explainable and resilient. Even if individual heuristics change later, that architectural skeleton is sound.

**Key points:** separation of concerns, read-act-read loop, explainability.

**Common mistakes:** Pointing only to framework choices.

---

### Q28. What is the weakest design choice in this project?

The weakest piece is probably relying on text-prompted JSON output instead of provider-native tool calling. It works and is provider-agnostic, but it is more brittle than I would want in production. I partially mitigated that with JSON extraction and a retry path, but native tooling would be more robust.

**Key points:** honest self-critique, brittleness of prompt-only JSON, clear improvement path.

**Common mistakes:** Pretending there are no weak spots.

---

### Q29. How do you justify the broad host permissions?

The assignment asked for a copilot that can understand and act on arbitrary webpages, which implies wide page access. I balanced that power with tight tool boundaries, approval gating, a separate backend for keys, and an alternative least-privilege manifest to show I understand the risk trade-off.

**Key points:** capability requirement, compensating controls, least-privilege alternative.

**Common mistakes:** Saying "because it was easier."

---

### Q30. If you had one extra week, what architectural improvement would you prioritize?

I would prioritize native tool-calling plus streaming. Native tool calling would reduce parsing brittleness, and streaming would make the chat experience feel much more responsive. Together they would improve both system reliability and perceived quality without forcing a full redesign.

**Key points:** tool-calling, streaming, high-impact improvement.

**Common mistakes:** Picking something flashy but low leverage.

---

# 6.2 Implementation Detail Questions

### Q1. What happens when the user presses send in the side panel?

`Popup.vue` collects the draft, updates local UI state, pushes the user message into chat, and sends `startAgent` to the service worker using `sendRuntimeMessage`. The background then reads the current page, stores the goal, and either enters the form workflow or the normal ReAct loop.

**Key points:** UI is thin, background owns orchestration, page is read before reasoning.

**Common mistakes:** Forgetting the initial `readPage` step.

---

### Q2. How does the content script know which tool to execute?

`content-script.ts` contains a `TOOL_REGISTRY` object that maps tool names to descriptions, parameter metadata, and execute handlers. When the background sends `executeTool`, the content script validates required parameters and dispatches to the matching function.

**Key points:** registry-driven dispatch, validation before execution, narrow tool surface.

**Common mistakes:** Saying the LLM directly runs page code.

---

### Q3. How do you prevent unknown tools from executing?

The content script explicitly checks whether `TOOL_REGISTRY[toolName]` exists. If not, it throws an "Unknown tool" error. This is important because the LLM output is treated as untrusted until it matches a known tool contract.

**Key points:** allowlist approach, untrusted model output, fail closed.

**Common mistakes:** Trusting model output by default.

---

### Q4. How is `read_page` implemented?

`read_page` is implemented by `extractAccessibilityTree()` in `read_page.ts`. It waits briefly for dynamic rendering, clears the prior element registry, builds a structured snapshot of metadata, state, sections, interactive elements, tables, lists, and text, then applies a token budget before returning the result.

**Key points:** semantic snapshot, registry reset, token budget.

**Common mistakes:** Describing it as raw HTML scraping.

---

### Q5. Why do you clear the element registry before page extraction?

The registry stores live DOM references keyed by agent ID, and those references become stale when the page changes. Clearing it before a new read ensures the next snapshot re-registers the currently visible elements instead of reusing invalid handles.

**Key points:** stale DOM references, snapshot-scoped identity, consistency.

**Common mistakes:** Forgetting that DOM nodes can be remounted.

---

### Q6. How does `click_element` decide whether an element is interactable?

It checks that the element is visible, not disabled, and not covered by another element by using `document.elementFromPoint()` against the center of its bounding box. It also scrolls elements into view before clicking when needed.

**Key points:** visibility check, disabled check, overlay/interactability check.

**Common mistakes:** Saying `.click()` is always enough.

---

### Q7. Why simulate multiple mouse events for a click?

Many modern frameworks listen to pointer and mouse event sequences rather than only the final `click` event. The tool fires pointerdown, mousedown, pointerup, mouseup, and click, then falls back to native `.click()` as an additional compatibility step.

**Key points:** framework compatibility, more realistic input simulation, `.click()` fallback.

**Common mistakes:** Oversimplifying browser interaction.

---

### Q8. How does `fill_input` work with React-controlled inputs?

It uses the native property setter to update the value, rather than only mutating DOM state directly, then fires the expected events like `input` and `change`. That increases compatibility with controlled component patterns where frameworks maintain their own value tracking.

**Key points:** native setter, framework compatibility, event dispatch.

**Common mistakes:** Only setting `element.value` and stopping there.

---

### Q9. How are select dropdowns filled?

The tool tries several matching strategies in order: exact match on option value, exact match on visible text, partial text match, reverse containment, and fuzzy keyword matching. This makes the tool more tolerant of natural-language inputs.

**Key points:** multi-level matching, natural-language tolerance, deterministic selection.

**Common mistakes:** Assuming option value and visible label always match.

---

### Q10. How does `extract_data` preserve relationships between fields?

It first looks for repeating item containers and extracts attributes per item, such as name, rating, price, reviewer, and actions, keeping them grouped together. That is much better than page-wide regexes because it preserves record-level structure.

**Key points:** per-item extraction, relationship preservation, repeating container heuristics.

**Common mistakes:** Explaining extraction only as regex scraping.

---

### Q11. How does `draft_reply` detect rich-text editors?

It checks for common patterns like `contenteditable`, Quill, ProseMirror, Draft.js, and iframe-based editors like TinyMCE. It then analyzes the field type and chooses the appropriate content-setting method.

**Key points:** editor pattern detection, field analysis, different write strategies.

**Common mistakes:** Assuming every reply field is a textarea.

---

### Q12. How does the backend build LLM messages?

`buildConversationMessages()` starts with the system prompt, appends recent chat history, converts tool results into textual context messages, summarizes page context, and appends the current goal. The backend therefore gives the model both conversational memory and structured environment state.

**Key points:** system prompt, recent history only, page context summary.

**Common mistakes:** Forgetting tool results become context too.

---

### Q13. Why does the backend convert tool results into `user` messages?

It is a provider-neutral simplification. Instead of modeling tools as a separate native API concept for each provider, the backend injects tool results into the message sequence so the model can reason over them in plain conversational form.

**Key points:** provider-neutral, simpler abstraction, not ideal but practical.

**Common mistakes:** Calling it exactly equivalent to native function calling.

---

### Q14. How does the app recover when the UI opens after the agent already started?

The UI calls `syncHistory()` in `useChat.ts`, reading from `chrome.storage.local` and then asking the service worker for current history. If the agent is still marked as running, the UI sets a live phase message so the user can understand that work is in progress or resuming.

**Key points:** storage hydration, runtime sync, resumed status.

**Common mistakes:** Ignoring MV3 worker/UI lifecycle mismatch.

---

### Q15. How is stopping the agent implemented?

The service worker flips `isRunning` to false, aborts any active LLM request via `AbortController`, resolves pending approvals as rejected, saves state, and notifies the UI. The loop checks `isRunning`, so the next iteration boundary exits cleanly.

**Key points:** cooperative cancellation, LLM abort, approval cleanup.

**Common mistakes:** Thinking stop is only a UI flag.

---

### Q16. Why does the agent use max iterations?

To avoid infinite loops and uncontrolled cost. Browser agents can get stuck re-reading, retrying, or oscillating between tools, so an explicit iteration cap guarantees termination and lets the system return a fallback answer rather than hanging forever.

**Key points:** termination guarantee, cost control, fallback behavior.

**Common mistakes:** Forgetting agents need hard bounds.

---

### Q17. How do SPA navigations get detected?

The content script monkey-patches `history.pushState` and `replaceState`, listens to `popstate` and `hashchange`, and also watches DOM mutations. When it detects a page signature change, it clears stale registry state and notifies the background.

**Key points:** history hooks, mutation observer, background notification.

**Common mistakes:** Mentioning only full reloads.

---

### Q18. Why does the background also listen to `tabs.onUpdated` and `tabs.onActivated`?

Those background events cover top-level navigation and tab switching cases that content-only SPA hooks do not fully own. The service worker then inserts navigation separators and refreshes context when appropriate.

**Key points:** top-level browser events, complements content observer, conversation continuity.

**Common mistakes:** Treating all navigation as equivalent.

---

### Q19. How does approval actually block execution?

The background creates a pending approval record and waits on a Promise that is resolved when the user approves or rejects through the UI. Until that Promise resolves, tool execution is paused, so the human remains in control of risky actions.

**Key points:** async gate, pending approval map, user-driven resolution.

**Common mistakes:** Describing approval as post-action notification.

---

### Q20. Why is there a separate retry endpoint on the backend?

The retry route tightens the instruction to "VALID JSON only" when the first response was malformed. This is a simple repair strategy that improves robustness without making the main route overly specialized.

**Key points:** malformed JSON recovery, stronger follow-up instruction, simple repair path.

**Common mistakes:** Claiming retries are only for network errors.

---

# 6.3 "How Would You Build X" Questions

### Q1. How would you add auto-fill for all forms on a page?

I would extend `read_page` so every visible form and field is represented with stable metadata, then introduce a new workflow path that requests a structured fill plan for all detected forms instead of just the active one. The background would iterate form by form, filling safe fields, asking follow-up questions for missing required values, and only requesting approval at final submission boundaries.

**Key points:** richer form inventory, plan per form or per page, approval only for submit.

**Common mistakes:** Treating all fields as one giant flat form.

---

### Q2. How would you add tab-to-tab memory?

I would promote page context and chat state from single-run storage into a per-tab or per-domain memory store keyed by tab ID and URL. The service worker would maintain a conversation map so the user could switch tabs and still preserve context without confusing tool targets across unrelated pages.

**Key points:** keyed memory model, prevent cross-tab contamination, tab/domain/session scoping.

**Common mistakes:** One global memory blob for every tab.

---

### Q3. How would you add screenshot-based visual understanding?

I would capture screenshots through extension APIs, then pass them to a multimodal model alongside DOM context. I would use DOM-first reasoning as the default because it is cheaper and more structured, and only escalate to vision when the DOM is insufficient.

**Key points:** DOM first, vision fallback, screenshot capture pipeline, multimodal escalation strategy.

**Common mistakes:** Replacing DOM understanding entirely with screenshots.

---

### Q4. How would you add backend caching?

I would cache deterministic informational responses keyed by a hash of normalized goal plus summarized page context plus model config. For action-oriented tasks I would be much more conservative, because stale cached reasoning can be dangerous when the page changes.

**Key points:** cache safe informational queries, avoid stale action plans, include model/context hash.

**Common mistakes:** Caching tool actions blindly.

---

### Q5. How would you add streaming responses?

I would convert the backend route to SSE or WebSocket streaming and update the UI composables to append partial tokens or partial structured events. The main design challenge is deciding when the model is emitting user-facing text versus control JSON.

**Key points:** transport change, UI incremental render, structured control vs free text separation.

**Common mistakes:** Streaming raw half-formed JSON directly into the agent loop.

---

### Q6. How would you support keyboard shortcuts?

I would register extension commands in the manifest and route them to background handlers that open the side panel or trigger predefined actions. The important design choice is keeping shortcuts declarative and limited so they do not bypass approval or tool safety policies.

**Key points:** manifest commands, background routing, no safety bypass.

**Common mistakes:** Binding shortcuts only in the webpage context.

---

### Q7. How would you add multi-step workflow recording and replay?

I would record approved tool executions and the relevant page anchors used to locate elements, then serialize that into a macro definition with guardrails around selectors and expected page state. Replay would validate preconditions at each step and pause when the environment diverges too much.

**Key points:** record tools not arbitrary JS, validate preconditions, pause on divergence.

**Common mistakes:** Replaying raw coordinates or brittle selectors only.

---

### Q8. How would you add authentication and user sessions?

I would move the backend from local-only demo mode to an authenticated API with user IDs, session tokens, and per-user quotas. The extension would manage login state in a secure way and include auth headers on backend calls.

**Key points:** auth boundary at backend, per-user quota/session, extension-side token management.

**Common mistakes:** Putting long-lived secrets directly in content scripts.

---

# 6.4 Debugging And Edge Case Questions

### Q1. What happens if the model returns invalid JSON?

The background tries direct JSON parsing, then attempts to extract the first JSON object from wrapped output, and if needed can use a stricter retry path through the backend.

**Key points:** parse, extract, retry with stricter instruction.

**Common mistakes:** Assuming the model always obeys format.

---

### Q2. What happens if the target element disappears before a click?

The tool will fail to resolve or interact with the element, return an error, and the background can retry once. In a stronger version I would add a re-localization step that uses the latest page snapshot to find the closest matching candidate before failing.

**Key points:** DOM drift, bounded retry, re-localization as improvement.

**Common mistakes:** Believing selectors remain valid forever.

---

### Q3. What happens on `chrome://` pages?

The background detects restricted URL prefixes and returns a friendly error telling the user to open the copilot on a normal webpage. Extensions cannot script browser-internal pages.

**Key points:** restricted URL handling, user-friendly failure, browser security boundary.

**Common mistakes:** Treating it as a bug instead of expected platform behavior.

---

### Q4. How do you debug a failing tool?

I would isolate whether the failure is in target resolution, interactability, event simulation, or post-action verification. Because tools are modular, I can usually reproduce the failure by calling the content-script tool path directly with a known selector or HTML fixture, rather than debugging the whole agent loop at once.

**Key points:** isolate layers, reproduce deterministically, inspect tool result and DOM state.

**Common mistakes:** Debugging everything through the LLM loop first.

---

### Q5. What if the page loads content after your 150ms wait?

The current extractor uses a pragmatic fixed delay and mutation observers to catch later changes. In production I would prefer a more adaptive readiness heuristic.

**Key points:** pragmatic current approach, not perfect, adaptive readiness is better.

**Common mistakes:** Claiming 150ms is universally sufficient.

---

### Q6. What if the page has hidden duplicate buttons with the same text?

The system tries to work from currently visible, registered elements and interactability checks rather than only text matching. If ambiguity remains high, the best next step is to ask the user for confirmation or use more context.

**Key points:** visibility filtering, ambiguity remains possible, ask or enrich locator.

**Common mistakes:** Assuming label text alone is enough.

---

### Q7. How would you debug a form fill issue on a React app?

I would verify that the native setter is being used, confirm `input` and `change` events fire, and inspect whether the field is actually a custom widget rather than a native input.

**Key points:** native setter, event firing, custom widget detection.

**Common mistakes:** Treating every field as a plain HTML input.

---

### Q8. What if `MutationObserver` creates too much noise?

I would debounce and coalesce updates, and in a larger redesign I would compare semantic page signatures instead of reacting to every raw mutation.

**Key points:** debounce, coalesce, semantic diffing improvement.

**Common mistakes:** Triggering full agent refresh on every mutation.

---

# 6.5 Scalability And Production Questions

### Q1. How would you scale this backend for many users?

The backend is already mostly stateless, which is a strong starting point. I would put it behind a load balancer, move session-related metadata to Redis or a database if needed, add per-user auth and rate limiting, and introduce observability around latency, token usage, and failure classes.

**Key points:** stateless scaling, Redis/auth/rate limits, observability.

**Common mistakes:** Saying "just add more servers" without discussing state and quotas.

---

### Q2. What production metrics would you track?

I would track request latency, model latency, token usage, tool success rate, approval accept/reject rate, retry rate, malformed JSON rate, and per-tool failure categories. For the extension, I would also track UI open-to-first-response latency and completion rate for multi-step tasks.

**Key points:** latency, reliability, completion/safety metrics.

**Common mistakes:** Tracking only backend CPU and memory.

---

### Q3. How would you handle rate limiting?

I would enforce it at the backend using per-user or per-API-key quotas and possibly provider-aware concurrency caps. The extension should receive structured rate-limit responses so the UI can degrade gracefully.

**Key points:** backend enforcement, user/provider scope, graceful UI handling.

**Common mistakes:** Trying to enforce real security limits only in the client.

---

### Q4. What would you cache?

I would cache health checks, model metadata, maybe normalized informational responses, and possibly repeated page-context summaries when the page signature has not changed. I would avoid caching action plans across materially changing page states.

**Key points:** safe caching boundaries, page signature awareness, avoid stale actions.

**Common mistakes:** Caching mutable task flows indiscriminately.

---

### Q5. How would you add monitoring and alerting?

I would instrument the backend with structured logs, tracing IDs, and metrics export, then set alerts on provider failures, rising malformed-output rates, and latency spikes. For the extension, I would add anonymized telemetry only with explicit consent.

**Key points:** backend metrics/logging, alert on reliability regressions, privacy-conscious extension telemetry.

**Common mistakes:** Ignoring privacy when talking about analytics.

---

# 6.6 LLM And AI-Specific Questions

### Q1. Why is this an agent and not just prompt engineering?

Because the model is embedded inside a control loop with perception, action, memory, retries, and approval policies. Prompting is important, but the system behavior comes from the loop and the tool boundary, not from a single prompt alone.

**Key points:** loop matters, tools matter, environment state matters.

**Common mistakes:** Equating agents with long prompts.

---

### Q2. Why not let the model directly output selectors without reading the page?

Because that would be hallucination-prone and brittle. The model needs grounded context from the actual page and ideally stable runtime identifiers, otherwise it is just guessing what elements probably exist.

**Key points:** grounding, reduce hallucination, stable identifiers.

**Common mistakes:** Trusting model priors over live page state.

---

### Q3. Why not give the model the full page every time?

Because full page context is expensive and noisy, and too much irrelevant text can make reasoning worse, not better. The system budgets and summarizes context so the prompt window is used on what matters.

**Key points:** cost, relevance, context quality.

**Common mistakes:** Assuming more context is always better.

---

### Q4. Why separate informational queries from action-oriented queries?

Informational queries often do not need a multi-step tool loop, so routing them toward direct answers saves latency and cost. Action-oriented requests need tool use and environment updates to be safe and correct.

**Key points:** cost/latency optimization, different execution mode, grounded action requires loop.

**Common mistakes:** Using the full ReAct loop for every trivial summary.

---

### Q5. What are the biggest failure modes for LLM browser agents?

The main ones are stale perception, invalid structured output, ambiguous targets, and overconfident reasoning when the environment changed. That is why this design emphasizes read-act-read, bounded tools, retries, and approval for risky actions.

**Key points:** stale state, ambiguity, structured output brittleness.

**Common mistakes:** Blaming only model quality.

---

### Q6. How would you improve prompt engineering here?

I would add more few-shot examples per tool, explicit negative examples for ambiguous actions, tighter answer schemas, and maybe separate prompts for extraction, navigation, and drafting. I would also benchmark prompts with saved page fixtures rather than tuning them ad hoc.

**Key points:** few-shot examples, task-specific prompts, benchmark-driven prompt iteration.

**Common mistakes:** Prompt tuning only by intuition.
