'use strict';
const { Client } = require('@notionhq/client');
const logger = require('./logger');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DB = {
  MEETINGS:      '4557b0ce-9d55-49ec-bd82-c068d2d5836c',
  OPPORTUNITIES: '1ec6e317-85ee-81bc-8fd4-c39fdfa0e780',
  ACCOUNTS:      '1ec6e317-85ee-81dc-b7ef-000b41801109',
  CONTACTS:      '1ec6e317-85ee-8125-981b-000bf38b30aa',
  NOTES:         '1ec6e317-85ee-81ce-83a6-000bbf1608ab',
};

async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * 500;
      logger.warn(`Notion API error (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function getActiveOpportunities() {
  return withRetry(async () => {
    const results = [];
    let cursor;
    do {
      const response = await notion.databases.query({
        database_id: DB.OPPORTUNITIES,
        filter: {
          property: 'Stage',
          select: { does_not_equal: '9. Closed/Lost' },
        },
        sorts: [{ property: 'Stage', direction: 'ascending' }],
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of response.results) {
        const p = page.properties;
        results.push({
          id:            page.id,
          opportunity:   p.Opportunity?.title?.[0]?.plain_text || '',
          stage:         p.Stage?.select?.name || '',
          nextStep:      p['Next Step']?.rich_text?.[0]?.plain_text || '',
          closeDate:     p['Close Date']?.date?.start || '',
          owner:         p.Owner?.people?.[0]?.name || '',
          priorityLevel: p['Priority Level']?.select?.name || '',
          state:         p.State?.rich_text?.[0]?.plain_text || '',
          city:          p.City?.rich_text?.[0]?.plain_text || '',
          lastModified:  p['Last Modified']?.last_edited_time || '',
        });
      }
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    return results;
  });
}

async function getOpportunityById(pageId) {
  return withRetry(async () => {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const p = page.properties;
    return {
      id:            page.id,
      opportunity:   p.Opportunity?.title?.[0]?.plain_text || '',
      stage:         p.Stage?.select?.name || '',
      nextStep:      p['Next Step']?.rich_text?.[0]?.plain_text || '',
      closeDate:     p['Close Date']?.date?.start || '',
      owner:         p.Owner?.people?.[0]?.name || '',
      priorityLevel: p['Priority Level']?.select?.name || '',
    };
  });
}

async function searchOpportunities(query) {
  const all = await getActiveOpportunities();
  const q = query.toLowerCase();
  return all.filter(o =>
    o.opportunity.toLowerCase().includes(q) ||
    o.stage.toLowerCase().includes(q) ||
    o.owner.toLowerCase().includes(q)
  );
}

async function createOpportunity(data) {
  return withRetry(() => notion.pages.create({
    parent: { database_id: DB.OPPORTUNITIES },
    properties: {
      Opportunity: { title: [{ text: { content: data.opportunity } }] },
      ...(data.stage     && { Stage:       { select: { name: data.stage } } }),
      ...(data.nextStep  && { 'Next Step':  { rich_text: [{ text: { content: data.nextStep } }] } }),
      ...(data.closeDate && { 'Close Date': { date: { start: data.closeDate } } }),
    },
  }));
}

async function updateOpportunity(pageId, data) {
  const properties = {};
  if (data.stage)    properties.Stage        = { select: { name: data.stage } };
  if (data.nextStep !== undefined)
                     properties['Next Step'] = { rich_text: [{ text: { content: data.nextStep } }] };
  if (data.closeDate) properties['Close Date'] = { date: { start: data.closeDate } };
  return withRetry(() => notion.pages.update({ page_id: pageId, properties }));
}

async function logMeeting(data) {
  return withRetry(() => notion.pages.create({
    parent: { database_id: DB.MEETINGS },
    properties: {
      Name:           { title: [{ text: { content: data.name } }] },
      'Meeting Type': { select: { name: 'Clients & External' } },
      Team:           { select: { name: 'Sales' } },
      ...(data.date      && { Date:      { date: { start: data.date } } }),
      ...(data.attendees && { Attendees: { rich_text: [{ text: { content: data.attendees } }] } }),
      ...(data.notes     && { Notes:     { rich_text: [{ text: { content: data.notes } }] } }),
    },
  }));
}

module.exports = {
  getActiveOpportunities,
  getOpportunityById,
  searchOpportunities,
  createOpportunity,
  updateOpportunity,
  logMeeting,
  DB,
};
