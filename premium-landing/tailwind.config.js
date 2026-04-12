/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        gold: {
          100: '#FFF8D6',
          200: '#FFEDAD',
          300: '#FFE285',
          400: '#FFD75C',
          500: '#FFD700', // Base Gold
          600: '#CCAC00',
          700: '#998100',
          800: '#665600',
          900: '#332B00',
        },
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(to right, #DFB943, #FFF086, #E0B941)',
        'black-gradient': 'linear-gradient(to bottom, #111111, #000000)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
};
