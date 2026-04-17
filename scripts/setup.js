'use strict';
require('dotenv').config();
const { WebClient } = require('@slack/web-api');

if (!process.env.SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN not found in .env');
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

async function run() {
  console.log('\n AugMend CRM Bot — First-Run Setup\n');
  const channelName = 'prospective-customers';
  let channel;
  const { channels } = await client.conversations.list({
    exclude_archived: true,
    types: 'public_channel',
    limit: 200,
  });
  channel = channels.find(c => c.name === channelName);
  if (channel) {
    console.log(`Found #${channelName} (ID: ${channel.id})`);
  } else {
    const res = await client.conversations.create({ name: channelName, is_private: false });
    channel   = res.channel;
    console.log(`Created #${channelName} (ID: ${channel.id})`);
  }
  console.log('\n----------------------------------------------');
  console.log('Add this line to your .env file:\n');
  console.log(`PROSPECTIVE_CUSTOMERS_CHANNEL_ID=${channel.id}`);
  console.log('\nOr paste this into your terminal:\n');
  console.log(`echo 'PROSPECTIVE_CUSTOMERS_CHANNEL_ID=${channel.id}' >> /Users/sachamoreau/Documents/augmend-crm-bot/.env`);
  console.log('----------------------------------------------\n');
  const missing = [];
  const needed  = ['ANTHROPIC_API_KEY', 'NOTION_API_KEY', 'SLACK_SIGNING_SECRET'];
  for (const key of needed) {
    if (!process.env[key] || process.env[key].includes('YOUR')) missing.push(key);
  }
  if (missing.length) {
    console.log(`Still missing in .env: ${missing.join(', ')}`);
    console.log('Fill those in before running: npm start\n');
  } else {
    console.log('All required env vars look populated.');
    console.log('Run the bot with: npm start\n');
  }
}

run().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
