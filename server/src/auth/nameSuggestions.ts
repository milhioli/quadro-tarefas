/**
 * Sugestão do nome de exibição para o primeiro acesso (o `given_name` do
 * Google). Fica só em memória, até o perfil ser criado: o nome do Google não
 * é guardado no banco, só o nome de exibição que a pessoa escolher.
 */
export interface NameSuggestions {
  set(userId: number, name: string): void;
  get(userId: number): string;
  delete(userId: number): void;
}

const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/** Limpa a sugestão para caber no nome de exibição: sem controles nem bidi, até 40 caracteres. */
export function cleanSuggestion(raw: string): string {
  return Array.from(raw.replace(HIDDEN_CHARACTERS, '').trim()).slice(0, 40).join('').trim();
}

export function createNameSuggestions(max = 1000): NameSuggestions {
  const map = new Map<number, string>();
  return {
    set(userId, name) {
      const clean = cleanSuggestion(name);
      if (clean === '') return;
      map.delete(userId);
      if (map.size >= max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(userId, clean);
    },
    get(userId) {
      return map.get(userId) ?? '';
    },
    delete(userId) {
      map.delete(userId);
    },
  };
}
