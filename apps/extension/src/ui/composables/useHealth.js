import { ref } from 'vue';

export function useHealth() {
  const offline = ref(false);
  let healthCheckIntervalId = null;

  async function checkBackendHealth() {
    try {
      const backendURL = 'http://127.0.0.1:3000/api/health';
      const response = await fetch(backendURL, {
        method: 'GET',
      });
      offline.value = !response.ok;
    } catch (error) {
      offline.value = true;
    }
  }

  function startHealthCheckPolling() {
    if (healthCheckIntervalId) {
      clearInterval(healthCheckIntervalId);
    }
    checkBackendHealth();
    healthCheckIntervalId = setInterval(checkBackendHealth, 30000);
  }

  function stopHealthCheckPolling() {
    if (healthCheckIntervalId) {
      clearInterval(healthCheckIntervalId);
      healthCheckIntervalId = null;
    }
  }

  function isConnectivityError(message) {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('failed to fetch') ||
      normalized.includes('backend') ||
      normalized.includes('networkerror') ||
      normalized.includes('network error') ||
      normalized.includes('llm api error') ||
      normalized.includes('load failed')
    );
  }

  return {
    offline,
    checkBackendHealth,
    startHealthCheckPolling,
    stopHealthCheckPolling,
    isConnectivityError,
  };
}
