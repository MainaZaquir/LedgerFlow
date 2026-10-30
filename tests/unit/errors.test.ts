import { it, expect } from 'vitest';
import { AppError, conflict, notFound } from '../../src/shared/errors/AppError.js';
it('maps domain errors to stable safe HTTP codes', () => {
    expect(conflict('conflict')).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(notFound()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(new AppError(400, 'INVALID', 'Invalid').message).toBe('Invalid');
});
