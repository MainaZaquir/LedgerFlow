import { loadConfig } from "./config/env.js";
import { prisma } from "./infrastructure/database/client.js";
import { createApp } from "./app.js";
import { logger } from "./shared/logging/logger.js";
const config = loadConfig();
const server = createApp(prisma, {
  secret: config.SIMULATOR_WEBHOOK_SECRET,
  simulatorEnabled: config.SIMULATOR_ENABLED,
}).listen(config.PORT, () =>
  logger.info({ port: config.PORT }, "LedgerFlow started"),
);
function shutdown() {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
