# 📝 Weekly Reflection Log System - Complete Documentation

A WhatsApp-based voice journal system for Ray Dalio-style weekly reflections with **FREE** transcription using Grok AI.

---

## 🎯 What This Does

Send voice notes via WhatsApp → Automatically transcribed → Structured into categories → Saved to database

**Features:**
- 🎤 Voice note logging via WhatsApp
- 🤖 **FREE** transcription using Grok (xAI API)
- 📊 Ray Dalio-style structured categories (wins, learnings, errors, etc.)
- 💾 Audio storage in Supabase
- 🔄 Multi-voice-note support per session
- 🛡️ Failsafe table prevents data loss
- 🔁 Automatic fallback to OpenAI if Grok fails

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| [QUICK_SETUP.md](QUICK_SETUP.md) | ⚡ **START HERE** - 5-step setup guide |
| [SETUP_SUPABASE.sql](SETUP_SUPABASE.sql) | 📊 Copy-paste this into Supabase SQL Editor |
| [GROK_SETUP_GUIDE.md](GROK_SETUP_GUIDE.md) | 🤖 How to get FREE Grok API key |
| [WEEKLY_LOG_TEST_PLAN.md](WEEKLY_LOG_TEST_PLAN.md) | 🧪 Complete testing scenarios |
| [functions/webhook.js](functions/webhook.js) | 💻 Updated webhook code |

---

## 🚀 Quick Start

### 1. Setup Database (2 min)
```sql
-- Copy ENTIRE contents of SETUP_SUPABASE.sql
-- Paste into Supabase SQL Editor
-- Click RUN
```

### 2. Get FREE API Key (1 min)
```
https://console.x.ai/ → API Keys → Create New
```

### 3. Add to Cloudflare (1 min)
```bash
Settings → Environment Variables → Add:
XAI_API_KEY=xai-your-key-here
```

### 4. Deploy & Test (1 min)
```
WhatsApp: "log"
[Send voice note]
✅ "Logged Week 2 (2026-01-10)..."
```

**Done!**

---

## 💬 How to Use

### Start Logging
```
YOU: log
BOT: Got it. Please reply with a voice note for your weekly reflection (2–6 min)...
```

### Send Reflections
```
YOU: [Voice note: "This week I learned that..."]
BOT: Received your voice note. Processing...
BOT: Logged ✅ Week 2 (2026-01-10). Want to add anything else?
```

### Add More (Optional)
```
YOU: [Another voice note]
BOT: Logged ✅ Week 2 (2026-01-10). Want to add anything else?
```

### Finish
```
YOU: done
BOT: All set! Your weekly reflections have been logged. 📝
```

---

## 📊 Structured Output

Each log is categorized into:

```json
{
  "wins": "Closed 3 major deals",
  "challenges": "Team communication issues",
  "key_learnings": "Need to set clearer expectations upfront",
  "errors_gaps": "Missed deadline due to poor planning",
  "improvements": "Implement weekly planning sessions",
  "systems_process": "New CRM workflow needs refinement",
  "emotional_state": "Stressed but optimistic",
  "strategic_insight": "Focus on high-value clients",
  "actions_next_week": "Schedule team meeting, review CRM",
  "notes": "Additional context..."
}
```

---

## 🗃️ Database Schema

### Tables Created

#### `log_sessions`
Tracks active logging sessions
```sql
wa_from          | text      | Phone number
status           | text      | idle / awaiting_audio
current_week     | integer   | Week number
last_prompted_at | timestamp | Last activity
```

#### `weekly_reflection_logs`
Main storage for reflections
```sql
wa_from           | text      | Phone number
log_date          | date      | Date of log (Asia/HCM timezone)
week_number       | integer   | ISO week number
transcript_text   | text      | Full transcription
audio_storage_path| text      | Path in Supabase Storage
audio_url         | text      | Public URL to audio
structured_json   | jsonb     | Categorized reflection
```

#### `failed_log_inserts`
Failsafe for data recovery
```sql
wa_from         | text      | Phone number
transcript_text | text      | Full transcription
audio_url       | text      | Audio file URL
error_message   | text      | What went wrong
```

---

## 💰 Pricing

| Service | Free Tier | Cost per Log |
|---------|-----------|--------------|
| Grok Transcription | ✅ 10K tokens/min | $0.00 |
| Grok Structuring | ✅ 100 req/min | $0.00 |
| Supabase Storage | ✅ 1GB | $0.00 |
| Supabase Database | ✅ 500MB | $0.00 |
| Cloudflare Pages | ✅ Unlimited | $0.00 |
| **Total** | | **$0.00** |

OpenAI fallback (optional): $0.03 per 5-min log

---

## 🔧 Environment Variables

