# ⚡ QUICK SETUP GUIDE - Weekly Reflection Log System

## 🎯 Complete Setup in 5 Steps

### Step 1: Setup Supabase Database (2 minutes)

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click **SQL Editor** in left sidebar
3. Copy ALL contents from `SETUP_SUPABASE.sql`
4. Paste into SQL Editor
5. Click **RUN** (or press Ctrl+Enter)

**Expected result:** ✅ Tables and storage bucket created

---

### Step 2: Get Grok API Key (FREE) (1 minute)

1. Go to https://console.x.ai/
2. Sign up/login
3. Go to **API Keys**
4. Click **Create New API Key**
5. Copy the key (starts with `xai-...`)

---

### Step 3: Add Environment Variables (1 minute)

#### Cloudflare Pages:
1. Go to Cloudflare Dashboard → Your Project
2. **Settings** → **Environment Variables**
3. Add these variables:

```bash
# Required for weekly log system
XAI_API_KEY=xai-your-key-here

# Your existing variables (already set)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key
WHATSAPP_TOKEN=your-whatsapp-token
PHONE_NUMBER_ID=your-phone-id

# Optional: Fallback transcription (costs money)
OPENAI_API_KEY=sk-your-openai-key-here
```

4. **Save** and **Redeploy**

---

### Step 4: Deploy Updated Webhook (30 seconds)

Your webhook file is already updated! Just deploy:

#### Option A: Git Push (if using git)
```bash
cd wa-demo
git add .
git commit -m "Add weekly reflection log system with Grok"
git push
```

#### Option B: Manual Upload
Upload the updated `functions/webhook.js` to your Cloudflare Pages project

---

### Step 5: Test It! (1 minute)

1. Open WhatsApp
2. Send: `log`
3. Reply with a **voice note** (30 seconds - 2 minutes)
4. Wait for processing (~10-20 seconds)
5. Receive confirmation: "Logged ✅ Week X (2026-01-10)..."

**Done!** 🎉

---

## 📋 Verify Setup

### Check Supabase Tables:
```sql
-- Run in Supabase SQL Editor
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('log_sessions', 'weekly_reflection_logs', 'failed_log_inserts');

-- Should return 3 rows
```

### Check Storage Bucket:
1. Go to **Storage** in Supabase Dashboard
2. You should see bucket: `weekly-logs`

### Check Environment Variables:
- In Cloudflare: Settings → Environment Variables
- Should see `XAI_API_KEY` listed

---

## 🎮 Usage Commands

| Command | Action |
|---------|--------|
| `log` | Start weekly reflection session |
| `[send voice note]` | Transcribe and log reflection |
| `done` | End session and finalize |

---

## 🔍 Troubleshooting

### "Missing XAI_API_KEY"
- Add `XAI_API_KEY` to environment variables
- Redeploy webhook

### "Failed to store audio"
- Check `weekly-logs` bucket exists in Supabase Storage
- Check `SUPABASE_SERVICE_ROLE_KEY` is correct

### "Send 'log' first to start a weekly log"
- You sent audio without starting a session
- Send `log` first, then voice note

### Grok not transcribing well?
- Add `OPENAI_API_KEY` as fallback (costs $0.006/min)
- Webhook will automatically use OpenAI if Grok fails

---

## 📊 View Your Logs

### In Supabase Table Editor:
1. Go to **Table Editor**
2. Select `weekly_reflection_logs`
3. See all your reflections with structured JSON

### Example Query:
```sql
-- Get your latest reflection
SELECT
  log_date,
  week_number,
  transcript_text,
  structured_json->>'wins' as wins,
  structured_json->>'key_learnings' as learnings,
  audio_url
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY created_at DESC
LIMIT 1;
```

---

## 💰 Cost Summary

| Component | Cost |
|-----------|------|
| Supabase Free Tier | $0 (1GB storage, 500MB DB) |
| Grok Transcription | $0 (FREE) |
| Grok Structuring | $0 (FREE) |
| Cloudflare Pages | $0 (Free tier) |
| WhatsApp API | $0 (free incoming messages) |
| **Total Monthly** | **$0.00** |

OpenAI fallback (optional): ~$0.03 per 5-min log

---

## 🎓 Files Created

- ✅ `SETUP_SUPABASE.sql` - Database setup script
- ✅ `GROK_SETUP_GUIDE.md` - Detailed Grok setup
- ✅ `WEEKLY_LOG_TEST_PLAN.md` - Complete test scenarios
- ✅ `functions/webhook.js` - Updated with log system
- ✅ `supabase_schema_weekly_logs.sql` - Original schema
- ✅ `QUICK_SETUP.md` - This file!

---

## 🚀 You're Ready!

1. ✅ Database tables created
2. ✅ Storage bucket created
3. ✅ Grok API key set
4. ✅ Webhook deployed
5. ✅ Existing flows (stamp card, meeting, edusafe) still work

**Start logging:** Send `log` via WhatsApp! 📝
