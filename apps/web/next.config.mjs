import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '../..');

// Only load .env.local in development, never during production build
if (process.env.NODE_ENV !== 'production') {
  const localEnv = resolve(root, '.env.local');
  if (existsSync(localEnv)) {
    config({ path: localEnv });
  }
}
config({ path: resolve(root, '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ORCHESTRATOR_URL: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL,
  },
};

export default nextConfig;
