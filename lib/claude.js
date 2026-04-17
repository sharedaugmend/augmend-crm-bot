'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const notion    = require('./notion');
const { syncPipeline } = require('./sync');
const logger    = require('./logger');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/sales-assistant.txt'),
  'utf8'
);

const TOOLS = [
  {
    name: 'get_pipeline',
    description: 'Get all active deals in the pipeline with their current stage, owner, next step, and close date.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_opportunities',
    description: 'Search for deals by company name, stage, or owner.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (company name, stage, or owner)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Create a new opportunity in Notion CRM. Name format: "Account / Type / Year".',
    input_schema: {
      type: 'object',
      properties: {
        opportunity: { type: 'string', description: 'Full opportunity name (e.g. "Mass General Hospital / Pain Clinic / 2026")' },
        stage: {
          type: 'string',
          description: 'Current pipeline stage',
          enum: ['1. Qualified Lead', '2. Demo', '4. Proposal', '5. Negotiation', '6. Pilot', '7. Integration', '8. Active/Won'],
        },
        nextStep:  { type: 'string', description: 'What needs to happen next' },
        closeDate: { type: 'string', description: 'Expected close date in YYYY-MM-DD format' },
      },
      required: ['opportunity', 'stage'],
    },
  },
  {
    name: 'update_opportunity',
    description: 'Update the stage, next step, or close date of an existing opportunity.',
    input_schema: {
      type: 'object',
      properties: {
        pageId:    { type: 'string', description: 'Notion page ID (get from get_pipeline or search_opportunities)' },
        stage:     { type: 'string', description: 'New pipeline stage' },
        nextStep:  { type: 'string', description: 'Updated next action' },
        closeDate: { type: 'string', description: 'Updated close date (YYYY-MM-DD)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'log_meeting',
    description: 'Log a sales meeting or call in Notion (Meeting Type: Clients & External, Team: Sales).',
    input_schema: {
      type: 'object',
      properties: {
        name:      { type: 'string', description: 'Meeting title (e.g. "Mass General / Discovery Call")' },
        date:      { type: 'string', description: 'Meeting date (YYYY-MM-DD)' },
        attendees: { type: 'string', description: 'Comma-separated list of attendees' },
        notes:     { type: 'string', description: 'Key takeaways or action items' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_deals_by_stage',
    description: 'Get all deals currently in a specific pipeline stage.',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Pipeline stage name (e.g. "2. Demo", "5. Negotiation")' },
      },
      required: ['stage'],
    },
  },
  {
    name: 'get_overdue_deals',
    description: 'Get all deals where the close date has already passed.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'sync_channels',
    description: 'Trigger an immediate sync of the Notion pipeline to Slack channels (rename, create, update pins).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

async function executeTool(name, input) {
  logger.info(`Tool call: ${name}  input: ${JSON.stringify(input)}`);
  switch (name) {
    case 'get_pipeline':
      return notion.getActiveOpportunities();
    case 'search_opportunities':
      return notion.searchOpportunities(input.query);
    case 'create_opportunity':
      return notion.createOpportunity(input);
    case 'update_opportunity':
      return notion.updateOpportunity(input.pageId, input);
    case 'log_meeting':
      return notion.logMeeting(input);
    case 'get_deals_by_stage': {
      const all = await notion.getActiveOpportunities();
      return all.filter(o => o.stage === input.stage || o.stage?.includes(input.stage));
    }
    case 'get_overdue_deals': {
      const all   = await notion.getActiveOpportunities();
      const today = new Date().toISOString().split('T')[0];
      return all.filter(o => o.closeDate && o.closeDate < today);
    }
    case 'sync_channels':
      return syncPipeline();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(userText, userId) {
  logger.info(`Message from ${userId}: ${userText.slice(0, 120)}`);
  const messages = [{ role: 'user', content: userText }];
  for (let i = 0; i < 10; i++) {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    });
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
          output = await executeTool(block.name, block.input);
        } catch (err) {
          output = { error: err.message };
        }
        results.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     JSON.stringify(output, null, 2),
        });
      }
      messages.push({ role: 'user', content: results });
    } else {
      break;
    }
  }
  return '_Ran into an issue — please try rephrasing your request._';
}

module.exports = { handleMessage };
