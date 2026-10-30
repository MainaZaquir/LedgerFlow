import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success)
        throw new AppError(400, 'VALIDATION_ERROR', result.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    return result.data;
}
export const uuidSchema = z.string().uuid();
