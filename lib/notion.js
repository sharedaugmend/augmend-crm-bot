'use strict';
const { Client } = require('@notionhq/client');
const logger = require('./logger');

const notion = new Client({ auth: process.env.NOTION_API_KEY, timeoutMs: 30_000 });

const DB = {
  OPPORTUNITIES: '1ec6e317-85ee-81bc-8fd4-c39fdfa0e780',
  MEETINGS:      '4557b0ce-9d55-49ec-bd82-c068d2d5836c',
  ACCOUNTS:      '1ec6e317-85ee-81dc-b7ef-000b41801109',
  CONTACTS:      '1ec6e317-85ee-8125-981b-000bf38b30aa',
  NOTES:         '1ec6e317-85ee-81ce-83a6-000bbf1608ab',
};

const PROSPECT_TS_PROP   = 'Slack Prospect Message TS';
const SLACK_SUMMARY_PROP = 'Slack Summary';
const DOCUMENTS_PROP     = 'Documents';

async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * 500;
      logger.warn(`Notion retry ${attempt}/${maxAttempts} in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function mapOpportunityPage(page) {
  const p = page.properties;
  return {
    id:           page.id,
    url:          page.url,
    opportunity:  p.Opportunity?.title?.[0]?.plain_text || '',
    stage:        p.Stage?.select?.name || '',
    nextStep:     p['Next Step']?.rich_text?.map(t => t.plain_text).join('') || '',
    closeDate:    p['Close Date']?.date?.start || '',
    owner:        p.Owner?.people?.[0]?.name || '',
    priority:     p['Priority Level']?.select?.name || '',
    type:         p.Type?.select?.name || '',
    state:        p.State?.rich_text?.[0]?.plain_text || '',
    city:         p.City?.rich_text?.[0]?.plain_text || '',
    patientRevenue: p['Patient Revenue']?.number || null,
    slackSummary: p[SLACK_SUMMARY_PROP]?.rich_text?.map(t => t.plain_text).join('') || '',
    documents:    (p[DOCUMENTS_PROP]?.files || []).map(f => ({
      name: f.name,
      url:  f.external?.url || f.file?.url || '',
    })),
    prospectMessageTs: p[PROSPECT_TS_PROP]?.rich_text?.[0]?.plain_text || '',
    lastModified: page.last_edited_time,
  };
}

async function getActiveOpportunities() {
  return queryOpportunities({ property: 'Stage', select: { does_not_equal: '9. Closed/Lost' } });
}

async function getClosedLostOpportunities() {
  return queryOpportunities({ property: 'Stage', select: { equals: '9. Closed/Lost' } });
}

async function queryOpportunities(filter) {
  return withRetry(async () => {
    const results = [];
    let cursor;
    do {
      const response = await notion.databases.query({
        database_id: DB.OPPORTUNITIES,
        filter,
        sorts: [{ property: 'Stage', direction: 'ascending' }, { property: 'Opportunity', direction: 'ascending' }],
        start_cursor: cursor,
        page_size:    100,
      });
      results.push(...response.results.map(mapOpportunityPage));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    return results;
  });
}

async function getOpportunityById(pageId) {
  return withRetry(async () => {
    const page = await notion.pages.retrieve({ page_id: pageId });
    return mapOpportunityPage(page);
  });
}

async function searchOpportunities(query) {
  const all = await getActiveOpportunities();
  const q   = query.toLowerCase();
  return all.filter(o =>
    o.opportunity.toLowerCase().includes(q) ||
    o.stage.toLowerCase().includes(q) ||
    o.owner.toLowerCase().includes(q)
  );
}

async function createOpportunity(data) {
  const page = await withRetry(() => notion.pages.create({
    parent: { database_id: DB.OPPORTUNITIES },
    properties: {
      Opportunity: { title: [{ text: { content: data.opportunity } }] },
      ...(data.stage     && { Stage:       { select: { name: data.stage } } }),
      ...(data.nextStep  && { 'Next Step':  { rich_text: [{ text: { content: data.nextStep } }] } }),
      ...(data.closeDate && { 'Close Date': { date: { start: data.closeDate } } }),
    },
  }));
  return { id: page.id, url: page.url };
}

async function updateOpportunity(pageId, data) {
  const properties = {};
  if (data.stage)                    properties.Stage        = { select: { name: data.stage } };
  if (data.nextStep !== undefined)   properties['Next Step'] = { rich_text: [{ text: { content: data.nextStep || '' } }] };
  if (data.closeDate)                properties['Close Date'] = { date: { start: data.closeDate } };
  if (data.priority)                 properties['Priority Level'] = { select: { name: data.priority } };
  if (data.slackSummary !== undefined) properties[SLACK_SUMMARY_PROP] = { rich_text: [{ text: { content: data.slackSummary || '' } }] };
  return withRetry(() => notion.pages.update({ page_id: pageId, properties }));
}

async function setProspectMessageTs(pageId, ts) {
  return withRetry(() => notion.pages.update({
    page_id: pageId,
    properties: {
      [PROSPECT_TS_PROP]: { rich_text: ts ? [{ text: { content: ts } }] : [] },
    },
  }));
}

async function addDocument(pageId, { url, name }) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const existing = page.properties[DOCUMENTS_PROP]?.files || [];
  const next = [...existing, { name: name || url, type: 'external', external: { url } }];
  return withRetry(() => notion.pages.update({
    page_id: pageId,
    properties: { [DOCUMENTS_PROP]: { files: next } },
  }));
}

async function logMeeting(data) {
  const properties = {
    Name:           { title: [{ text: { content: data.name } }] },
    'Meeting Type': { multi_select: [{ name: 'Clients & External' }] },
    Team:           { multi_select: [{ name: 'Sales' }] },
    ...(data.date      && { Date:      { date: { start: data.date } } }),
    ...(data.summary   && { Summary:   { rich_text: [{ text: { content: data.summary } }] } }),
  };
  if (data.opportunityId) {
    properties.Opportunity = { relation: [{ id: data.opportunityId }] };
  }
  return withRetry(() => notion.pages.create({
    parent:     { database_id: DB.MEETINGS },
    properties,
  }));
}

async function getRecentMeetings(limit = 20) {
  return withRetry(async () => {
    const res = await notion.databases.query({
      database_id: DB.MEETINGS,
      filter: {
        and: [
          { property: 'Meeting Type', multi_select: { contains: 'Clients & External' } },
          { property: 'Team',         multi_select: { contains: 'Sales' } },
        ],
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: Math.min(limit, 100),
    });
    return res.results.map(page => {
      const p = page.properties;
      return {
        id:         page.id,
        url:        page.url,
        name:       p.Name?.title?.[0]?.plain_text || '',
        date:       p.Date?.date?.start || '',
        summary:    p.Summary?.rich_text?.map(t => t.plain_text).join('') || '',
        opportunityIds: (p.Opportunity?.relation || []).map(r => r.id),
      };
    });
  });
}

async function ensureSchema() {
  const db = await notion.databases.retrieve({ database_id: DB.OPPORTUNITIES });
  const props = db.properties;
  const toAdd = {};
  if (!props[SLACK_SUMMARY_PROP]) toAdd[SLACK_SUMMARY_PROP] = { rich_text: {} };
  if (!props[DOCUMENTS_PROP])     toAdd[DOCUMENTS_PROP]     = { files: {} };
  if (!props[PROSPECT_TS_PROP])   toAdd[PROSPECT_TS_PROP]   = { rich_text: {} };
  if (!Object.keys(toAdd).length) return { added: [] };
  await notion.databases.update({ database_id: DB.OPPORTUNITIES, properties: toAdd });
  return { added: Object.keys(toAdd) };
}

module.exports = {
  DB,
  getActiveOpportunities,
  getClosedLostOpportunities,
  getOpportunityById,
  searchOpportunities,
  createOpportunity,
  updateOpportunity,
  logMeeting,
  getRecentMeetings,
  setProspectMessageTs,
  addDocument,
  ensureSchema,
};
