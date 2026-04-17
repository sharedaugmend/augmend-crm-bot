'use strict';

require('dotenv').config();

const { App } = require('@slack/bolt');
const logger = require('./lib/logger');
const slackLib = require('./lib/slack');
const claude = require('./lib/claude');
const { startScheduler, runNow } = require('./jobs/syncScheduler');

// ─── Validate required env vars ───────────────────────────────────────────────
const REQUIRED_ENV = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'NOTION_API_KEY',
  'ANTHROPIC_API_KEY',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ─── Slack Bolt app (Socket Mode) ────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'warn',
});

// Wire the WebClient into our slack lib
app.client.then
  ? app.client.then((c) => slackLib.setClient(c))
  : slackLib.setClient(app.client);

// ─── Conversation history cache (in-memory, keyed by channel) ────────────────
// In production you'd use Redis; for a single-process Railway deployment
// an in-memory map is sufficient and avoids an extra service dependency.
const conversationCache = new Map();
const MAX_HISTORY = 10;

function getHistory(channelId) {
  return conversationCache.get(channelId) || [];
}

function appendHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    // Keep the last MAX_HISTORY * 2 entries
    history.splice(0, history.length - MAX_HISTORY * 2);
  }
  conversationCache.set(channelId, history);
}

// ─── Helper: strip bot mention from text ─────────────────────────────────────
function stripBotMention(text = '') {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

// ─── DM handler ───────────────────────────────────────────────────────────────
app.message(async ({ message, say }) => {
  // Only handle direct messages (channel_type === 'im') with actual text
  if (message.channel_type !== 'im' || !message.text || message.bot_id) return;

  const channelId = message.channel;
  const userText = message.text.trim();

  logger.info('DM received', { user: message.user, text: userText.slice(0, 80) });

  try {
    const history = getHistory(channelId);
    appendHistory(channelId, 'user', userText);

    const reply = await claude.chat(userText, history.slice(0, -1)); // pass history before this msg

    appendHistory(channelId, 'assistant', reply);

    await say({ text: reply, thread_ts: message.thread_ts });
  } catch (err) {
    logger.error('Error handling DM', { err: err.message, stack: err.stack });
    await say({
      text: 'Something went wrong on my end. Check the logs.',
      thread_ts: message.thread_ts,
    }).catch(() => {});
  }
});

// ─── @mention handler ─────────────────────────────────────────────────────────
app.event('app_mention', async ({ event, say }) => {
  if (!event.text || event.bot_id) return;

  const channelId = event.channel;
  const userText = stripBotMention(event.text);

  if (!userText) {
    await say({ text: 'Yes? Ask me something about the pipeline.', thread_ts: event.ts });
    return;
  }

  logger.info('App mention received', { user: event.user, text: userText.slice(0, 80) });

  try {
    const history = getHistory(channelId);
    appendHistory(channelId, 'user', userText);

    const reply = await claude.chat(userText, history.slice(0, -1));

    appendHistory(channelId, 'assistant', reply);

    await say({ text: reply, thread_ts: event.thread_ts || event.ts });
  } catch (err) {
    logger.error('Error handling app_mention', { err: err.message, stack: err.stack });
    await say({
      text: 'Something went wrong processing that. Check the logs.',
      thread_ts: event.thread_ts || event.ts,
    }).catch(() => {});
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.error(async (err) => {
  logger.error('Slack Bolt error', { err: err.message, stack: err.stack });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    // Initialize Slack client in the lib after app is ready
    slackLib.setClient(app.client);

    await app.start();
    logger.info('AugMend Sales Bot is running (Socket Mode)');

    // Start the recurring sync scheduler
    startScheduler();

    // Run an initial sync on startup (non-blocking — don't await)
    runNow().catch((err) =>
      logger.warn('Initial sync failed', { err: err.message })
    );
  } catch (err) {
    logger.error('Failed to start app', { err: err.message, stack: err.stack });
    process.exit(1);
  }
})();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  const { stopScheduler } = require('./jobs/syncScheduler');
  stopScheduler();
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down');
  const { stopScheduler } = require('./jobs/syncScheduler');
  stopScheduler();
  await app.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
