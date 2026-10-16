import React from 'react';
import ReactDOM from 'react-dom/client';
import { setupWebLogger } from './utils/logger.ts';
import { App } from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import './index.css';

// Inicializa padronização de logs no frontend (data/hora yyyy-mm-dd-hh:mm:ss.sss e app de origem)
setupWebLogger('evolvi-web');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
