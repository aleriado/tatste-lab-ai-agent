import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

const root = resolve(__dirname, '../../..');

// Only load .env.local in development
if (process.env.NODE_ENV !== 'production') {
  const localEnv = resolve(root, '.env.local');
  if (existsSync(localEnv)) {
    config({ path: localEnv });
  }
}
config({ path: resolve(root, '.env') });
