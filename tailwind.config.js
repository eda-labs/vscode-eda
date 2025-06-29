module.exports = {
  content: [
    './src/panels/**/*.{ts,html}',
    './src/styles/**/*.{css,ts}',
  ],
  safelist: [
    'btn',
    'btn-primary',
    'btn-secondary',
    'input',
    'text-gray-500',
    'pr-8',
    'mr-1',
    'hidden',
    'block',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
