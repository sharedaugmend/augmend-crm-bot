'use strict';

const STAGE_SLUG = {
  '1. Qualified Lead': 'lead',
  '2. Demo':           'demo',
  '4. Proposal':       'proposal',
  '5. Negotiation':    'negotiation',
  '6. Pilot':          'pilot',
  '7. Integration':    'integration',
  '8. Active/Won':     'active',
  '9. Closed/Lost':    'closed',
};

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toCompanySlug(opp) {
  const raw = opp.opportunity || '';
  const segment = raw.split('/')[0].trim();
  return slugify(segment).slice(0, 21);
}

function toStageSlug(stage) {
  return STAGE_SLUG[stage] || 'unknown';
}

function toChannelName(opp) {
  const company = toCompanySlug(opp);
  const stage   = toStageSlug(opp.stage);
  return `${company}-${stage}`;
}

function buildStatusCard(opp) {
  const stage     = opp.stage        || '_Unknown_';
  const nextStep  = opp.nextStep     || '_No next step defined_';
  const closeDate = opp.closeDate    || '_No close date_';
  const owner     = opp.owner        || '_Unassigned_';
  const priority  = opp.priorityLevel || '_Not set_';
  return [
    `*${opp.opportunity}*`,
    `*Stage:* ${stage}`,
    `*Owner:* ${owner}   *Priority:* ${priority}`,
    `*Close Date:* ${closeDate}`,
    `*Next Step:* ${nextStep}`,
    `_Synced from Notion · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}_`,
  ].join('\n');
}

function buildProspectDigest(opportunities) {
  const active = opportunities.filter(o => o.stage !== '9. Closed/Lost');
  if (!active.length) return '*Pipeline is empty.*';

  const grouped = {};
  for (const opp of active) {
    const s = opp.stage || 'Unknown';
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(opp);
  }

  const ORDER = [
    '1. Qualified Lead', '2. Demo', '4. Proposal', '5. Negotiation',
    '6. Pilot', '7. Integration', '8. Active/Won',
  ];

  const lines = [
    `*Pipeline Digest · ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}*`,
    `_${active.length} active deal${active.length !== 1 ? 's' : ''}_`,
    '',
  ];

  for (const stage of ORDER) {
    if (!grouped[stage]) continue;
    lines.push(`*${stage}*`);
    for (const opp of grouped[stage]) {
      const ch = toChannelName(opp);
      const ns = opp.nextStep ? ` · ${opp.nextStep.slice(0, 60)}` : '';
      lines.push(`  • ${opp.opportunity}${ns} -> #${ch}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  slugify,
  toCompanySlug,
  toStageSlug,
  toChannelName,
  buildStatusCard,
  buildProspectDigest,
};
