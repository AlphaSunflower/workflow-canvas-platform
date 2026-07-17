/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        node: {
          image: '#3B82F6',
          video: '#8B5CF6',
          ply: '#10B981',
          aiChat: '#F97316',
          aiImageGen: '#EC4899',
          aiVideoGen: '#06B6D4',
          group: '#6B7280',
        },
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite',
        'flow': 'flow 1s linear infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        flow: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
      },
    },
  },
  plugins: [],
}
