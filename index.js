// -----------------------------------------------------------------------------
// Entry point of the Le Vélo (Bordeaux) integration for Gladys Assistant.
//
// This file only starts the SDK; every handler lives in src/app.js:
//   1. instantiate the SDK (connection, auth, reconnection: handled by it);
//   2. register the handlers BEFORE connect();
//   3. connect.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

// The SDK disconnects cleanly and exits with code 0 on SIGTERM/SIGINT.
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

logger.info('Starting the Le Vélo integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
