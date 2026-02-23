/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wordle: {
          correct: '#538d4e',
          present: '#b59f3b',
          absent: '#3a3a3c',
          empty: '#121213',
          border: '#565758',
        },
      },
    },
  },
  plugins: [],
};
