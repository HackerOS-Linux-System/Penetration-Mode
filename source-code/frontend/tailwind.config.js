export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "redteam": {
          bg: "#050505",
          panel: "#111111",
          panel2: "#0f0f0f",
          border: "#222222",
          accent: "#ff3333",
          text: "#e0e0e0",
          muted: "#666666",
          term: "#00ff41",
        },
      },
    },
  },
  plugins: [],
};
