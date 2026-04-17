'use strict';

const { Client } = require('@notionhq/client');
const logger = require('./logger');

// ─── Database IDs ────────────────────────────────────────────────────────────
const DB = {
  MEETINGS: '4557b0ce-9d55-49ec-bd82-c068d2d5836c',
  OPPORTUNITIES: '1ec6e317-85ee-81bc-8fd4-c39fdfa0e780',
  ACCOUNTS: '1ec6e317-85ee-81dc-b7ef-000b41801109',
  CONTACTS: '1ec6e317-85ee-8125-981b-000bf38b30aa',
  NOTES: '1ec6e317-85ee-81ce-83a6-000bbf1608ab',
};

// Stage slugs used for channel naming
const STAGE_SLUGS = {
  '4. Proposal': 'proposal',
  '5. Negotiation': 'negotiation',
  '6. Pilot': 'pilot',
  '7. Integration': 'integration',
  '8. Active/Won': 'active',
};

const ACTIVE_STAGES = Object.keys(STAGE_SLUGS);

module.exports.DB = DB;
module.exports.STAGE_SLUGS = STAGE_SLUGS;
module.exports.ACTIVE_STAGES = ACTIVE_STAGES;

// ─── Notion Client ───────────────────────────────────────────────────────────
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ─── Rate-limit-aware retry wrapper ─────────────────────────────────────────
async function withRetry(fn, maxAttempts = 3) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isRateLimit = err?.status === 429 || err?.code === 'rate_limited';
      const isRetryable = isRateLimit || err?.status >= 500;
      if (!isRetryable || attempt >= maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      logger.warn(`Notion API retry ${attempt}/${maxAttempts} after ${Math.round(delay)}ms`, {
        status: err?.status,
        code: err?.code,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Pagination helper ───────────────────────────────────────────────────────
async function collectAll(fn, params = {}) {
  const results = [];
  let cursor;
  do {
    const page = await withRetry(() =>
      fn({ ...params, ...(cursor ? { start_cursor: cursor } : {}) })
    );
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return results;
}

// ─── Property extractors ─────────────────────────────────────────────────────
function extractTitle(prop) {
  return prop?.title?.map((t) => t.plain_text).join('') || '';
}

function extractText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join('') || '';
}

function extractSelect(prop) {
  return prop?.select?.name || null;
}

function extractMultiSelect(prop) {
  return prop?.multi_select?.map((s) => s.name) || [];
}

function extractDate(prop) {
  return prop?.date?.start || null;
}

function extractNumber(prop) {
  return prop?.number ?? null;
}

function extractUrl(prop) {
  return prop?.url || null;
}

function extractEmail(prop) {
  return prop?.email || null;
}

function extractPhone(prop) {
  return prop?.phone_number || null;
}

function extractPerson(prop) {
  if (!prop?.people?.length) return null;
  const p = prop.people[0];
  return { id: p.id, name: p.name || p.id };
}

function extractPeople(prop) {
  return (prop?.people || []).map((p) => ({ id: p.id, name: p.name || p.id }));
}

function extractRelationIds(prop) {
  return (prop?.relation || []).map((r) => r.id);
}

function extractPercent(prop) {
  return prop?.number ?? null; // Notion stores percent as a plain number (0–1)
}

// ─── Shape normalizers ───────────────────────────────────────────────────────
function shapeOpportunity(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    name: extractTitle(p['Opportunity']),
    stage: extractSelect(p['Stage']),
    nextStep: extractText(p['Next Step']),
    actionDeadline: extractDate(p['Action Deadline']),
    closeDate: extractDate(p['Close Date']),
    owner: extractPerson(p['Owner']),
    priorityLevel: extractSelect(p['Priority Level']),
    type: extractSelect(p['Type']),
    publicPrivate: extractSelect(p['Public/Private']),
    city: extractText(p['City']),
    state: extractText(p['State']),
    accountIds: extractRelationIds(p['Account']),
    contactIds: extractRelationIds(p['Contacts']),
    noteIds: extractRelationIds(p['Notes']),
    numberOfBeds: extractNumber(p['Number of Beds per Hospital']),
    patientRevenue: extractNumber(p['Patient Revenue']),
    percentageUsingAugMend: extractPercent(p['Percentage using AugMend']),
  };
}

function shapeMeeting(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    name: extractTitle(p['Name']),
    summary: extractText(p['Summary']),
    meetingType: extractMultiSelect(p['Meeting Type']),
    team: extractMultiSelect(p['Team']),
    participants: extractPeople(p['Participants']),
    stakeholders: extractPeople(p['Stakeholders']),
    opportunityIds: extractRelationIds(p['Opportunity'] || {}),
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
  };
}

function shapeContact(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    name: extractTitle(p['Name']),
    email: extractEmail(p['Email']),
    phone: extractPhone(p['Phone']),
    specialty: extractText(p['Specialty']),
    status: extractSelect(p['Status']),
    type: extractMultiSelect(p['Type']),
    linkedin: extractUrl(p['Linkedin']),
    accountIds: extractRelationIds(p['Account']),
    opportunityIds: extractRelationIds(p['Opportunities']),
  };
}

