'use strict';

const logger = require('./logger');
const notion = require('./notion');
const slackLib = require('./slack');
const { formatChannelPost, formatProspectDigest, channelName } = require('./formatter');

const { STAGE_SLUGS, ACTIVE_STAGES } = notion;

/**
 * Core sync: for each active opportunity, ensure a Slack channel exists and
 * update (or create) its pinned status post.
 */
async function syncPipelineToSlack() {
  logger.info('Starting pipeline sync');

  let opportunities;
  try {
    opportunities = await notion.getPipeline();
  } catch (err) {
    logger.error('Sync failed: could not fetch pipeline', { err: err.message });
    return;
  }

  logger.info(`Fetched ${opportunities.length} active opportunities`);

  // Run each opportunity sync concurrently (but cap with Promise.allSettled)
  const results = await Promise.allSettled(opportunities.map((opp) => syncOpportunity(opp)));

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    logger.warn(`${failures.length}/${opportunities.length} opportunity syncs failed`);
  }

  // Update the #prospective-customers channel with Negotiation-stage deals
  await syncProspectChannel(opportunities);

  logger.info('Pipeline sync complete', {
    total: opportunities.length,
    failed: failures.length,
  });
}

/**
 * Syncs a single opportunity to its Slack channel.
 */
async function syncOpportunity(opp) {
  const stage = opp.stage;
  if (!ACTIVE_STAGES.includes(stage)) return;

  const stageSlug = STAGE_SLUGS[stage];
  const companyName = opp.account?.name || opp.name;
  const chanName = channelName(companyName, stageSlug);

  // Ensure the channel exists
  let channel;
  try {
    channel = await slackLib.ensureChannel(chanName);
  } catch (err) {
    logger.error('Could not ensure channel', { chanName, err: err.message });
    return;
  }

  // Resolve full details (contacts, account, latest meeting)
  let detail;
  try {
    detail = await notion.getOpportunityDetail(opp.id);
  } catch (err) {
    logger.warn('Could not load full opportunity detail, using partial data', {
      id: opp.id,
      err: err.message,
    });
    detail = { ...opp, contacts: [], account: null, meetings: [] };
  }

  const latestMeeting = detail.meetings?.[0] || null;
  const postText = formatChannelPost(detail, detail.contacts || [], latestMeeting);

  try {
    await slackLib.upsertPinnedPost(channel.id, postText);
    logger.info('Updated pinned post', { channel: chanName, oppId: opp.id });
  } catch (err) {
    logger.error('Failed to upsert pinned post', { channel: chanName, err: err.message });
  }
}

/**
 * Updates the #prospective-customers channel with Negotiation-stage deals.
 */
async function syncProspectChannel(opportunities) {
  const channelId = process.env.PROSPECTIVE_CUSTOMERS_CHANNEL_ID;
  if (!channelId) {
    logger.warn('PROSPECTIVE_CUSTOMERS_CHANNEL_ID not set — skipping prospect digest');
    return;
  }

  const digestText = formatProspectDigest(opportunities);

  try {
    await slackLib.upsertPinnedPost(channelId, digestText);
    logger.info('Updated #prospective-customers digest');
  } catch (err) {
    logger.error('Failed to update prospect channel', { err: err.message });
  }
}

module.exports = { syncPipelineToSlack, syncOpportunity, syncProspectChannel };
