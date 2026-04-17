/**
 * PM2 Ecosystem Config — AI Gateway Platform
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # auto-start on reboot
 *
 * Migrations run automatically before each start via the pre_start hook.
 */
module.exports = {
  apps: [
    {
      name: "ai-gateway-api",
      script: "./artifacts/api-server/dist/index.mjs",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      cwd: "/opt/ai-gateway",
      instances: 1,
      exec_mode: "fork",
      watch: false,

      // Load .env file automatically
      env_file: "/opt/ai-gateway/.env",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        MIGRATIONS_DIR: "/opt/ai-gateway/lib/db/migrations",
      },

      // Run DB migrations before (re)starting the API
      pre_start: "node --enable-source-maps ./artifacts/api-server/dist/migrate.mjs",

      // Log configuration
      error_file: "/var/log/ai-gateway/api-error.log",
      out_file:   "/var/log/ai-gateway/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Restart policy
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
