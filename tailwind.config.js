export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        cinzel: ["Cinzel", "serif"],
        crimson: ["Crimson Pro", "Georgia", "serif"],
        ui: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        card: "var(--bg-card)",
        gold: "var(--gold)",
        "gold-light": "var(--gold-light)",
        "gold-dim": "var(--gold-dim)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
      },
    },
  },
  plugins: [],
};
