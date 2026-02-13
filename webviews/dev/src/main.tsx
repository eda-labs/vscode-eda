import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Could not find root element for dev shell');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
