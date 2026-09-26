import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRouter } from './app/router.js';
import { AuthProvider } from './core/auth/AuthProvider.js';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/shell.css';
import './styles/main-site-header.css';
import './styles/main-site-fortune.css';
import './styles/commerce.css';
import './styles/components.css';
import './styles/activity.css';
import './styles/knowledge.css';
import './styles/discovery.css';
import './styles/festival.css';
import './styles/growth.css';
import './styles/sports.css';
import './styles/liaison.css';
import './styles/information.css';
import './styles/finance.css';
import './styles/collections.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </StrictMode>,
);