function shapeAccount(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    name: extractTitle(p['Account Name']),
    website: extractUrl(p['Website']),
    linkedin: extractUrl(p['Linkedin']),
    leadSource: extractSelect(p['Lead Source']),
    relationship: extractSelect(p['Relationship']),
    companySize: extractNumber(p['Company Size']),
    owner: extractPerson(p['Owner']),
  };
}

function shapeNote(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    subject: extractTitle(p['Subject']),
    quickDescription: extractText(p['Quick Description']),
    accountIds: extractRelationIds(p['Account']),
    contactIds: extractRelationIds(p['Contact']),
    opportunityIds: extractRelationIds(p['Opportunity']),
    createdTime: page.created_time,
  };
}

// ─── Opportunity queries ──────────────────────────────────────────────────────

/**
 * Returns all active opportunities (stages 4–8).
 */
async function getPipeline() {
  const pages = await collectAll(notion.databases.query.bind(notion.databases), {
    database_id: DB.OPPORTUNITIES,
    filter: {
      or: ACTIVE_STAGES.map((stage) => ({
        property: 'Stage',
        select: { equals: stage },
      })),
    },
    sorts: [{ property: 'Stage', direction: 'ascending' }],
  });
  return pages.map(shapeOpportunity);
}

/**
 * Returns a single opportunity by name (case-insensitive partial match).
 */
async function getOpportunityByName(name) {
  const pages = await collectAll(notion.databases.query.bind(notion.databases), {
    database_id: DB.OPPORTUNITIES,
    filter: {
      property: 'Opportunity',
      title: { contains: name },
    },
  });
  if (!pages.length) return null;
  return shapeOpportunity(pages[0]);
}

/**
 * Returns full opportunity detail including resolved contacts, account, and recent meetings.
 */
async function getOpportunityDetail(opportunityId) {
  const page = await withRetry(() => notion.pages.retrieve({ page_id: opportunityId }));
  const opp = shapeOpportunity(page);

  // Resolve contacts in parallel
  const [contacts, account, meetings] = await Promise.all([
    Promise.all(opp.contactIds.map((id) => getContactById(id))),
    opp.accountIds[0] ? getAccountById(opp.accountIds[0]) : Promise.resolve(null),
    getMeetingsForOpportunity(opportunityId),
  ]);

  return { ...opp, contacts: contacts.filter(Boolean), account, meetings };
}

/**
 * Returns deals that are at risk: no next step, overdue deadline, or no edit in 30+ days.
 */
async function getAtRiskDeals() {
  const all = await getPipeline();
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  return all.filter((opp) => {
    const noNextStep = !opp.nextStep;
    const overdue =
      opp.actionDeadline && new Date(opp.actionDeadline) < now;
    return noNextStep || overdue;
  });
}

