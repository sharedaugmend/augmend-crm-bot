'use strict';
const logger = require('./logger');

let client = null;

function init(slackClient) {
  client = slackClient;
}

async function listAllChannels() {
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
  return all;
}

async function findChannel(name) {
  const channels = await listAllChannels();
  return channels.find(c => c.name === name) || null;
}

async function findChannelByCompanySlug(companySlug) {
  const channels = await listAllChannels();
  return channels.find(c =>
    c.name === companySlug ||
    c.name.startsWith(companySlug + '-')
  ) || null;
}

async function renameChannel(channelId, newName) {
  logger.info(`Renaming channel ${channelId} -> #${newName}`);
  await client.conversations.rename({ channel: channelId, name: newName });
}

async function createChannel(name) {
  logger.info(`Creating channel #${name}`);
  const res = await client.conversations.create({ name, is_private: false });
  return res.channel;
}

async function ensureChannel(channelName, companySlug) {
  const exact = await findChannel(channelName);
  if (exact) {
    logger.info(`Channel #${channelName} already up to date`);
    return exact;
  }
  if (companySlug) {
    const old = await findChannelByCompanySlug(companySlug);
    if (old && old.name !== channelName) {
      logger.info(`Found old channel #${old.name} for "${companySlug}" -> renaming to #${channelName}`);
      try {
        await renameChannel(old.id, channelName);
        return { ...old, name: channelName };
      } catch (err) {
        logger.warn(`Rename failed: ${err.message}. Creating new channel instead.`);
      }
    }
  }
  return createChannel(channelName);
}

async function inviteBot(channelId) {
  try {
    const auth = await client.auth.test();
    await client.conversations.invite({ channel: channelId, users: auth.user_id });
  } catch (err) {
    if (err.data?.error !== 'already_in_channel') {
      logger.warn(`Could not join channel ${channelId}: ${err.message}`);
    }
  }
}

async function upsertPinnedPost(channelId, text) {
  try {
    const pinned = await client.pins.list({ channel: channelId });
    const botPin = (pinned.items || []).find(p =>
      p.type === 'message' && p.message?.bot_id
    );
    if (botPin?.message?.ts) {
      await client.chat.update({ channel: channelId, ts: botPin.message.ts, text });
      logger.info(`Updated pinned post in ${channelId}`);
      return;
    }
  } catch (err) {
    logger.warn(`Could not list pins in ${channelId}: ${err.message}`);
  }
  const posted = await client.chat.postMessage({ channel: channelId, text });
  try {
    await client.pins.add({ channel: channelId, timestamp: posted.ts });
    logger.info(`Pinned new post in ${channelId}`);
  } catch (err) {
    logger.warn(`Could not pin message: ${err.message}`);
  }
}

module.exports = {
  init,
  listAllChannels,
  findChannel,
  ensureChannel,
  inviteBot,
  upsertPinnedPost,
};
