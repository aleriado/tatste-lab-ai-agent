/**
 * PM2 process file (Windows + Unix). From repo root, after `pnpm build`:
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Requires: pnpm on PATH, .env configured, DATABASE_URL valid.
 */
const root = __dirname;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

module.exports = {
  apps: [
    {
      name: "taste-orchestrator",
      cwd: root,
      script: pnpm,
      args: "--filter orchestrator start",
      interpreter: "none",
      env: { NODE_ENV: "production" },
    },
    {
      name: "taste-web",
      cwd: root,
      script: pnpm,
      args: "--filter web start",
      interpreter: "none",
      env: { NODE_ENV: "production" },
    },
  ],
};
