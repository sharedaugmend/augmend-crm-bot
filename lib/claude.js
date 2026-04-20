'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const notion    = require('./notion');
const state     = require('./state');
const formatter = require('./formatter');
const { planSync, applyOps } = require('./channelSync');
const gdrive    = require('./gdrive');
const { STAGES, validateStage, validatePageId } = require('./validator');
const logger    = require('./logger');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60_000,
});

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/sales-assistant.txt'),
  'utf8'
);

const TOOLS = [
  {
    name: 'get_pipeline',
    description: 'Return all active opportunities (everything except stage "9. Closed/Lost").',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_opportunities',
    description: 'Filter the active pipeline by company name, stage, or owner (substring match).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_deals_by_stage',
    description: 'Return deals in a specific stage.',
    input_schema: {
      type: 'object',
      properties: { stage: { type: 'string', enum: STAGES } },
      required: ['stage'],
    },
  },
  {
    name: 'get_overdue_deals',
    description: 'Return deals whose close date is in the past.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_recent_meetings',
    description: 'Return recent meetings (Meeting Type = "Clients & External" AND Team = "Sales") sorted newest first.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 20 } },
      required: [],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Create a new opportunity in Notion. Title format: "Account / Type / Year".',
    input_schema: {
      type: 'object',
      properties: {
        opportunity: { type: 'string' },
        stage:       { type: 'string', enum: STAGES },
        nextStep:    { type: 'string' },
        closeDate:   { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['opportunity', 'stage'],
    },
  },
  {
    name: 'update_opportunity',
    description: 'Update an existing opportunity. Executes immediately (no confirmation). slackSummary is the short 1-3 sentence summary shown in the prospect channel message. description is the longer customer context (what they do, public pain points, notes on decision-makers).',
    input_schema: {
      type: 'object',
      properties: {
        pageId:       { type: 'string' },
        stage:        { type: 'string', enum: STAGES },
        nextStep:     { type: 'string' },
        closeDate:    { type: 'string' },
        priority:     { type: 'string' },
        slackSummary: { type: 'string', description: '1-3 sentence summary for the #prospective-customers message.' },
        description:  { type: 'string', description: 'Longer-form customer context — what they do, location/size, public pain points, decision-maker notes. Shown to the team as they prep for pilot/deployment.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'log_meeting',
    description: 'Log a client meeting. Must include opportunityId to link the meeting to a deal.',
    input_schema: {
      type: 'object',
      properties: {
        name:          { type: 'string' },
        date:          { type: 'string' },
        summary:       { type: 'string' },
        opportunityId: { type: 'string' },
      },
      required: ['name', 'opportunityId'],
    },
  },
  {
    name: 'add_document',
    description: 'Attach an https URL to an opportunity\'s Documents field.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        url:    { type: 'string', description: 'Must start with https://' },
        name:   { type: 'string' },
      },
      required: ['pageId', 'url'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a Contact in the Contacts database and link it to an Opportunity. Use this when the user confirms contacts that were drafted from research. For web-sourced contacts, set status to "Lead" and include a note in specialty noting the source (e.g., "Chief of Pain Medicine · sourced from web, verify").',
    input_schema: {
      type: 'object',
      properties: {
        name:          { type: 'string' },
        opportunityId: { type: 'string' },
        email:         { type: 'string' },
        phone:         { type: 'string' },
        specialty:     { type: 'string', description: 'Job title or clinical specialty.' },
        linkedin:      { type: 'string' },
        status:        { type: 'string', enum: ['Unqualified', 'Lead', 'Working', 'Nurture', 'Customer'] },
        type:          {
          type: 'array',
          items: { type: 'string', enum: ['Main Contact', 'End User', 'Champion', 'Decision Maker'] },
          description: 'Role(s) in the buying process.',
        },
      },
      required: ['name', 'opportunityId'],
    },
  },
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  },
  {
    name: 'search_drive',
    description: 'Search the AugMend Sales folder in Google Drive (including customer sub-folders) for documents matching a query. Returns a list of matching files with names, IDs, mime types, and modified dates. Use when the user asks about a customer\'s PRD, proposal, pilot plan, contract, or anything likely to be in Drive.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to search file contents and names.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_drive_document',
    description: 'Fetch the plain-text content of a specific Drive document. Call after search_drive to read the contents of a relevant file. Supports Google Docs, Slides, Sheets, PDFs, Word, PowerPoint. Content may be truncated if long.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'plan_slack_sync',
    description: 'Compute the Slack-vs-Notion diff and return a list of proposed channel operations. Does NOT execute. Always present the summary to the user and ask them to reply "yes" to apply. The application runs outside your tool loop — you do NOT call an apply tool yourself.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

function isYes(text) {
  const t = text.trim().toLowerCase();
  return ['yes', 'y', 'proceed', 'confirm', 'apply', 'go ahead', 'approved'].includes(t);
}

function isNo(text) {
  const t = text.trim().toLowerCase();
  return ['no', 'cancel', 'abort', 'stop', 'nevermind'].includes(t);
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

async function executeTool(name, input, userId, pipelineRef) {
  logger.info(`Tool: ${name}`);
  switch (name) {
    case 'get_pipeline':
      pipelineRef.current = await notion.getActiveOpportunities();
      return pipelineRef.current.map(o => ({
        id:              o.id,
        name:            o.opportunity,
        stage:           o.stage,
        owner:           o.owner,
        priority:        o.priority,
        nextStep:        o.nextStep,
        closeDate:       o.closeDate,
        city:            o.city,
        state:           o.state,
        hasDescription:  !!o.description,
        hasSlackSummary: !!o.slackSummary,
        documentsCount:  (o.documents || []).length,
      }));

    case 'search_opportunities':
      return notion.searchOpportunities(input.query);

    case 'get_deals_by_stage':
      validateStage(input.stage);
      return pipelineRef.current.filter(o => o.stage === input.stage);

    case 'get_overdue_deals': {
      const today = new Date().toISOString().slice(0, 10);
      return pipelineRef.current.filter(o => o.closeDate && o.closeDate < today);
    }

    case 'get_recent_meetings':
      return notion.getRecentMeetings(input.limit || 20);

    case 'create_opportunity': {
      if (input.stage) validateStage(input.stage);
      const result = await notion.createOpportunity(input);
      pipelineRef.current = await notion.getActiveOpportunities();
      return result;
    }

    case 'update_opportunity':
      validatePageId(input.pageId, pipelineRef.current);
      if (input.stage) validateStage(input.stage);
      await notion.updateOpportunity(input.pageId, input);
      return { ok: true, url: formatter.notionUrl(input.pageId) };

    case 'log_meeting':
      validatePageId(input.opportunityId, pipelineRef.current);
      return notion.logMeeting(input);

    case 'add_document':
      validatePageId(input.pageId, pipelineRef.current);
      if (!isHttpsUrl(input.url)) {
        return { error: 'URL must be http:// or https://. Rejected for safety.' };
      }
      await notion.addDocument(input.pageId, { url: input.url, name: input.name });
      return { ok: true };

    case 'create_contact':
      validatePageId(input.opportunityId, pipelineRef.current);
      if (input.linkedin && !isHttpsUrl(input.linkedin)) {
        return { error: 'linkedin must be a http(s) URL.' };
      }
      return notion.createContact(input);

    case 'search_drive':
      return gdrive.search(input.query);

    case 'read_drive_document':
      return gdrive.readDocument(input.fileId);

    case 'plan_slack_sync': {
      const plan = await planSync();
      if (!plan.ops.length && !plan.warnings.length) {
        state.clearPending(userId);
        return { summary: plan.summary, ops: [] };
      }
      state.setPending(userId, { kind: 'slack_sync', ops: plan.ops, summary: plan.summary });
      return {
        summary: plan.summary,
        ops_count: plan.ops.length,
        truncated: plan.truncated,
        warnings: plan.warnings.map(w => w.description),
        instruction: 'Show the `summary` text to the user verbatim. Do NOT call any apply tool. The runtime applies when the user replies "yes".',
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(text, userId) {
  logger.info(`Msg from ${userId}: ${text.slice(0, 200)}`);

  const pending = state.getPending(userId);
  if (pending && isYes(text) && state.isReadyToApply(pending)) {
    state.clearPending(userId);
    const results = await applyOps(pending.ops);
    return renderResults(results);
  }
  if (pending && isNo(text)) {
    state.clearPending(userId);
    return 'Cancelled. No Slack changes applied.';
  }

  const pipelineRef = { current: await notion.getActiveOpportunities() };
  const messages = [{ role: 'user', content: text }];
  const cachedTools = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 && !t.type ? { ...t, cache_control: { type: 'ephemeral' } } : t
  );
  const cachedSystem = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

  for (let i = 0; i < 10; i++) {
    let response;
    try {
      response = await anthropic.messages.create({
        model:      'claude-sonnet-4-5',
        max_tokens: 2048,
        system:     cachedSystem,
        tools:      cachedTools,
        messages,
      });
    } catch (err) {
      if (err.status === 429) {
        logger.warn(`Anthropic rate limit hit at iteration ${i}: ${err.message}`);
        return '_I hit the Anthropic rate limit (10K input tokens/min on this account). Please wait about a minute and try again. If this keeps happening, we\'ll need to request a limit increase from Anthropic or reduce how much the bot reads per query._';
      }
      throw err;
    }

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text');
      return text?.text || '_Done._';
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let output;
        try {
          output = await executeTool(block.name, block.input, userId, pipelineRef);
        } catch (err) {
          output = { error: err.message };
        }
        const wrapped = `<untrusted_data source="tool:${block.name}">\n${JSON.stringify(output, null, 2)}\n</untrusted_data>`;
        results.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     wrapped,
        });
      }
      if (results.length === 0) {
        const text = response.content.find(b => b.type === 'text');
        return text?.text || '_Done._';
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    break;
  }

  return '_Ran out of tool-use iterations — please rephrase or break your request into smaller steps._';
}

function renderResults(results) {
  const lines = ['*Applied:*'];
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : '✗';
    lines.push(`  ${icon} ${r.op}${r.error ? ` — ${r.error}` : ''}`);
  }
  return lines.join('\n');
}

module.exports = { handleMessage };
