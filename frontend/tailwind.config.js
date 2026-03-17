/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: "#f4efe5",
        ink: "#1d2733",
        teal: "#0f766e",
        coral: "#f97316",
        slate: "#2f3b4b",
      },
      boxShadow: {
        panel: "0 24px 60px rgba(17, 24, 39, 0.12)",
      },
    },
  },
  plugins: [],
};
