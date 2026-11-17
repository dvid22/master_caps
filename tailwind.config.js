/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      keyframes: {
        "overdue-blink": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(220, 38, 38, 0.55)",
            backgroundColor: "#ffffff",
          },
          "50%": {
            boxShadow: "0 0 0 7px rgba(220, 38, 38, 0)",
            backgroundColor: "#fef2f2",
          },
        },
      },
      animation: {
        "overdue-blink": "overdue-blink 1.4s ease-in-out infinite",
      },
      colors: {
        brand: {
          black: "#111111",
          gold: "#C9A227",
          cream: "#F8F5EF",
          green: "#16A34A",
          red: "#DC2626",
          blue: "#2563EB",
        },
      },
    },
  },
  plugins: [],
};