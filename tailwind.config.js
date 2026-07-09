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