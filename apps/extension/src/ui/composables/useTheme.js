import { ref, watch, onMounted } from 'vue';

const theme = ref('dark');

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
    saveTheme();
    applyTheme();
  }

  function applyTheme() {
    const root = document.documentElement;
    if (theme.value === 'dark') {
      root.classList.remove('light-mode');
      root.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
      root.classList.add('light-mode');
    }
  }

  async function saveTheme() {
    try {
      await chrome.storage.local.set({ theme: theme.value });
    } catch (e) {
      console.error('Failed to save theme', e);
    }
  }

  async function loadTheme() {
    try {
      const data = await chrome.storage.local.get('theme');
      if (data.theme) {
        theme.value = data.theme;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        theme.value = 'light';
      }
      applyTheme();
    } catch (e) {
      console.error('Failed to load theme', e);
    }
  }

  return {
    theme,
    toggleTheme,
    loadTheme,
  };
}
