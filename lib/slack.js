'use strict';

const logger = require('./logger');

// The Slack WebClient is passed in from app.js (initialized by Bolt)
let _client = null;

function setClient(client) {
  _client = client;
}

function getClient() {
  if (!_client) throw new Error('Slack client not initialized — call setClient() first');
  return _client;
}

// ─── Channel management ───────────────────────────────────────────────────────

/**
 * Looks up a channel by name. Returns channel object or null.
 */
async function findChannel(name) {
  try {
    const client = getClient();
    let cursor;
    do {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const match = result.channels.find((c) => c.name === name);
      if (match) return match;
      cursor = result.response_metadata?.next_cursor || null;
    } while (cursor);
    return null;
  } catch (err) {
    logger.error('findChannel error', { name, err: err.message });
    return null;
  }
}

/**
 * Creates a Slack channel if it doesn't already exist.
 * Returns the channel object.
 */
async function ensureChannel(name) {
  const existing = await findChannel(name);
  if (existing) return existing;

  try {
    const client = getClient();
    const result = await client.conversations.create({ name, is_private: false });
    logger.info('Created Slack channel', { name, id: result.channel.id });
    return result.channel;
  } catch (err) {
    // name_taken means it exists — fetch and return it
    if (err.data?.error === 'name_taken') {
      const ch = await findChannel(name);
      return ch;
    }
    logger.error('ensureChannel error', { name, err: err.message });
    throw err;
  }
}

/**
 * Posts a message to a channel. Returns the ts of the posted message.
 */
async function postMessage(channelId, text, options = {}) {
  try {
    const client = getClient();
    const result = await client.chat.postMessage({ channel: channelId, text, ...options });
    return result.ts;
  } catch (err) {
    logger.error('postMessage error', { channelId, err: err.message });
    throw err;
  }
}

/**
 * Updates an existing message.
 */
async function updateMessage(channelId, ts, text, options = {}) {
  try {
    const client = getClient();
    await client.chat.update({ channel: channelId, ts, text, ...options });
  } catch (err) {
    logger.error('updateMessage error', { channelId, ts, err: err.message });
    throw err;
  }
}

/**
 * Finds the current pinned message in a channel (returns the first pin or null).
 */
async function getPinnedMessage(channelId) {
  try {
    const client = getClient();
    const result = await client.pins.list({ channel: channelId });
    const pins = result.items || [];
    const msgPin = pins.find((p) => p.type === 'message');
    return msgPin ? { ts: msgPin.message.ts, text: msgPin.message.text } : null;
  } catch (err) {
    logger.warn('getPinnedMessage error', { channelId, err: err.message });
    return null;
  }
}

/**
 * Pins a message. Silently ignores already_pinned errors.
 */
async function pinMessage(channelId, ts) {
  try {
    const client = getClient();
    await client.pins.add({ channel: channelId, timestamp: ts });
  } catch (err) {
    if (err.data?.error === 'already_pinned') return;
    logger.warn('pinMessage error', { channelId, ts, err: err.message });
  }
}

/**
 * Unpins a message. Silently ignores not_pinned errors.
 */
async function unpinMessage(channelId, ts) {
  try {
    const client = getClient();
    await client.pins.remove({ channel: channelId, timestamp: ts });
  } catch (err) {
    if (err.data?.error === 'not_pinned') return;
    logger.warn('unpinMessage error', { channelId, ts, err: err.message });
  }
}

/**
 * Posts or replaces the pinned status post in a channel.
 * If a pinned message exists, unpins and posts a fresh one.
 */
async function upsertPinnedPost(channelId, text) {
  try {
    const existing = await getPinnedMessage(channelId);
    if (existing) {
      await unpinMessage(channelId, existing.ts);
    }
    const ts = await postMessage(channelId, text);
    await pinMessage(channelId, ts);
    return ts;
  } catch (err) {
    logger.error('upsertPinnedPost error', { channelId, err: err.message });
    throw err;
  }
}

/**
 * Looks up a Slack user by their Notion person name (best-effort display-name match).
 * Returns the Slack user object or null.
 */
async function findUserByName(name) {
  try {
    const client = getClient();
    let cursor;
    do {
      const result = await client.users.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const match = result.members.find(
        (m) =>
          !m.deleted &&
          (m.real_name?.toLowerCase() === name.toLowerCase() ||
            m.profile?.display_name?.toLowerCase() === name.toLowerCase())
      );
      if (match) return match;
      cursor = result.response_metadata?.next_cursor || null;
    } while (cursor);
    return null;
  } catch (err) {
    logger.warn('findUserByName error', { name, err: err.message });
    return null;
  }
}

/**
 * Posts a reply in a thread (or to the channel if no thread ts given).
 */
async function replyInThread(channelId, threadTs, text, options = {}) {
  try {
    const client = getClient();
    const result = await client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
      ...options,
    });
    return result.ts;
  } catch (err) {
    logger.error('replyInThread error', { channelId, threadTs, err: err.message });
    throw err;
  }
}

/**
 * Fetches the last N messages from a DM/channel (excluding bot messages).
 */
async function getRecentMessages(channelId, limit = 10) {
  try {
    const client = getClient();
    const result = await client.conversations.history({ channel: channelId, limit: limit + 5 });
    return (result.messages || [])
      .filter((m) => !m.bot_id && m.type === 'message')
      .slice(0, limit)
      .reverse(); // oldest first
  } catch (err) {
    logger.warn('getRecentMessages error', { channelId, err: err.message });
    return [];
  }
}

module.exports = {
  setClient,
  getClient,
  findChannel,
  ensureChannel,
  postMessage,
  updateMessage,
  getPinnedMessage,
  pinMessage,
  unpinMessage,
  upsertPinnedPost,
  findUserByName,
  replyInThread,
  getRecentMessages,
};
