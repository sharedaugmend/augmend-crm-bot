'use strict';

/**
 * Formats an opportunity and its related data into the pinned channel post template.
 */
function formatChannelPost(opp, contacts = [], latestMeeting = null) {
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━';

  // Company line
  const location = [opp.city, opp.state].filter(Boolean).join(', ');
  const companyLine = [opp.account?.name || opp.name, location].filter(Boolean).join(' | ');

  // Type/beds line
  const typeParts = [];
  if (opp.publicPrivate) typeParts.push(`Type: ${opp.publicPrivate}`);
  if (opp.numberOfBeds) typeParts.push(`Beds: ${opp.numberOfBeds.toLocaleString()}`);

  // Owner
  const ownerName = opp.owner?.name || 'Unassigned';

  // Contacts block
  let contactsBlock;
  if (contacts.length === 0) {
    contactsBlock = 'No contacts linked in Notion — add them';
  } else {
    contactsBlock = contacts
      .map((c) => {
        const typeTags = c.type?.length ? c.type.join('/') : '';
        const parts = [`• ${c.name}`];
        if (c.specialty) parts.push(c.specialty);
        if (c.email) parts.push(c.email);
        if (typeTags) parts.push(`(${typeTags})`);
        return parts.join(' — ');
      })
      .join('\n');
  }

  // Latest meeting block
  let meetingBlock;
  if (!latestMeeting) {
    meetingBlock = 'No meetings linked to this opportunity';
  } else {
    const date = latestMeeting.createdTime
      ? new Date(latestMeeting.createdTime).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : 'Unknown date';
    const meetingType = latestMeeting.meetingType?.join(', ') || 'Unknown type';
    const summary = latestMeeting.summary
      ? latestMeeting.summary.slice(0, 300) + (latestMeeting.summary.length > 300 ? '…' : '')
      : 'No summary recorded';
    meetingBlock = `${date} | ${meetingType}\n${summary}`;
  }

  // Next action block
  const nextStep = opp.nextStep || 'No next step recorded';
  const deadline = opp.actionDeadline
    ? new Date(opp.actionDeadline).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'No deadline set';

  const timestamp = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return [
    divider,
    `*CUSTOMER PROFILE*`,
    `Company: ${companyLine}`,
    typeParts.length ? typeParts.join(' | ') : null,
    `Stage: ${opp.stage} | Owner: ${ownerName}`,
    '',
    divider,
    `*KEY CONTACTS*`,
    contactsBlock,
    '',
    divider,
    `*LATEST MEETING*`,
    meetingBlock,
    '',
    divider,
    `*NEXT ACTION*`,
    nextStep,
    `Due: ${deadline}`,
    '',
    divider,
    `_Last synced: ${timestamp} | <${opp.notionUrl}|Open in Notion>_`,
    divider,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Formats a table row for the #prospective-customers channel.
 * Returns a single Slack-formatted line.
 */
function formatProspectRow(opp) {
  const owner = opp.owner?.name || 'Unassigned';
  const deadline = opp.actionDeadline
    ? new Date(opp.actionDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const nextStep = opp.nextStep
    ? opp.nextStep.slice(0, 60) + (opp.nextStep.length > 60 ? '…' : '')
    : '_No next step_';

  return `• <${opp.notionUrl}|${opp.name}> — ${opp.stage} — ${owner} — Due: ${deadline} — ${nextStep}`;
}

/**
 * Formats the full #prospective-customers digest post.
 */
function formatProspectDigest(opportunities) {
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━';
  const timestamp = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  // Group by stage
  const byStage = {};
  for (const opp of opportunities) {
    if (!byStage[opp.stage]) byStage[opp.stage] = [];
    byStage[opp.stage].push(opp);
  }

  const lines = [
    divider,
    `*ACTIVE PIPELINE — NEGOTIATION STAGE*`,
    `_Updated: ${timestamp}_`,
    divider,
  ];

  const negotiationDeals = opportunities.filter((o) => o.stage === '5. Negotiation');
  if (negotiationDeals.length === 0) {
    lines.push('No deals currently in Negotiation stage.');
  } else {
    for (const opp of negotiationDeals) {
      lines.push(formatProspectRow(opp));
    }
  }

  lines.push(divider);
  return lines.join('\n');
}

/**
 * Derives a Slack channel name from a company name and stage.
 * Lowercases, strips special chars, replaces spaces with hyphens, max 80 chars.
 */
function channelName(companyName, stageSlug) {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return `${slug}-${stageSlug}`;
}

module.exports = { formatChannelPost, formatProspectDigest, formatProspectRow, channelName };
