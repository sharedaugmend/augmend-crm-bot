# AugMend Sales Bot

A Slack bot for the AugMend Health sales team. It answers pipeline questions via Claude AI, syncs the Notion CRM to Slack channels every 30 minutes, and auto-creates customer-specific Slack channels when deals reach active stages.

---

## What it does

- **Conversational CRM assistant** — DM the bot or @mention it in any channel to query and update the Notion pipeline. Powered by Claude (claude-sonnet-4-5) with full Notion read/write access via function calling.
- **Scheduled sync** — Every 30 minutes, reads all active opportunities from Notion and posts/updates a pinned status card in each deal's Slack channel.
- **Auto channel creation** — Creates `{company}-{stage}` Slack channels automatically when deals reach Proposal, Negotiation, Pilot, Integration, or Active/Won stage.
- **Prospect digest** — Maintains a pinned post in `#prospective-customers` with all Negotiation-stage deals.

---

## Prerequisites

- Node.js 18+
- A Slack workspace where you have admin access
- A Notion workspace with the 5 AugMend CRM databases
- An Anthropic API key
- A Railway account (for deployment)

---

## Local setup

```bash
# 1. Clone the repo
git clone https://github.com/augmend-health/augmend-sales-bot.git
cd augmend-sales-bot

# 2. Install dependencies
npm install

# 3. Copy env file and fill in values
cp .env.example .env
# Edit .env with your keys (see Environment Variables section below)

# 4. Run the bot
npm run dev
```

The bot uses **Socket Mode** — no public URL or ngrok required for local development.

---

## Environment variables

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (starts with `xoxb-`) |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode (starts with `xapp-`) |
| `SLACK_SIGNING_SECRET` | From Slack app Basic Information page |
| `NOTION_API_KEY` | Integration secret (starts with `secret_`) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `PROSPECTIVE_CUSTOMERS_CHANNEL_ID` | Slack channel ID for the prospect digest (e.g. `C0XXXXXXXXX`) |
| `NODE_ENV` | `development` or `production` |
| `SYNC_INTERVAL_MINUTES` | How often to sync (default: `30`) |
| `LOG_LEVEL` | Winston log level: `debug`, `info`, `warn`, `error` |

---

## Slack app creation

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "AugMend Sales Bot", select your workspace

### Enable Socket Mode
3. **Settings → Socket Mode** → Enable Socket Mode
4. Create an App-Level Token with scope `connections:write` → copy the `xapp-...` token

### Bot token scopes
5. **OAuth & Permissions → Bot Token Scopes** — add all of the following:

```
channels:manage
channels:read
channels:write
chat:write
chat:write.public
im:history
im:read
im:write
users:read
app_mentions:read
groups:write
mpim:write
pins:read
pins:write
conversations:history
```

### Event subscriptions
6. **Event Subscriptions** → Enable Events
7. Under **Subscribe to bot events**, add:
   - `message.im`
   - `app_mention`

### Install the app
8. **OAuth & Permissions** → **Install to Workspace** → Allow
9. Copy the **Bot User OAuth Token** (`xoxb-...`) to `.env`

---

## Notion integration setup

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**
2. Name it "AugMend Sales Bot", select your workspace, set Type to **Internal**
3. Under **Capabilities**, enable: Read content, Update content, Insert content
4. Copy the **Internal Integration Secret** (`secret_...`) to `.env`
5. **Share each of the 5 databases with the integration**:
   - Open each database in Notion
   - Click **...** (top right) → **Add connections** → select "AugMend Sales Bot"

The 5 databases that must be shared:
- Our Meetings
- Opportunities Pipeline
- Accounts
- Contacts
- Notes

---

## Railway deployment

1. Push this repo to GitHub

2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**

3. Select the `augmend-sales-bot` repo

4. Railway will detect the `railway.json` and use NIXPACKS to build automatically

5. **Add environment variables** in Railway:
   - Go to your service → **Variables** tab
   - Add each variable from `.env` (never commit the `.env` file)

6. Deploy. Railway will run `node app.js` on every push to the default branch.

7. **Ensure the service is always-on**: Under service settings, make sure it is not set to sleep. Railway's Hobby plan keeps services running 24/7.

