'use strict';

const slugs = require('../config/slugs');

const STAGES = [
  '1. Qualified Lead',
  '2. Demo',
  '4. Proposal',
  '5. Negotiation',
  '6. Pilot',
  '7. Integration',
  '8. Active/Won',
  '9. Closed/Lost',
];

const ACTIVE_STAGES  = new Set(['6. Pilot', '7. Integration', '8. Active/Won']);
const PROSPECT_STAGE = '5. Negotiation';

function validateStage(stage) {
  if (!STAGES.includes(stage)) {
    throw new Error(`Invalid stage "${stage}". Must be one of: ${STAGES.join(', ')}`);
  }
}

function validatePageId(pageId, pipeline) {
  if (!pageId || typeof pageId !== 'string') {
    throw new Error('pageId is required');
  }
  if (!pipeline.some(o => o.id === pageId)) {
    throw new Error(`pageId "${pageId}" not found in current pipeline. Fetch the pipeline first.`);
  }
}

function oppSlugKey(title) {
  const firstSegment = (title || '').split('/')[0].trim();
  return slugify(firstSegment);
}

function channelNameForOpp(opp) {
  return slugs[oppSlugKey(opp.opportunity)] || null;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  STAGES,
  ACTIVE_STAGES,
  PROSPECT_STAGE,
  validateStage,
  validatePageId,
  channelNameForOpp,
  oppSlugKey,
  slugify,
};
