(() => {
  const STORAGE_KEY = "nicolabz-theme";
  const root = document.documentElement;
  const toggleButton = document.querySelector("[data-theme-toggle]");
  const themeLabel = document.querySelector("[data-theme-label]");
  const themeIcon = document.querySelector("[data-theme-icon]");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const form = document.querySelector("#demo-form");
  const formFeedback = document.querySelector("#form-feedback");

  function readSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(STORAGE_KEY);
      return savedTheme === "light" || savedTheme === "dark" ? savedTheme : null;
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The theme still works when storage is unavailable (private mode / policy).
    }
  }

  function getPreferredTheme() {
    const savedTheme = readSavedTheme();
    if (savedTheme) return savedTheme;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    root.dataset.theme = isDark ? "dark" : "light";
    toggleButton?.setAttribute("aria-pressed", String(isDark));
    toggleButton?.setAttribute("aria-label", isDark ? "Activer le thème clair" : "Activer le thème sombre");
    if (themeLabel) themeLabel.textContent = isDark ? "Mode clair" : "Mode sombre";
    if (themeIcon) themeIcon.textContent = isDark ? "☀" : "☾";
    themeColor?.setAttribute("content", isDark ? "#111513" : "#FAFAF8");
  }

  applyTheme(getPreferredTheme());

  toggleButton?.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });

  // Follow OS changes only while the user hasn't chosen a theme manually.
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (event) => {
    if (!readSavedTheme()) applyTheme(event.matches ? "dark" : "light");
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const projectName = String(formData.get("project") ?? "").trim();
    if (!projectName) {
      formFeedback.textContent = "Renseigne le nom du projet.";
      return;
    }
    formFeedback.textContent = `Démo : « ${projectName} » est prêt à être configuré.`;
  });
})();
