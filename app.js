'use strict';
require('dotenv').config();

const { App }        = require('@slack/bolt');
const logger         = require('./lib/logger');
const slack          = require('./lib/slack');
const { handleMessage } = require('./lib/claude');
const { startScheduler } = require('./jobs/syncScheduler');

const REQUIRED_ENV = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'NOTION_API_KEY',
  'ANTHROPIC_API_KEY',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

if (!process.env.PROSPECTIVE_CUSTOMERS_CHANNEL_ID) {
  logger.warn('PROSPECTIVE_CUSTOMERS_CHANNEL_ID not set — pipeline digest will be skipped until set');
}

const app = new App({
  token:         process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode:    true,
  appToken:      process.env.SLACK_APP_TOKEN,
});

slack.init(app.client);

app.event('message', async ({ event, say }) => {
  if (event.channel_type !== 'im') return;
  if (event.bot_id) return;
  try {
    const reply = await handleMessage(event.text || '', event.user);
    await say(reply);
  } catch (err) {
    logger.error(`DM handler error: ${err.message}`);
    await say('Something went wrong. Please try again.');
  }
});

app.event('app_mention', async ({ event, say }) => {
  if (event.bot_id) return;
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  try {
    const reply = await handleMessage(text, event.user);
    await say({ text: reply, thread_ts: event.thread_ts || event.ts });
  } catch (err) {
    logger.error(`Mention handler error: ${err.message}`);
    await say({ text: 'Something went wrong. Please try again.', thread_ts: event.ts });
  }
});

(async () => {
  await app.start();
  logger.info('AugMend CRM Bot is running (Socket Mode)');
  startScheduler();
})();
