module.exports = {
  apps: [
    {
      name: 'taste-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3301',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'taste-orchestrator',
      cwd: './services/orchestrator',
      script: 'dist/index.js',
      node_args: '-r dotenv/config',
      env: {
        DOTENV_CONFIG_PATH: '../../.env',
        NODE_ENV: 'production',
      },
    },
  ],
};
