-- Delegance v4: private workspaces, socials in the dashboard, comment auto-replies,
-- LinkedIn outreach queue, open job board with contracts that unlock contact details.
ALTER TABLE crm_contacts ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crm_contacts ADD COLUMN linkedin TEXT;
ALTER TABLE automations ADD COLUMN sharing TEXT NOT NULL DEFAULT 'private';
ALTER TABLE webhooks ADD COLUMN sharing TEXT NOT NULL DEFAULT 'private';
ALTER TABLE email_templates ADD COLUMN shared INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
ALTER TABLE candidates ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
-- Anything made before workspaces existed stays visible and editable by the team.
UPDATE automations SET sharing = 'edit';
UPDATE webhooks SET sharing = 'edit';
UPDATE candidates SET verified = 1 WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS outreach (
  id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, owner_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'linkedin',
  message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, sent_at TEXT);
CREATE INDEX IF NOT EXISTS outreach_owner ON outreach(owner_id, status);

CREATE TABLE IF NOT EXISTS autoreplies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, account_ids TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]', replies TEXT NOT NULL DEFAULT '[]', created_by TEXT, runs INTEGER NOT NULL DEFAULT 0,
  last_run TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, conversation_id TEXT, title TEXT NOT NULL, rate TEXT, hours TEXT, start_date TEXT,
  terms TEXT NOT NULL, client_name TEXT NOT NULL, client_company TEXT, client_enc TEXT NOT NULL, va_name TEXT NOT NULL,
  client_token TEXT NOT NULL, va_token TEXT NOT NULL, client_signed TEXT, client_signed_at TEXT, va_signed TEXT, va_signed_at TEXT,
  status TEXT NOT NULL DEFAULT 'sent', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS contracts_conv ON contracts(conversation_id);

-- Your own profile
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN location TEXT;
ALTER TABLE users ADD COLUMN accent TEXT;

-- Team chat: #team, one group per client (client + their VAs + Delegance), direct and group messages
CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_members (channel_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (channel_id, user_id));
CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS chat_reads (channel_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read TEXT NOT NULL, PRIMARY KEY (channel_id, user_id));
CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_messages_ch ON chat_messages(channel_id, created_at);

-- Updates log + roadmap
CREATE TABLE IF NOT EXISTS product_updates (id TEXT PRIMARY KEY, version TEXT, title TEXT NOT NULL, body TEXT NOT NULL, released_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roadmap (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'planned', area TEXT, sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);

INSERT OR IGNORE INTO product_updates (id, version, title, body, released_at, created_at) VALUES
('up_01','1.0','Website launch','delegance.app goes live: home page, privacy policy, security headers and search setup.','2026-10-03','2026-10-03'),
('up_02','2.0','New logo and positioning','The real Delegance logo, virtual service provider positioning, icons and an installable website.','2026-10-03','2026-10-03'),
('up_03','Desk 1-2','Delegance Desk','The social desk: Facebook, Instagram, LinkedIn, YouTube and TikTok posting, scheduler, optimizer, comment inbox and the website chat bubble.','2026-10-04','2026-10-04'),
('up_04','Desk 2.3','Desk on every device','Install Desk on any phone or computer, share to Desk, client labels and post approvals.','2026-10-04','2026-10-04'),
('up_05','3.0','Job board and website redesign','VA gallery, VA profiles with chat, apply form and VA dashboard; new photo hero, services, guides and FAQ.','2026-10-08','2026-10-08'),
('up_06','Accounts 1.0','Sign-in and dashboards for six roles','Super admin, admin, staff, VA, client and member spaces; website requests go straight to the CRM.','2026-10-15','2026-10-15'),
('up_07','Accounts 1.1','Email, password reset and 2-step sign-in','Branded emails, forgot-password links, authenticator codes, bot checks and session control.','2026-10-15','2026-10-15'),
('up_08','CRM 2.0','The Delegance CRM','Deals pipeline, deal pages, activity timeline, email from the CRM with templates, reports, search, notifications, bulk actions, CSV import and the gold theme.','2026-10-15','2026-10-15'),
('up_09','Motion','Motion kit','Word flip, count-up numbers, shine, magnetic buttons, 6-box code entry, password meter and loading skeletons.','2026-10-16','2026-10-16'),
('up_10','3.1','Automations, integrations and Claude','GoHighLevel-style workflows with 6 recipes, API keys, webhooks, lead-capture links, the Claude connector (17 tools) and the public booking page.','2026-10-16','2026-10-16'),
('up_11','4.0','Workspaces, Social, chat and agreements','Private workspaces with sharing, Social in the dashboard with comment auto-replies, LinkedIn outreach queue, open job board with verified badges, agreements that unlock contact details, team chat, your own profile, updates log, roadmap and the installable dashboard app.','2026-10-16','2026-10-16');

INSERT OR IGNORE INTO roadmap (id, title, body, status, area, sort, updated_at) VALUES
('rm_01','Client workspaces','Each client gets their own private CRM inside Delegance (like GoHighLevel sub-accounts), with their own Claude connector.','planned','Platform',10,'2026-10-16'),
('rm_02','Client payments','Clients pay Delegance by card through Stripe invoices or subscriptions; Delegance pays VAs. Needs your go-ahead on pricing.','planned','Billing',20,'2026-10-16'),
('rm_03','Desk as its own white-label product','Separate Delegance Desk so other agencies can use it under their own brand.','planned','Desk',30,'2026-10-16'),
('rm_04','LinkedIn page comments','Read and reply to LinkedIn company page comments once LinkedIn approves the Community Management access.','planned','Social',40,'2026-10-16'),
('rm_05','TikTok public posting','Public TikTok posts once TikTok finishes its app audit (posts are private until then).','planned','Social',50,'2026-10-16'),
('rm_06','AI reply suggestions','Delegance drafts replies to comments, chats and emails for you to approve in one click.','planned','AI',60,'2026-10-16'),
('rm_07','Phone notifications','Push notifications from the installed app for new chats, leads and mentions.','planned','App',70,'2026-10-16'),
('rm_08','Separate Cloudflare account','Move Delegance to its own Cloudflare account, apart from REALM.','planned','Platform',80,'2026-10-16'),
('rm_10','Delegance Academy','Guides become courses with short modules, quizzes and saved progress: How to become a VA, How to start as a VA, Social Media Manager, How to upskill, Data analyst and Lead generation expert, plus realistic practice tasks for new VAs.','in_progress','Academy',1,'2026-10-16'),
('rm_11','Sign-in upgrade','Continue with Google, passkeys (fingerprint or face) and one-time email codes.','in_progress','Accounts',2,'2026-10-16'),
('rm_09','Team chat, profiles, updates and roadmap','Slack-style chat with client groups, your own profile, this updates log and this roadmap.','done','Platform',5,'2026-10-16');

-- Members choose a side: hire a VA, or work as a VA
ALTER TABLE users ADD COLUMN intent TEXT;
