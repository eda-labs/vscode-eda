module.exports = {
  content: [
    './src/webviews/**/*.{ts,html}',
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
    'w-36',
    'w-80',
    'w-96',
    'max-w-screen-xl',
    'max-w-[500px]',
    'rounded',
    'rounded-lg',
    'rounded-full',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
