'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const notion = require('./notion');

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 10;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── System prompt ────────────────────────────────────────────────────────────
let _systemPrompt = null;
function getSystemPrompt() {
  if (!_systemPrompt) {
    const promptPath = path.join(__dirname, '..', 'prompts', 'sales-assistant.txt');
    _systemPrompt = fs.readFileSync(promptPath, 'utf8');
  }
  return _systemPrompt;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_pipeline',
    description:
      'Query all active opportunities (stages 4–8) with their stage, next step, action deadline, and owner. Use this for pipeline overviews and deal counts.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_opportunity',
    description:
      'Get full details on a named opportunity including stage, contacts, account info, recent meetings, and next steps. Use when someone asks about a specific deal or company.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The opportunity/company name to search for (partial match supported)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Create a new opportunity record in the Notion pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Opportunity/company name' },
        stage: {
          type: 'string',
          enum: [
            '1. Qualified Lead',
            '2. Demo',
            '4. Proposal',
            '5. Negotiation',
            '6. Pilot',
            '7. Integration',
            '8. Active/Won',
            '9. Closed/Lost',
          ],
          description: 'Pipeline stage',
        },
        nextStep: { type: 'string', description: 'Next action to take' },
        actionDeadline: {
          type: 'string',
          description: 'Deadline for next action (ISO 8601 date, e.g. 2025-06-15)',
        },
        closeDate: {
          type: 'string',
          description: 'Expected close date (ISO 8601)',
        },
        ownerId: { type: 'string', description: 'Notion user ID of the owner' },
        priorityLevel: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'Priority level',
        },
        type: { type: 'string', enum: ['New', 'Repeat'], description: 'New or repeat business' },
        publicPrivate: { type: 'string', enum: ['Public', 'Private'] },
        city: { type: 'string' },
        state: { type: 'string' },
        accountId: { type: 'string', description: 'Notion page ID of the linked Account' },
        numberOfBeds: { type: 'number' },
        patientRevenue: { type: 'number' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_opportunity',
    description:
      'Update stage, next step, deadline, owner, or priority on an existing opportunity. Requires the opportunity Notion page ID.',
    input_schema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'The Notion page ID of the opportunity to update',
        },
        stage: {
          type: 'string',
          enum: [
            '1. Qualified Lead',
            '2. Demo',
            '4. Proposal',
            '5. Negotiation',
            '6. Pilot',
            '7. Integration',
            '8. Active/Won',
            '9. Closed/Lost',
          ],
        },
        nextStep: { type: 'string' },
        actionDeadline: { type: 'string', description: 'ISO 8601 date or empty string to clear' },
        closeDate: { type: 'string', description: 'ISO 8601 date or empty string to clear' },
        ownerId: { type: 'string' },
        priorityLevel: { type: 'string', enum: ['Low', 'Medium', 'High'] },
      },
      required: ['opportunityId'],
    },
  },
  {
    name: 'create_meeting',
    description: 'Create a meeting record in the Our Meetings database, linked to an opportunity.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Meeting name/title' },
        summary: { type: 'string', description: 'Meeting summary or notes' },
        meetingType: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'Alignment & Strategy',
              'Advisory & Feedback',
              'Pitching & Investors',
              'Market Research & UXR',
              'Clients & External',
              'Operations & HR',
              'Board Meeting',
            ],
          },
        },
        team: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'All-Hands',
              'Leadership',
              'Product',
              'Research',
              'Sales',
              'Marketing',
              'Board',
              'Engineering',
              'UI/UX',
              'VR',
            ],
          },
        },
        participantIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Notion user IDs of participants',
        },
        stakeholderIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Notion user IDs of stakeholders',
        },
        opportunityId: { type: 'string', description: 'Notion page ID of the linked opportunity' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact record linked to an account and/or opportunity.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        specialty: { type: 'string', description: 'Clinical specialty or job title' },
        status: {
          type: 'string',
          enum: ['Unqualified', 'Lead', 'Working', 'Nurture', 'Customer'],
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Main Contact', 'End User', 'Champion', 'Decision Maker'],
          },
        },
        linkedin: { type: 'string' },
        accountId: { type: 'string' },
        opportunityId: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_note',
    description:
      'Add a short CRM note to an opportunity. Use for call summaries, key decisions, or important context that does not fit a meeting record.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Brief subject line for the note' },
        quickDescription: { type: 'string', description: 'Note body (keep under 500 chars)' },
        opportunityId: { type: 'string' },
        accountId: { type: 'string' },
        contactId: { type: 'string' },
      },
      required: ['subject', 'quickDescription'],
    },
  },
  {
    name: 'get_at_risk_deals',
    description:
      'Return deals with no next step set, overdue action deadlines, or no recent activity. Use for weekly reviews or when asked about deals that need attention.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(toolName, input) {
  logger.info('Executing Claude tool', { tool: toolName, input });
  try {
    switch (toolName) {
      case 'get_pipeline': {
        const opps = await notion.getPipeline();
        return { opportunities: opps, count: opps.length };
      }

      case 'get_opportunity': {
        const opp = await notion.getOpportunityByName(input.name);
        if (!opp) return { error: `No opportunity found matching "${input.name}"` };
        const detail = await notion.getOpportunityDetail(opp.id);
        return detail;
      }

      case 'create_opportunity': {
        const created = await notion.createOpportunity(input);
        return { created: true, opportunity: created };
      }

      case 'update_opportunity': {
        const { opportunityId, ...updates } = input;
        const updated = await notion.updateOpportunity(opportunityId, updates);
        return { updated: true, opportunity: updated };
      }

      case 'create_meeting': {
        const meeting = await notion.createMeeting(input);
        return { created: true, meeting };
      }

      case 'create_contact': {
        const contact = await notion.createContact(input);
        return { created: true, contact };
      }

      case 'add_note': {
        const note = await notion.addNote(input);
        return { created: true, note };
      }

      case 'get_at_risk_deals': {
        const deals = await notion.getAtRiskDeals();
        return { atRiskDeals: deals, count: deals.length };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    logger.error('Tool execution error', { tool: toolName, err: err.message });
    return { error: err.message };
  }
}

// ─── Main Claude interaction loop ────────────────────────────────────────────

/**
 * Sends a user message to Claude and handles the tool_use loop.
 * @param {string} userMessage - The user's message text
 * @param {Array} history - Array of {role, content} prior messages (oldest first)
 * @returns {string} Claude's final text response
 */
async function chat(userMessage, history = []) {
  const systemPrompt = getSystemPrompt();

  // Build messages array: history + new user message
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    logger.debug('Claude response', {
      stopReason: response.stop_reason,
      contentTypes: response.content.map((c) => c.type),
    });

    // If Claude is done — return the text
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((c) => c.type === 'text');
      return textBlock ? textBlock.text : '(No response generated)';
    }

    // If Claude wants to use tools
    if (response.stop_reason === 'tool_use') {
      // Add the assistant's response (including tool_use blocks) to history
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results as a user message
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    logger.warn('Unexpected stop reason from Claude', { stopReason: response.stop_reason });
    const textBlock = response.content.find((c) => c.type === 'text');
    return textBlock ? textBlock.text : 'Something went wrong processing your request.';
  }

  logger.error('Claude tool loop exceeded max iterations', { MAX_TOOL_ITERATIONS });
  return 'I ran into an issue completing that request — too many steps required. Please try a more specific question.';
}

module.exports = { chat, TOOLS };
