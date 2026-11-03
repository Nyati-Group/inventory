import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          100: "#E6EEF5",
          500: "#2A6594",
          600: "#014B85",
          800: "#112C49",
        },
        bg: "#F6F8FB",
        surface: "#FFFFFF",
        border: "#E2E8F0",
        ink: "#0F172A",
        muted: "#64748B",
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      fontSize: { base: ["14px", "20px"] },
      borderRadius: { card: "12px" },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
