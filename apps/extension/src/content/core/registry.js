const pageElementRegistry = new Map();

function registerElement(agentId, element) {
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
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  return null;
}
