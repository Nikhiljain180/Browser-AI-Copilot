// @ts-nocheck
export const pageElementRegistry = new Map();

export function clearRegistry() {
  pageElementRegistry.clear();
}

export function registerElement(agentId, element) {
  if (!agentId || !element) return '';
  pageElementRegistry.set(agentId, element);
  return agentId;
}

function resolveElement({ agentId, agent_id, selector }) {
  const resolvedAgentId = agentId || agent_id;

  if (resolvedAgentId && pageElementRegistry.has(resolvedAgentId)) {
    return pageElementRegistry.get(resolvedAgentId);
  }

  if (selector) {
    return document.querySelector(selector);
  }

  return null;
}

export { resolveElement };