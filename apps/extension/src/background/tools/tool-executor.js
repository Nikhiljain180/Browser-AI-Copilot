/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// ACTION CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_RISK_PATTERN = /\b(submit|apply|send|finish|complete|post|delete|remove|confirm)\b/;

/** Model sometimes sends placeholder text; prefer agentId or a real selector for approval UI. */
function isGenericClickDetail(value) {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return true;
  return /^(element|elements|the element|a element|an element|button|a button|the button|link|a link|the link|click|target|selector|\.)$/.test(
    t,
  );
}

function clickElementApprovalSummary(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};

  const rawDesc = String(input.description || '').trim();
  if (rawDesc && !isGenericClickDetail(rawDesc)) {
    return rawDesc.endsWith('.') ? rawDesc : `${rawDesc}.`;
  }

  const sel = String(input.selector || '').trim();
  if (sel && !isGenericClickDetail(sel)) {
    const max = 100;
    const shown = sel.length > max ? `${sel.slice(0, max)}…` : sel;
    return `Click the element matching: ${shown}.`;
  }

  const aid = String(input.agentId || input.agent_id || '').trim();
  if (aid) {
    return `Click the listed element (ref ${aid}).`;
  }

  return 'Click a page element — the model did not include a usable label or selector.';
}

/** Likely final-money / irreversible submits — keep approval modal for these even in transactional autopilot. */
const FINAL_IRREVERSIBLE_PATTERN =
  /\b(place\s+your\s+order|place\s+order|complete\s+purchase|buy\s+now|pay\s+now|confirm\s+payment|confirm\s+purchase|confirm\s+booking|book\s+now|confirm\s+order|submit\s+order|submit\s+payment|place\s+your\s+booking)\b/i;

