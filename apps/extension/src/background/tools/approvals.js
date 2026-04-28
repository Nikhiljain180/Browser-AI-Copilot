export const pendingApprovals = {};
export const approvalPromises = {};

export function waitForApproval(approvalId, timeoutMs) {
  return new Promise((resolve) => {
    approvalPromises[approvalId] = resolve;
    setTimeout(() => {
      if (approvalPromises[approvalId]) {
        delete approvalPromises[approvalId];
        resolve(false);
      }
    }, timeoutMs);
  });
}

export async function handleApproveAction(approvalId) {
  const resolver = approvalPromises[approvalId];
  if (resolver) {
    resolver(true);
    delete approvalPromises[approvalId];
  }
  delete pendingApprovals[approvalId];
  return { success: true };
}

export async function handleRejectAction(approvalId) {
  const resolver = approvalPromises[approvalId];
  if (resolver) {
    resolver(false);
    delete approvalPromises[approvalId];
  }
  delete pendingApprovals[approvalId];
  return { success: true };
}
