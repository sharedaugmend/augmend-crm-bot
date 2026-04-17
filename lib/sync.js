'use strict';
const notion    = require('./notion');
const slack     = require('./slack');
const formatter = require('./formatter');
const logger    = require('./logger');

const SKIP_CHANNELS = new Set(['materials']);

async function syncPipeline() {
  logger.info('=== Pipeline sync started ===');
  let opportunities;
  try {
    opportunities = await notion.getActiveOpportunities();
    logger.info(`Fetched ${opportunities.length} active opportunities from Notion`);
  } catch (err) {
    logger.error(`Failed to fetch pipeline from Notion: ${err.message}`);
    return { synced: 0, errors: [err.message] };
  }

  const errors = [];
  for (const opp of opportunities) {
    if (!opp.opportunity) continue;
    const channelName = formatter.toChannelName(opp);
    const companySlug = formatter.toCompanySlug(opp);
    if (SKIP_CHANNELS.has(channelName) || SKIP_CHANNELS.has(companySlug)) {
      logger.info(`Skipping reserved channel: ${channelName}`);
      continue;
    }
    try {
      const channel = await slack.ensureChannel(channelName, companySlug);
      await slack.inviteBot(channel.id);
      const card = formatter.buildStatusCard(opp);
      await slack.upsertPinnedPost(channel.id, card);
      logger.info(`✓ ${opp.opportunity}  ->  #${channelName}`);
    } catch (err) {
      logger.error(`✗ ${opp.opportunity}: ${err.message}`);
      errors.push({ deal: opp.opportunity, error: err.message });
    }
  }

  const prospectChannelId = process.env.PROSPECTIVE_CUSTOMERS_CHANNEL_ID;
  if (prospectChannelId) {
    try {
      const digest = formatter.buildProspectDigest(opportunities);
      await slack.upsertPinnedPost(prospectChannelId, digest);
      logger.info('Updated pipeline digest in #prospective-customers');
    } catch (err) {
      logger.error(`Failed to update prospect digest: ${err.message}`);
      errors.push({ deal: '#prospective-customers digest', error: err.message });
    }
  } else {
    logger.warn('PROSPECTIVE_CUSTOMERS_CHANNEL_ID not set — skipping digest post');
  }

  logger.info(`=== Sync complete: ${opportunities.length} deals, ${errors.length} error(s) ===`);
  return { synced: opportunities.length, errors };
}

module.exports = { syncPipeline };
