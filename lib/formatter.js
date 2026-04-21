'use strict';

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(n) {
  if (n == null || isNaN(n)) return null;
  return `$${Number(n).toLocaleString('en-US')}`;
}

function notionUrl(pageId) {
  if (typeof pageId !== 'string' || !pageId) return 'https://www.notion.so/';
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

function buildProspectMessage(opp) {
  const lines = [];
  lines.push(`*${opp.opportunity}*  ·  _5. Negotiation_`);
  const meta = [];
  if (opp.owner)     meta.push(`Owner: ${opp.owner}`);
  if (opp.priority)  meta.push(`Priority: ${opp.priority}`);
  if (opp.closeDate) meta.push(`Close: ${formatDate(opp.closeDate)}`);
  if (meta.length)   lines.push(meta.join('  ·  '));

  const loc = [opp.city, opp.state].filter(Boolean).join(', ');
  if (loc) lines.push(loc);

  lines.push('');
  lines.push(opp.slackSummary || '_No summary yet. Update the Slack Summary field in Notion._');

  if (opp.documents && opp.documents.length) {
    lines.push('');
    lines.push('*Documents:*');
    for (const d of opp.documents) {
      lines.push(`  • <${d.url}|${d.name}>`);
    }
  } else {
    lines.push('');
    lines.push('_No documents attached. Reply with links to the PRD, proposal, or other relevant files._');
  }

  lines.push('');
  lines.push(`<${notionUrl(opp.id)}|View in Notion>`);
  return lines.join('\n');
}

function buildStatusCard(opp) {
  const lines = [];
  lines.push(`*${opp.opportunity}*`);
  lines.push(`*Stage:* ${opp.stage || '_unset_'}`);
  const row2 = [];
  if (opp.owner)    row2.push(`*Owner:* ${opp.owner}`);
  if (opp.priority) row2.push(`*Priority:* ${opp.priority}`);
  if (row2.length)  lines.push(row2.join('   '));
  const row3 = [];
  if (opp.closeDate)      row3.push(`*Close Date:* ${formatDate(opp.closeDate)}`);
  if (opp.patientRevenue) row3.push(`*Patient Revenue:* ${formatMoney(opp.patientRevenue)}`);
  if (row3.length) lines.push(row3.join('   '));
  if (opp.nextStep) lines.push(`*Next Step:* ${opp.nextStep}`);

  if (opp.description) {
    lines.push('');
    lines.push('*About*');
    lines.push(opp.description);
  }

  if (opp.documents && opp.documents.length) {
    lines.push('');
    lines.push('*Documents*');
    for (const d of opp.documents) {
      lines.push(`  • <${d.url}|${d.name}>`);
    }
  }

  lines.push('');
  lines.push(`_Synced from Notion · ${formatDate(new Date().toISOString())}_`);
  lines.push(`<${notionUrl(opp.id)}|View in Notion>`);
  return lines.join('\n');
}

function buildClosedNotice(opp) {
  return [
    `*${opp.opportunity}* was marked *9. Closed/Lost* on ${formatDate(new Date().toISOString())}.`,
    `Channel archived. History preserved.`,
    `<${notionUrl(opp.id)}|View in Notion>`,
  ].join('\n');
}

module.exports = {
  formatDate,
  formatMoney,
  notionUrl,
  buildProspectMessage,
  buildStatusCard,
  buildClosedNotice,
};
