# Manual testing — real Amazon + real LLM shopping flow

Fully automated verification of **extension + deterministic mock LLM + local HTML fixture** is:

```bash
npm run test:e2e:amazon-agent
```

Live **amazon.com** URL-only Playwright scripts **do not** exercise the Copilot (`taskWorkflow`, side panel prompts, approvals). Those are:

```bash
npm run test:e2e
```

Below is how to manually validate **the product** once automation has passed.

## Preconditions

1. Build / load unpacked extension (`apps/extension`) in Chrome Developer mode.
2. Start backend: `npm run dev:backend` (with real `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env`).
3. Open Side panel or popup (`public/popup.html`) for the browser tab where you will test.

## Happy-path checklist on live Amazon US

Use one **compound** prompt (similar to transactional heuristics):

> Buy running shoes under $50, search the site, narrow options, pick one realistic result, add to cart, open the cart icon, proceed toward checkout until the site asks for confirmation or login.

Observe:

1. Assistant posts a short **plan** (from `/api/llm/task-plan`) — not an error bubble.
2. Search field is filled and search runs **without approval modals** for routine clicks (while `taskWorkflow` is active).
3. Selecting an item / add to cart avoids **spam approval** except on **final place-order / payment** wording (your safety gate).

## Known limits (often need human eyes)

- **CAPTCHA / bot checks** — cannot be scripted reliably; unblock once and continue manually.
- **Login / OTP / MFA** — you must authenticate yourself; the agent should stop or ask rather than guessing credentials.
- **Layout / experiments** — LLM-selected selectors can miss; rerun or narrow the prompt.
- **Regional storefronts** — flows differ (`amazon.co.uk`, etc.); selectors and copy change.

If any step systematically fails across retries, capture **screenshot**, **exact URL**, and **last assistant/tool message** in chat — plus Network tab POSTs to `/api/llm/chat`.

## Smoke without Amazon

Developers short on network can rely on **`npm run test:e2e:amazon-agent`** (mock LLM + `tests/fixtures/amazon-shopping-mock.html`) before testing live ecommerce.
