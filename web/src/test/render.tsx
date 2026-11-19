import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { ApiProvider } from '../api/ApiContext';
import { BoardProvider } from '../api/BoardContext';
import type { ApiClient } from '../api/client';
import { createSessionCaches } from '../api/queries';
import { createFakeApi, type FakeApi } from './fakeApi';

/** Como o do app (inclusive o 401 que volta para o login), mas sem retry nem refetch no foco. */
export function createTestQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    ...createSessionCaches(() => client),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  return client;
}

/**
 * Wrapper com QueryClient, API e o quadro aberto, para `render` e `renderHook`.
 * `boardId: null` deixa de fora o BoardProvider (para o Shell, que escolhe o quadro).
 */
export function createWrapper(api: ApiClient, queryClient: QueryClient, boardId: number | null = 1) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>
          {boardId === null ? children : <BoardProvider boardId={boardId}>{children}</BoardProvider>}
        </ApiProvider>
      </QueryClientProvider>
    );
  };
}

export interface ProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  api?: FakeApi;
  queryClient?: QueryClient;
  /** Quadro aberto. Padrão: 1 (o quadro pessoal do admin na API fake). */
  boardId?: number | null;
}

export function renderWithProviders(ui: ReactElement, options: ProvidersOptions = {}) {
  const { api = createFakeApi(), queryClient = createTestQueryClient(), boardId = 1, ...renderOptions } = options;
  const user = userEvent.setup();
  const result = render(ui, { wrapper: createWrapper(api, queryClient, boardId), ...renderOptions });
  return { ...result, api, queryClient, user };
}
