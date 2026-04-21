'use strict';
const slack     = require('./slack');
const notion    = require('./notion');
const formatter = require('./formatter');
const logger    = require('./logger');
const { ACTIVE_STAGES, PROSPECT_STAGE, channelNameForOpp } = require('./validator');

const CLOSED_LOST = '9. Closed/Lost';
const MAX_OPS_PER_PLAN = 5;
const PROSPECT_CHANNEL_ID = process.env.PROSPECTIVE_CUSTOMERS_CHANNEL_ID;
const ADMIN_USER_IDS = (process.env.ADMIN_SLACK_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function planSync() {
  if (!PROSPECT_CHANNEL_ID) {
    throw new Error('PROSPECTIVE_CUSTOMERS_CHANNEL_ID not set in environment.');
  }
  const [active, closed] = await Promise.all([
    notion.getActiveOpportunities(),
    notion.getClosedLostOpportunities(),
  ]);
  const allDeals = [...active, ...closed];
  const channels = await slack.listChannels({ force: true });
  const byName   = new Map(channels.map(c => [c.name, c]));

  const ops = [];
  const seenSlugKeys = new Map();

  for (const opp of allDeals) {
    const target = channelNameForOpp(opp);

    // Closed/Lost: only act if we actually have a channel to clean up.
    // No slug + no channel = nothing to do, skip silently.
    if (opp.stage === CLOSED_LOST) {
      const existing = target ? byName.get(target) : null;
      if (existing) {
        if (seenSlugKeys.has(target)) {
          ops.push({ type: 'warning', description: `Slug collision on #${target} — see earlier warning.` });
        } else {
          seenSlugKeys.set(target, opp.opportunity);
          ops.push({
            type: 'close_deal',
            pageId: opp.id,
            oppName: opp.opportunity,
            channelId: existing.id,
            slug: target,
            description: `Deal *${opp.opportunity}* is Closed/Lost. Rename #${target} to #closed-${target} and archive.`,
          });
        }
      }
      if (opp.prospectMessageTs) {
        ops.push({
          type: 'delete_prospect',
          pageId: opp.id,
          oppName: opp.opportunity,
          ts: opp.prospectMessageTs,
          description: `Delete stale #prospective-customers message for *${opp.opportunity}* (closed/lost).`,
        });
      }
      continue;
    }

    // Only warn for stages that actually need a Slack presence.
    // Stages 1/2/4, Tabled, and other unknowns: skip silently.
    if (!target) {
      if (opp.stage === PROSPECT_STAGE || ACTIVE_STAGES.has(opp.stage)) {
        ops.push({
          type: 'warning',
          description: `"${opp.opportunity}" has no slug in config/slugs.js — skipping.`,
        });
      }
      continue;
    }

    if (seenSlugKeys.has(target)) {
      ops.push({
        type: 'warning',
        description: `Slug collision: both "${seenSlugKeys.get(target)}" and "${opp.opportunity}" map to #${target}. Edit config/slugs.js.`,
      });
      continue;
    }
    seenSlugKeys.set(target, opp.opportunity);

    if (opp.stage === PROSPECT_STAGE) {
      if (!opp.prospectMessageTs) {
        ops.push({
          type: 'post_prospect',
          pageId: opp.id,
          oppName: opp.opportunity,
          description: `Post a message for *${opp.opportunity}* in #prospective-customers.`,
        });
      }
    } else if (opp.prospectMessageTs) {
      ops.push({
        type: 'delete_prospect',
        pageId: opp.id,
        oppName: opp.opportunity,
        ts: opp.prospectMessageTs,
        description: `Delete stale #prospective-customers message for *${opp.opportunity}* (now at ${opp.stage}).`,
      });
    }

    // Channel pin/topic ops:
    // - Pilot / Integration / Active-Won: create if missing, upsert pin + topic
    // - Negotiation: upsert pin + topic ONLY if the channel already exists
    //   (team channels are reused; we don't auto-create for Negotiation)
    // - Stages 1 / 2 / 4 and earlier: Notion-only, leave team channels untouched
    const existing = byName.get(target);
    if (ACTIVE_STAGES.has(opp.stage)) {
      if (!existing) {
        ops.push({
          type: 'create_and_pin',
          pageId: opp.id,
          oppName: opp.opportunity,
          channelName: target,
          description: `Create #${target} for *${opp.opportunity}* and pin a status card.`,
        });
      } else {
        ops.push({
          type: 'upsert_pin',
          pageId: opp.id,
          oppName: opp.opportunity,
          channelId: existing.id,
          channelName: target,
          description: `Refresh the pinned status card in #${target} for *${opp.opportunity}* (stage: ${opp.stage}).`,
        });
      }
    } else if (opp.stage === PROSPECT_STAGE && existing) {
      ops.push({
        type: 'upsert_pin',
        pageId: opp.id,
        oppName: opp.opportunity,
        channelId: existing.id,
        channelName: target,
        description: `Refresh the pinned status card in #${target} for *${opp.opportunity}* (stage: ${opp.stage}).`,
      });
    }
  }

  const actionable = ops.filter(o => o.type !== 'warning');
  const warnings   = ops.filter(o => o.type === 'warning');

  return {
    ops: actionable.slice(0, MAX_OPS_PER_PLAN),
    truncated: actionable.length > MAX_OPS_PER_PLAN,
    totalActionable: actionable.length,
    warnings,
    summary: buildSummary(actionable.slice(0, MAX_OPS_PER_PLAN), actionable.length > MAX_OPS_PER_PLAN, warnings),
  };
}

function buildSummary(ops, truncated, warnings) {
  const lines = [];
  if (!ops.length && !warnings.length) {
    return 'Slack is already in sync with Notion. Nothing to do.';
  }
  if (ops.length) {
    lines.push(`*Proposed Slack changes (${ops.length}):*`);
    ops.forEach((o, i) => lines.push(`  ${i + 1}. ${o.description}`));
    if (truncated) lines.push(`  _…more ops exist; apply these and run sync again for the rest._`);
  }
  if (warnings.length) {
    lines.push('');
    lines.push('*Warnings:*');
    warnings.forEach(w => lines.push(`  • ${w.description}`));
  }
  lines.push('');
  lines.push('Reply `yes` to apply, `no` to cancel.');
  return lines.join('\n');
}

async function refreshChannelContent(channelId, opp) {
  if (opp.slackSummary) {
    await slack.setChannelTopic(channelId, opp.slackSummary);
  }
  const card = formatter.buildStatusCard(opp);
  await slack.upsertPinnedStatusCard(channelId, card);
}

async function applyOps(ops) {
  const results = [];
  for (const op of ops) {
    try {
      await applyOp(op);
      results.push({ op: op.description, status: 'ok' });
    } catch (err) {
      logger.error(`Op failed (${op.type}): ${err.message}`);
      results.push({ op: op.description, status: 'failed', error: err.message });
    }
  }
  return results;
}

async function applyOp(op) {
  switch (op.type) {
    case 'post_prospect': {
      const opp = await notion.getOpportunityById(op.pageId);
      const text = formatter.buildProspectMessage(opp);
      const ts = await slack.postMessage(PROSPECT_CHANNEL_ID, text);
      await notion.setProspectMessageTs(op.pageId, ts);
      return;
    }
    case 'delete_prospect': {
      try { await slack.deleteMessage(PROSPECT_CHANNEL_ID, op.ts); } catch (_) { /* may already be gone */ }
      try { await notion.setProspectMessageTs(op.pageId, null); } catch (err) {
        if (err.code !== 'object_not_found') throw err;
      }
      return;
    }
    case 'create_and_pin': {
      const opp = await notion.getOpportunityById(op.pageId);
      let channel;
      let created = false;
      try {
        channel = await slack.createChannel(op.channelName);
        created = true;
      } catch (err) {
        if (err.data?.error === 'name_taken') {
          channel = await slack.findByName(op.channelName);
        } else {
          throw err;
        }
      }
      await slack.joinChannel(channel.id);
      if (created && ADMIN_USER_IDS.length) {
        await slack.inviteUsers(channel.id, ADMIN_USER_IDS);
      }
      await refreshChannelContent(channel.id, opp);
      return;
    }
    case 'upsert_pin': {
      const opp = await notion.getOpportunityById(op.pageId);
      await slack.joinChannel(op.channelId);
      await refreshChannelContent(op.channelId, opp);
      return;
    }
    case 'close_deal': {
      const opp = await notion.getOpportunityById(op.pageId);
      const notice = formatter.buildClosedNotice(opp);
      try { await slack.postMessage(op.channelId, notice); } catch (_) {}
      try { await slack.renameChannel(op.channelId, `closed-${op.slug}`); } catch (_) {}
      await slack.archiveChannel(op.channelId);
      return;
    }
    default:
      throw new Error(`Unknown op type: ${op.type}`);
  }
}

module.exports = { planSync, applyOps, applyOp, MAX_OPS_PER_PLAN };
