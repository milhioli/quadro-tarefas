import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { ApiProvider } from '../api/ApiContext';
import type { ApiClient } from '../api/client';
import { createFakeApi, type FakeApi } from './fakeApi';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

/** Wrapper com QueryClient e API, para `render` e `renderHook`. */
export function createWrapper(api: ApiClient, queryClient: QueryClient) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={api}>{children}</ApiProvider>
      </QueryClientProvider>
    );
  };
}

export interface ProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  api?: FakeApi;
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: ProvidersOptions = {}) {
  const { api = createFakeApi(), queryClient = createTestQueryClient(), ...renderOptions } = options;
  const user = userEvent.setup();
  const result = render(ui, { wrapper: createWrapper(api, queryClient), ...renderOptions });
  return { ...result, api, queryClient, user };
}