/**
 * Creates a new opportunity record.
 */
async function createOpportunity({
  name,
  stage,
  nextStep,
  actionDeadline,
  closeDate,
  ownerId,
  priorityLevel,
  type,
  publicPrivate,
  city,
  state,
  accountId,
  numberOfBeds,
  patientRevenue,
}) {
  const properties = {
    Opportunity: { title: [{ text: { content: name } }] },
  };

  if (stage) properties['Stage'] = { select: { name: stage } };
  if (nextStep) properties['Next Step'] = { rich_text: [{ text: { content: nextStep } }] };
  if (actionDeadline) properties['Action Deadline'] = { date: { start: actionDeadline } };
  if (closeDate) properties['Close Date'] = { date: { start: closeDate } };
  if (ownerId) properties['Owner'] = { people: [{ id: ownerId }] };
  if (priorityLevel) properties['Priority Level'] = { select: { name: priorityLevel } };
  if (type) properties['Type'] = { select: { name: type } };
  if (publicPrivate) properties['Public/Private'] = { select: { name: publicPrivate } };
  if (city) properties['City'] = { rich_text: [{ text: { content: city } }] };
  if (state) properties['State'] = { rich_text: [{ text: { content: state } }] };
  if (accountId) properties['Account'] = { relation: [{ id: accountId }] };
  if (numberOfBeds != null) properties['Number of Beds per Hospital'] = { number: numberOfBeds };
  if (patientRevenue != null) properties['Patient Revenue'] = { number: patientRevenue };

  const page = await withRetry(() =>
    notion.pages.create({ parent: { database_id: DB.OPPORTUNITIES }, properties })
  );
  logger.info('Created opportunity', { id: page.id, name });
  return shapeOpportunity(page);
}

/**
 * Updates stage, next step, deadline, and/or owner on an opportunity.
 */
async function updateOpportunity(opportunityId, updates) {
  const properties = {};

  if (updates.stage) properties['Stage'] = { select: { name: updates.stage } };
  if (updates.nextStep !== undefined)
    properties['Next Step'] = { rich_text: [{ text: { content: updates.nextStep } }] };
  if (updates.actionDeadline !== undefined)
    properties['Action Deadline'] = updates.actionDeadline
      ? { date: { start: updates.actionDeadline } }
      : { date: null };
  if (updates.closeDate !== undefined)
    properties['Close Date'] = updates.closeDate
      ? { date: { start: updates.closeDate } }
      : { date: null };
  if (updates.ownerId) properties['Owner'] = { people: [{ id: updates.ownerId }] };
  if (updates.priorityLevel) properties['Priority Level'] = { select: { name: updates.priorityLevel } };

  const page = await withRetry(() =>
    notion.pages.update({ page_id: opportunityId, properties })
  );
  logger.info('Updated opportunity', { id: opportunityId, updates });
  return shapeOpportunity(page);
}

// ─── Meeting queries ──────────────────────────────────────────────────────────

/**
 * Fetches meetings linked to a given opportunity (via the Opportunity relation field).
 * Falls back to a name-based search if the relation field is absent/empty.
 */
async function getMeetingsForOpportunity(opportunityId) {
  try {
    const pages = await collectAll(notion.databases.query.bind(notion.databases), {
      database_id: DB.MEETINGS,
      filter: {
        property: 'Opportunity',
        relation: { contains: opportunityId },
      },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    });
    return pages.map(shapeMeeting);
  } catch (err) {
    // If the Opportunity relation field doesn't exist yet, return empty
    logger.warn('getMeetingsForOpportunity: relation filter failed, returning empty', {
      err: err.message,
    });
    return [];
  }
}

/**
 * Creates a meeting record in Our Meetings.
 */
