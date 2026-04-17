'use strict';

const { test, describe, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock the Notion client before requiring notion.js ───────────────────────
const mockPages = {
  retrieve: mock.fn(),
  create: mock.fn(),
  update: mock.fn(),
};
const mockDatabases = {
  query: mock.fn(),
};

mock.module('@notionhq/client', {
  namedExports: {
    Client: class MockClient {
      constructor() {
        this.pages = mockPages;
        this.databases = mockDatabases;
      }
    },
  },
});

// Stub logger to suppress output during tests
mock.module('../lib/logger', {
  defaultExport: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
});

const notion = require('../lib/notion');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeOpportunityPage(overrides = {}) {
  return {
    id: 'opp-page-id-123',
    url: 'https://notion.so/opp-page-id-123',
    created_time: '2025-01-01T00:00:00.000Z',
    last_edited_time: '2025-04-01T00:00:00.000Z',
    properties: {
      Opportunity: { title: [{ plain_text: 'Valley Spine Center' }] },
      Stage: { select: { name: '5. Negotiation' } },
      'Next Step': { rich_text: [{ plain_text: 'Send final contract draft' }] },
      'Action Deadline': { date: { start: '2025-05-01' } },
      'Close Date': { date: { start: '2025-06-01' } },
      Owner: { people: [{ id: 'user-abc', name: 'Jordan Lee' }] },
      'Priority Level': { select: { name: 'High' } },
      Type: { select: { name: 'New' } },
      'Public/Private': { select: { name: 'Private' } },
      City: { rich_text: [{ plain_text: 'Austin' }] },
      State: { rich_text: [{ plain_text: 'TX' }] },
      Account: { relation: [{ id: 'account-id-456' }] },
      Contacts: { relation: [{ id: 'contact-id-789' }] },
      Notes: { relation: [] },
      'Number of Beds per Hospital': { number: 120 },
      'Patient Revenue': { number: 4200000 },
      'Percentage using AugMend': { number: 0.15 },
      ...overrides,
    },
  };
}

function makePaginatedResponse(results, hasMore = false) {
  return {
    results,
    has_more: hasMore,
    next_cursor: hasMore ? 'cursor-xyz' : null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('notion.getPipeline', () => {
  test('returns shaped opportunities from the API', async () => {
    const page = makeOpportunityPage();
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([page])
    );

    const results = await notion.getPipeline();
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Valley Spine Center');
    assert.equal(results[0].stage, '5. Negotiation');
    assert.equal(results[0].nextStep, 'Send final contract draft');
    assert.equal(results[0].actionDeadline, '2025-05-01');
    assert.equal(results[0].owner?.name, 'Jordan Lee');
    assert.equal(results[0].numberOfBeds, 120);
  });

  test('returns empty array when no results', async () => {
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([])
    );
    const results = await notion.getPipeline();
    assert.deepEqual(results, []);
  });
});

describe('notion.getOpportunityByName', () => {
  test('returns first match', async () => {
    const page = makeOpportunityPage();
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([page])
    );
    const result = await notion.getOpportunityByName('Valley Spine');
    assert.ok(result);
    assert.equal(result.name, 'Valley Spine Center');
  });

  test('returns null when no match', async () => {
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([])
    );
    const result = await notion.getOpportunityByName('Nonexistent');
    assert.equal(result, null);
  });
});

describe('notion.createOpportunity', () => {
  test('calls notion.pages.create with correct properties', async () => {
    const page = makeOpportunityPage();
    mockPages.create.mock.mockImplementation(async () => page);

    const result = await notion.createOpportunity({
      name: 'Valley Spine Center',
      stage: '5. Negotiation',
      nextStep: 'Send final contract draft',
      city: 'Austin',
      state: 'TX',
    });

    assert.ok(mockPages.create.mock.calls.length > 0);
    const callArgs = mockPages.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.parent.database_id, notion.DB.OPPORTUNITIES);
    assert.ok(callArgs.properties['Opportunity']);
    assert.equal(result.name, 'Valley Spine Center');
  });
});

describe('notion.updateOpportunity', () => {
  test('calls notion.pages.update and returns shaped result', async () => {
    const page = makeOpportunityPage();
    mockPages.update.mock.mockImplementation(async () => page);

    const result = await notion.updateOpportunity('opp-page-id-123', {
      stage: '6. Pilot',
      nextStep: 'Schedule kickoff call',
    });

    assert.ok(mockPages.update.mock.calls.length > 0);
    const callArgs = mockPages.update.mock.calls[0].arguments[0];
    assert.equal(callArgs.page_id, 'opp-page-id-123');
    assert.equal(callArgs.properties['Stage'].select.name, '6. Pilot');
  });
});

describe('notion.addNote', () => {
  test('creates note with correct subject and links', async () => {
    const notePage = {
      id: 'note-id-001',
      url: 'https://notion.so/note-id-001',
      created_time: '2025-04-01T00:00:00.000Z',
      properties: {
        Subject: { title: [{ plain_text: 'Call recap' }] },
        'Quick Description': { rich_text: [{ plain_text: 'Discussed pricing' }] },
        Opportunity: { relation: [{ id: 'opp-page-id-123' }] },
        Account: { relation: [] },
        Contact: { relation: [] },
      },
    };
    mockPages.create.mock.mockImplementation(async () => notePage);

    const result = await notion.addNote({
      subject: 'Call recap',
      quickDescription: 'Discussed pricing',
      opportunityId: 'opp-page-id-123',
    });

    assert.equal(result.subject, 'Call recap');
    assert.equal(result.quickDescription, 'Discussed pricing');
  });
});

describe('notion.getAtRiskDeals', () => {
  test('flags deals with no next step', async () => {
    const noNextStep = makeOpportunityPage({
      'Next Step': { rich_text: [] },
      'Action Deadline': { date: null },
    });
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([noNextStep])
    );
    const results = await notion.getAtRiskDeals();
    assert.equal(results.length, 1);
  });

  test('flags deals with overdue deadline', async () => {
    const overdue = makeOpportunityPage({
      'Next Step': { rich_text: [{ plain_text: 'Follow up' }] },
      'Action Deadline': { date: { start: '2020-01-01' } }, // past date
    });
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([overdue])
    );
    const results = await notion.getAtRiskDeals();
    assert.equal(results.length, 1);
  });

  test('does not flag healthy deals', async () => {
    const futureDeadline = new Date();
    futureDeadline.setDate(futureDeadline.getDate() + 14);
    const healthy = makeOpportunityPage({
      'Next Step': { rich_text: [{ plain_text: 'Send proposal' }] },
      'Action Deadline': { date: { start: futureDeadline.toISOString().split('T')[0] } },
    });
    mockDatabases.query.mock.mockImplementation(async () =>
      makePaginatedResponse([healthy])
    );
    const results = await notion.getAtRiskDeals();
    assert.equal(results.length, 0);
  });
});
