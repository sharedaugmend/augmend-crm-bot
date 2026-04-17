# AugMend Sales Bot — Setup Checklist

Complete these steps in order. Each section has a checkbox. Do not skip steps — the dependencies are real.

---

## Phase 0 — Notion (do this first, takes ~10 minutes)

### 0.1 Share databases with the integration
Your Notion integration token (`ntn_295797734227...`) is valid but currently has no access to any databases. Notion requires explicit sharing per database.

For each database below, open it in Notion → click **•••** (top right) → **Connections** → **Add a connection** → select **AugMend Sales Bot**:

- [ ] **Our Meetings** — [open in Notion](https://www.notion.so/4557b0ce9d5549ecbd82c068d2d5836c)
- [ ] **Opportunities Pipeline** — [open in Notion](https://www.notion.so/1ec6e31785ee81bc8fd4c39fdfa0e780)
- [ ] **Sales CRM** (parent page) — [open in Notion](https://www.notion.so/1ec6e31785ee8118b0c6f268fceed764)
- [ ] **Accounts** — open via Sales CRM → Database Repository → Accounts
- [ ] **Contacts** — open via Sales CRM → Database Repository → Contacts
- [ ] **Notes** — open via Sales CRM → Database Repository → Notes

> **Why this matters**: Without sharing, every Notion API call returns "Could not find database" — the token exists but is blind.

### 0.2 Add Opportunity relation to Our Meetings (manual, 30 seconds)
The meetings database currently has no link to deals. This must be added manually in Notion:

- [ ] Open **Our Meetings** in Notion
- [ ] Click **+** to add a new property
- [ ] Choose **Relation**
- [ ] Select **Opportunities Pipeline** as the related database
- [ ] Name the property **Opportunity**
- [ ] Set limit to **1 (single relation)**
- [ ] Save

---

## Phase 1 — GitHub (5 minutes)

- [ ] Create a new **private** repo in the `augmend-h` GitHub org named `augmend-crm-bot`
- [ ] Leave it empty (no README, no .gitignore — the code has these already)
- [ ] Copy the repo URL: `https://github.com/augmend-h/augmend-crm-bot.git`
- [ ] Push the code from your local machine:

```bash
# Navigate to the augmend-sales-bot folder on your machine
cd path/to/augmend-sales-bot

git init
git add .
git commit -m "Initial commit: AugMend Sales Bot scaffolding"
git branch -M main
git remote add origin https://github.com/augmend-h/augmend-crm-bot.git
git push -u origin main
```

---

## Phase 2 — Slack App (15-20 minutes)

### 2.1 Create the app
- [ ] Go to [api.slack.com/apps](https://api.slack.com/apps)
- [ ] Click **Create New App** → **From scratch**
- [ ] Name: `AugMend Sales Bot`
- [ ] Select your AugMend Slack workspace
- [ ] Click **Create App**

### 2.2 Enable Socket Mode
- [ ] Go to **Settings → Socket Mode**
- [ ] Toggle **Enable Socket Mode** ON
- [ ] Create an App-Level Token: name it `socket-token`, scope: `connections:write`
- [ ] Copy the token (starts with `xapp-`) → save as `SLACK_APP_TOKEN` in your `.env`

### 2.3 Add bot token scopes
- [ ] Go to **OAuth & Permissions → Bot Token Scopes**
- [ ] Add all of these:
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
  ```

### 2.4 Enable event subscriptions
- [ ] Go to **Event Subscriptions** → toggle ON
- [ ] Under **Subscribe to bot events**, add:
  - `message.im`
  - `app_mention`

### 2.5 Install the app
- [ ] Go to **OAuth & Permissions** → **Install to Workspace**
- [ ] Copy the **Bot User OAuth Token** (starts with `xoxb-`) → save as `SLACK_BOT_TOKEN`
- [ ] Copy **Signing Secret** from Basic Information → save as `SLACK_SIGNING_SECRET`

### 2.6 Get the prospective customers channel ID
- [ ] Create (or find) your `#prospective-customers` channel in Slack
- [ ] Right-click the channel → **View channel details** → copy the Channel ID (starts with `C`)
- [ ] Save as `PROSPECTIVE_CUSTOMERS_CHANNEL_ID`

---

## Phase 3 — Local setup and test (10 minutes)

- [ ] Create your `.env` file:
  ```bash
  cp .env.example .env
  ```

- [ ] Fill in all values:
  ```
  SLACK_BOT_TOKEN=xoxb-...
  SLACK_APP_TOKEN=xapp-...
  SLACK_SIGNING_SECRET=...
  NOTION_API_KEY=ntn_...YOUR_TOKEN_HERE
  ANTHROPIC_API_KEY=sk-ant-...    ← your existing Anthropic API key
  PROSPECTIVE_CUSTOMERS_CHANNEL_ID=C...
  NODE_ENV=development
  SYNC_INTERVAL_MINUTES=30
  LOG_LEVEL=debug
  ```

- [ ] Install dependencies:
  ```bash
  npm install
  ```

- [ ] Start the bot locally:
  ```bash
  npm run dev
  ```

- [ ] In Slack, DM the bot: `hello` — you should get a response within a few seconds
- [ ] Test a pipeline query: `show me the current pipeline`
- [ ] Trigger a manual sync: `npm run sync:now` (in a second terminal)

---

## Phase 4 — Railway deployment (15 minutes)

- [ ] Go to [railway.app](https://railway.app) and sign in
- [ ] Click **New Project** → **Deploy from GitHub repo**
- [ ] Connect your GitHub account if not already connected
- [ ] Select `augmend-h/augmend-crm-bot`
- [ ] Railway will auto-detect Node.js and the `railway.json` config
- [ ] Go to **Variables** and add all the same env vars from your `.env` file (do NOT commit `.env` to GitHub)
- [ ] Deploy — Railway will build and start the bot
- [ ] Check logs to confirm the bot started and connected to Slack

---

## Phase 5 — Invite team members (5 minutes)

- [ ] In Slack, add the bot to any channels it needs to post in (customer channels, #prospective-customers)
- [ ] DM the bot to test as yourself
- [ ] Have Mark send a test DM to confirm his access works
- [ ] Share the usage guide below with the team

---

## Usage guide for team

**DM the bot or @mention it in any channel.**

Examples:
- `show me the pipeline` — full pipeline status with risk flags
- `how is Cambridge Health Alliance doing?` — deal health check + MEDDPICC analysis
- `log a meeting with Carl at Cambridge, outcome: compliance review starting, next step: follow-up call in 2 weeks` — creates meeting record, updates opportunity, surfaces advisory insight
- `add new opportunity: Detroit Wayne Integrated Health Network, Demo stage, contact is Dayna Clark, Director of Communications` — creates all records

The bot reads and writes Notion directly. Whatever you tell it goes into the CRM.

---

## Notion data hygiene (required for the bot to be useful)

The bot is only as good as the data. Establish these habits from day one:
1. **Log every customer meeting** — tell the bot after every call, not days later
2. **Every next step needs a deadline** — the bot will ask if you don't provide one
3. **Link a Champion and Decision Maker contact to every active deal** — the MEDDPICC check is the main advisory value
4. **Never leave Next Step blank** on an active opportunity — it signals a dead deal

---

## Security notes

- **Never commit `.env` to GitHub** — it's already in `.gitignore` but double-check
- **Never share the Notion token in Slack or email** — treat it like a password
- If the token is ever compromised: go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → revoke it → create a new one → update Railway env var
- The Anthropic API key has usage limits and costs money per request — monitor usage at [console.anthropic.com](https://console.anthropic.com)
