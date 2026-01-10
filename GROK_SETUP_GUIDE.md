# Using Grok (xAI) for FREE Transcription - Setup Guide

## 🎉 Why Grok?

**Grok is FREE** for certain usage tiers with xAI's API, while OpenAI Whisper costs $0.006 per minute.

Your webhook now tries Grok FIRST, then falls back to OpenAI if Grok fails. This means:
- ✅ Free transcription with Grok
- ✅ Automatic fallback to OpenAI if needed
- ✅ No code changes required - just set the API key!

---

## Step 1: Get Your Grok API Key

### Option A: xAI Console (Recommended)

1. Go to https://console.x.ai/
2. Sign up or log in with your account
3. Navigate to **API Keys** section
4. Click **Create New API Key**
5. Copy the API key (starts with `xai-...`)

### Option B: X.com (Twitter) Integration

If you have a verified X account, you may get access through:
1. Visit https://x.ai/
2. Click "Get API Access"
3. Follow authentication with your X account

---

## Step 2: Add API Key to Your Environment

### For Cloudflare Pages:

1. Go to your Cloudflare Dashboard
2. Select your **Pages** project
3. Go to **Settings** → **Environment Variables**
4. Click **Add variable**
5. Add:
   ```
   Variable name: XAI_API_KEY
   Value: xai-your-key-here
   ```
6. Click **Save**
7. **Redeploy** your site

### For Local Development (.env file):

```bash
# .env file
XAI_API_KEY=xai-your-key-here

# Optional: Keep OpenAI as fallback
OPENAI_API_KEY=sk-your-openai-key-here
```

---

## Step 3: Test It!

1. **Send** `log` via WhatsApp
2. **Send** a voice note
3. **Check logs** - You should see:
   ```
   [TRANSCRIBE] Using Grok (xAI) for transcription
   [TRANSCRIBE] Grok transcription successful
   [STRUCTURE] Using Grok for structuring
   [STRUCTURE] Grok structuring successful
   ```

---

## Supported API Key Names

The webhook checks for these environment variables (in order):
1. `XAI_API_KEY` ← Recommended
2. `GROK_API_KEY` ← Alternative name
3. `OPENAI_API_KEY` ← Fallback

---

## How It Works

### Transcription Flow:
```
1. Try Grok (xAI) API
   ↓ Success? → Return transcript
   ↓ Failed?
2. Try OpenAI Whisper
   ↓ Success? → Return transcript
   ↓ Failed?
3. Return error
```

### Structuring Flow:
```
1. Try Grok (grok-beta model)
   ↓ Success? → Return structured JSON
   ↓ Failed?
2. Try OpenAI (gpt-4o-mini)
   ↓ Success? → Return structured JSON
   ↓ Failed?
3. Return { notes: transcript }
```

---

## Grok API Limits (as of Jan 2025)

**Free Tier:**
- 100 requests per minute
- 10,000 tokens per minute
- Sufficient for personal weekly logs

**Note:** Check https://docs.x.ai/api for current limits

---

## Cost Comparison

| Service | Transcription | Structuring | Total per 5-min log |
|---------|--------------|-------------|---------------------|
| **Grok (xAI)** | FREE | FREE | **$0.00** |
| **OpenAI** | $0.03 | $0.0001 | **$0.03** |

**Annual savings** (1 log/week): ~$1.56/year (not much, but free is free! 😄)

---

## Troubleshooting

### Issue: "Missing XAI_API_KEY or OPENAI_API_KEY"
**Solution:** Add `XAI_API_KEY` to environment variables and redeploy

### Issue: Grok transcription fails
**Solution:**
- Check API key is correct
- Check https://status.x.ai/ for service status
- Webhook will automatically fallback to OpenAI if you have that key

### Issue: Audio format not supported
**Solution:** Grok supports: ogg, mp3, m4a. WhatsApp voice notes are typically ogg format (supported).

### Issue: Transcription is inaccurate
**Solution:**
- Try speaking more clearly
- Reduce background noise
- If Grok quality is poor, remove `XAI_API_KEY` to force OpenAI Whisper (more accurate but paid)

---

## Verify Which API Is Being Used

Check your Cloudflare Pages logs:

**Using Grok (free):**
```
[TRANSCRIBE] Using Grok (xAI) for transcription
[STRUCTURE] Using Grok for structuring
```

**Fallback to OpenAI:**
```
[TRANSCRIBE] Grok failed, trying OpenAI...
[TRANSCRIBE] Using OpenAI Whisper for transcription
```

---

## Advanced: Force OpenAI Only

If you want to skip Grok and use OpenAI only:
1. Remove `XAI_API_KEY` from environment variables
2. Keep only `OPENAI_API_KEY`
3. Redeploy

---

## Notes

⚠️ **Important:** Grok's audio transcription API is relatively new. If you experience issues:
- The webhook automatically falls back to OpenAI Whisper
- Audio is always saved to Supabase Storage (never lost)
- You can manually transcribe later if needed

✅ **Best Practice:** Set both `XAI_API_KEY` and `OPENAI_API_KEY` for redundancy

---

## Summary

1. ✅ Get xAI API key from https://console.x.ai/
2. ✅ Add `XAI_API_KEY` to Cloudflare environment variables
3. ✅ Redeploy your webhook
4. ✅ Test with "log" + voice note
5. ✅ Enjoy FREE transcription! 🎉
