(() => {
  const storageKey = 'nicolabz-theme';
  const root = document.documentElement;
  const toggleButton = document.querySelector('[data-theme-toggle]');
  const themeLabel = document.querySelector('[data-theme-label]');
  const themeIcon = document.querySelector('[data-theme-icon]');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');

  function readSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(storageKey);
      return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null;
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Theme selection still works for the current page when storage is unavailable.
    }
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    root.dataset.theme = isDark ? 'dark' : 'light';
    toggleButton?.setAttribute('aria-pressed', String(isDark));
    toggleButton?.setAttribute('aria-label', isDark ? 'Activer le thème clair' : 'Activer le thème sombre');
    if (themeLabel) themeLabel.textContent = isDark ? 'Mode clair' : 'Mode sombre';
    if (themeIcon) themeIcon.textContent = isDark ? '☀' : '☾';
    themeColor?.setAttribute('content', isDark ? '#111513' : '#FAFAF8');
  }

  applyTheme(readSavedTheme() ?? (colorScheme?.matches ? 'dark' : 'light'));

  toggleButton?.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });

  colorScheme?.addEventListener('change', event => {
    if (!readSavedTheme()) applyTheme(event.matches ? 'dark' : 'light');
  });
})();
