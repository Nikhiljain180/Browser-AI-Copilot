# Demo Reproduction Guide

## Overview

This guide provides **exact, step-by-step instructions** to reproduce each demo scenario. Use this for hiring presentations, client demos, or internal validation.

---

## Prerequisites

✅ **Backend running:**
```bash
npm run dev:backend
# Should see: "Listening on port 3000"
```

✅ **Extension loaded** in Chrome (unpacked, developer mode)

✅ **Test fixture** accessible:
```
file:///Users/Nikhil_Jain/Downloads/High-level/assignment/browser-ai-copilot/tests/fixtures/ecommerce.html
```

---

## Demo 1: Single-Step Summarization (2 minutes)

### Script: "Summarizing Web Content"

**Goal:** Show that the AI can understand and summarize any webpage in seconds.

**Setup:**
1. Open any Wikipedia article or blog post (e.g., https://en.wikipedia.org/wiki/Artificial_intelligence)
2. Open AI Copilot extension (puzzle icon)

**Exact Steps:**
1. Click in the **chat input field**
2. Type: `"Summarize this page in 2-3 sentences for a non-technical person"`
3. Press `Ctrl+Enter` (or click Send)
4. **Wait 3-5 seconds** while observing the **Reasoning Window** on the right

**What to Show:**
- Reasoning window shows:
  - "Thought: The user wants a summary. I should read the page first."
  - "Action: `read_page`"
  - "Progress: 1/10 iterations"
- Page content extracts (you may see DOM updating)
- Chat shows result with `🔧 read_page` tool badge

**Expected Output in Chat:**
```
Assistant: "Artificial Intelligence is a field of computer science focused on creating systems that can perform tasks requiring human intelligence. This includes learning, problem-solving, and decision-making. Modern AI uses machine learning and neural networks to improve performance over time."

[Tool: read_page] [~3 seconds ago]
```

**Pro Tip:** Point out:
> "The extension understood the page structure in seconds, extracted key information, and generated a custom summary. No manual copy-pasting needed."

---

## Demo 2: Multi-Step Workflow (5 minutes)

### Script: "Finding & Analyzing E-Commerce Data"

**Goal:** Show agent autonomy - the AI reads, understands, makes decisions, and takes actions without human input between steps.

**Setup:**
1. Open test fixture: `file:///Users/Nikhil_Jain/Downloads/High-level/assignment/browser-ai-copilot/tests/fixtures/ecommerce.html`
2. Open AI Copilot extension

**Exact Steps:**
1. Click in chat input
2. Type: `"Find the most expensive product in the table, click on its 'View Details' button, and tell me the details"`
3. Press `Ctrl+Enter`
4. **Watch the Reasoning Window** for 10-15 seconds

**What to Show:**

**Iteration 1 (0-3 seconds):**
- Reasoning: "I need to read the page to see products"
- Action: `read_page`
- Progress: `1/10`
- Chat shows agent is thinking

**Iteration 2 (3-6 seconds):**
- Reasoning: "The most expensive product is '4K Monitor' at $599.99. I should click its 'View Details' button"
- Action: `click_element`
- Action Input: `{ selector: "button[data-product-id='4']" }`
- Progress: `2/10`

**Iteration 3 (6-10 seconds):**
- Reasoning: "Now I should extract the product details"
- Action: `extract_data`
- Progress: `3/10`

**Final Result in Chat:**
```
Assistant: I found the most expensive product! Here are the details:

- **Product:** 4K Monitor
- **Price:** $599.99
- **Category:** Electronics
- **Stock:** 5 units

[Tool: read_page] [Tool: click_element] [Tool: extract_data] [~8 seconds ago]
```

**Pro Tips to Highlight:**
> "Notice how the agent autonomously planned 3 steps:
> 1. Read the page (what's available?)
> 2. Click on a specific button (take action)
> 3. Extract data (get structured result)
> 
> All of this happened without waiting for human input between steps!"

---

## Demo 3: Human-in-the-Loop Safety Gate (5 minutes)

### Script: "Protecting Against Accidental Actions"

**Goal:** Show the safety mechanism - destructive actions require explicit human approval before execution.

**Setup:**
1. Open test fixture: `file:///Users/Nikhil_Jain/Downloads/High-level/assignment/browser-ai-copilot/tests/fixtures/ecommerce.html`
2. Open AI Copilot extension

**Exact Steps:**
1. Type in chat: `"Fill out the contact form and submit it with sample data"`
2. Press `Ctrl+Enter`
3. **Watch for the approval modal to appear** (after ~5 seconds)

**What to Show:**

**Phase 1: Filling Fields (No Approval Needed)**
- Agent autonomously fills:
  - Name: "Sample User" (`🔧 fill_input`)
  - Email: "sample@example.com" (`🔧 fill_input`)
  - Message: "Thank you for this great product!" (`🔧 fill_input`)
- You'll see 3 tool badges in chat

**Phase 2: Submission (Approval Required)**
- After filling, a **modal popup appears** blocking the action:
  ```
  ╔════════════════════════════════════════════╗
  │ ⚠️ Action Approval Required                │
  ├════════════════════════════════════════════┤
  │                                            │
  │ 🔴 HIGH RISK                              │
  │                                            │
  │ Action: click_element - Submit Form       │
  │                                            │
  │ Selector: button[data-action="submit"]    │
  │                                            │
  │ Side Effects:                              │
  │ - May submit form to server                │
  │ - Cannot be undone easily                  │
  │                                            │
  │ [❌ Reject]         [✅ Approve]          │
  ╚════════════════════════════════════════════╝
  ```

**Action 1: Click "Approve"**
- Modal closes
- Form submits
- Chat shows: `✅ Form submitted successfully!`
- Shows `🔧 click_element` badge

**Rerun with Rejection (Optional):**
- Type: `"Try filling and submitting the form again"`
- When modal appears, click `❌ Reject`
- Chat shows: `⛔ Action rejected by user`
- Form is NOT submitted

**Pro Tips:**
> "This is a critical safety feature. When the AI attempts a destructive action like:
> - Submitting a form
> - Deleting content
> - Making a purchase
> - Sending a message
> 
> The user gets a clear approval modal showing exactly what's about to happen. This prevents the AI from accidentally wreaking havoc!"

---

## Demo 4: Error Recovery (3 minutes)

### Script: "Graceful Error Handling"

**Goal:** Show that when things go wrong, the agent reports it clearly instead of crashing or hanging.

**Setup:**
1. Open test fixture
2. Open AI Copilot extension

**Exact Steps:**
1. Type: `"Click the button with ID 'this-button-does-not-exist'"`
2. Press `Ctrl+Enter`
3. **Watch for the error handling**

**What to Show:**

**Immediate Response (0-2 seconds):**
- Reasoning: "I should click that button"
- Action: `click_element`
- Attempt selector: `#this-button-does-not-exist`

**Error State (2-3 seconds):**
- Chat shows error message:
  ```
  ❌ I couldn't find the button. The element with ID "this-button-does-not-exist" 
  doesn't exist on the page. This might mean:
  
  - The page structure changed
  - The button is on a different page
  - The selector was incorrect
  
  Try a different approach or check the page manually.
  ```

**Key Observations:**
- ✅ No extension crash
- ✅ No infinite loop
- ✅ Clear error message
- ✅ Suggestions for user

**Pro Tips:**
> "The agent doesn't break when things go wrong. It clearly reports what happened and suggests alternatives. This builds user trust."

---

## Full Workflow Demo (10 minutes)

**Combine all scenarios into one impressive demo:**

1. **Start** on test fixture
2. **Summarization** (2 min): "Summarize what products are available"
3. **Multi-step** (3 min): "Find the cheapest product and extract its details"
4. **HITL** (3 min): "Fill form and try to submit"
5. **Error** (2 min): "Click a button that doesn't exist"

**Timing:** ~10 minutes total

**Talking Points:**
- AI understands pages semantically (not just raw DOM)
- Agent plans and executes multi-step workflows autonomously
- Safety gate prevents accidental actions
- Error handling is robust
- All thinking is transparent to the user

---

## Video Recording Tips

**If recording for portfolio/marketing:**

### Audio
- Speak clearly about what the agent is doing
- Narrate the reasoning window actions
- Highlight the approval modal interaction
- Don't record background noise

### Video Settings
- **Resolution:** 1920x1080 (1080p)
- **Speed:** 1x (real-time, not sped up)
- **Tool:** ScreenFlow (Mac) or OBS (all platforms)

### Editing
- Trim long waits to 1-2x speed only
- Add captions with timestamps
- Highlight chat messages and approval modals
- Cut together segments into 3-5 minute video

### Upload
- Upload to YouTube (unlisted)
- Share link in portfolio/GitHub
- Also create GIF for GitHub README

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Modal doesn't appear | Not destructive action | Ensure using `[data-action="submit"]` selector |
| Slow response | Backend not running | Check `npm run dev:backend` is running on port 3000 |
| Extension doesn't load | Wrong path | Verify extension path: `/apps/extension/public` |
| Form not filling | Content script error | Reload extension, clear cache |
| LLM timeout | API key invalid | Check `.env` OPENAI_API_KEY is correct |

---

## Success Checklist

✅ Backend server running (port 3000)
✅ Extension loaded in Chrome
✅ Test fixture opens without errors
✅ Chat input accepts text
✅ Reasoning window updates in real-time
✅ Tool badges appear in chat
✅ Approval modal appears for destructive actions
✅ Error messages are clear

If all checked, you're ready to demo! 🚀

---

**Demo Duration:**
- **Quick** (3 min): Summarization only
- **Medium** (7 min): Summarization + Multi-step
- **Full** (12 min): All scenarios + Q&A

**Recommended:** Start with Medium, expand based on audience interest.