function looksLikeFinalPurchaseOrPaymentClick(toolName, toolInput) {
  if (toolName !== 'click_element') return false;
  const description = String(toolInput?.description || '').trim();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description} ${selector}`;
  if (FINAL_IRREVERSIBLE_PATTERN.test(combined)) return true;
  return /\b(place|checkout|buy|payment|confirm|pay|submit|order)-/.test(selector);
}

/**
 * Public-site discovery: search boxes, SERP refinement, benign nav within results — no login money impact.
 * Heuristic-only (description + selector); skips approval when REQUIRE_CLICK_APPROVAL is on.
 */
function looksLikeRoutineDiscoveryClick(toolName, toolInput) {
  if (toolName !== 'click_element') return false;
  const description = String(toolInput?.description || '').trim();
  const selectorRaw = String(toolInput?.selector || '').trim();
  const combined = `${description} ${selectorRaw}`;
  const low = combined.toLowerCase();

  if (looksLikeFinalPurchaseOrPaymentClick(toolName, toolInput)) return false;
  if (FINAL_IRREVERSIBLE_PATTERN.test(combined)) return false;

  if (
    /\b(add\s*to\s*cart|add-to-cart|buy\s*now|buy-now|buy\s*at|buynow|checkout|proceed\s*to\s*checkout|mini-cart|shopping\s*basket)\b/.test(
      low,
    )
  ) {
    return false;
  }

  const searchDesc =
    /\b(search|query)\s+(?:box|field|bar|button|submit|icon|input|area)\b/.test(low) ||
    /\b(?:main|site|global|product|store|header)\s+search\b/.test(low) ||
    /\b(?:type|enter|fill)\s+(?:in\s+)?(?:into\s+(?:the\s+)?)?(?:search|query)\b/.test(low) ||
    /\b(?:open|expand)\s+(?:the\s+)?search\b/.test(low) ||
    /\b(?:click|press)\s+(?:the\s+)?(?:search\s+)?(?:button|box|field|bar|icon|magnifying|magnifier)\b/.test(
      low,
    ) ||
    /\b(?:run|perform|execute)\s+search\b/.test(low) ||
    /\bsubmit\s+(?:the\s+|site\s+)?search\b/.test(low) ||
    /\bsearch\s+submit\b/.test(low) ||
    /\bautosuggest\b/.test(low);

  const filterSortDesc =
    /\bapply\s+(?:the\s+)?(?:selected\s+)?(?:filter|facet)s?\b/.test(low) ||
    /\bapply\s+sort\b/.test(low) ||
    /\bfacet(?:ed)?\s+(?:filter|link|option)\b/.test(low) ||
    /\bfilter\s+(?:by|results|sidebar|panel|chips?)\b/.test(low) ||
    /\bsort\s*(?:by|dropdown|menu|\:)/.test(low) ||
    /\b(?:price|colour|color|rating|brand|size)\s+(?:filter|facet|sort)\b/.test(low);

  const paginationDesc =
    /\b(?:next|previous|prev)\s+page\b/.test(low) ||
    /\bpagination\b/.test(low) ||
    (/\bpage\s*\d+\b/.test(low) && /\b(?:result|search|listing|srp)\b/.test(low));

  if (searchDesc || filterSortDesc || paginationDesc) return true;

  if (
    selectorRaw &&
    /[#.]nav-search|[#_-]twotabsearch|[#_-]navSearch|field-keywords|search-alias|[?&]field-keywords=|[\s#.,]search-field|[\s#.,]searchbox|[\s#.,]site-search|header-search|facets?_?(?:container|narrow)|facet[\w-]*link|s-pagination|a-pagination|(?:^|[\s#.])\.?pager\b/i.test(
      selectorRaw,
    )
  ) {
    return true;
  }

  return false;
}

CopilotSw.classifyAction = function classifyAction(toolName, toolInput) {
  const description = String(toolInput?.description || '').trim();
  const selector = String(toolInput?.selector || '').toLowerCase();
  const combined = `${description.toLowerCase()} ${selector}`.trim();
  const requireClickApproval = CopilotSw.CONFIG?.REQUIRE_CLICK_APPROVAL === true;

  if (toolName !== 'click_element') {
    return { requiresApproval: false, riskLevel: 'low', actionDescription: description };
  }

  if (!requireClickApproval) {
    if (HIGH_RISK_PATTERN.test(combined)) {
      const base = clickElementApprovalSummary(toolInput).replace(/\.$/, '');
      return {
        requiresApproval: false,
        riskLevel: 'high',
        actionDescription: `${base} — this looks like a destructive submit/delete action.`,
      };
    }
    return {
      requiresApproval: false,
      riskLevel: 'medium',
      actionDescription: clickElementApprovalSummary(toolInput),
    };
  }

  if (
    CopilotSw.isTaskWorkflowActive?.() &&
    !looksLikeFinalPurchaseOrPaymentClick(toolName, toolInput)
  ) {
    return {
      requiresApproval: false,
      riskLevel: 'low',
      actionDescription: clickElementApprovalSummary(toolInput),
    };
  }

  if (looksLikeRoutineDiscoveryClick(toolName, toolInput)) {
    return {
      requiresApproval: false,
      riskLevel: 'low',
      actionDescription: clickElementApprovalSummary(toolInput),
    };
  }

  if (HIGH_RISK_PATTERN.test(combined)) {
    const base = clickElementApprovalSummary(toolInput).replace(/\.$/, '');
    return {
      requiresApproval: true,
      riskLevel: 'high',
      actionDescription: `${base} — this looks like a destructive submit/delete action.`,
    };
  }

  return {
    requiresApproval: true,
    riskLevel: 'medium',
    actionDescription: clickElementApprovalSummary(toolInput),
  };
};

CopilotSw.isDestructiveAction = function isDestructiveAction(toolName, toolInput) {
  return CopilotSw.classifyAction(toolName, toolInput).requiresApproval;
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_RETRY_DELAY_MS = 250;
const MAX_TOOL_ATTEMPTS = 2;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateApprovalId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

CopilotSw.executeToolWithApproval = async function executeToolWithApproval(
  toolName,
  toolInput,
  tabId,
) {
  const classification = CopilotSw.classifyAction(toolName, toolInput);

  if (!classification.requiresApproval) {
    return CopilotSw.executeTool(toolName, toolInput, tabId);
  }

  // ── Request human approval ──
  const approvalId = generateApprovalId();

  CopilotSw.pendingApprovals[approvalId] = {
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription,
    timestamp: Date.now(),
  };

  CopilotSw.broadcastUI({
    action: 'requestApproval',
    approvalId,
    toolName,
    toolInput,
    riskLevel: classification.riskLevel,
    actionDescription: classification.actionDescription,
  });

  const approved = await CopilotSw.waitForApproval(approvalId, CopilotSw.CONFIG.TOOL_TIMEOUT_MS);
  delete CopilotSw.pendingApprovals[approvalId];

  if (!approved) {
    return { error: 'User cancelled the action.' };
  }

  return CopilotSw.executeTool(toolName, toolInput, tabId);
};

CopilotSw.executeTool = async function executeTool(toolName, toolInput, tabId) {
  let payload = toolInput;
  if (
    toolName === 'click_element' &&
    toolInput &&
    typeof toolInput === 'object' &&
    typeof CopilotSw.sanitizeClickElementInput === 'function'
  ) {
    payload = CopilotSw.sanitizeClickElementInput({ ...toolInput });
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
    if (CopilotSw.agentState?.isRunning === false) {
      return { error: 'Agent stopped by user.' };
    }

    try {
      const result = await CopilotSw.sendMessageToTab(tabId, {
        action: 'executeTool',
        toolName,
        toolInput: payload,
      });

      if (result && !result.error) {
        return result;
      }

      const errMsg = String(result?.error || 'Tool returned an unknown error.');
      if (
        toolName === 'click_element' &&
        attempt === 1 &&
        CopilotSw.isTaskWorkflowActive?.() &&
        /not interactable|behind overlay/i.test(errMsg) &&
        payload &&
        typeof payload === 'object' &&
        !payload.force
      ) {
        payload = { ...payload, force: true };
      } else {
        lastError = new Error(errMsg);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_TOOL_ATTEMPTS) {
      await delay(TOOL_RETRY_DELAY_MS);
    }
  }

  return { error: lastError?.message || 'Tool failed.' };
};
