import { loadEnv, type Env } from './env.js';

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}

export type { Env };
