'use strict';

const { test, describe, mock, before } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockPipeline = [];
const mockNotion = {
  getPipeline: mock.fn(async () => mockPipeline),
  getOpportunityDetail: mock.fn(async (id) => ({
    id,
    name: 'Valley Spine Center',
    stage: '5. Negotiation',
    notionUrl: `https://notion.so/${id}`,
    nextStep: 'Send contract',
    actionDeadline: '2025-06-01',
    owner: { id: 'user-abc', name: 'Jordan Lee' },
    publicPrivate: 'Private',
    city: 'Austin',
    state: 'TX',
    numberOfBeds: null,
    contacts: [],
    account: { name: 'Valley Spine Center' },
    meetings: [],
  })),
  STAGE_SLUGS: {
    '4. Proposal': 'proposal',
    '5. Negotiation': 'negotiation',
    '6. Pilot': 'pilot',
    '7. Integration': 'integration',
    '8. Active/Won': 'active',
  },
  ACTIVE_STAGES: ['4. Proposal', '5. Negotiation', '6. Pilot', '7. Integration', '8. Active/Won'],
};

const mockSlack = {
  ensureChannel: mock.fn(async (name) => ({ id: `C_${name}`, name })),
  upsertPinnedPost: mock.fn(async () => 'ts-123'),
};

mock.module('../lib/notion', { defaultExport: mockNotion, namedExports: mockNotion });
mock.module('../lib/slack', { defaultExport: mockSlack, namedExports: mockSlack });
mock.module('../lib/logger', {
  defaultExport: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('formatter.channelName', () => {
  const { channelName } = require('../lib/formatter');

  test('generates clean hyphenated channel names', () => {
    assert.equal(channelName('Valley Spine Center', 'negotiation'), 'valley-spine-center-negotiation');
  });

  test('strips special characters', () => {
    assert.equal(channelName('Acme & Associates, LLC', 'pilot'), 'acme--associates-llc-pilot');
  });

  test('lowercases the company name', () => {
    assert.equal(channelName('NorthWest Medical', 'proposal'), 'northwest-medical-proposal');
  });

  test('truncates very long names', () => {
    const longName = 'A'.repeat(100);
    const result = channelName(longName, 'active');
    assert.ok(result.length <= 80);
  });
});

describe('formatter.formatChannelPost', () => {
  const { formatChannelPost } = require('../lib/formatter');

  const baseOpp = {
    name: 'Valley Spine Center',
    stage: '5. Negotiation',
    notionUrl: 'https://notion.so/abc123',
    nextStep: 'Send final contract',
    actionDeadline: '2025-06-15',
    owner: { id: 'u1', name: 'Jordan Lee' },
    city: 'Austin',
    state: 'TX',
    publicPrivate: 'Private',
    numberOfBeds: null,
    account: { name: 'Valley Spine Center' },
  };

  test('includes company name', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('Valley Spine Center'));
  });

  test('includes stage', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('5. Negotiation'));
  });

  test('includes owner name', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('Jordan Lee'));
  });

  test('includes next step', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('Send final contract'));
  });

  test('shows fallback when no contacts', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('No contacts linked'));
  });

  test('shows fallback when no meetings', () => {
    const post = formatChannelPost(baseOpp, [], null);
    assert.ok(post.includes('No meetings linked'));
  });

  test('includes contact info when provided', () => {
    const contacts = [
      {
        name: 'Dr. Sarah Kim',
        email: 'sarah@valleyspine.com',
        specialty: 'Pain Management',
        type: ['Champion', 'Decision Maker'],
      },
    ];
    const post = formatChannelPost(baseOpp, contacts, null);
    assert.ok(post.includes('Dr. Sarah Kim'));
    assert.ok(post.includes('Champion'));
  });

  test('truncates long meeting summary to 300 chars', () => {
    const meeting = {
      createdTime: '2025-04-01T10:00:00Z',
      meetingType: ['Clients & External'],
      summary: 'A'.repeat(400),
    };
    const post = formatChannelPost(baseOpp, [], meeting);
    // The summary shown should not exceed 300 chars plus ellipsis
    assert.ok(post.includes('…'));
  });
});

describe('formatter.formatProspectDigest', () => {
  const { formatProspectDigest } = require('../lib/formatter');

  test('shows negotiation deals', () => {
    const opps = [
      {
        name: 'Valley Spine',
        stage: '5. Negotiation',
        notionUrl: 'https://notion.so/a',
        owner: { name: 'Jordan' },
        actionDeadline: '2025-06-01',
        nextStep: 'Send contract',
      },
    ];
    const digest = formatProspectDigest(opps);
    assert.ok(digest.includes('Valley Spine'));
    assert.ok(digest.includes('5. Negotiation'));
  });

  test('shows empty message when no negotiation deals', () => {
    const opps = [
      {
        name: 'Acme Health',
        stage: '6. Pilot',
        notionUrl: 'https://notion.so/b',
        owner: { name: 'Alex' },
        actionDeadline: null,
        nextStep: null,
      },
    ];
    const digest = formatProspectDigest(opps);
    assert.ok(digest.includes('No deals currently'));
  });
});

describe('sync.syncPipelineToSlack', () => {
  test('does not throw when pipeline is empty', async () => {
    mockNotion.getPipeline.mock.mockImplementation(async () => []);
    const { syncPipelineToSlack } = require('../lib/sync');
    await assert.doesNotReject(() => syncPipelineToSlack());
  });

  test('calls ensureChannel for each active opportunity', async () => {
    mockSlack.ensureChannel.mock.resetCalls();
    mockNotion.getPipeline.mock.mockImplementation(async () => [
      {
        id: 'opp-1',
        name: 'Valley Spine',
        stage: '5. Negotiation',
        notionUrl: 'https://notion.so/opp-1',
        accountIds: [],
        contactIds: [],
        noteIds: [],
        owner: { name: 'Jordan' },
        nextStep: 'Send contract',
        actionDeadline: '2025-06-01',
        account: { name: 'Valley Spine' },
      },
    ]);

    const { syncPipelineToSlack } = require('../lib/sync');
    await syncPipelineToSlack();

    assert.ok(mockSlack.ensureChannel.mock.calls.length >= 1);
    const channelArg = mockSlack.ensureChannel.mock.calls[0].arguments[0];
    assert.ok(channelArg.includes('negotiation'));
  });
});
