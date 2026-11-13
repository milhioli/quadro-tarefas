import type { z } from 'zod';
import { HttpError } from './errors';

/** Valida `data` com o schema; em caso de falha lança 400 com a lista de problemas. */
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new HttpError(400, 'VALIDATION', 'Dados inválidos', issues);
  }
  return result.data;
}
