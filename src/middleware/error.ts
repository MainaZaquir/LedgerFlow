import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/AppError.js';
import { logger } from '../shared/logging/logger.js';
export const missingRoute: RequestHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: { code: error.code, message: error.message, requestId: req.correlationId } });
        return;
    }
    if (error instanceof ZodError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: req.correlationId } });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource already exists', requestId: req.correlationId } });
        return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error) {
        const type = (error as {
            type?: unknown;
        }).type;
        if (type === 'entity.parse.failed') {
            res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON', requestId: req.correlationId } });
            return;
        }
        if (type === 'entity.too.large') {
            res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large', requestId: req.correlationId } });
            return;
        }
    }
    // No stack traces or exception details to API callers.
    logger.error({ err: error, requestId: req.correlationId }, 'Unhandled request error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.correlationId } });
};
