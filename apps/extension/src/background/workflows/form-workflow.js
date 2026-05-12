/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// FIELD FILLING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function fillOneField(tabId, field, value) {
  if (!field || !value) return null;

  return CopilotSw.executeTool(
    'fill_input',
    {
      agent_id: field.agentId,
      selector: field.selector,
      value,
    },
    tabId,
  );
}

/** Split on newline, comma, or ". " (period + space). */
function splitAnswerFragments(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split(/\n|,|(?:\.\s+)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function normalizeLabelValueSegment(segment) {
  const s = String(segment || '').trim();
  if (!s) return '';
  const m = s.match(/^([a-zA-Z][a-zA-Z\s]{1,40})\s*:\s*(.+)$/);
  if (m) return m[2].trim();
  return s;
}

function tokenizeNormalizedBulkSegments(text) {
  return splitAnswerFragments(text).map(normalizeLabelValueSegment).filter(Boolean);
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const c = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}

function parseInlineFieldAnswers(text) {
  const source = String(text || '');
  if (!source.trim()) return {};

  const mappings = {};
  const normalized = splitAnswerFragments(source);

  for (const part of normalized) {
    const emailOnly = part.match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i);
    if (emailOnly) {
      mappings.email = part;
      mappings['email address'] = part;
      continue;
    }
    const match = part.match(/^([a-zA-Z][a-zA-Z\s]{1,40})\s*:\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (!value) continue;
    mappings[key] = value;
  }

  augmentMappingsFromCommaSeparatedContact(source, mappings);

  return mappings;
}

/** When the user sends "Name, email@x.com, address line" without Label: prefixes. */
function augmentMappingsFromCommaSeparatedContact(source, mappings) {
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const parts = source
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return;

  const emailIdx = parts.findIndex((p) => emailRe.test(p));
  if (emailIdx === -1) return;

  const emailMatch = parts[emailIdx].match(emailRe);
  const email = emailMatch ? emailMatch[0] : '';
  if (!email) return;

  if (parts.length >= 3 && emailIdx >= 1) {
    const name = parts.slice(0, emailIdx).join(', ');
    const rest = parts.slice(emailIdx + 1).join(', ');
    if (name) {
      mappings.name = name;
      mappings['full name'] = name;
    }
    mappings.email = email;
    mappings['email address'] = email;
    if (rest) {
      mappings.address = rest;
      mappings['shipping address'] = rest;
    }
    return;
  }

  // Two segments with email last: do not guess "name" — pending-field flow maps by order / email field.
  if (parts.length === 2 && emailIdx === 1) {
    mappings.email = email;
    mappings['email address'] = email;
  }
}

/** Split user reply into segments (newline, comma, or ". "). */
function tokenizeAnswerSegments(text) {
  return splitAnswerFragments(text);
}

/**
 * Match user label keys to a field using substring overlap + fuzzy token match against *that field's*
 * label/name/placeholder text only (no global demo vocabulary — scales to arbitrary forms).
 */
function mappingKeyMatchesFieldHaystack(haystackLc, keyLc) {
  if (!haystackLc || !keyLc) return false;
  if (haystackLc.includes(keyLc) || keyLc.includes(haystackLc)) return true;
  const keyWords = keyLc.split(/\s+/).filter((w) => w.length > 2);
  if (keyWords.some((w) => haystackLc.includes(w))) return true;

  const hayTok = haystackLc.split(/[^a-z0-9]+/i).filter((w) => w.length > 3);
  for (const tok of hayTok) {
    if (levenshtein(keyLc, tok) <= 2) return true;
    for (const kw of keyWords) {
      if (kw.length > 2 && levenshtein(kw, tok) <= 2) return true;
    }
  }
  return false;
}

function fieldRefHaystack(fieldRef, field) {
  return [
    field?.label,
    field?.name,
    field?.placeholder,
    fieldRef?.label,
    fieldRef?.question,
    field?.type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * User replied with comma-separated values for the fields the assistant asked for — map in order,
 * or put the segment containing @ on the pending email field (2-field case).
 */
function assignCommaPartsToPendingFields(parts, pending, lookup) {
  if (!Array.isArray(parts) || parts.length === 0 || pending.length === 0) return null;
  if (parts.length !== pending.length) return null;

  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const pendingEmailIdx = pending.findIndex((ref) => {
    const f = lookup.get(ref.agentId) || lookup.get(ref.selector) || ref;
    const h = fieldRefHaystack(ref, f);
    return /\bemail\b|\be-mail\b/.test(h) || f?.type === 'email';
  });
  const emailPartIdx = parts.findIndex((p) => emailRe.test(p));

  if (pending.length === 2 && emailPartIdx >= 0 && pendingEmailIdx >= 0) {
    const otherPartIdx = 1 - emailPartIdx;
    const otherPendingIdx = 1 - pendingEmailIdx;
    return [
      { fieldRef: pending[pendingEmailIdx], value: parts[emailPartIdx].trim() },
      { fieldRef: pending[otherPendingIdx], value: parts[otherPartIdx].trim() },
    ];
  }

  // 3+ segments: pin the @ segment to the email field; zip other segments to other pendings in order.
  if (pending.length > 2 && emailPartIdx >= 0 && pendingEmailIdx >= 0) {
    const nonEmailPartIdxs = parts.map((_, i) => i).filter((i) => i !== emailPartIdx);
    const nonEmailPendingIdxs = pending.map((_, i) => i).filter((i) => i !== pendingEmailIdx);
    if (nonEmailPartIdxs.length !== nonEmailPendingIdxs.length) return null;
    const valueByPendingIdx = new Map();
    valueByPendingIdx.set(pendingEmailIdx, parts[emailPartIdx].trim());
    nonEmailPendingIdxs.forEach((pIdx, i) => {
      valueByPendingIdx.set(pIdx, parts[nonEmailPartIdxs[i]].trim());
    });
    return pending.map((fieldRef, pIdx) => ({
      fieldRef,
      value: valueByPendingIdx.get(pIdx) || '',
    }));
  }

  return pending.map((fieldRef, i) => ({
    fieldRef,
    value: String(parts[i] || '').trim(),
  }));
}

async function tryMapPendingFieldsWithLlm(raw, pending, lookup, tabId) {
  if (typeof CopilotSw.requestPendingFieldMap !== 'function') return [];

  try {
    const rows = pending.map((ref) => {
      const f = lookup.get(ref.agentId) || lookup.get(ref.selector) || {};
      return {
        agentId: ref.agentId,
        selector: ref.selector,
        label: ref.label || f.label,
        type: f.type,
      };
    });

    const data = await CopilotSw.requestPendingFieldMap(raw, rows);
    const parsed = CopilotSw.parseJsonResponse(data.content);
    const values = parsed?.values && typeof parsed.values === 'object' ? parsed.values : {};

    const out = [];
    for (const fieldRef of pending) {
      const id = fieldRef.agentId;
      if (!id || values[id] == null) continue;
      const val = String(values[id]).trim();
      if (!val) continue;

      const result = await fillOneField(tabId, fieldRef, val);
      if (result?.error) continue;

      const field = lookup.get(fieldRef.agentId) || lookup.get(fieldRef.selector) || fieldRef;
      out.push({
        fieldRef,
        value: val,
        label: fieldRef.label || field?.label || 'Field',
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function handlePendingFieldAnswers(goal, session, formsInventory, tabId) {
  const pending = Array.isArray(session.pendingFields) ? session.pendingFields : [];
  if (pending.length === 0) return null;

  const raw = String(goal || '').trim();
  if (!raw) return null;

  const trimmedLower = raw.toLowerCase().trim();
  const bareAffirmativeDuringPending = ['yes', 'y', 'ok', 'okay'].includes(trimmedLower);

  if (CopilotSw.isNegativeIntent(raw)) return null;

  if (!(pending.length > 0 && bareAffirmativeDuringPending) && CopilotSw.isSubmitIntent(raw)) {
    return null;
  }

  if (pending.length > 0 && bareAffirmativeDuringPending) {
    const target = session.lastAskedField || pending[0];
    const question = target ? CopilotSw.askForField(target) : 'Please provide the required value.';
    return {
      message: `Use a real value for this field, not just "yes". ${question}`,
      autoSubmit: false,
    };
  }

  const allFields = (formsInventory || []).flatMap((form) => form?.fields || []);
  const lookup = CopilotSw.buildFieldLookup(allFields);
  const answered = [];
  const fillErrors = [];

  function answeredKeySet() {
    return new Set(answered.map((a) => CopilotSw.fieldKey(a.fieldRef)).filter(Boolean));
  }

  function remainingPending() {
    const filled = answeredKeySet();
    return pending.filter((r) => !filled.has(CopilotSw.fieldKey(r)));
  }

  // 0) One fragment per field when counts match — order follows session pending (page inventory order).
  // Keep successful fills even if another field fails (e.g. invalid email); continue with key/LLM for gaps.
  if (pending.length >= 2) {
    const parts = tokenizeNormalizedBulkSegments(raw);
    const pairs = assignCommaPartsToPendingFields(parts, pending, lookup);
    if (pairs && pairs.length === pending.length) {
      for (const { fieldRef, value } of pairs) {
        if (!value) continue;
        const result = await fillOneField(tabId, fieldRef, value);
        if (result?.error) {
          fillErrors.push(result.error);
          continue;
        }
        const field = lookup.get(fieldRef.agentId) || lookup.get(fieldRef.selector) || fieldRef;
        answered.push({
          fieldRef,
          value,
          label: fieldRef.label || field?.label || 'Field',
        });
      }
    }
  }

  const keyValueAnswers = parseInlineFieldAnswers(raw);

  // 1) Label:value pairs → match keys to each unfilled pending field using that field's own label text only.
  if (Object.keys(keyValueAnswers).length > 0) {
    const filledKeys = answeredKeySet();
    for (const fieldRef of pending) {
      const fk = CopilotSw.fieldKey(fieldRef);
      if (filledKeys.has(fk)) continue;

      const field = lookup.get(fieldRef.agentId) || lookup.get(fieldRef.selector) || fieldRef;
      const haystack = [
        field?.label,
        field?.name,
        field?.placeholder,
        fieldRef?.label,
        fieldRef?.question,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const haystackLc = haystack.toLowerCase();
      const matchedKey = Object.keys(keyValueAnswers).find((key) =>
        mappingKeyMatchesFieldHaystack(haystackLc, key.toLowerCase()),
      );
      if (!matchedKey) continue;

      const value = keyValueAnswers[matchedKey];
      const result = await fillOneField(tabId, fieldRef, value);
      if (result?.error) {
        fillErrors.push(result.error);
        continue;
      }
      answered.push({ fieldRef, value, label: fieldRef.label || field?.label || 'Field' });
      filledKeys.add(fk);
    }
  }

  // 1b) LLM fills whatever is still missing (works for large N — model sees only unfilled agent_ids).
  let stillNeed = remainingPending();
  if (stillNeed.length > 0 && pending.length >= 2) {
    const llmFilled = await tryMapPendingFieldsWithLlm(raw, stillNeed, lookup, tabId);
    for (const item of llmFilled) {
      answered.push(item);
    }
    stillNeed = remainingPending();
  }

  // 2) Last resort: whole message → single field only when exactly one slot remains and no structured keys.
  if (answered.length === 0 && Object.keys(keyValueAnswers).length === 0) {
    const left = remainingPending();
    if (left.length === 0) {
      /* noop */
    } else if (left.length >= 2) {
      const nextField = left[0];
      const question = nextField ? CopilotSw.askForField(nextField) : 'Please provide the required value.';
      return { message: question, autoSubmit: false };
    } else {
      const target = left[0];
      const result = await fillOneField(tabId, target, raw);
      if (!result?.error) {
        answered.push({ fieldRef: target, value: raw, label: target.label || 'Field' });
      } else {
        fillErrors.push(result.error);
      }
    }
  }

  if (answered.length === 0) {
    // Keep deterministic pending-field flow; do not fall back to LLM replanning
    // for short user answers like "abc", which causes unnecessary re-questioning loops.
    const nextField = session.lastAskedField || pending[0];
    const question = nextField ? CopilotSw.askForField(nextField) : 'Please provide the required value.';
    if (fillErrors.length > 0) {
      return {
        message: `I could not fill that field automatically yet. ${question}`,
        autoSubmit: false,
      };
    }
    return { message: question, autoSubmit: false };
  }

  session.filledFields = session.filledFields || {};
  const answeredKeys = new Set(
    answered.map((item) => CopilotSw.fieldKey(item.fieldRef)).filter(Boolean),
  );
  answered.forEach((item) => {
    session.filledFields[CopilotSw.fieldKey(item.fieldRef)] = item.value;
  });

  session.pendingFields = pending.filter((fieldRef) => !answeredKeys.has(CopilotSw.fieldKey(fieldRef)));
  session.lastAskedField = session.pendingFields[0] || null;
  session.active = session.pendingFields.length > 0;
  session.awaitingSubmitConfirmation = !session.active && !!session.autoSubmitRequested;
  await CopilotSw.agentState.save();

  if (session.pendingFields.length > 0) {
    return { message: CopilotSw.askForField(session.pendingFields[0]), autoSubmit: false };
  }
  if (session.autoSubmitRequested) {
    return { message: '', autoSubmit: true };
  }
  return {
    message: 'Thanks. All requested fields are filled.',
    autoSubmit: false,
  };
}

function getMissingRequiredFields(formsInventory) {
  const allFields = (formsInventory || []).flatMap((form) => form?.fields || []);
  return allFields
    .filter((field) => field && field.visible !== false && !field.disabled)
    .filter((field) => !CopilotSw.isFileUploadField(field))
    .filter((field) => field.required === true && field.isFilled !== true)
    .map((field) =>
      CopilotSw.normalizeFieldRef({
        agentId: field.agentId,
        selector: field.selector,
        label: field.label || field.name || field.placeholder || field.selector,
        type: field.type,
      }),
    );
}

function inventoryHasMissingRequired(formsInventory) {
  return getMissingRequiredFields(formsInventory).length > 0;
}

async function clearFieldsInForm(formsInventory, tabId) {
  const allFields = (formsInventory || []).flatMap((form) => form?.fields || []);

  for (const field of allFields) {
    if (!field || !field.selector || CopilotSw.isFileUploadField(field)) continue;

    await CopilotSw.executeTool(
      'fill_input',
      {
        agent_id: field.agentId,
        selector: field.selector,
        value: '',
      },
      tabId,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

async function handleClearFlow(pageContext, formsInventory, tabId) {
  const clearButtons = Array.isArray(pageContext?.buttons)
    ? pageContext.buttons.filter((btn) =>
        /\b(clear|reset|cancel|start over|wipe|empty)\b/i.test(String(btn.text || '')),
      )
    : [];

  if (clearButtons.length > 0) {
    const clearBtn = clearButtons[0];
    const result = await CopilotSw.executeTool(
      'click_element',
      {
        agent_id: clearBtn.agentId,
        selector: clearBtn.selector,
        description: clearBtn.text || 'Clear form',
      },
      tabId,
    );

    if (!result?.error) {
      CopilotSw.clearFormSession();
      return `Cleared the form using "${clearBtn.text || 'Clear'}" button.`;
    }
  }

  await clearFieldsInForm(formsInventory, tabId);
  CopilotSw.clearFormSession();
  return 'Cleared all form fields.';
}

async function handleEditFlow(goal, formsInventory, tabId) {
  const session = CopilotSw.agentState.formSession;
  const normalizedGoal = String(goal || '').toLowerCase();

  session.active = true;
  session.awaitingSubmitConfirmation = false;

  if (!session.editMode) {
    const matchedField = CopilotSw.findEditField(formsInventory, normalizedGoal);
    session.editMode = true;
    session.editField = matchedField ? CopilotSw.normalizeFieldRef(matchedField) : null;
    await CopilotSw.agentState.save();

    if (session.editField) return CopilotSw.askForEditField(session.editField);
    return 'Which field would you like to modify? (name, email, message)';
  }

  if (!session.editField) {
    const matchedField = CopilotSw.findEditField(formsInventory, normalizedGoal);

    if (!matchedField) {
      await CopilotSw.agentState.save();
      return 'Please tell me which field to update: name, email, or message.';
    }

    session.editField = CopilotSw.normalizeFieldRef(matchedField);
    await CopilotSw.agentState.save();
    return CopilotSw.askForEditField(session.editField);
  }

  const editField = session.editField;
  const newValue = String(goal || '').trim();

  if (!newValue) {
    await CopilotSw.agentState.save();
    return CopilotSw.askForEditField(editField);
  }

  const result = await fillOneField(tabId, editField, newValue);
  if (result?.error) {
    return `I could not update the ${editField.label || editField.name || 'field'}: ${result.error}`;
  }

  session.filledFields = session.filledFields || {};
  session.filledFields[CopilotSw.fieldKey(editField)] = newValue;
  session.pendingFields = Array.isArray(session.pendingFields)
    ? session.pendingFields.filter(
        (item) => CopilotSw.fieldKey(item) !== CopilotSw.fieldKey(editField),
      )
    : [];
  session.editMode = false;
  session.editField = null;
  session.lastAskedField = session.pendingFields[0] || null;

  const morePending = session.pendingFields.length > 0;
  session.active = morePending;
  session.awaitingSubmitConfirmation = !morePending && !!session.autoSubmitRequested;

  CopilotSw.agentState.chatHistory.push({
    role: 'tool',
    toolName: 'fill_input',
    content: result,
    timestamp: Date.now(),
  });

  await CopilotSw.agentState.save();

  const fieldLabel = editField.label || editField.name || 'Field';
  if (morePending) {
    return `${fieldLabel} updated. ${CopilotSw.askForField(session.pendingFields[0])}`;
  }
  if (session.autoSubmitRequested) {
    return `${fieldLabel} updated. Say "yes" or "submit" if you want me to submit the form.`;
  }
  return `${fieldLabel} updated.`;
}

async function handleSubmitConfirmation(goal, pageContext, session, tabId) {
  if (
    CopilotSw.isSubmitIntent(goal) ||
    CopilotSw.isFormSubmitGoal(String(goal || '').toLowerCase())
  ) {
    const submitButton = CopilotSw.resolveSubmitButton(pageContext, null, session);

    if (!submitButton?.selector && !submitButton?.agentId) {
      return 'I could not find a submit button for this form.';
    }

    CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await CopilotSw.executeToolWithApproval(
      'click_element',
      {
        agent_id: submitButton.agentId,
        selector: submitButton.selector,
        description: submitButton.text || 'Submit form',
      },
      tabId,
    );

    if (submitResult?.error) {
      return submitResult.error.includes('cancel')
        ? 'Submission was cancelled.'
        : `I could not submit the form: ${submitResult.error}`;
    }

    CopilotSw.clearFormSession();
    return 'Submitted the form after your approval.';
  }

  if (CopilotSw.isNegativeIntent(goal)) {
    session.awaitingSubmitConfirmation = false;
    session.active = false;
    await CopilotSw.agentState.save();
    return 'Okay, I will not submit it yet.';
  }

  return 'Say "yes" or "submit" if you want me to submit the form.';
}

async function handleExplicitSubmit(goal, pageContext, formsInventory, session, tabId) {
  const plan = await CopilotSw.requestFormFillPlan(
    goal,
    formsInventory,
    CopilotSw.agentState.chatHistory,
  );
  const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);
  let latestFormsInventory = formsInventory;

  // Fill any values the plan already resolved before checking required-missing.
  if (workflowPlan.fields.length > 0) {
    for (const fieldPlan of workflowPlan.fields) {
      const result = await CopilotSw.executeTool(
        'fill_input',
        {
          agent_id: fieldPlan.agentId,
          selector: fieldPlan.selector,
          value: fieldPlan.value,
        },
        tabId,
      );
      if (result?.error) continue;
      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: 'fill_input',
        content: result,
        timestamp: Date.now(),
      });
    }

    const refreshedContext = await CopilotSw.sendMessageToTab(tabId, {
      action: 'readPage',
      focusArea: null,
    }).catch(() => null);

    if (refreshedContext) {
      latestFormsInventory = CopilotSw.buildFormsInventory(refreshedContext);
    }
  }

  const requiredMissing = getMissingRequiredFields(latestFormsInventory);

  if (requiredMissing.length > 0) {
    CopilotSw.setFormSession(requiredMissing, true, {
      submitButtons: workflowPlan.submitButtons,
      targetButton: workflowPlan.targetButton,
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
      pageUrl: pageContext?.url,
      autoSubmitRequested: true,
    });
    await CopilotSw.agentState.save();

    const questions = requiredMissing.map((item) => `- ${CopilotSw.askForField(item)}`);
    return ['I need required fields before submitting:', ...questions].join('\n');
  }

  if (workflowPlan.missingFields.length > 0) {
    CopilotSw.setFormSession(workflowPlan.missingFields, true, {
      submitButtons: workflowPlan.submitButtons,
      targetButton: workflowPlan.targetButton,
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
      pageUrl: pageContext?.url,
    });
    await CopilotSw.agentState.save();

    const questions = workflowPlan.missingFields.map((item) => `- ${CopilotSw.askForField(item)}`);

    return ['I found the form, but I still need a few details:', ...questions].join('\n');
  }

  const submitButton = CopilotSw.resolveSubmitButton(pageContext, workflowPlan, session);
  if (!submitButton?.selector && !submitButton?.agentId) {
    return 'I could not find a submit button for this form.';
  }

  CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
  const submitResult = await CopilotSw.executeToolWithApproval(
    'click_element',
    {
      agent_id: submitButton.agentId,
      selector: submitButton.selector,
      description: submitButton.text || 'Submit form',
    },
    tabId,
  );

  if (submitResult?.error) {
    return submitResult.error.includes('cancel')
      ? 'Submission was cancelled.'
      : `I could not submit the form: ${submitResult.error}`;
  }

  CopilotSw.clearFormSession();
  return 'Submitted the form after your approval.';
}

async function handleFreshFormFill(goal, pageContext, formsInventory, session, tabId) {
  const normalizedGoal = String(goal || '').toLowerCase();
  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal);

  const plan = await CopilotSw.requestFormFillPlan(
    goal,
    formsInventory,
    CopilotSw.agentState.chatHistory,
  );
  const workflowPlan = CopilotSw.validateFormWorkflowPlan(plan, formsInventory);
  const responseLines = [];
  let didFillAny = false;

  const allFields = (formsInventory || []).flatMap((form) => form?.fields || []);
  const fallbackMissingFields = allFields
    .filter((field) => field && field.visible !== false && !field.disabled)
    .filter((field) => !CopilotSw.isFileUploadField(field))
    .filter((field) => {
      // Don't treat placeholder text (especially for <select>) as "filled".
      // The inventory already provides an isFilled boolean that handles selects correctly.
      return field.isFilled !== true;
    })
    .map((field) =>
      CopilotSw.normalizeFieldRef({
        agentId: field.agentId,
        selector: field.selector,
        label: field.label || field.name || field.placeholder || field.selector,
        type: field.type,
      }),
    );

  // ── Fill fields from plan ──
  if (workflowPlan.fields.length > 0) {
    const filledFields = [];

    for (const fieldPlan of workflowPlan.fields) {
      const result = await CopilotSw.executeTool(
        'fill_input',
        {
          agent_id: fieldPlan.agentId,
          selector: fieldPlan.selector,
          value: fieldPlan.value,
        },
        tabId,
      );

      if (result?.error) continue;

      filledFields.push({ field: fieldPlan.label, value: fieldPlan.value });
      didFillAny = true;

      CopilotSw.agentState.chatHistory.push({
        role: 'tool',
        toolName: 'fill_input',
        content: result,
        timestamp: Date.now(),
      });
    }

    if (filledFields.length > 0) {
      responseLines.push(
        [
          workflowPlan.summary || 'Filled the form with the information provided:',
          ...filledFields.map((item) => `- ${item.field}: ${item.value}`),
        ].join('\n'),
      );
    }
  }

  // ── Ask for missing fields ──
  const isNoDataFillRequest =
    /\bfill\b/.test(normalizedGoal) &&
    !/[:\n,]/.test(String(goal || '')) &&
    !/@/.test(String(goal || '')) &&
    !/\b\d{2,}\b/.test(String(goal || ''));

  const missingFieldsToAsk = isNoDataFillRequest
    ? fallbackMissingFields
    : workflowPlan.missingFields.length > 0
      ? workflowPlan.missingFields
      : workflowPlan.nextAction === 'ask_user'
        ? fallbackMissingFields
        : [];

  if (missingFieldsToAsk.length > 0 || workflowPlan.nextAction === 'ask_user') {
    CopilotSw.setFormSession(missingFieldsToAsk, true, {
      submitButtons: workflowPlan.submitButtons,
      targetButton: workflowPlan.targetButton,
      awaitingSubmitConfirmation: false,
      editMode: false,
      editField: null,
      pageUrl: pageContext?.url,
    });
    await CopilotSw.agentState.save();

    const questions =
      missingFieldsToAsk.length > 0
        ? missingFieldsToAsk.map((item) => `- ${CopilotSw.askForField(item)}`)
        : [];

    if (workflowPlan.summary) responseLines.push(workflowPlan.summary);
    if (questions.length > 0) {
      responseLines.push('I found the form, but I still need:');
      responseLines.push(...questions);
    } else {
      responseLines.push('I need a bit more information before I can continue.');
    }

    return responseLines.filter(Boolean).join('\n\n');
  }

  const hasFurtherStep =
    (workflowPlan.nextAction === 'continue' && !!workflowPlan.targetButton) ||
    (workflowPlan.nextAction === 'request_approval' && wantsSubmit) ||
    wantsSubmit;

  // ── Continue / next button flow ──
  if (workflowPlan.nextAction === 'continue' && workflowPlan.targetButton) {
    const buttonText = String(workflowPlan.targetButton.text || '').toLowerCase();
    const buttonIntent = String(workflowPlan.targetButton.intent || '').toLowerCase();
    const looksLikeSubmit =
      buttonIntent === 'submit' || /\b(submit|apply|send|finish|complete|post)\b/.test(buttonText);

    if (looksLikeSubmit && !wantsSubmit) {
      responseLines.push('I filled the fields.');
    } else {
      const clickFn = looksLikeSubmit ? CopilotSw.executeToolWithApproval : CopilotSw.executeTool;
      const continueResult = await clickFn(
        'click_element',
        {
          agent_id: workflowPlan.targetButton.agentId,
          selector: workflowPlan.targetButton.selector,
          description: workflowPlan.targetButton.text || 'Continue',
        },
        tabId,
      );

      if (continueResult?.error) {
        return [...responseLines, `I could not continue to the next step: ${continueResult.error}`]
          .filter(Boolean)
          .join('\n\n');
      }

      responseLines.push(
        `Moved to the next step using "${workflowPlan.targetButton.text || 'Continue'}".`,
      );
    }
  }

  // ── Handle submit if requested ──
  if (wantsSubmit) {
    const requiredMissing = getMissingRequiredFields(formsInventory);
    if (requiredMissing.length > 0) {
      CopilotSw.setFormSession(requiredMissing, true, {
        submitButtons: workflowPlan.submitButtons,
        targetButton: workflowPlan.targetButton,
        awaitingSubmitConfirmation: false,
        editMode: false,
        editField: null,
        pageUrl: pageContext?.url,
      });
      await CopilotSw.agentState.save();

      const questions = requiredMissing.map((item) => `- ${CopilotSw.askForField(item)}`);
      return [...responseLines, 'I still need required details before submit:', ...questions]
        .filter(Boolean)
        .join('\n\n');
    }

    const submitButton = CopilotSw.resolveSubmitButton(pageContext, workflowPlan, session);
    if (!submitButton?.selector && !submitButton?.agentId) {
      return [...responseLines, 'I could not find a submit button for this form.']
        .filter(Boolean)
        .join('\n\n');
    }

    CopilotSw.updateAgentStatus('acting', 'Waiting for approval before submitting the form.', true);
    const submitResult = await CopilotSw.executeToolWithApproval(
      'click_element',
      {
        agent_id: submitButton.agentId,
        selector: submitButton.selector,
        description: submitButton.text || 'Submit form',
      },
      tabId,
    );

    if (submitResult?.error) {
      return [
        ...responseLines,
        submitResult.error.includes('cancel')
          ? 'Submission was cancelled.'
          : `I could not submit the form: ${submitResult.error}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    CopilotSw.clearFormSession();
    responseLines.push('Submitted the form after your approval.');
  } else if (workflowPlan.nextAction === 'request_approval' && wantsSubmit) {
    session.awaitingSubmitConfirmation = true;
    session.active = false;
    session.submitButtons = workflowPlan.submitButtons || [];
    session.targetButton = workflowPlan.targetButton || null;
    responseLines.push('Say "yes" or "submit" if you want me to submit the form.');
  } else if (
    !wantsSubmit &&
    (workflowPlan.nextAction === 'fill_only' || workflowPlan.nextAction === 'done')
  ) {
    // Only clear the session when the page inventory shows required fields satisfied — the LLM
    // often returns "done" for meaningless short goals (e.g. "abc"), which must not wipe pending work.
    if (!inventoryHasMissingRequired(formsInventory)) {
      CopilotSw.clearFormSession();
      responseLines.push('Done. The form fields are filled.');
    } else {
      const stillMissing = getMissingRequiredFields(formsInventory);
      CopilotSw.setFormSession(stillMissing, true, {
        submitButtons: workflowPlan.submitButtons,
        targetButton: workflowPlan.targetButton,
        awaitingSubmitConfirmation: false,
        editMode: false,
        editField: null,
        pageUrl: pageContext?.url,
      });
      await CopilotSw.agentState.save();
      responseLines.push('I still need a few details to finish:');
      responseLines.push(...stillMissing.map((item) => `- ${CopilotSw.askForField(item)}`));
    }
  }

  // If we filled something and there is nothing left to ask/click/submit, emit completion — but never
  // clear session while required fields are still unfilled in inventory.
  if (!hasFurtherStep && didFillAny && !session?.awaitingSubmitConfirmation) {
    if (!inventoryHasMissingRequired(formsInventory)) {
      CopilotSw.clearFormSession();
      if (!responseLines.some((line) => /done\./i.test(String(line)))) {
        responseLines.push('Done. The form fields are filled.');
      }
    }
  }

  // ── Final response ──
  if (responseLines.length === 0) {
    if (workflowPlan.summary) return workflowPlan.summary;
    if (CopilotSw.isFormFillGoal(normalizedGoal)) {
      return 'I found the form, but I could not update any fields automatically on this page.';
    }
    return null;
  }

  await CopilotSw.agentState.save();
  return responseLines.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

CopilotSw.tryDirectFormWorkflow = async function tryDirectFormWorkflow(
  goal,
  pageContext,
  tabId,
  options = {},
) {
  CopilotSw.ensureFormSessionState();

  const normalizedGoal = String(goal || '').toLowerCase();
  const session = CopilotSw.agentState.formSession;
  const formsInventory = CopilotSw.buildFormsInventory(pageContext);
  const rawGoal = String(goal || '').trim();

  // Recovery path: if we recently asked for a specific field but session.active
  // was dropped, treat the next plain user message as the answer for lastAskedField.
  const hasPendingQueue =
    (Array.isArray(session.pendingFields) && session.pendingFields.length > 0) ||
    !!session?.lastAskedField;

  if (
    rawGoal &&
    hasPendingQueue &&
    !CopilotSw.isSubmitIntent(rawGoal) &&
    !CopilotSw.isNegativeIntent(rawGoal) &&
    !session?.awaitingSubmitConfirmation
  ) {
    if (!Array.isArray(session.pendingFields) || session.pendingFields.length === 0) {
      session.pendingFields = session.lastAskedField ? [session.lastAskedField] : [];
    }
    session.active = true;
    const recovered = await handlePendingFieldAnswers(
      rawGoal,
      session,
      formsInventory,
      tabId,
    );

    if (recovered?.autoSubmit) {
      return handleSubmitConfirmation('submit', pageContext, session, tabId);
    }
    if (recovered?.message) return recovered.message;
  }

  // ── Determine intent (minimal gating; LLM drives the steps) ──
  const treatAsFormFillFromIntent = options.treatAsFormFill === true;
  const structuredFollowUpAfterFill =
    typeof CopilotSw.shouldTreatMessageAsFormValueFollowUp === 'function' &&
    CopilotSw.shouldTreatMessageAsFormValueFollowUp(rawGoal, CopilotSw.agentState.chatHistory);
  const wantsFill =
    CopilotSw.isFormFillGoal(normalizedGoal) ||
    !!session?.active ||
    structuredFollowUpAfterFill ||
    treatAsFormFillFromIntent;
  const wantsSubmit = CopilotSw.isFormSubmitGoal(normalizedGoal) || CopilotSw.isSubmitIntent(goal);
  const wantsClear = CopilotSw.isFormClearGoal(normalizedGoal);

  // ── Bail out if not a form workflow ──
  if (
    !wantsFill &&
    !wantsSubmit &&
    !wantsClear &&
    !session?.active &&
    !session?.awaitingSubmitConfirmation
  ) {
    return null;
  }

  if (!formsInventory.length && !session?.active && !session?.awaitingSubmitConfirmation) {
    return 'I could not find any form fields on this page.';
  }

  // ── Route to appropriate handler ──
  if (wantsClear) {
    return handleClearFlow(pageContext, formsInventory, tabId);
  }

  if (session?.awaitingSubmitConfirmation) {
    return handleSubmitConfirmation(goal, pageContext, session, tabId);
  }

  if (session?.active) {
    const pendingAnswerFlow = await handlePendingFieldAnswers(goal, session, formsInventory, tabId);
    if (pendingAnswerFlow?.autoSubmit) {
      return handleSubmitConfirmation('submit', pageContext, session, tabId);
    }
    if (pendingAnswerFlow?.message) return pendingAnswerFlow.message;

    // Pending handler returned null (e.g. submit phrasing) — never jump to a fresh LLM plan while
    // we still have queued fields; that replan replaces pending state and feels like a full revert.
    if (
      CopilotSw.isSubmitIntent(goal) ||
      CopilotSw.isFormSubmitGoal(normalizedGoal)
    ) {
      return handleExplicitSubmit(goal, pageContext, formsInventory, session, tabId);
    }
    const nextPending = session.pendingFields?.[0] || session.lastAskedField;
    if (nextPending) {
      return CopilotSw.askForField(nextPending);
    }

    return handleFreshFormFill(goal, pageContext, formsInventory, session, tabId);
  }

  if (wantsSubmit) {
    return handleExplicitSubmit(goal, pageContext, formsInventory, session, tabId);
  }

  if (!session?.active) {
    return handleFreshFormFill(goal, pageContext, formsInventory, session, tabId);
  }

  return null;
};
