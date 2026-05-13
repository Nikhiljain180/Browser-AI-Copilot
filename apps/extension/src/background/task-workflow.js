/* global CopilotSw */

CopilotSw.ensureTaskWorkflowShape = function ensureTaskWorkflowShape() {
  const w = CopilotSw.agentState.taskWorkflow;
  if (w && typeof w === 'object') return;
  CopilotSw.agentState.taskWorkflow = null;
};

CopilotSw.clearTaskWorkflow = function clearTaskWorkflow() {
  CopilotSw.agentState.taskWorkflow = null;
};

CopilotSw.isTaskWorkflowActive = function isTaskWorkflowActive() {
  return Boolean(CopilotSw.agentState.taskWorkflow?.active);
};

CopilotSw.getTaskWorkflowMaxIterations = function getTaskWorkflowMaxIterations() {
  const base = Number(CopilotSw.CONFIG?.MAX_REACT_ITERATIONS) || 10;
  const extra = Number(CopilotSw.CONFIG?.MAX_TRANSACTIONAL_ITERATIONS) || 32;
  return CopilotSw.isTaskWorkflowActive() ? base + extra : base;
};
