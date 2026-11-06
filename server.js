'use strict';
require('dotenv').config();

const { loadEnv } = require('./config/env');
const { createLogger } = require('./config/logger');
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const createApp = require('./app');

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  await connectDB(env.MONGO_URI, logger);

  const { server, io } = createApp(env, logger);
  server.listen(env.PORT, () => logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`));

  // Graceful shutdown so platforms (Render, Docker) can restart us without dropping requests.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    io.close();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
