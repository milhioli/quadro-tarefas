import { createTaskSchema } from '@quadro/shared';
import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { validate } from './validate';

describe('validate', () => {
  it('devolve os dados já transformados pelo schema', () => {
    expect(validate(createTaskSchema, { title: '  A  ' })).toEqual({ title: 'A' });
  });

  it('lança HttpError 400 com a lista de problemas', () => {
    try {
      validate(createTaskSchema, { title: '', color: 'red' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(400);
      expect(httpError.code).toBe('VALIDATION');
      expect(httpError.issues?.map((i) => i.path).sort()).toEqual(['color', 'title']);
    }
  });
});
