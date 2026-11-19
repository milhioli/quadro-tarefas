import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../test/fakeApi';
import { renderWithProviders } from '../../test/render';
import { PRIVACY_UPDATED_AT, PrivacyPage, RETENTION_ROWS } from './PrivacyPage';

describe('PrivacyPage', () => {
  it('mostra as seções da LGPD, a data da versão e o caminho de volta', () => {
    renderWithProviders(<PrivacyPage />, { boardId: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Privacidade' })).toBeInTheDocument();
    for (const name of [
      'Quem é o responsável',
      'O que coletamos',
      'Para que usamos',
      'Quem vê',
      'Onde ficam e por quanto tempo',
      'Quando você apaga a conta',
      'Cookies',
      'Seus direitos',
      'Incidentes',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText(`Última atualização: ${PRIVACY_UPDATED_AT}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao Quadro de tarefas' })).toHaveAttribute('href', '/');
  });

  it('a tabela de prazos tem uma linha por dado', () => {
    renderWithProviders(<PrivacyPage />, { boardId: null });
    const table = screen.getByRole('table', { name: 'Prazos de guarda' });
    expect(within(table).getAllByRole('row')).toHaveLength(RETENTION_ROWS.length + 1);
    expect(within(table).getByRole('rowheader', { name: 'Conta sem nenhum acesso' })).toBeInTheDocument();
  });

  it('o contato e o responsável vêm do servidor; o contato vira mailto', async () => {
    renderWithProviders(<PrivacyPage />, { boardId: null });
    const links = await screen.findAllByRole('link', { name: 'contato@example.com' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', 'mailto:contato@example.com');
    expect(screen.getByText(/operado por Operador de Teste/)).toBeInTheDocument();
  });

  it('sem contato configurado, diz isso em vez de um link', async () => {
    const api = createFakeApi();
    api.setInfo({ contactEmail: null, operatorName: null });
    renderWithProviders(<PrivacyPage />, { api, boardId: null });
    expect((await screen.findAllByText('o contato ainda não foi configurado neste servidor')).length).toBeGreaterThan(0);
    expect(screen.getByText(/operado por quem administra este servidor/)).toBeInTheDocument();
  });

  it('abre sem sessão: não pergunta quem está logado', async () => {
    const api = createFakeApi();
    api.setMe({ user: null, pendingProfile: null });
    renderWithProviders(<PrivacyPage />, { api, boardId: null });
    await screen.findAllByRole('link', { name: 'contato@example.com' });
    expect(api.calls.map((c) => c.method)).toEqual(['getInfo']);
  });
});
