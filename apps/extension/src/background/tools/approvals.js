/* global CopilotSw */

CopilotSw.pendingApprovals = CopilotSw.pendingApprovals || {};
CopilotSw.approvalPromises = CopilotSw.approvalPromises || {};

CopilotSw.waitForApproval = function waitForApproval(approvalId, timeoutMs) {
  return new Promise((resolve) => {
    CopilotSw.approvalPromises[approvalId] = resolve;
    setTimeout(() => {
      if (CopilotSw.approvalPromises[approvalId]) {
        delete CopilotSw.approvalPromises[approvalId];
        resolve(false);
      }
    }, timeoutMs);
  });
};

CopilotSw.handleApproveAction = async function handleApproveAction(approvalId) {
  const resolver = CopilotSw.approvalPromises[approvalId];
  if (resolver) {
    resolver(true);
    delete CopilotSw.approvalPromises[approvalId];
  }
  delete CopilotSw.pendingApprovals[approvalId];
  return { success: true };
};

CopilotSw.handleRejectAction = async function handleRejectAction(approvalId) {
  const resolver = CopilotSw.approvalPromises[approvalId];
  if (resolver) {
    resolver(false);
    delete CopilotSw.approvalPromises[approvalId];
  }
  delete CopilotSw.pendingApprovals[approvalId];
  return { success: true };
};

