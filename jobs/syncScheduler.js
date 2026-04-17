'use strict';
const schedule         = require('node-schedule');
const { syncPipeline } = require('../lib/sync');
const logger           = require('../lib/logger');

function startScheduler() {
  const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);
  const cronExpr        = `*/${intervalMinutes} * * * *`;
  logger.info(`Sync scheduler started — running every ${intervalMinutes} min (${cronExpr})`);
  schedule.scheduleJob(cronExpr, async () => {
    logger.info('Scheduled sync triggered');
    try {
      const result = await syncPipeline();
      logger.info(`Scheduled sync complete: ${result.synced} deals, ${result.errors.length} errors`);
    } catch (err) {
      logger.error(`Scheduled sync failed: ${err.message}`);
    }
  });
  logger.info('Running initial sync on startup...');
  syncPipeline().catch(err => logger.error(`Initial sync failed: ${err.message}`));
}

module.exports = { startScheduler };
