module.exports = {
  apps: [{
    name: 'sprint-command-center',
    script: 'server/index.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
    },
    max_restarts: 10,
    restart_delay: 2000,
    watch: false,
  }],
};
