'use strict';
const logger = require('./logger');

let client = null;
let channelCache = null;
let channelCacheAt = 0;
let botUserId = null;
const CACHE_TTL_MS = 60 * 1000;

function init(slackClient) {
  client = slackClient;
}

async function getBotUserId() {
  if (botUserId) return botUserId;
  const auth = await client.auth.test();
  botUserId = auth.user_id;
  return botUserId;
}

async function listChannels({ force = false } = {}) {
  if (!force && channelCache && Date.now() - channelCacheAt < CACHE_TTL_MS) {
    return channelCache;
  }
  const all = [];
  let cursor;
  do {
    const res = await client.conversations.list({
      exclude_archived: true,
      types: 'public_channel',
      limit: 200,
      ...(cursor && { cursor }),
    });
    all.push(...(res.channels || []));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  channelCache = all;
  channelCacheAt = Date.now();
  return all;
}

function invalidateCache() {
  channelCache = null;
}

async function findByName(name) {
  const all = await listChannels();
  return all.find(c => c.name === name) || null;
}

async function findById(id) {
  try {
    const res = await client.conversations.info({ channel: id });
    return res.channel;
  } catch (_) {
    return null;
  }
}

async function createChannel(name) {
  logger.info(`Slack: creating #${name}`);
  const res = await client.conversations.create({ name, is_private: false });
  invalidateCache();
  return res.channel;
}

async function renameChannel(id, newName) {
  logger.info(`Slack: renaming ${id} -> #${newName}`);
  await client.conversations.rename({ channel: id, name: newName });
  invalidateCache();
}

async function archiveChannel(id) {
  logger.info(`Slack: archiving ${id}`);
  await client.conversations.archive({ channel: id });
  invalidateCache();
}

async function joinChannel(id) {
  try {
    await client.conversations.join({ channel: id });
  } catch (err) {
    if (err.data?.error !== 'already_in_channel') {
      logger.warn(`Slack: could not join ${id}: ${err.data?.error || err.message}`);
    }
  }
}

async function setChannelTopic(channelId, topic) {
  try {
    await client.conversations.setTopic({
      channel: channelId,
      topic: (topic || '').slice(0, 250),
    });
  } catch (err) {
    logger.warn(`Slack: setTopic failed on ${channelId}: ${err.data?.error || err.message}`);
  }
}

async function setChannelPurpose(channelId, purpose) {
  try {
    await client.conversations.setPurpose({
      channel: channelId,
      purpose: (purpose || '').slice(0, 250),
    });
  } catch (err) {
    logger.warn(`Slack: setPurpose failed on ${channelId}: ${err.data?.error || err.message}`);
  }
}

async function inviteUsers(channelId, userIds) {
  if (!userIds?.length) return;
  try {
    await client.conversations.invite({ channel: channelId, users: userIds.join(',') });
  } catch (err) {
    const e = err.data?.error || err.message;
    if (e === 'already_in_channel') return;
    const failed = err.data?.errors || [];
    const hardFails = failed.filter(f => f.error !== 'already_in_channel');
    if (hardFails.length) {
      logger.warn(`Slack: some invites failed on ${channelId}: ${JSON.stringify(hardFails)}`);
    }
  }
}

async function postMessage(channelId, text) {
  const res = await client.chat.postMessage({ channel: channelId, text, unfurl_links: false, unfurl_media: false });
  return res.ts;
}

async function updateMessage(channelId, ts, text) {
  await client.chat.update({ channel: channelId, ts, text });
}

async function deleteMessage(channelId, ts) {
  try {
    await client.chat.delete({ channel: channelId, ts });
  } catch (err) {
    logger.warn(`Slack: could not delete ${channelId}/${ts}: ${err.data?.error || err.message}`);
    throw err;
  }
}

const STATUS_CARD_MARKER = 'Synced from Notion';

async function upsertPinnedStatusCard(channelId, text) {
  const myId = await getBotUserId();
  let existingTs = null;

  try {
    const pinned = await client.pins.list({ channel: channelId });
    const botPin = (pinned.items || []).find(p =>
      p.type === 'message' &&
      (p.message?.user === myId || p.message?.bot_id === myId)
    );
    existingTs = botPin?.message?.ts || null;
  } catch (err) {
    logger.warn(`Slack: pins.list failed on ${channelId}: ${err.data?.error || err.message}`);
  }

  if (!existingTs) {
    try {
      const hist = await client.conversations.history({ channel: channelId, limit: 100 });
      const botMsg = (hist.messages || []).find(m =>
        m.type === 'message' &&
        m.user === myId &&
        (m.text || '').includes(STATUS_CARD_MARKER)
      );
      existingTs = botMsg?.ts || null;
    } catch (err) {
      logger.warn(`Slack: history scan failed on ${channelId}: ${err.data?.error || err.message}`);
    }
  }

  if (existingTs) {
    try {
      await updateMessage(channelId, existingTs, text);
      try { await client.pins.add({ channel: channelId, timestamp: existingTs }); }
      catch (err) { if (err.data?.error !== 'already_pinned') logger.warn(`Slack: pins.add failed: ${err.data?.error || err.message}`); }
      return existingTs;
    } catch (err) {
      logger.warn(`Slack: update failed; will repost: ${err.data?.error || err.message}`);
    }
  }

  const ts = await postMessage(channelId, text);
  try { await client.pins.add({ channel: channelId, timestamp: ts }); }
  catch (err) { logger.warn(`Slack: pins.add failed: ${err.data?.error || err.message}`); }
  return ts;
}

async function sendDM(userId, text) {
  const open = await client.conversations.open({ users: userId });
  const channelId = open.channel.id;
  return postMessage(channelId, text);
}

module.exports = {
  init,
  getBotUserId,
  listChannels,
  invalidateCache,
  findByName,
  findById,
  createChannel,
  renameChannel,
  archiveChannel,
  joinChannel,
  inviteUsers,
  setChannelTopic,
  setChannelPurpose,
  postMessage,
  updateMessage,
  deleteMessage,
  upsertPinnedStatusCard,
  sendDM,
};
