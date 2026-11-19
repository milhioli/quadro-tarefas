import { describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import type { BoardRepository, MembershipRecord } from '../repositories/boardRepository';
import { requireMember } from './access';

function boardsWith(membership: MembershipRecord | null): BoardRepository {
  return { membership: () => membership } as unknown as BoardRepository;
}

function statusOf(fn: () => unknown): number | 'ok' {
  try {
    fn();
    return 'ok';
  } catch (error) {
    return error instanceof HttpError ? error.statusCode : -1;
  }
}

describe('requireMember', () => {
  it('não membro e convidado pendente recebem 404, como se o quadro não existisse', () => {
    expect(statusOf(() => requireMember(boardsWith(null), 1, 1))).toBe(404);
    expect(statusOf(() => requireMember(boardsWith({ role: 'editor', status: 'invited' }), 1, 1))).toBe(404);
  });

  it('membro ativo passa; ação de dono exige o dono (editor recebe 403)', () => {
    expect(statusOf(() => requireMember(boardsWith({ role: 'editor', status: 'active' }), 1, 1))).toBe('ok');
    expect(statusOf(() => requireMember(boardsWith({ role: 'editor', status: 'active' }), 1, 1, 'owner'))).toBe(403);
    expect(statusOf(() => requireMember(boardsWith({ role: 'owner', status: 'active' }), 1, 1, 'owner'))).toBe('ok');
  });
});
