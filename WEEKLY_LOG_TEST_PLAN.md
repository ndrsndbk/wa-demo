# Weekly Reflection Log System - Test Plan

## Prerequisites

### 1. Environment Variables
Ensure the following environment variables are set in your Cloudflare Pages or local environment:

```bash
# Existing variables
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
WHATSAPP_TOKEN=your-whatsapp-token
PHONE_NUMBER_ID=your-phone-number-id

# New variable for log system
OPENAI_API_KEY=sk-your-openai-api-key
```

### 2. Database Setup
Run the SQL schema file in your Supabase SQL Editor:

```bash
# File: supabase_schema_weekly_logs.sql
```

This creates:
- `log_sessions` table
- `weekly_reflection_logs` table
- `failed_log_inserts` table (failsafe)
- All necessary indexes

### 3. Storage Bucket Setup
Create the storage bucket in Supabase Dashboard:

1. Go to **Storage** section
2. Click **New Bucket**
3. Name: `weekly-logs`
4. Make it **Public** (for easy access to audio URLs)
5. Click **Create Bucket**

Alternatively, run this SQL (with admin privileges):
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('weekly-logs', 'weekly-logs', true)
ON CONFLICT (id) DO NOTHING;
```

---

## Test Plan

### Test 1: Start Log Session
**Objective:** Verify that sending "log" creates a session and prompts for voice note

**Steps:**
1. Send WhatsApp message: `log` (lowercase)
2. Observe response

**Expected Result:**
```
Got it. Please reply with a voice note for your weekly reflection (2–6 min). When you send it, I'll transcribe and save it.
```

**Verification:**
```sql
SELECT * FROM log_sessions WHERE wa_from = 'YOUR_PHONE_NUMBER';
-- Should show: status = 'awaiting_audio'
```

---

### Test 2: Send Voice Note (Happy Path)
**Objective:** Verify full flow: download → store → transcribe → structure → save

**Steps:**
1. After Test 1, record a voice note (30 seconds - 2 minutes)
2. Send the voice note via WhatsApp
3. Wait for processing (may take 10-30 seconds depending on audio length)

**Expected Result:**
```
Received your voice note. Processing...

[After processing]

Logged ✅ Week [WEEK_NUMBER] ([DATE]). Want to add anything else? Send another voice note or reply 'done'.
```

**Verification:**
```sql
-- Check audio stored
SELECT audio_storage_path, audio_url
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY created_at DESC LIMIT 1;

-- Check transcript saved
SELECT transcript_text
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY created_at DESC LIMIT 1;

-- Check structured JSON
SELECT structured_json
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY created_at DESC LIMIT 1;
```

**Expected Fields in structured_json:**
```json
{
  "wins": "...",
  "challenges": "...",
  "key_learnings": "...",
  "errors_gaps": "...",
  "improvements": "...",
  "systems_process": "...",
  "emotional_state": "...",
  "strategic_insight": "...",
  "actions_next_week": "...",
  "notes": "..."
}
```

---

### Test 3: Send Multiple Voice Notes
**Objective:** Verify that multiple voice notes can be added to the same session

**Steps:**
1. After Test 2, send another voice note
2. Wait for processing

**Expected Result:**
```
Received your voice note. Processing...

[After processing]

