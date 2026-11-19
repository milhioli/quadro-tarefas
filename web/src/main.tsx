import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import { ApiProvider } from './api/ApiContext';
import { createApiClient } from './api/client';
import { createQueryClient } from './api/queries';
import { systemClock } from './lib/clock';
import { resolveClock } from './lib/devToday';
import { parseLoginOutcome, withoutLoginParam } from './lib/login';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

// ?hoje=AAAA-MM-DD simula a data, só em desenvolvimento.
const clock = resolveClock(window.location.search, import.meta.env.DEV, systemClock);

// O servidor volta com ?login=erro|cancelado|indisponivel quando o login não deu certo.
// O aviso é lido uma vez e sai da barra, para não reaparecer ao recarregar.
const loginOutcome = parseLoginOutcome(window.location.search);
const here = withoutLoginParam(window.location.pathname, window.location.search);
if (loginOutcome) window.history.replaceState(null, '', here);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <ApiProvider client={createApiClient()}>
        <Shell clock={clock} loginOutcome={loginOutcome} next={here} />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
