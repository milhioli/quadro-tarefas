import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeTask } from '../../test/fakeApi';
import { AgendaTaskButton } from './AgendaTaskButton';

describe('AgendaTaskButton', () => {
  it('mostra horário e título e abre a tarefa ao tocar', async () => {
    const onOpen = vi.fn();
    render(<AgendaTaskButton task={makeTask({ id: 3, title: 'Academia', color: 'verde' })} timeLabel="07:00 – 07:30" onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: '07:00 – 07:30 Academia' });
    expect(button.querySelector('.task-card')).toHaveClass('task-card--verde');
    await userEvent.setup().click(button);
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it('sem horário mostra só o cartão', () => {
    render(<AgendaTaskButton task={makeTask({ id: 1, title: 'Ler' })} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ler' })).toBeInTheDocument();
  });

  it('o título é texto, nunca HTML', () => {
    const { container } = render(<AgendaTaskButton task={makeTask({ id: 1, title: '<img src=x onerror=alert(1)>' })} onOpen={() => {}} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
