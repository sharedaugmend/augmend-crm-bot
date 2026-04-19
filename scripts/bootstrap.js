'use strict';
require('dotenv').config();

const { WebClient } = require('@slack/web-api');
const logger        = require('../lib/logger');
const slack         = require('../lib/slack');
const notion        = require('../lib/notion');
const formatter     = require('../lib/formatter');
const slugs         = require('../config/slugs');
const { ACTIVE_STAGES, PROSPECT_STAGE, channelNameForOpp, oppSlugKey } = require('../lib/validator');

const PROSPECT_CHANNEL_ID   = process.env.PROSPECTIVE_CUSTOMERS_CHANNEL_ID;
const OLD_STAGE_SUFFIXES    = /-(lead|demo|proposal|negotiation|pilot|integration|active|closed)$/;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n=== Bootstrap ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  if (!process.env.SLACK_BOT_TOKEN || !process.env.NOTION_API_KEY) {
    console.error('Missing SLACK_BOT_TOKEN or NOTION_API_KEY in .env');
    process.exit(1);
  }
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  slack.init(client);

  console.log('1. Checking Notion schema...');
  if (dryRun) {
    console.log('   (dry-run; skipping schema check)');
  } else {
    const schemaResult = await notion.ensureSchema();
    if (schemaResult.added.length) {
      console.log(`   Added: ${schemaResult.added.join(', ')}`);
    } else {
      console.log('   Schema already up to date.');
    }
  }

  console.log('\n2. Loading pipeline and Slack channels...');
  const pipeline = await notion.getActiveOpportunities();
  const channels = await slack.listChannels({ force: true });
  const byName   = new Map(channels.map(c => [c.name, c]));
  const auth     = await client.auth.test();
  const botId    = auth.user_id;
  console.log(`   ${pipeline.length} active deals · ${channels.length} public channels · bot=${botId}`);

  console.log('\n3. Identifying wrongly-named bot-created channels to archive...');
  const targetChannels = new Set(Object.values(slugs));
  const toArchive = [];
  for (const ch of channels) {
    if (targetChannels.has(ch.name)) continue;
    if (['prospective-customers', 'active-customers'].includes(ch.name)) continue;
    if (!OLD_STAGE_SUFFIXES.test(ch.name)) continue;
    if (ch.creator !== botId) continue;

    try {
      const hist = await client.conversations.history({ channel: ch.id, limit: 100 });
      const human = (hist.messages || []).filter(m => m.type === 'message' && !m.subtype && m.user !== botId);
      if (human.length) {
        console.log(`   SKIP #${ch.name} — has ${human.length} human message(s)`);
        continue;
      }
    } catch (err) {
      console.log(`   SKIP #${ch.name} — history check failed: ${err.data?.error || err.message}`);
      continue;
    }
    toArchive.push(ch);
  }
  console.log(`   ${toArchive.length} channels will be archived:`);
  toArchive.forEach(c => console.log(`     - #${c.name}`));

  console.log('\n4. Deals at Pilot+/Integration/Active-Won that need a mapped channel:');
  const pilotDeals = pipeline.filter(o => ACTIVE_STAGES.has(o.stage));
  for (const opp of pilotDeals) {
    const target = channelNameForOpp(opp);
    const existing = byName.get(target);
    const isMember = existing?.is_member;
    console.log(`   ${opp.stage.padEnd(20)} ${opp.opportunity.padEnd(40)} -> #${target} ${existing ? (isMember ? '(bot in channel)' : '(need to join)') : '(will create)'}`);
  }

  console.log('\n5. Negotiation-stage deals that need a #prospective-customers message:');
  const negDeals = pipeline.filter(o => o.stage === PROSPECT_STAGE);
  for (const opp of negDeals) {
    const has = opp.prospectMessageTs ? '(message posted)' : '(NEEDS POST)';
    console.log(`   ${opp.opportunity.padEnd(40)} ${has}`);
  }

  console.log('\n6. Deals with no slug mapping:');
  const unmapped = pipeline.filter(o => !channelNameForOpp(o));
  if (!unmapped.length) console.log('   (none — slug config covers all active deals)');
  unmapped.forEach(o => console.log(`   MISSING ${oppSlugKey(o.opportunity)} -> ??? (${o.opportunity})`));

  if (dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to apply changes.');
    return;
  }

  console.log('\n=== APPLYING CHANGES ===\n');

  for (const ch of toArchive) {
    try {
      await client.conversations.archive({ channel: ch.id });
      console.log(`   archived #${ch.name}`);
    } catch (err) {
      console.log(`   FAILED #${ch.name}: ${err.data?.error || err.message}`);
    }
  }

  for (const opp of pilotDeals) {
    const target = channelNameForOpp(opp);
    if (!target) continue;
    let channel = byName.get(target);
    if (!channel) {
      try {
        channel = await slack.createChannel(target);
        console.log(`   created #${target}`);
      } catch (err) {
        console.log(`   FAILED to create #${target}: ${err.data?.error || err.message}`);
        continue;
      }
    }
    await slack.joinChannel(channel.id);
    try {
      const card = formatter.buildStatusCard(opp);
      await slack.upsertPinnedStatusCard(channel.id, card);
      console.log(`   pinned status card in #${target}`);
    } catch (err) {
      console.log(`   FAILED to pin card in #${target}: ${err.data?.error || err.message}`);
    }
  }

  for (const opp of negDeals) {
    if (opp.prospectMessageTs) continue;
    try {
      const text = formatter.buildProspectMessage(opp);
      const ts   = await slack.postMessage(PROSPECT_CHANNEL_ID, text);
      await notion.setProspectMessageTs(opp.id, ts);
      console.log(`   posted prospect message for ${opp.opportunity}`);
    } catch (err) {
      console.log(`   FAILED prospect post for ${opp.opportunity}: ${err.message}`);
    }
  }

  console.log('\nBootstrap complete.');
}

main().catch(err => {
  console.error('Bootstrap failed:', err.stack || err.message);
  process.exit(1);
});
