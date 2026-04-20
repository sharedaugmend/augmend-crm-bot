'use strict';
const notion = require('./notion');
const logger = require('./logger');
const { STAGES } = require('./validator');

function sectionText(text) {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function divider() {
  return { type: 'divider' };
}

function header(text) {
  return { type: 'header', text: { type: 'plain_text', text } };
}

async function buildHomeView() {
  let pipeline = [];
  try {
    pipeline = await notion.getActiveOpportunities();
  } catch (err) {
    logger.warn(`Home tab: could not fetch pipeline: ${err.message}`);
  }

  const counts = {};
  for (const s of STAGES) counts[s] = 0;
  for (const o of pipeline) if (counts[o.stage] !== undefined) counts[o.stage]++;

  const pipelineLines = STAGES
    .filter(s => s !== '9. Closed/Lost')
    .map(s => `• *${s}* — ${counts[s]}`);

  const blocks = [
    header('AugMend CRM Bot'),
    sectionText('_Conversational sales ops for AugMend. DM me or @-mention me in any channel I\'m in._'),
    divider(),
    header('Pipeline snapshot'),
    sectionText(pipelineLines.join('\n') || '_Pipeline unavailable._'),
    divider(),
    header('What to ask me'),
    sectionText([
      '*Query*',
      '• "what\'s in the pipeline?"',
      '• "who\'s at negotiation?"',
      '• "any overdue deals?"',
      '• "how\'s Einstein Montefiore looking?" (MEDDPICC-lite advisory)',
      '',
      '*Update Notion*',
      '• "move Kritzer to Pilot, next step IRB kickoff, due Friday"',
      '• "log a meeting with Mike Kritzer today — we covered pilot timeline"',
      '• "set the Slack Summary for Atrius to: ..."',
      '',
      '*Research*',
      '• "research Brigham and Women\'s Pain Management" (web search + drafts)',
      '• "create an opportunity for Cleveland Clinic Pain Management" (auto-researches)',
      '',
      '*Sync Slack*',
      '• "sync slack" (I\'ll show a plan; you reply `yes` to apply)',
    ].join('\n')),
    divider(),
    header('Channels I maintain'),
    sectionText([
      '• `#prospective-customers` — one message per deal at Negotiation (5)',
      '• per-customer channel — status card pinned, for Pilot/Integration/Active-Won (6/7/8)',
      '• Stages 1/2/4 → Notion only, no Slack presence',
      '• Closed/Lost → channel renamed to `closed-*` and archived',
    ].join('\n')),
    divider(),
    sectionText(`_Updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET_`),
  ];

  return { type: 'home', blocks };
}

async function publish(client, userId) {
  try {
    const view = await buildHomeView();
    await client.views.publish({ user_id: userId, view });
  } catch (err) {
    logger.warn(`Home tab publish failed for ${userId}: ${err.data?.error || err.message}`);
  }
}

module.exports = { publish };