---

## How to use the bot

### Direct messages

DM `@AugMend Sales Bot` directly:

```
What's in the pipeline?
Show me all deals in Negotiation stage
What are the at-risk deals?
Tell me everything about the Valley Spine deal
Update Valley Spine to Pilot stage, next step: schedule kickoff, due May 15
Log a meeting with Northwest Medical — demo call today, they want a proposal
Add Dr. Sarah Kim as a Champion contact at Valley Spine
Add a note to the Riverside Pain deal: they have budget locked for Q3
```

### @mentions

Use `@AugMend Sales Bot` in any channel:

```
@AugMend Sales Bot show me deals with no next step
@AugMend Sales Bot what's the status on Northwest Medical?
@AugMend Sales Bot who owns the highest priority deals?
```

The bot replies in-thread.

---

## How the sync works

Every 30 minutes (configurable via `SYNC_INTERVAL_MINUTES`):

1. Queries all Notion opportunities in stages: Proposal, Negotiation, Pilot, Integration, Active/Won
2. For each opportunity:
   - Derives a channel name: `{company-slug}-{stage-slug}` (e.g. `valley-spine-center-negotiation`)
   - Creates the channel if it doesn't exist
   - Fetches the opportunity's contacts, account, and most recent meeting
   - Posts (or replaces the pinned post) in that channel with the formatted status card
3. Updates the pinned post in `#prospective-customers` with all Negotiation-stage deals

An initial sync also runs on bot startup.

**Stage-to-channel mapping:**

| Notion Stage | Channel Suffix |
|---|---|
| 4. Proposal | `-proposal` |
| 5. Negotiation | `-negotiation` |
| 6. Pilot | `-pilot` |
| 7. Integration | `-integration` |
| 8. Active/Won | `-active` |

---

## Troubleshooting

**Bot doesn't respond to DMs**
- Confirm `message.im` is in your bot's event subscriptions
- Confirm the bot has been invited to the DM (just open a DM with it)
- Check logs for authentication errors

**Bot doesn't respond to @mentions**
- Confirm `app_mention` is in event subscriptions
- Confirm the bot is in the channel where you mentioned it

**Sync creates channels but posts are empty / "No contacts linked"**
- This means the Notion records exist but have no linked Contacts. Add contacts to the Opportunity in Notion and the next sync will pick them up.

**`NOTION_API_KEY` errors / "Could not find database"**
- Make sure all 5 databases are shared with the Notion integration (see setup step 5 above)

**Rate limit errors from Notion**
- The bot retries automatically with exponential backoff (up to 3 attempts). If it persists, reduce `SYNC_INTERVAL_MINUTES`.

**Railway service keeps restarting**
- Check Railway logs for the crash reason. Common causes: missing env vars, Slack token revoked, or Notion integration not connected.
- `railway.json` is set to restart on failure up to 10 times.

**"Missing required environment variable" on startup**
- The bot exits immediately if any of these are missing: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `NOTION_API_KEY`, `ANTHROPIC_API_KEY`. Check your Railway variables tab.

---

## Notion data hygiene requirements

The bot's output is only as good as what's in Notion. For each active opportunity, keep these fields current:

| Field | Why it matters |
|---|---|
| **Stage** | Determines which Slack channel the deal goes in |
| **Next Step** | Shown in the pinned post; flagged as "at-risk" if blank |
| **Action Deadline** | Shown in pinned post; flagged as overdue if in the past |
| **Owner** | Shown in the pinned post |
| **Contacts (relation)** | Drives the Key Contacts section of the channel post |
| **Account (relation)** | Provides company name for channel naming |
| **City / State** | Shown in the customer profile section |
| **Meetings (via Opportunity relation)** | The bot looks for meetings linked to the opportunity; log meetings in Notion with the Opportunity field set |

The following will cause the channel post to show fallback text:
- No linked Contacts → "No contacts linked in Notion — add them"
- No linked Meetings → "No meetings linked to this opportunity"
- No Next Step → shown as "No next step recorded"
- No Action Deadline → shown as "No deadline set"

---

## Running tests

```bash
npm test
```

Tests use Node.js's built-in `node:test` runner — no additional test framework needed.
