'use strict';

const schedule = require('node-schedule');
const logger = require('../lib/logger');
const { syncPipelineToSlack } = require('../lib/sync');

let _job = null;

/**
 * Starts the recurring sync job.
 * Default interval: every 30 minutes (configurable via SYNC_INTERVAL_MINUTES env var).
 */
function startScheduler() {
  const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);

  // Build a cron expression: run at minute 0 and minute N of every hour, etc.
  // For flexibility, we use a recurrence rule rather than a raw cron string
  // so any interval from 1–59 minutes is supported cleanly.
  const rule = new schedule.RecurrenceRule();
  rule.minute = buildMinuteArray(intervalMinutes);

  _job = schedule.scheduleJob(rule, async () => {
    logger.info('Scheduled sync triggered');
    try {
      await syncPipelineToSlack();
    } catch (err) {
      logger.error('Scheduled sync threw an uncaught error', { err: err.message, stack: err.stack });
    }
  });

  logger.info(`Sync scheduler started — running every ${intervalMinutes} minute(s)`);
  return _job;
}

/**
 * Builds an array of minute values matching the given interval.
 * e.g. interval=30 → [0, 30]; interval=15 → [0, 15, 30, 45]; interval=20 → [0, 20, 40]
 */
function buildMinuteArray(intervalMinutes) {
  const minutes = [];
  for (let m = 0; m < 60; m += intervalMinutes) {
    minutes.push(m);
  }
  return minutes;
}

/**
 * Stops the scheduler gracefully.
 */
function stopScheduler() {
  if (_job) {
    _job.cancel();
    _job = null;
    logger.info('Sync scheduler stopped');
  }
}

/**
 * Runs a sync immediately (outside the schedule — useful for testing/startup).
 */
async function runNow() {
  logger.info('Manual sync triggered');
  await syncPipelineToSlack();
}

module.exports = { startScheduler, stopScheduler, runNow };