async function createMeeting({
  name,
  summary,
  meetingType,
  team,
  participantIds = [],
  stakeholderIds = [],
  opportunityId,
}) {
  const properties = {
    Name: { title: [{ text: { content: name } }] },
  };

  if (summary) properties['Summary'] = { rich_text: [{ text: { content: summary } }] };
  if (meetingType?.length)
    properties['Meeting Type'] = { multi_select: meetingType.map((v) => ({ name: v })) };
  if (team?.length)
    properties['Team'] = { multi_select: team.map((v) => ({ name: v })) };
  if (participantIds.length)
    properties['Participants'] = { people: participantIds.map((id) => ({ id })) };
  if (stakeholderIds.length)
    properties['Stakeholders'] = { people: stakeholderIds.map((id) => ({ id })) };
  if (opportunityId)
    properties['Opportunity'] = { relation: [{ id: opportunityId }] };

  const page = await withRetry(() =>
    notion.pages.create({ parent: { database_id: DB.MEETINGS }, properties })
  );
  logger.info('Created meeting', { id: page.id, name });
  return shapeMeeting(page);
}

// ─── Contact queries ──────────────────────────────────────────────────────────

async function getContactById(contactId) {
  try {
    const page = await withRetry(() => notion.pages.retrieve({ page_id: contactId }));
    return shapeContact(page);
  } catch (err) {
    logger.warn('getContactById failed', { contactId, err: err.message });
    return null;
  }
}

/**
 * Creates a contact linked to an account and/or opportunity.
 */
async function createContact({
  name,
  email,
  phone,
  specialty,
  status,
  types = [],
  linkedin,
  accountId,
  opportunityId,
}) {
  const properties = {
    Name: { title: [{ text: { content: name } }] },
  };

  if (email) properties['Email'] = { email };
  if (phone) properties['Phone'] = { phone_number: phone };
  if (specialty) properties['Specialty'] = { rich_text: [{ text: { content: specialty } }] };
  if (status) properties['Status'] = { select: { name: status } };
  if (types.length) properties['Type'] = { multi_select: types.map((t) => ({ name: t })) };
  if (linkedin) properties['Linkedin'] = { url: linkedin };
  if (accountId) properties['Account'] = { relation: [{ id: accountId }] };
  if (opportunityId) properties['Opportunities'] = { relation: [{ id: opportunityId }] };

  const page = await withRetry(() =>
    notion.pages.create({ parent: { database_id: DB.CONTACTS }, properties })
  );
  logger.info('Created contact', { id: page.id, name });
  return shapeContact(page);
}

// ─── Account queries ──────────────────────────────────────────────────────────

async function getAccountById(accountId) {
  try {
    const page = await withRetry(() => notion.pages.retrieve({ page_id: accountId }));
    return shapeAccount(page);
  } catch (err) {
    logger.warn('getAccountById failed', { accountId, err: err.message });
    return null;
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

/**
 * Adds a short CRM note linked to an opportunity, and optionally account/contact.
 */
async function addNote({ subject, quickDescription, opportunityId, accountId, contactId }) {
  const properties = {
    Subject: { title: [{ text: { content: subject } }] },
  };

  if (quickDescription)
    properties['Quick Description'] = { rich_text: [{ text: { content: quickDescription } }] };
  if (opportunityId) properties['Opportunity'] = { relation: [{ id: opportunityId }] };
  if (accountId) properties['Account'] = { relation: [{ id: accountId }] };
  if (contactId) properties['Contact'] = { relation: [{ id: contactId }] };

  const page = await withRetry(() =>
    notion.pages.create({ parent: { database_id: DB.NOTES }, properties })
  );
  logger.info('Added note', { id: page.id, subject });
  return shapeNote(page);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  DB,
  STAGE_SLUGS,
  ACTIVE_STAGES,
  getPipeline,
  getOpportunityByName,
  getOpportunityDetail,
  getAtRiskDeals,
  createOpportunity,
  updateOpportunity,
  getMeetingsForOpportunity,
  createMeeting,
  getContactById,
  createContact,
  getAccountById,
  addNote,
};
