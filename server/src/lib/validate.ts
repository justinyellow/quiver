import type { z, ZodTypeAny } from 'zod'
import { badRequest } from './errors.js'

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw badRequest('Validation failed', r.error.flatten())
  return r.data
}
