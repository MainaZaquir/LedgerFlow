export class AppError extends Error {
    constructor(public readonly statusCode: number, public readonly code: string, message: string) {
        super(message);
        this.name = 'AppError';
    }
}
export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');
