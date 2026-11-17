import { describe, expect, it, vi } from 'vitest';
import { makeTask } from '../test/fakeApi';
import {
  AGENDA_VIEWS,
  AGENDA_VIEW_STORAGE_KEY,
  browserStorage,
  clampSpan,
  defaultAgendaDay,
  endChoices,
  loadAgendaView,
  parseAgendaView,
  saveAgendaView,
  slotChoices,
  tasksForDay,
  type StorageGetter,
} from './agenda';
import { boardColumns } from './board';
import { parseIsoDate } from './calendar';

const d = (iso: string) => parseIsoDate(iso) as Date;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
}

describe('visualizações', () => {
  it('três tags na ordem Dia, Dia completo, Semana', () => {
    expect(AGENDA_VIEWS.map((v) => [v.id, v.label])).toEqual([
      ['day', 'Dia'],
      ['dayFull', 'Dia completo'],
      ['week', 'Semana'],
    ]);
  });

  it('parseAgendaView aceita só os ids conhecidos', () => {
    expect(parseAgendaView('day')).toBe('day');
    expect(parseAgendaView('dayFull')).toBe('dayFull');
    expect(parseAgendaView('week')).toBe('week');
  });

  it.each(['toString', '__proto__', 'constructor', 'week ', 'WEEK', '', null, undefined, 3, {}])(
    'valor fora da lista %j vira "day"',
    (value) => {
      expect(parseAgendaView(value)).toBe('day');
    },
  );
});

describe('persistência da visualização', () => {
  it('salva e lê a escolha', () => {
    const storage = memoryStorage();
    const get: StorageGetter = () => storage;
    saveAgendaView(get, 'week');
    expect(storage.setItem).toHaveBeenCalledWith(AGENDA_VIEW_STORAGE_KEY, 'week');
    expect(loadAgendaView(get)).toBe('week');
  });

  it('sem nada salvo usa "day"', () => {
    expect(loadAgendaView(() => memoryStorage())).toBe('day');
  });

  it('valor estranho salvo por outro app vira "day"', () => {
    expect(loadAgendaView(() => memoryStorage({ [AGENDA_VIEW_STORAGE_KEY]: '__proto__' }))).toBe('day');
  });

  it('acesso ao storage que lança erro não quebra', () => {
    const denied: StorageGetter = () => {
      throw new DOMException('negado', 'SecurityError');
    };
    expect(loadAgendaView(denied)).toBe('day');
    expect(() => saveAgendaView(denied, 'week')).not.toThrow();
  });

  it('getItem e setItem que lançam erro não quebram', () => {
    const broken: StorageGetter = () => ({
      getItem: () => {
        throw new Error('cheio');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    });
    expect(loadAgendaView(broken)).toBe('day');
    expect(() => saveAgendaView(broken, 'dayFull')).not.toThrow();
  });

  it('browserStorage usa o localStorage do navegador', () => {
    saveAgendaView(browserStorage, 'dayFull');
    expect(window.localStorage.getItem(AGENDA_VIEW_STORAGE_KEY)).toBe('dayFull');
    expect(loadAgendaView(browserStorage)).toBe('dayFull');
  });
});

describe('tasksForDay', () => {
  it('só as agendadas no dia, em ordem de horário', () => {
    const tasks = [
      makeTask({ id: 1, day: 1, slot: 20 }),
      makeTask({ id: 2 }),
      makeTask({ id: 3, day: 1, slot: 2 }),
      makeTask({ id: 4, day: 2, slot: 0 }),
    ];
    expect(tasksForDay(tasks, 1).map((t) => t.id)).toEqual([3, 1]);
    expect(tasksForDay(tasks, 0)).toEqual([]);
  });
});

describe('defaultAgendaDay', () => {
  it('abre no dia de hoje', () => {
    expect(defaultAgendaDay(boardColumns(d('2026-11-17')))).toBe(1);
    expect(defaultAgendaDay(boardColumns(d('2026-11-13')))).toBe(4);
  });

  it('no fim de semana abre na segunda', () => {
    expect(defaultAgendaDay(boardColumns(d('2026-11-15')))).toBe(0);
    expect(defaultAgendaDay(boardColumns(d('2026-11-14')))).toBe(0);
  });
});

describe('slotChoices', () => {
  const tasks = [makeTask({ id: 1, title: 'Reunião', day: 0, slot: 2 }), makeTask({ id: 2, title: 'Eu', day: 0, slot: 5 })];

  it('lista os 34 horários com o ocupante de cada um', () => {
    const choices = slotChoices(tasks, 0);
    expect(choices).toHaveLength(34);
    expect(choices[0]).toEqual({ slot: 0, label: '05:00 – 05:30', occupant: undefined });
    expect(choices[2]?.occupant?.title).toBe('Reunião');
    expect(choices[33]?.label).toBe('21:30 – 22:00');
  });

  it('a própria tarefa não conta como ocupante', () => {
    expect(slotChoices(tasks, 0, 2)[5]?.occupant).toBeUndefined();
    expect(slotChoices(tasks, 0, 2)[2]?.occupant?.title).toBe('Reunião');
  });

  it('outro dia está livre', () => {
    expect(slotChoices(tasks, 3).every((c) => c.occupant === undefined)).toBe(true);
  });

  it('um horário coberto pela faixa de outra tarefa aparece ocupado', () => {
    const long = [makeTask({ id: 9, title: 'Plantão', day: 1, slot: 0, span: 30 })];
    const choices = slotChoices(long, 1);
    expect(choices[29]?.occupant?.title).toBe('Plantão');
    expect(choices[30]?.occupant).toBeUndefined();
    expect(slotChoices(long, 1, 9).every((c) => c.occupant === undefined)).toBe(true);
  });
});

describe('endChoices e clampSpan ("Até")', () => {
  const tasks = [makeTask({ id: 1, day: 0, slot: 4, span: 2 }), makeTask({ id: 2, day: 0, slot: 10 })];

  it('vai do fim do próprio slot até a próxima tarefa, com a duração', () => {
    const choices = endChoices(tasks, 0, 6);
    expect(choices.map((c) => c.span)).toEqual([1, 2, 3, 4]);
    expect(choices[0]?.label).toBe('08:30 (30 min)');
    expect(choices.at(-1)?.label).toBe('10:00 (2 h)');
  });

  it('sem tarefa abaixo vai até 22:00; a própria tarefa não limita', () => {
    expect(endChoices(tasks, 1, 30).map((c) => c.label)).toEqual([
      '20:30 (30 min)',
      '21:00 (1 h)',
      '21:30 (1 h 30)',
      '22:00 (2 h)',
    ]);
    expect(endChoices(tasks, 0, 4, 1)).toHaveLength(6);
  });

  it('horário ocupado não tem fim possível', () => {
    expect(endChoices(tasks, 0, 5)).toEqual([]);
  });

  it('clampSpan reduz ao que cabe e nunca fica abaixo de 1', () => {
    expect(clampSpan(tasks, 0, 6, 10)).toBe(4);
    expect(clampSpan(tasks, 0, 6, 2)).toBe(2);
    expect(clampSpan(tasks, 0, 5, 3)).toBe(1);
  });
});
