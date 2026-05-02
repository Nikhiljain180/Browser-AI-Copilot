/* global CopilotSw */

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE & FIELD UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FORM_SESSION = {
  active: false,
  pendingFields: [],
  lastAskedField: null,
  filledFields: {},
  awaitingSubmitConfirmation: false,
  editMode: false,
  editField: null,
  submitButtons: [],
  targetButton: null,
  pageUrl: null,
};

CopilotSw.ensureFormSessionState = function ensureFormSessionState() {
  if (!CopilotSw.agentState.formSession) {
    CopilotSw.agentState.formSession = { ...DEFAULT_FORM_SESSION };
  } else {
    const s = CopilotSw.agentState.formSession;
    if (typeof s.active !== 'boolean') s.active = false;
    if (!Array.isArray(s.pendingFields)) s.pendingFields = [];
    if (!s.lastAskedField) s.lastAskedField = null;
    if (!s.filledFields || typeof s.filledFields !== 'object') s.filledFields = {};
    if (typeof s.awaitingSubmitConfirmation !== 'boolean') s.awaitingSubmitConfirmation = false;
    if (typeof s.editMode !== 'boolean') s.editMode = false;
    if (!s.editField) s.editField = null;
    if (!Array.isArray(s.submitButtons)) s.submitButtons = [];
    if (!s.targetButton) s.targetButton = null;
    if (typeof s.pageUrl !== 'string') s.pageUrl = null;
  }
  return CopilotSw.agentState.formSession;
};

CopilotSw.setFormSession = function setFormSession(fields = [], active = true, meta = {}) {
  const session = CopilotSw.ensureFormSessionState();
  session.active = active;
  session.pendingFields = fields.map(CopilotSw.normalizeFieldRef);
  session.lastAskedField = session.pendingFields[0] || null;
  session.filledFields = session.filledFields || {};
  session.awaitingSubmitConfirmation = !!meta.awaitingSubmitConfirmation;
  session.editMode = !!meta.editMode;
  session.editField = meta.editField ? CopilotSw.normalizeFieldRef(meta.editField) : null;
  session.submitButtons = Array.isArray(meta.submitButtons) ? meta.submitButtons : (session.submitButtons || []);
  session.targetButton = meta.targetButton || session.targetButton || null;
  if (typeof meta.pageUrl === 'string') session.pageUrl = meta.pageUrl;
  return session;
};

CopilotSw.clearFormSession = function clearFormSession() {
  CopilotSw.agentState.formSession = { ...DEFAULT_FORM_SESSION };
  return CopilotSw.agentState.formSession;
};

CopilotSw.normalizeFieldRef = function normalizeFieldRef(item = {}) {
  return {
    agentId: item.agentId || item.agent_id || '',
    selector: item.selector || '',
    label: item.label || item.name || item.question || item.selector || '',
    question: item.question || '',
    type: item.type || '',
    value: typeof item.value === 'string' ? item.value : '',
    reason: item.reason || '',
  };
};

CopilotSw.fieldKey = function fieldKey(field = {}) {
  return field.selector || field.agentId || field.label || field.name || '';
};

CopilotSw.buildFieldLookup = function buildFieldLookup(fields = []) {
  const map = new Map();
  fields.forEach(field => {
    if (field?.agentId) map.set(field.agentId, field);
    if (field?.selector) map.set(field.selector, field);
  });
  return map;
};

CopilotSw.buildButtonLookup = function buildButtonLookup(buttons = []) {
  const map = new Map();
  buttons.forEach(button => {
    if (button?.agentId) map.set(button.agentId, button);
    if (button?.selector) map.set(button.selector, button);
  });
  return map;
};