Logged ✅ Week [WEEK_NUMBER] ([DATE]). Want to add anything else? Send another voice note or reply 'done'.
```

**Verification:**
```sql
-- Should have 2 entries for the same user
SELECT COUNT(*)
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER';
-- Expected: 2 (or more)
```

---

### Test 4: End Log Session
**Objective:** Verify that "done" closes the session

**Steps:**
1. After Test 3, send: `done`
2. Observe response

**Expected Result:**
```
All set! Your weekly reflections have been logged. 📝
```

**Verification:**
```sql
SELECT status FROM log_sessions WHERE wa_from = 'YOUR_PHONE_NUMBER';
-- Should show: status = 'idle'
```

---

### Test 5: Audio Without Starting Log
**Objective:** Verify error handling when audio sent without "log" first

**Steps:**
1. Start fresh (or ensure session is idle)
2. Send a voice note WITHOUT sending "log" first

**Expected Result:**
```
Send 'log' first to start a weekly log.
```

---

### Test 6: Existing Flows Still Work
**Objective:** Ensure stamp card, meeting, and edusafe flows are unaffected

**Steps:**
1. Send `DEMO` → Should start demo flow
2. Send `SIGNUP` → Should start signup flow
3. Send `EDUSAFE` → Should start incident report flow
4. Send `STAMP` → Should handle stamp (if in demo context)

**Expected Result:**
All existing flows should work exactly as before. Log system should not interfere.

---

## Error Handling Tests

### Test 7: Missing OpenAI API Key
**Objective:** Verify graceful handling if OPENAI_API_KEY is not set

**Setup:**
Temporarily remove `OPENAI_API_KEY` from environment variables

**Steps:**
1. Send `log`
2. Send voice note

**Expected Result:**
```
Transcription failed: Missing OpenAI API key. Audio saved at [URL]
```

**Verification:**
- Audio should still be saved to Supabase Storage
- No entry in `weekly_reflection_logs` (since transcription failed)

---

### Test 8: Database Insert Failure (Simulated)
**Objective:** Verify failsafe table catches failures

**Note:** This is hard to simulate without breaking the DB. Check logs and failsafe table if any real failures occur.

**Expected Behavior:**
- If `weekly_reflection_logs` insert fails, system should:
  1. Insert into `failed_log_inserts` table
  2. Reply to user with transcript snippet + apology

**Verification:**
```sql
SELECT * FROM failed_log_inserts WHERE resolved_at IS NULL;
```

---

## Performance Tests

### Test 9: Large Audio File (5+ minutes)
**Steps:**
1. Record a 5-6 minute voice note
2. Send it

**Expected Result:**
- Should process successfully (may take 30-60 seconds)
- Confirmation message with week/date

**Note:** OpenAI Whisper supports files up to 25 MB

---

### Test 10: Concurrent Sessions
**Steps:**
1. Use two different phone numbers
2. Both send `log` simultaneously
3. Both send voice notes

**Expected Result:**
- Both sessions should be independent
- Both should receive confirmations
- No cross-contamination of data

---

## Data Integrity Checks

### Test 11: Week Number Calculation
**Verification:**
```sql
SELECT wa_from, log_date, week_number, created_at
FROM weekly_reflection_logs
ORDER BY created_at DESC;
```

**Expected:**
- `week_number` should match ISO week number for `log_date`
- Can verify with: https://www.epochconverter.com/weeknumbers

---

### Test 12: Timezone Consistency
**Verification:**
```sql
SELECT wa_from, log_date, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS TZ') AS created_at_tz
FROM weekly_reflection_logs
ORDER BY created_at DESC;
```

**Expected:**
- `log_date` should use Asia/Ho_Chi_Minh timezone (UTC+7)
- Logs created on same calendar day (HCM time) should have same `log_date`

---

## Maintenance Queries

### Check Session Status
```sql
SELECT wa_from, status, last_prompted_at, current_week
FROM log_sessions
WHERE status = 'awaiting_audio';
```

### Get User's Log History
```sql
SELECT log_date, week_number,
       LEFT(transcript_text, 100) AS preview,
       audio_url
FROM weekly_reflection_logs
WHERE wa_from = 'YOUR_PHONE_NUMBER'
ORDER BY log_date DESC;
```

### Search Logs by Content
```sql
-- Search in structured JSON
SELECT wa_from, log_date, structured_json->>'wins' AS wins
FROM weekly_reflection_logs
WHERE structured_json->>'wins' LIKE '%project%';

-- Full-text search in transcript
SELECT wa_from, log_date, LEFT(transcript_text, 200) AS preview
FROM weekly_reflection_logs
WHERE transcript_text ILIKE '%error%';
```

### Check Failed Inserts
```sql
SELECT * FROM failed_log_inserts
WHERE resolved_at IS NULL
ORDER BY created_at DESC;
```

### Clean Up Old Sessions
```sql
-- Remove idle sessions older than 7 days
DELETE FROM log_sessions
WHERE status = 'idle'
  AND updated_at < now() - interval '7 days';
```

---

## Success Criteria

All tests should pass with:
- ✅ Correct prompts and confirmations
- ✅ Audio files stored in Supabase Storage
- ✅ Transcripts accurately captured
- ✅ Structured JSON populated (even if some fields are empty)
- ✅ Week numbers and dates correct
- ✅ Existing flows unaffected
- ✅ Graceful error handling
- ✅ No data loss (failsafe table works)

---

## Troubleshooting

### Issue: "Transcription failed: Missing OpenAI API key"
**Solution:** Add `OPENAI_API_KEY` to environment variables

### Issue: "Failed to store audio"
**Solution:**
- Check that `weekly-logs` bucket exists in Supabase Storage
- Verify `SUPABASE_SERVICE_ROLE_KEY` has storage permissions

### Issue: "Database insert failed"
**Solution:**
- Check `failed_log_inserts` table for the transcript
- Verify tables were created correctly
- Check Supabase logs for SQL errors

### Issue: Audio not processing
**Solution:**
- Check WhatsApp webhook logs
- Verify `WHATSAPP_TOKEN` is valid
- Ensure webhook URL is correctly configured in Meta App

---

## Notes

- **Cost Estimate:** OpenAI Whisper costs $0.006 per minute of audio. A 5-minute log costs ~$0.03.
- **Structuring with GPT-4o-mini:** Very cheap (~$0.0001 per log)
- **Storage:** Supabase free tier includes 1GB storage
- **Language:** Currently set to English (`language: "en"`). Change in `transcribeAudio()` if needed.
- **Failsafe:** System never loses transcripts. Even if DB insert fails, data goes to `failed_log_inserts`.