### Required
```bash
# Supabase (you already have these)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# WhatsApp (you already have these)
WHATSAPP_TOKEN=EAAxxxx...
PHONE_NUMBER_ID=123456789

# NEW: Grok API for FREE transcription
XAI_API_KEY=xai-xxx...
```

### Optional
```bash
# Fallback if Grok fails (costs money)
OPENAI_API_KEY=sk-xxx...
```

---

## 🧪 Testing

### Basic Test Flow
```bash
1. Send "log" → Expect prompt
2. Send voice note → Expect "Processing..."
3. Wait 10-20 sec → Expect "Logged ✅"
4. Send "done" → Expect confirmation
```

### Verify Data
```sql
-- Check latest log
SELECT * FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY created_at DESC LIMIT 1;

-- Check structured categories
SELECT
  log_date,
  structured_json->>'wins' as wins,
  structured_json->>'key_learnings' as learnings
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER';
```

---

## 🛡️ Error Handling

### Audio Download Fails
- ✅ User notified
- ✅ Session stays active
- ✅ Can retry

### Transcription Fails (Grok)
- ✅ Automatically tries OpenAI
- ✅ If both fail, audio still saved
- ✅ User receives audio URL

### Database Insert Fails
- ✅ Data saved to `failed_log_inserts`
- ✅ User receives transcript snippet
- ✅ Manual recovery possible

---

## 🎨 Customization

### Change Timezone
Edit `getLogDate()` in webhook.js:
```javascript
// Currently: Asia/Ho_Chi_Minh (UTC+7)
const hcmTime = new Date(utc + (3600000 * 7));

// For EST (UTC-5):
const estTime = new Date(utc - (3600000 * 5));
```

### Change Language
Edit `transcribeAudio()` in webhook.js:
```javascript
formData.append("language", "es"); // Spanish
formData.append("language", "fr"); // French
formData.append("language", "vi"); // Vietnamese
```

### Add Custom Categories
Edit `structureTranscript()` system prompt:
```javascript
const systemPrompt = `...
- custom_category: your description
...`;
```

---

## 📈 Analytics Queries

### Weekly Log Count
```sql
SELECT week_number, COUNT(*) as log_count
FROM weekly_reflection_logs
WHERE EXTRACT(YEAR FROM log_date) = 2026
GROUP BY week_number
ORDER BY week_number;
```

### Search Logs
```sql
-- Full-text search
SELECT log_date, LEFT(transcript_text, 200)
FROM weekly_reflection_logs
WHERE transcript_text ILIKE '%project%'
ORDER BY log_date DESC;

-- Search structured fields
SELECT log_date, structured_json->>'wins'
FROM weekly_reflection_logs
WHERE structured_json->>'wins' ILIKE '%deal%';
```

### Most Active Users
```sql
SELECT wa_from, COUNT(*) as total_logs
FROM weekly_reflection_logs
GROUP BY wa_from
ORDER BY total_logs DESC;
```

---

## 🔒 Security

- ✅ Uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- ✅ Idempotency prevents duplicate processing
- ✅ Audio stored in private bucket (optional)
- ✅ No API keys exposed to client
- ✅ Webhook verification with Meta

---

## 🚨 Troubleshooting

### Issue: "Send 'log' first"
**Cause:** Sent audio without active session
**Fix:** Send `log` command first

### Issue: "Missing XAI_API_KEY"
**Cause:** Environment variable not set
**Fix:** Add `XAI_API_KEY` to Cloudflare, redeploy

### Issue: Grok transcription poor quality
**Cause:** Audio quality or Grok limitation
**Fix:** Add `OPENAI_API_KEY` as fallback

### Issue: Storage upload fails
**Cause:** Bucket doesn't exist or wrong permissions
**Fix:** Run `SETUP_SUPABASE.sql` again

---

## 🎓 Learn More

- Grok API: https://docs.x.ai/
- Supabase: https://supabase.com/docs
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp

---

## ✅ Checklist

Before going live:

- [ ] Run `SETUP_SUPABASE.sql` in Supabase
- [ ] Verify `weekly-logs` bucket exists
- [ ] Get Grok API key from console.x.ai
- [ ] Add `XAI_API_KEY` to environment variables
- [ ] Deploy updated webhook
- [ ] Test full flow: log → voice note → done
- [ ] Check logs in Supabase Table Editor
- [ ] Verify audio files in Storage

---

## 📞 Support

**Issues?** Check:
1. Cloudflare Logs (for webhook errors)
2. Supabase Logs (for database errors)
3. `failed_log_inserts` table (for recovery)

---

## 🎉 Credits

- Built on top of [wa-demo](https://github.com/ndrsndbk/wa-demo)
- Transcription: Grok (xAI) + OpenAI Whisper
- Storage: Supabase
- Hosting: Cloudflare Pages

---

**Enjoy your FREE weekly reflection system!** 🚀📝
