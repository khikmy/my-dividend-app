import type { Config } from "tailwindcss";

/**
 * やわらかい配色テーマ。
 * 既存の blue / red / green / violet を、少し明るく丸みのある色に差し替えている。
 * slate・角丸・影は Tailwind 標準のまま。
 */
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // 主色: やさしい藍
        blue: {
          50: "#eef2fc",
          100: "#dce4f8",
          200: "#bac8f1",
          300: "#93a8e8",
          400: "#6f87d6",
          500: "#5874cc",
          600: "#4a68c4",
          700: "#3c55a6",
          800: "#314688",
          900: "#283869",
        },
        // 赤字・警告: やわらかい朱
        red: {
          50: "#fdf0ee",
          100: "#fadcd8",
          200: "#f4bbb3",
          300: "#ec9488",
          400: "#e6766a",
          500: "#e0554a",
          600: "#d04a3f",
          700: "#b03a31",
          800: "#8d2f28",
          900: "#702620",
        },
        rose: { 500: "#e0554a", 600: "#d04a3f" },
        // 黒字: 明るい緑
        green: {
          50: "#edf8f2",
          100: "#d4efe1",
          200: "#a9dfc3",
          300: "#79caa2",
          400: "#4fb384",
          500: "#2f9e6b",
          600: "#278a5c",
          700: "#206f4b",
          800: "#1b583d",
          900: "#154432",
        },
        // 補助ボタン: 藤色
        violet: {
          50: "#f4f0fb",
          100: "#e7def6",
          500: "#8f6fcb",
          600: "#7e5ec0",
          700: "#6a4aa6",
        },
      },
    },
  },
  plugins: [],
};
export default config;
