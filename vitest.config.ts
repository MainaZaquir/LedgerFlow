import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 20000, hookTimeout: 20000, pool: 'forks', maxWorkers: 1 } });
