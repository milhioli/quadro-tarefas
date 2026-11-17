import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { createApiClient } from './api/client';
import { createQueryClient } from './api/queries';
import { systemClock } from './lib/clock';
import { resolveClock } from './lib/devToday';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

// ?hoje=AAAA-MM-DD simula a data, só em desenvolvimento.
const clock = resolveClock(window.location.search, import.meta.env.DEV, systemClock);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <ApiProvider client={createApiClient()}>
        <App clock={clock} />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
