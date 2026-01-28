// Cloudflare Pages Function: WhatsApp Stamp Card Demo
// No external npm deps; Supabase via REST; WhatsApp Cloud API for messaging.

// ---------- Supabase REST helpers ----------

function getSupabaseConfig(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/KEY");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function sbHeaders(env, extra = {}) {
  const { key } = getSupabaseConfig(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbSelectOne(env, table, filterQuery, columns = "*") {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/${table}?${filterQuery}&select=${encodeURIComponent(
      columns
    )}&limit=1`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    console.error(
      `Supabase selectOne ${table} error`,
      res.status,
      await res.text()
    );
    return null;
  }
  const data = await res.json();
  return data[0] || null;
}

async function sbInsert(env, table, rows) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(
      `Supabase insert ${table} error`,
      res.status,
      await res.text()
    );
  }
}

async function sbUpsert(env, table, rows, keyCols) {
  const { url } = getSupabaseConfig(env);
  const onConflict = Array.isArray(keyCols) ? keyCols.join(",") : keyCols;
  const res = await fetch(
    `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    console.error(
      `Supabase upsert ${table} error`,
      res.status,
      await res.text()
    );
  }
}

async function sbUpdate(env, table, filterQuery, patch) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: sbHeaders(env, { Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error(
      `Supabase update ${table} error`,
      res.status,
      await res.text()
    );
  }
}

// ---------- Supabase Storage helper ----------

async function sbUploadToStorage(env, bucket, path, bytes, contentType) {
  const { url, key } = getSupabaseConfig(env);

  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: bytes,
  });

  if (!res.ok) {
    console.error(
      `Supabase storage upload error`,
      res.status,
      await res.text()
    );
    return null;
  }

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${path}`;
  return publicUrl;
}

// ---------- Weekly Reflection Log System ----------

// ISO week number calculation
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function getLogDate() {
  // Use Asia/Ho_Chi_Minh timezone (UTC+7)
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const hcmTime = new Date(utc + (3600000 * 7));
  const y = hcmTime.getFullYear();
  const m = String(hcmTime.getMonth() + 1).padStart(2, "0");
  const d = String(hcmTime.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Log session management
async function getLogSession(env, waFrom) {
  return await sbSelectOne(
    env,
    "log_sessions",
    `wa_from=eq.${encodeURIComponent(waFrom)}`,
    "id,wa_from,status,current_week,created_at,updated_at"
  );
}

async function upsertLogSession(env, waFrom, status, week = null) {
  const now = new Date().toISOString();
  const payload = {
    wa_from: waFrom,
    status: status,
    last_prompted_at: now,
    updated_at: now,
  };
  if (week !== null) {
    payload.current_week = week;
  }
  await sbUpsert(env, "log_sessions", [payload], "wa_from");
}

// Download WhatsApp media
async function downloadWhatsAppMedia(env, mediaId) {
  const token = env.WHATSAPP_TOKEN;

  // Step 1: Get media metadata
  const metaRes = await fetch(
    `https://graph.facebook.com/v23.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!metaRes.ok) {
    console.error("[WA MEDIA] metadata error", metaRes.status, await metaRes.text());
    return null;
  }

  const metaJson = await metaRes.json();
  const mediaUrl = metaJson.url;
  const mimeType = metaJson.mime_type || "audio/ogg";

  // Step 2: Download media bytes
  const fileRes = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!fileRes.ok) {
    console.error("[WA MEDIA] download error", fileRes.status, await fileRes.text());
    return null;
  }

  const bytes = await fileRes.arrayBuffer();
  return { bytes, mimeType };
}

// Transcribe audio using AssemblyAI (FREE 300+ hours!)
async function transcribeAudio(env, audioBytes, mimeType) {
  const assemblyApiKey = env.ASSEMBLYAI_API_KEY;
  const openaiApiKey = env.OPENAI_API_KEY;

  if (!assemblyApiKey && !openaiApiKey) {
    console.error("[TRANSCRIBE] Missing ASSEMBLYAI_API_KEY or OPENAI_API_KEY");
    return { success: false, error: "Missing transcription API key. Add ASSEMBLYAI_API_KEY or OPENAI_API_KEY to environment variables." };
  }

  // Try AssemblyAI first (FREE!)
  if (assemblyApiKey) {
    try {
      console.log("[TRANSCRIBE] Using AssemblyAI for transcription");

      // Step 1: Upload audio file to AssemblyAI
      const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
        method: "POST",
        headers: {
          authorization: assemblyApiKey,
        },
        body: audioBytes,
      });

      if (!uploadRes.ok) {
        console.error("[TRANSCRIBE] AssemblyAI upload error", uploadRes.status, await uploadRes.text());
        throw new Error(`Upload failed: ${uploadRes.status}`);
      }

      const uploadData = await uploadRes.json();
      const audioUrl = uploadData.upload_url;

      // Step 2: Request transcription
      const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: {
          authorization: assemblyApiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          speech_model: "universal",
        }),
      });

      if (!transcriptRes.ok) {
        console.error("[TRANSCRIBE] AssemblyAI transcript request error", transcriptRes.status, await transcriptRes.text());
        throw new Error(`Transcription request failed: ${transcriptRes.status}`);
      }

      const transcriptData = await transcriptRes.json();
      const transcriptId = transcriptData.id;

      // Step 3: Poll for completion
      let transcript = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: {
            authorization: assemblyApiKey,
          },
        });

        if (!pollRes.ok) {
          console.error("[TRANSCRIBE] AssemblyAI poll error", pollRes.status);
          throw new Error(`Polling failed: ${pollRes.status}`);
        }

        const pollData = await pollRes.json();

        if (pollData.status === "completed") {
          transcript = pollData.text;
          console.log("[TRANSCRIBE] AssemblyAI transcription successful");
          return {
            success: true,
            transcript: transcript || "",
            model: "assemblyai-universal",
            transcribed_at: new Date().toISOString(),
          };
        } else if (pollData.status === "error") {
          console.error("[TRANSCRIBE] AssemblyAI transcription error:", pollData.error);
          throw new Error(`Transcription error: ${pollData.error}`);
        }

        // Still processing, continue polling
      }

      throw new Error("Transcription timeout after 2 minutes");
    } catch (assemblyErr) {
      console.error("[TRANSCRIBE] AssemblyAI exception, trying OpenAI fallback:", assemblyErr.message);
    }
  }

  // Fallback to OpenAI Whisper
  if (openaiApiKey) {
    try {
      console.log("[TRANSCRIBE] Using OpenAI Whisper for transcription");

      const formData = new FormData();
      const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp3") ? "mp3" : "m4a";
      const blob = new Blob([audioBytes], { type: mimeType });
      formData.append("file", blob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "en");
      formData.append("response_format", "json");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[TRANSCRIBE] OpenAI error", res.status, errText);
        return { success: false, error: `OpenAI API error: ${res.status}` };
      }

      const json = await res.json();
      return {
        success: true,
        transcript: json.text || "",
        model: "whisper-1",
        transcribed_at: new Date().toISOString(),
      };
    } catch (err) {
      console.error("[TRANSCRIBE] OpenAI exception:", err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: "All transcription methods failed" };
}

// Structure transcript using Grok or OpenAI - FREE with Grok!
async function structureTranscript(env, transcript) {
  const grokApiKey = env.XAI_API_KEY || env.GROK_API_KEY;
  const openaiApiKey = env.OPENAI_API_KEY;

  if (!grokApiKey && !openaiApiKey) {
    console.error("[STRUCTURE] Missing XAI_API_KEY or OPENAI_API_KEY");
    return { notes: transcript };
  }

  const systemPrompt = `You are an AI that structures weekly reflection logs in the style of Ray Dalio's error logs.
Given a transcript, extract and categorize information into these fields:
- wins: notable successes
- challenges: difficulties faced
- key_learnings: main lessons learned
- errors_gaps: mistakes or gaps identified
- improvements: areas to improve
- systems_process: process or system insights
- emotional_state: emotional or mental state observations
- strategic_insight: strategic or big-picture thinking
- actions_next_week: planned actions for next week
- notes: anything that doesn't fit above

Return valid JSON with these keys. If a category has no content, use empty string.`;

  // Try Grok first (free)
  if (grokApiKey) {
    try {
      console.log("[STRUCTURE] Using Grok for structuring");

      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${grokApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript },
          ],
          temperature: 0.3,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          // Try to extract JSON from response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const structured = JSON.parse(jsonMatch[0]);
            console.log("[STRUCTURE] Grok structuring successful");
            return structured;
          }
        }
      }

      console.log("[STRUCTURE] Grok failed, trying OpenAI...", res.status);
    } catch (grokErr) {
      console.error("[STRUCTURE] Grok exception, trying OpenAI:", grokErr.message);
    }
  }

  // Fallback to OpenAI
  if (openaiApiKey) {
    try {
      console.log("[STRUCTURE] Using OpenAI for structuring");

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        console.error("[STRUCTURE] OpenAI error", res.status, await res.text());
        return { notes: transcript };
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        return { notes: transcript };
      }

      const structured = JSON.parse(content);
      return structured;
    } catch (err) {
      console.error("[STRUCTURE] OpenAI exception:", err);
      return { notes: transcript };
    }
  }

  return { notes: transcript };
}

// Save weekly reflection log
async function saveWeeklyLog(env, waFrom, transcript, audioPath, audioUrl, structuredJson) {
  const logDate = getLogDate();
  const weekNumber = getISOWeek(new Date(logDate));
  const now = new Date().toISOString();

  const row = {
    wa_from: waFrom,
    log_date: logDate,
    week_number: weekNumber,
    transcript_text: transcript,
    audio_storage_path: audioPath,
    audio_url: audioUrl,
    structured_json: structuredJson,
    created_at: now,
  };

  await sbInsert(env, "weekly_reflection_logs", [row]);
  return { logDate, weekNumber };
}

// Main handler for log command
async function handleLogCommand(env, waFrom) {
  const logDate = getLogDate();
  const weekNumber = getISOWeek(new Date(logDate));

  await upsertLogSession(env, waFrom, "awaiting_audio", weekNumber);

  await sendText(
    env,
    waFrom,
    `Got it. Please reply with a voice note for your weekly reflection (2–6 min). When you send it, I'll transcribe and save it.`
  );
}

// Main handler for audio in log flow
async function handleLogAudio(env, waFrom, message) {
  // Check session status
  const session = await getLogSession(env, waFrom);
  if (!session || session.status !== "awaiting_audio") {
    await sendText(env, waFrom, "Send 'log' first to start a weekly log.");
    return false;
  }

  const mediaId = message.audio?.id;
  if (!mediaId) {
    await sendText(env, waFrom, "Could not find audio in your message. Please send a voice note.");
    return false;
  }

  await sendText(env, waFrom, "Received your voice note. Processing...");

  try {
    // Step 1: Download audio
    const media = await downloadWhatsAppMedia(env, mediaId);
    if (!media) {
      await sendText(env, waFrom, "Failed to download audio. Please try again.");
      return false;
    }

    // Step 2: Store in Supabase Storage
    const logDate = getLogDate();
    const timestamp = Date.now();
    const ext = media.mimeType.includes("ogg") ? "ogg" : media.mimeType.includes("mp3") ? "mp3" : "m4a";
    const storagePath = `${waFrom}/${logDate}/${timestamp}_${mediaId}.${ext}`;

    const audioUrl = await sbUploadToStorage(
      env,
      "weekly-logs",
      storagePath,
      media.bytes,
      media.mimeType
    );

    if (!audioUrl) {
      await sendText(env, waFrom, "Failed to store audio. Please contact support.");
      return false;
    }

    // Step 3: Transcribe
    const transcription = await transcribeAudio(env, media.bytes, media.mimeType);
    if (!transcription.success) {
      await sendText(
        env,
        waFrom,
        `Transcription failed: ${transcription.error}. Audio saved at ${audioUrl}`
      );
      return false;
    }

    const transcript = transcription.transcript;

    // Step 4: Structure the transcript
    const structuredJson = await structureTranscript(env, transcript);

    // Step 5: Save to database
    try {
      const { logDate: savedDate, weekNumber } = await saveWeeklyLog(
        env,
        waFrom,
        transcript,
        storagePath,
        audioUrl,
        structuredJson
      );

      // Step 6: Confirm to user
      await sendText(
        env,
        waFrom,
        `Logged ✅ Week ${weekNumber} (${savedDate}). Want to add anything else? Send another voice note or reply 'done'.`
      );

      // Keep session in awaiting_audio state to allow multiple voice notes
      return true;
    } catch (dbErr) {
      console.error("[LOG SAVE] Database error:", dbErr);

      // Fallback: save to failed_log_inserts table
      try {
        await sbInsert(env, "failed_log_inserts", [
          {
            wa_from: waFrom,
            transcript_text: transcript,
            audio_storage_path: storagePath,
            audio_url: audioUrl,
            structured_json: structuredJson,
            error_message: dbErr.message || "Database insert failed",
            created_at: new Date().toISOString(),
          },
        ]);
      } catch (failErr) {
        console.error("[FAILED_LOG_INSERTS] Failed to save to failsafe table:", failErr);
      }

      await sendText(
        env,
        waFrom,
        `Transcript saved but database insert failed. Your reflection:\n\n"${transcript.substring(0, 200)}..."\n\nPlease contact support.`
      );
      return false;
    }
  } catch (err) {
    console.error("[LOG AUDIO] Unexpected error:", err);
    await sendText(env, waFrom, "An unexpected error occurred. Please try again.");
    return false;
  }
}

async function handleLogDone(env, waFrom) {
  const session = await getLogSession(env, waFrom);
  if (session && session.status === "awaiting_audio") {
    await upsertLogSession(env, waFrom, "idle");
    await sendText(env, waFrom, "All set! Your weekly reflections have been logged. 📝");
    return true;
  }
  return false;
}

// ---------- WhatsApp helpers ----------

function getPhoneNumberId(env) {
  return env.PHONE_NUMBER_ID || "858272234034248";
}

async function sendWhatsApp(env, payload) {
  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = getPhoneNumberId(env);
  if (!token || !phoneNumberId) {
    console.error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("[WA SEND] error", res.status, text);
  } else {
    console.log("[WA SEND] ok", res.status, text);
  }
}

function sendText(env, to, body) {
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

function sendImage(env, to, link, caption) {
  const image = { link };
  if (caption) image.caption = caption;
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image,
  });
}

function sendInteractiveButtons(env, to, bodyText, buttons) {
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

// ---------- Card URL helpers ----------

function buildCardUrl(env, visits) {
  const base =
    env.CARDS_BASE_URL ||
    "https://lhbtgjvejsnsrlstwlwl.supabase.co/storage/v1/object/public/cards";
  const version = env.CARDS_VERSION || "v1";
  const prefix = env.CARD_PREFIX || "Demo_Shop_";
  const v = Math.max(
    0,
    Math.min(10, Number.isNaN(Number(visits)) ? 0 : Number(visits))
  );
  return `${base}/${version}/${prefix}${v}.png`;
}

function getZeroCardUrl(env) {
  return env.STAMP_CARD_ZERO_URL || buildCardUrl(env, 0);
}

// ---------- Idempotency: processed_events ----------

async function alreadyProcessed(env, messageId) {
  if (!messageId) return false;
  const row = await sbSelectOne(
    env,
    "processed_events",
    `message_id=eq.${encodeURIComponent(messageId)}`,
    "message_id"
  );
  return !!row;
}

async function markProcessed(env, messageId) {
  if (!messageId) return;
  await sbInsert(env, "processed_events", [{ message_id: messageId }]);
}

// ---------- Conversation state: conversation_state ----------

async function getState(env, customerId) {
  const row = await sbSelectOne(
    env,
    "conversation_state",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "active_flow,step"
  );
  if (!row) return { active_flow: null, step: 0 };
  return row;
}

async function setState(env, customerId, flow, step = 0) {
  const payload = {
    customer_id: customerId,
    active_flow: flow,
    step,
    updated_at: new Date().toISOString(),
  };
  await sbUpsert(env, "conversation_state", [payload], "customer_id");
}

async function clearState(env, customerId) {
  await setState(env, customerId, null, 0);
}

// ---------- Customers table helpers ----------

async function upsertCustomer(env, customerId, profileName) {
  const now = new Date().toISOString();
  const existing = await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id"
  );

  if (existing) {
    await sbUpdate(
      env,
      "customers",
      `customer_id=eq.${encodeURIComponent(customerId)}`,
      { last_seen_at: now, profile_name: profileName }
    );
  } else {
    await sbInsert(env, "customers", [
      {
        customer_id: customerId,
        profile_name: profileName,
        created_at: now,
        last_seen_at: now,
      },
    ]);
  }
}

async function setCustomerBirthday(env, customerId, birthdayIso) {
  await sbUpdate(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    { birthday: birthdayIso }
  );
}

async function setCustomerPreferredDrink(env, customerId, drink) {
  await sbUpdate(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    { preferred_drink: drink }
  );
}

async function resetVisitCount(env, customerId) {
  await sbUpsert(
    env,
    "customers",
    [{ customer_id: customerId, number_of_visits: 0, last_visit_at: null }],
    "customer_id"
  );
}

async function resetStreakState(env, customerId) {
  await sbUpsert(
    env,
    "customer_streaks",
    [
      {
        customer_id: customerId,
        streak_count: 0,
        last_visit_date: null,
        two_day_sent: false,
        five_day_sent: false,
      },
    ],
    "customer_id"
  );
}

// ---------- Streak helpers ----------

function getTodayIsoDate() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayDiff(fromDate, toDate) {
  const a = new Date(`${fromDate}T00:00:00Z`);
  const b = new Date(`${toDate}T00:00:00Z`);
  const diff = (b - a) / (1000 * 60 * 60 * 24);
  return Math.round(diff);
}

async function updateStreak(env, customerId) {
  const today = getTodayIsoDate();
  const row = await sbSelectOne(
    env,
    "customer_streaks",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id,streak_count,last_visit_date,two_day_sent,five_day_sent"
  );

  let streak = 1;
  let twoSent = row?.two_day_sent === true;
  let fiveSent = row?.five_day_sent === true;

  if (row) {
    const lastDate = row.last_visit_date || today;
    const diff = dayDiff(lastDate, today);

    if (diff === 0) {
      streak = row.streak_count || 1;
    } else if (diff === 1) {
      streak = (row.streak_count || 1) + 1;
    } else {
      streak = 1;
    }
  }

  await sbUpsert(
    env,
    "customer_streaks",
    [
      {
        customer_id: customerId,
        streak_count: streak,
        last_visit_date: today,
        two_day_sent: twoSent,
        five_day_sent: fiveSent,
      },
    ],
    "customer_id"
  );

  return { streak, twoSent, fiveSent };
}

async function maybeSendStreakMilestones(env, customerId, streak, flags) {
  if (streak === 2 && !flags.twoSent) {
    await sendText(
      env,
      customerId,
      "You’re on a 2-day streak… hit 5 and get double stamps!"
    );
    await sbUpdate(
      env,
      "customer_streaks",
      `customer_id=eq.${encodeURIComponent(customerId)}`,
      { two_day_sent: true }
    );
  }

  if (streak === 5 && !flags.fiveSent) {
    await sendText(env, customerId, "🔥 5-day streak! You’ve earned a reward.");
    await sbUpdate(
      env,
      "customer_streaks",
      `customer_id=eq.${encodeURIComponent(customerId)}`,
      { five_day_sent: true }
    );
  }
}

// ---------- Birthday parsing ----------

function parseBirthday(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  return null;
}

// ---------- SIGNUP flow ----------

async function startSignupFlow(env, customerId, waName) {
  const msg = `Hey${waName ? `, ${waName}` : ""}! 👋

_Two quick questions to set up your stamp card_ ⚡

 1️⃣ When’s your birthday?
e.g. 1993-02-07

_(you get a free drink on your birthday)_`;
  await sendText(env, customerId, msg);
  await setState(env, customerId, "signup", 1);
}

async function handleSignupTextStep1(env, customerId, text) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 1) return false;

  const iso = parseBirthday(text);
  const birthdayValue = iso || text.trim();
  await setCustomerBirthday(env, customerId, birthdayValue);

  await sendInteractiveButtons(env, customerId, "2️⃣ Which drink do you prefer?", [
    { id: "drink_matcha", title: "Matcha" },
    { id: "drink_americano", title: "Americano" },
    { id: "drink_cappuccino", title: "Cappuccino" },
  ]);

  await setState(env, customerId, "signup", 2);
  return true;
}

// ---------- Connect & branching flows ----------

function buildShareLink(env) {
  if (env.SHARE_LINK) return env.SHARE_LINK;
  return "https://wa.me/84764929881?text=DEMO";
}

function getWebsiteUrl(env) {
  return env.WEBSITE_URL || "https://thepotentialcompany.com";
}

function getDashboardUrl(env) {
  return (
    env.DASHBOARD_URL ||
    env.REPORT_URL ||
    "https://ndrsndbk.github.io/stamp-card-dashboard/"
  );
}

async function sendConnectMenu(env, to, waName) {
  const body = `Hi${waName ? ` ${waName}` : ""}! 🤝

Thanks for connecting.

_We help businesses grow with custom Meta loyalty systems, digital products, and strategic advisory_

Would you like to book a *meeting* or *try a demo*?`;

  await sendInteractiveButtons(env, to, body, [
    { id: "connect_meeting", title: "MEETING" },
    { id: "connect_demo", title: "DEMO" },
  ]);
}

async function startMeetingFlow(env, customerId) {
  await sendInteractiveButtons(
    env,
    customerId,
    "Which bespoke service are you most interested in?",
    [
      { id: "meeting_meta", title: "META SYSTEMS" },
      { id: "meeting_apps", title: "APPS & AUTOMATIONS" },
      { id: "meeting_advisory", title: "STRATEGIC ADVISORY" },
    ]
  );
  await setState(env, customerId, "meeting", 1);
}

async function logMeetingSelection(env, customerId, waName, selected) {
  const now = new Date().toISOString();
  await sbInsert(env, "meeting_requests", [
    {
      customer_id: customerId,
      wa_name: waName || null,
      service_selected: selected,
      status: "service_selected",
      created_at: now,
      updated_at: now,
    },
  ]);
}

async function getLatestMeetingRequest(env, customerId) {
  return await sbSelectOne(
    env,
    "meeting_requests",
    `customer_id=eq.${encodeURIComponent(
      customerId
    )}&status=eq.${encodeURIComponent("service_selected")}&order=created_at.desc`,
    "id"
  );
}

async function updateMeetingRequestTime(env, customerId, rawText) {
  const latest = await getLatestMeetingRequest(env, customerId);
  const now = new Date().toISOString();

  if (latest?.id) {
    await sbUpdate(
      env,
      "meeting_requests",
      `id=eq.${encodeURIComponent(latest.id)}`,
      { requested_time_text: rawText, status: "time_proposed", updated_at: now }
    );
    return;
  }

  await sbInsert(env, "meeting_requests", [
    {
      customer_id: customerId,
      requested_time_text: rawText,
      status: "time_proposed",
      created_at: now,
      updated_at: now,
    },
  ]);
}

async function updateMeetingRequestEmail(env, customerId, emailText) {
  const latest = await getLatestMeetingRequest(env, customerId);
  const now = new Date().toISOString();

  if (latest?.id) {
    await sbUpdate(
      env,
      "meeting_requests",
      `id=eq.${encodeURIComponent(latest.id)}`,
      { email: emailText, status: "email_captured", updated_at: now }
    );
    return;
  }

  await sbInsert(env, "meeting_requests", [
    {
      customer_id: customerId,
      email: emailText,
      status: "email_captured",
      created_at: now,
      updated_at: now,
    },
  ]);
}

async function handleMeetingServiceReply(env, customerId, replyId, waName) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "meeting" || st.step !== 1) return false;

  const map = {
    meeting_meta: "Meta Systems",
    meeting_apps: "Applications / Automation",
    meeting_advisory: "Strategic Advisory",
  };
  const selected = map[replyId];
  if (!selected) return false;

  await logMeetingSelection(env, customerId, waName, selected);

  await sendText(
    env,
    customerId,
    `Awesome! We’ll focus on *${selected}*.

Which day + time suits you? 📅 (e.g. Tue 3pm or 12 Jun 10:00)`
  );

  await setState(env, customerId, `meeting_${replyId}`, 2);
  return true;
}

async function handleMeetingTimeText(env, customerId, rawText) {
  const st = await getState(env, customerId);
  if (!st.active_flow?.startsWith("meeting_") || st.step !== 2) return false;

  const serviceKey = st.active_flow.replace("meeting_", "");
  const map = {
    meta: "Meta Systems",
    apps: "Applications / Automation",
    advisory: "Strategic Advisory",
  };
  const selected = map[serviceKey] || "our services";

  await updateMeetingRequestTime(env, customerId, rawText);

  await sendText(
    env,
    customerId,
    `Nice! We’ll pencil in *${rawText}* for *${selected}*.

_Final step:_ ⚡

Please reply with your email address so we can book the meeting.`
  );

  await setState(env, customerId, `meeting_${serviceKey}`, 3);
  return true;
}

async function handleMeetingEmailText(env, customerId, rawText) {
  const st = await getState(env, customerId);
  if (!st.active_flow?.startsWith("meeting_") || st.step !== 3) return false;

  await updateMeetingRequestEmail(env, customerId, rawText);

  await sendText(
    env,
    customerId,
    `Thanks! You’re all set — we’ll reach out soon to confirm details.

In the meantime, you can:
• Send *DEMO* to test our Meta Systems
• Or visit ${getWebsiteUrl(env)} for explainer videos`
  );

  await clearState(env, customerId);
  return true;
}

async function startDemoFlow(env, customerId, waName) {
  const intro = `Here’s a demo of a *Meta Loyalty System*: the *WhatsApp Stamp Card* 👇

_Imagine a customer walks into a coffee shop and scans a QR._

Then they get sent this message:

Send *SIGNUP* to get your stamp card. 🙂 `;
  await sendText(env, customerId, intro);
  await setState(env, customerId, "demo_intro", 0);
}

async function sendMoreMenu(env, customerId) {
  const body = `Want to try more features? Pick an option:

🔥 Reply *STREAK* to test gamification.

📊 Reply *DASH* to see the manager dashboard.`;
  await sendInteractiveButtons(env, customerId, body, [
    { id: "more_streak", title: "STREAK" },
    { id: "more_dash", title: "DASH" },
  ]);
  await setState(env, customerId, "more", 1);
}

async function sendDashboardLink(env, customerId) {
  await sendText(
    env,
    customerId,
    `Here’s the dashboard link:
${getDashboardUrl(env)}

It updates in real-time during the demo.

More content about us is here: ${getWebsiteUrl(env)}`
  );
}

async function handleStreakCommand(env, customerId) {
  await sendText(
    env,
    customerId,
    `Let’s test streak gamification 🔥 

A streak means visiting multiple days in a row.

Send *STAMP* to make another “purchase”.`
  );
  await setState(env, customerId, "demo_streak", 1);
}

async function handleSignupInteractiveStep2(env, customerId, replyId) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 2) return false;

  const map = {
    drink_matcha: "matcha",
    drink_americano: "americano",
    drink_cappuccino: "cappuccino",
  };
  const drink = map[replyId];
  if (!drink) return false;

  await setCustomerPreferredDrink(env, customerId, drink);

  await sendText(
    env,
    customerId,
    "Nice choice 😎 Here’s your digital stamp card:"
  );
  await sendImage(env, customerId, getZeroCardUrl(env));

  await sendText(
    env,
    customerId,
    `Now imagine you’ve just bought a coffee ☕️

Respond *STAMP* to claim your first stamp.`
  );

  await setState(env, customerId, "demo_stamp", 1);
  return true;
}

// ---------- EDUSAFE Incident Report Flow ----------

async function startEduSafeFlow(env, customerId) {
  const body = `🛟 *Incident Report*

Hi! Would you like to log an incident?`;
  await sendInteractiveButtons(env, customerId, body, [
    { id: "edu_yes", title: "YES" },
    { id: "edu_no", title: "NO" },
  ]);
  await setState(env, customerId, "edusafe", 1);
}

async function handleEduInteractive(env, customerId, replyId) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "edusafe") return false;

  if (st.step === 1) {
    if (replyId === "edu_no") {
      await sendText(
        env,
        customerId,
        `👍 No problem.

If you need to log something later, just send *EDUSAFE*.`
      );
      await clearState(env, customerId);
      return true;
    }

    if (replyId === "edu_yes") {
      await sendInteractiveButtons(
        env,
        customerId,
        `🚨 *Incident Type*

What type of incident is it?`,
        [
          { id: "edu_type_critical", title: "Critical" },
          { id: "edu_type_noise", title: "Noise" },
          { id: "edu_type_minor", title: "Minor" },
        ]
      );
      await setState(env, customerId, "edusafe", 2);
      return true;
    }

    return false;
  }

  if (st.step === 2) {
    let incidentType = null;

    if (replyId === "edu_type_critical") incidentType = "critical";
    if (replyId === "edu_type_noise") incidentType = "noise";
    if (replyId === "edu_type_minor") incidentType = "minor";

    if (!incidentType) return false;

    await sbInsert(env, "incident_reports", [
      {
        customer_id: customerId,
        incident_type: incidentType,
        status: "awaiting_media",
      },
    ]);

    if (incidentType === "noise") {
      await sendText(
        env,
        customerId,
        `🔊 *Noise Complaint*

Please reply with a *voice note* explaining the noise (location, time, and any details).`
      );
    } else if (incidentType === "critical") {
      await sendText(
        env,
        customerId,
        `📸 *Critical Incident*

Please send a *photo* of the incident (if it is safe to do so).`
      );
    } else {
      await sendText(
        env,
        customerId,
        `📝 *Minor Issue / Near Miss*

Please reply with a short *text description* of the incident.`
      );
    }

    await setState(env, customerId, "edusafe", 3);
    return true;
  }

  if (st.step === 4) {
    const map = {
      edu_leader_A: "Leader A",
      edu_leader_B: "Leader B",
      edu_leader_C: "Leader C",
    };
    const leader = map[replyId];
    if (!leader) return false;

    const incident = await sbSelectOne(
      env,
      "incident_reports",
      `customer_id=eq.${encodeURIComponent(
        customerId
      )}&status=eq.${encodeURIComponent("awaiting_leader")}&order=created_at.desc`,
      "id"
    );

    if (incident?.id) {
      await sbUpdate(
        env,
        "incident_reports",
        `id=eq.${encodeURIComponent(incident.id)}`,
        {
          team_leader: leader,
          status: "logged",
        }
      );
    }

    await sendText(
      env,
      customerId,
      `✅ *Incident Logged*

Thank you — your report has been recorded. 🙏`
    );
    await clearState(env, customerId);
    return true;
  }

  return false;
}

async function handleEduMedia(env, customerId, message) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "edusafe" || st.step !== 3) return false;

  const incident = await sbSelectOne(
    env,
    "incident_reports",
    `customer_id=eq.${encodeURIComponent(
      customerId
    )}&status=eq.${encodeURIComponent("awaiting_media")}&order=created_at.desc`,
    "id"
  );

  if (!incident?.id) return false;

  const type = message.type;
  let mediaType = null;
  let mediaId = null;
  let description = null;
  let mediaUrl = null;

  if (type === "audio") {
    mediaType = "audio";
    mediaId = message.audio?.id || null;

    if (mediaId) {
      const metaRes = await fetch(
        `https://graph.facebook.com/v23.0/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          },
        }
      );

      if (metaRes.ok) {
        const metaJson = await metaRes.json();
        const fileRes = await fetch(metaJson.url, {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          },
        });
        const bytes = await fileRes.arrayBuffer();

        const mime = message.audio?.mime_type || "audio/ogg";
        const path = `audio/${incident.id}-${Date.now()}.ogg`;

        const url = await sbUploadToStorage(
          env,
          "incident-media",
          path,
          bytes,
          mime
        );
        mediaUrl = url;
      }
    }
  }

  if (type === "image") {
    mediaType = "image";
    mediaId = message.image?.id || null;

    if (mediaId) {
      const metaRes = await fetch(
        `https://graph.facebook.com/v23.0/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          },
        }
      );

      if (metaRes.ok) {
        const metaJson = await metaRes.json();
        const fileRes = await fetch(metaJson.url, {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          },
        });
        const bytes = await fileRes.arrayBuffer();

        const mime = message.image?.mime_type || "image/jpeg";
        const ext = mime.includes("png") ? "png" : "jpg";
        const path = `images/${incident.id}-${Date.now()}.${ext}`;

        const url = await sbUploadToStorage(
          env,
          "incident-media",
          path,
          bytes,
          mime
        );
        mediaUrl = url;
      }
    }
  }

  if (type === "text") {
    mediaType = "none";
    description = (message.text?.body || "").trim();
  }

  await sbUpdate(
    env,
    "incident_reports",
    `id=eq.${encodeURIComponent(incident.id)}`,
    {
      media_type: mediaType,
      media_whatsapp_id: mediaId,
      media_url: mediaUrl,
      description: description,
      status: "awaiting_leader",
    }
  );

  await sendInteractiveButtons(
    env,
    customerId,
    `👷 *Team Leader*

Please select the name of your team leader:`,
    [
      { id: "edu_leader_A", title: "Leader A" },
      { id: "edu_leader_B", title: "Leader B" },
      { id: "edu_leader_C", title: "Leader C" },
    ]
  );

  await setState(env, customerId, "edusafe", 4);
  return true;
}

// ---------- QMUNITY QUEUE Flow ----------

// Get default Qmunity location (home-affairs)
async function getDefaultQmunityLocation(env) {
  return await sbSelectOne(
    env,
    "qmunity_locations",
    `slug=eq.home-affairs&is_active=eq.true`,
    "id,slug,name,max_capacity"
  );
}

// Insert a queue check-in
async function insertQmunityCheckin(env, locationId, waFrom, queueNumber) {
  await sbInsert(env, "qmunity_checkins", [
    {
      location_id: locationId,
      wa_from: waFrom,
      queue_number: queueNumber,
    },
  ]);
}

// Insert a speed report
async function insertQmunitySpeedReport(env, locationId, waFrom, speed) {
  await sbInsert(env, "qmunity_speed_reports", [
    {
      location_id: locationId,
      wa_from: waFrom,
      speed: speed,
    },
  ]);
}

// Insert an issue report
async function insertQmunityIssue(env, locationId, waFrom, message) {
  await sbInsert(env, "qmunity_issues", [
    {
      location_id: locationId,
      wa_from: waFrom,
      message: message,
    },
  ]);
}

// Get the dashboard URL for Qmunity
function getQmunityDashboardUrl(env) {
  if (env.QMUNITY_DASHBOARD_URL) return env.QMUNITY_DASHBOARD_URL;
  return "https://wa-demo.pages.dev/qmunity";
}

// Start the Qmunity Queue flow
async function startQmunityFlow(env, customerId, waName) {
  const location = await getDefaultQmunityLocation(env);

  if (!location) {
    await sendText(
      env,
      customerId,
      "Sorry, the queue reporting system is not available right now. Please try again later."
    );
    return;
  }

  const maxCap = location.max_capacity || 25;

  await sendText(
    env,
    customerId,
    `🙏 *Thanks for helping the community!*

📍 Home Affairs Q-mmunity

*How long is the queue right now?*

Reply with the last number you see (1 to ${maxCap})`
  );

  await setState(env, customerId, "qmunity_awaiting_queue_number", 1);
}

// Handle queue number input
async function handleQmunityQueueNumber(env, customerId, rawText) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "qmunity_awaiting_queue_number") return false;

  const location = await getDefaultQmunityLocation(env);
  if (!location) {
    await sendText(env, customerId, "System error. Please try again later.");
    await clearState(env, customerId);
    return true;
  }

  const maxCap = location.max_capacity || 25;

  // Parse the queue number from text (e.g., "11", "I'm number 11", "number 11")
  const numMatch = rawText.match(/(\d+)/);
  if (!numMatch) {
    await sendText(
      env,
      customerId,
      `Please send a number from 1 to ${maxCap}.`
    );
    return true;
  }

  const queueNumber = parseInt(numMatch[1], 10);

  if (queueNumber < 1 || queueNumber > maxCap) {
    await sendText(
      env,
      customerId,
      `Please send a number from 1 to ${maxCap}.`
    );
    return true;
  }

  // Save the check-in
  await insertQmunityCheckin(env, location.id, customerId, queueNumber);

  // Calculate capacity percentage
  const capacityPct = Math.round((queueNumber / maxCap) * 100);

  // Send acknowledgement and ask for speed
  await sendInteractiveButtons(
    env,
    customerId,
    `✅ Got it!

Queue is at *#${queueNumber}*
📊 ${capacityPct}% capacity

*How fast is the queue moving?*`,
    [
      { id: "qmunity_speed_quickly", title: "🚀 Quickly" },
      { id: "qmunity_speed_moderately", title: "👍 Moderately" },
      { id: "qmunity_speed_slow", title: "🐢 Slow" },
    ]
  );

  await setState(env, customerId, "qmunity_awaiting_speed", 2);
  return true;
}

// Handle speed button selection
async function handleQmunitySpeedReply(env, customerId, replyId) {
  const location = await getDefaultQmunityLocation(env);

  // Map reply ID to speed value
  const speedMap = {
    qmunity_speed_quickly: "QUICKLY",
    qmunity_speed_moderately: "MODERATELY",
    qmunity_speed_slow: "SLOW",
  };

  const speed = speedMap[replyId];
  if (!speed) return false;

  if (location) {
    await insertQmunitySpeedReport(env, location.id, customerId, speed);
  }

  const dashUrl = getQmunityDashboardUrl(env);

  await sendInteractiveButtons(
    env,
    customerId,
    `🎉 *Thanks for the update!*

📊 See the live queue status:
${dashUrl}

*Anything else to report?*`,
    [
      { id: "qmunity_report_issue", title: "⚠️ Report Issue" },
      { id: "qmunity_done", title: "✅ All Done" },
    ]
  );

  await setState(env, customerId, "qmunity_awaiting_issue", 3);
  return true;
}

// Handle ISSUE - prompt user for their issue
async function promptQmunityIssue(env, customerId) {
  await sendText(
    env,
    customerId,
    `⚠️ *Report an Issue*

What would you like to report?

Just type your message and send it.`
  );
  await setState(env, customerId, "qmunity_typing_issue", 4);
  return true;
}

// Handle the actual issue text submission
async function handleQmunityIssueText(env, customerId, issueMessage) {
  const location = await getDefaultQmunityLocation(env);

  if (issueMessage.length < 3) {
    await sendText(
      env,
      customerId,
      "Please provide more details about the issue."
    );
    return true;
  }

  if (location) {
    await insertQmunityIssue(env, location.id, customerId, issueMessage);
  }

  const dashUrl = getQmunityDashboardUrl(env);

  await sendText(
    env,
    customerId,
    `🙏 *Thanks for reporting!*

Your feedback helps the community.

📊 View the queue status:
${dashUrl}`
  );

  await clearState(env, customerId);
  return true;
}

// Handle DONE in qmunity flow
async function handleQmunityDone(env, customerId) {
  const st = await getState(env, customerId);
  if (!st.active_flow?.startsWith("qmunity_")) return false;

  const dashUrl = getQmunityDashboardUrl(env);

  await sendText(
    env,
    customerId,
    `✅ *All done!*

Thanks for helping the community! 🙏

📊 Check the queue anytime:
${dashUrl}`
  );

  await clearState(env, customerId);
  return true;
}

// ---------- BUDGET TRACKER: Dual-Mode WhatsApp Budget Tracker ----------
// Isolated module: does NOT touch any existing flows.
// Trigger: "budget" / "budget status"
// States: budget_select_mode, budget_full_1..4, budget_limit_1..2,
//         budget_log_amount, budget_log_category, budget_log_note, budget_log_another

// --- Budget: HCM timezone helpers ---

function getBudgetHCMDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const hcm = new Date(utc + (3600000 * 7));
  return hcm;
}

function getBudgetDateISO() {
  const hcm = getBudgetHCMDate();
  const y = hcm.getFullYear();
  const m = String(hcm.getMonth() + 1).padStart(2, "0");
  const d = String(hcm.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getBudgetMonthLabel() {
  const hcm = getBudgetHCMDate();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[hcm.getMonth()]} ${hcm.getFullYear()}`;
}

function getBudgetMonthInfo() {
  const hcm = getBudgetHCMDate();
  const year = hcm.getFullYear();
  const month = hcm.getMonth(); // 0-indexed
  const day = hcm.getDate();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysElapsed = day;
  const daysRemaining = totalDays - day;
  const firstDay = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { year, month, day, totalDays, daysElapsed, daysRemaining, firstDay };
}

function formatVND(n) {
  if (n == null) return "0 \u20ab";
  const abs = Math.abs(Number(n));
  const formatted = abs.toLocaleString("en-US").replace(/,/g, ",");
  const sign = Number(n) < 0 ? "-" : "";
  return `${sign}${formatted} \u20ab`;
}

function parseVND(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d]/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

// --- Budget: DB helpers ---

async function getBudgetProfile(env, waFrom) {
  return await sbSelectOne(
    env,
    "budget_profiles",
    `wa_from=eq.${encodeURIComponent(waFrom)}`,
    "id,wa_from,mode,total_budget_vnd,fixed_costs_vnd,savings_goal_vnd,discretionary_budget_vnd,available_budget_vnd,created_at,updated_at,timezone,reminders_enabled,last_user_message_at,last_expense_log_at,last_log_date,current_streak,longest_streak,on_track_streak,last_on_track_date,last_micro_reward_date"
  );
}

async function upsertBudgetProfile(env, waFrom, fields) {
  const now = new Date().toISOString();
  const payload = {
    wa_from: waFrom,
    updated_at: now,
    ...fields,
  };
  await sbUpsert(env, "budget_profiles", [payload], "wa_from");
}

async function saveBudgetCategories(env, waFrom, categories) {
  // Delete existing categories for this user first
  const { url } = getSupabaseConfig(env);
  await fetch(
    `${url}/rest/v1/budget_categories?wa_from=eq.${encodeURIComponent(waFrom)}`,
    {
      method: "DELETE",
      headers: sbHeaders(env),
    }
  );
  // Insert new ones
  if (categories.length > 0) {
    const rows = categories.map((c) => ({
      wa_from: waFrom,
      category_name: c.trim(),
    }));
    await sbInsert(env, "budget_categories", rows);
  }
}

async function getBudgetCategories(env, waFrom) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/budget_categories?wa_from=eq.${encodeURIComponent(waFrom)}&select=category_name`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((r) => r.category_name);
}

async function saveBudgetExpense(env, waFrom, amountVnd, category, note) {
  const expenseDate = getBudgetDateISO();
  const row = {
    wa_from: waFrom,
    amount_vnd: amountVnd,
    category: category,
    note: note || null,
    expense_date: expenseDate,
  };
  await sbInsert(env, "budget_expenses", [row]);
}

async function getMonthlyExpenses(env, waFrom) {
  const { firstDay } = getBudgetMonthInfo();
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/budget_expenses?wa_from=eq.${encodeURIComponent(waFrom)}&expense_date=gte.${firstDay}&select=amount_vnd,category`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) return [];
  return await res.json();
}

// --- Budget: Gamification helpers ---

// Timezone-aware date helpers

function getBudgetUserDate(timezone) {
  const tz = timezone || "Asia/Ho_Chi_Minh";
  const offsets = {
    "Asia/Ho_Chi_Minh": 7, "Asia/Bangkok": 7, "Asia/Jakarta": 7,
    "Asia/Tokyo": 9, "Asia/Seoul": 9, "Asia/Shanghai": 8,
    "Asia/Singapore": 8, "Asia/Kolkata": 5.5, "UTC": 0,
    "Europe/London": 0, "Europe/Berlin": 1, "America/New_York": -5,
    "America/Los_Angeles": -8,
  };
  const offsetHours = offsets[tz] !== undefined ? offsets[tz] : 7;
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * offsetHours));
}

function getBudgetUserDateISO(timezone) {
  const d = getBudgetUserDate(timezone);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getBudgetUserHour(timezone) {
  return getBudgetUserDate(timezone).getHours();
}

// Badge system

const BADGE_INFO = {
  STARTER_7:  { emoji: "\ud83c\udf1f", label: "7-Day Starter" },
  SOLID_30:   { emoji: "\ud83d\udcaa", label: "30-Day Solid" },
  ELITE_90:   { emoji: "\ud83c\udfc6", label: "90-Day Elite" },
  SAVER_1M:   { emoji: "\ud83d\udcb0", label: "1-Month Saver" },
  COMEBACK:   { emoji: "\ud83d\udd25", label: "Comeback Kid" },
};

async function getBudgetBadges(env, waFrom) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/budget_badges?wa_from=eq.${encodeURIComponent(waFrom)}&select=badge_code`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((r) => r.badge_code);
}

async function awardBadge(env, waFrom, badgeCode) {
  await sbUpsert(env, "budget_badges", [{ wa_from: waFrom, badge_code: badgeCode }], ["wa_from", "badge_code"]);
}

function checkBadgeEligibility(profile, existingBadges) {
  const newBadges = [];
  const streak = profile.current_streak || 0;
  const has = (code) => existingBadges.includes(code);

  if (streak >= 7 && !has("STARTER_7")) newBadges.push("STARTER_7");
  if (streak >= 30 && !has("SOLID_30")) newBadges.push("SOLID_30");
  if (streak >= 90 && !has("ELITE_90")) newBadges.push("ELITE_90");
  if ((profile.on_track_streak || 0) >= 30 && !has("SAVER_1M")) newBadges.push("SAVER_1M");

  return newBadges;
}

// Streak computation (pure functions)

function computeStreakUpdate(profile, todayISO) {
  const lastLog = profile.last_log_date;
  if (!lastLog) {
    return { current_streak: 1, longest_streak: Math.max(1, profile.longest_streak || 0), last_log_date: todayISO };
  }
  if (lastLog === todayISO) {
    return null; // already logged today
  }
  const last = new Date(lastLog + "T00:00:00Z");
  const today = new Date(todayISO + "T00:00:00Z");
  const diffDays = Math.round((today - last) / 86400000);

  if (diffDays === 1) {
    const newStreak = (profile.current_streak || 0) + 1;
    return {
      current_streak: newStreak,
      longest_streak: Math.max(newStreak, profile.longest_streak || 0),
      last_log_date: todayISO,
    };
  }
  return { current_streak: 1, longest_streak: Math.max(1, profile.longest_streak || 0), last_log_date: todayISO };
}

function computeOnTrackUpdate(profile, totalSpentThisMonth, todayISO, monthInfo) {
  let trackedBudget = 0;
  if (profile.mode === "full") {
    trackedBudget = Number(profile.discretionary_budget_vnd) || 0;
  } else {
    trackedBudget = Number(profile.available_budget_vnd) || 0;
  }
  const idealSpend = trackedBudget > 0 ? (trackedBudget / monthInfo.totalDays) * monthInfo.daysElapsed : 0;
  const onTrack = totalSpentThisMonth <= idealSpend;

  if (!onTrack) {
    return { on_track_streak: 0, last_on_track_date: null };
  }

  const lastOTDate = profile.last_on_track_date;
  if (!lastOTDate) {
    return { on_track_streak: 1, last_on_track_date: todayISO };
  }
  if (lastOTDate === todayISO) {
    return null; // already computed today
  }
  const last = new Date(lastOTDate + "T00:00:00Z");
  const today = new Date(todayISO + "T00:00:00Z");
  const diffDays = Math.round((today - last) / 86400000);

  if (diffDays === 1) {
    return { on_track_streak: (profile.on_track_streak || 0) + 1, last_on_track_date: todayISO };
  }
  return { on_track_streak: 1, last_on_track_date: todayISO };
}

// Micro-rewards

function shouldSendMicroReward(profile, todayISO, context) {
  if (profile.last_micro_reward_date === todayISO) return null; // max 1/day
  const pool = [];
  if (context.logsToday >= 3) pool.push("\ud83d\udd25 Three logs today \u2014 you\u2019re on fire!");
  if (context.isWeekend) pool.push("\ud83c\udf1e Weekend logging = elite mindset. Most people skip weekends.");
  if (context.isComeback) pool.push("\ud83d\udc4b You\u2019re back! That\u2019s what matters.");
  if (context.newStreakMilestone) pool.push("\ud83c\udf89 New streak milestone! You\u2019re building a real habit.");
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Re-engagement & nudges

function shouldShowReengagement(profile, nowUTC) {
  if (!profile.reminders_enabled) return false;
  if (!profile.last_user_message_at) return false;
  const lastMsg = new Date(profile.last_user_message_at).getTime();
  const hoursSince = (nowUTC - lastMsg) / 3600000;
  if (hoursSince < 24) return false;
  const localHour = getBudgetUserHour(profile.timezone);
  return localHour >= 7 && localHour <= 21;
}

async function buildReengagementSummary(env, waFrom, profile) {
  const expenses = await getMonthlyExpenses(env, waFrom);
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount_vnd), 0);
  const trackedBudget = profile.mode === "full"
    ? Number(profile.discretionary_budget_vnd) || 0
    : Number(profile.available_budget_vnd) || 0;
  const remaining = trackedBudget - totalSpent;
  const pct = trackedBudget > 0 ? Math.round((totalSpent / trackedBudget) * 100) : 0;
  const monthLabel = getBudgetMonthLabel();
  const { daysRemaining } = getBudgetMonthInfo();
  const dailyLeft = daysRemaining > 0 ? Math.round(remaining / daysRemaining) : 0;

  return `\ud83c\udf05 *Good morning!*

Here\u2019s your budget so far \ud83d\udc47

\ud83d\udcb0 Budget: ${formatVND(trackedBudget)}
\ud83d\udcc9 Spent: ${formatVND(totalSpent)} (${pct}%)
\ud83d\udcbc Remaining: ${formatVND(remaining)}
\u23f1 ~${formatVND(dailyLeft)} / day for ${daysRemaining} days

\ud83d\udcdd Log today\u2019s spending:
Reply *budget*`;
}

function buildLossAversionNudge(oldStreak) {
  return `\u26a0\ufe0f Your *${oldStreak}-day streak* was lost! But you\u2019re back \u2014 log an expense to start rebuilding \ud83d\udcaa`;
}

// Daily expense count helper

async function getTodayExpenseCount(env, waFrom, todayISO) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/budget_expenses?wa_from=eq.${encodeURIComponent(waFrom)}&expense_date=eq.${todayISO}&select=id`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) return 0;
  const data = await res.json();
  return data.length;
}

// --- Budget: Lazy evaluation orchestration ---

async function budgetLazyCheck(env, waFrom) {
  const profile = await getBudgetProfile(env, waFrom);
  if (!profile) return;

  const nowUTC = Date.now();
  const todayISO = getBudgetUserDateISO(profile.timezone);
  const monthInfo = getBudgetMonthInfo();
  const notifications = [];

  // 1. Re-engagement summary (lazy reminder)
  if (shouldShowReengagement(profile, nowUTC)) {
    const summary = await buildReengagementSummary(env, waFrom, profile);
    notifications.push(summary);
  }

  // 2. Loss aversion nudge: had streak >= 3, missed a day
  if (profile.last_log_date && profile.last_log_date !== todayISO) {
    const last = new Date(profile.last_log_date + "T00:00:00Z");
    const today = new Date(todayISO + "T00:00:00Z");
    const diffDays = Math.round((today - last) / 86400000);
    if (diffDays > 1 && (profile.current_streak || 0) >= 3) {
      notifications.push(buildLossAversionNudge(profile.current_streak));
      // Award COMEBACK badge
      const badges = await getBudgetBadges(env, waFrom);
      if (!badges.includes("COMEBACK")) {
        await awardBadge(env, waFrom, "COMEBACK");
        const info = BADGE_INFO.COMEBACK;
        notifications.push(`${info.emoji} *Badge earned: ${info.label}!*\nYou came back after a break. Resilience matters!`);
      }
    }
  }

  // 3. On-track streak update
  const expenses = await getMonthlyExpenses(env, waFrom);
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount_vnd), 0);
  const otUpdate = computeOnTrackUpdate(profile, totalSpent, todayISO, monthInfo);
  if (otUpdate) {
    await upsertBudgetProfile(env, waFrom, otUpdate);
  }

  // 4. Badge check
  const currentBadges = await getBudgetBadges(env, waFrom);
  const freshProfile = otUpdate ? { ...profile, ...otUpdate } : profile;
  const newBadges = checkBadgeEligibility(freshProfile, currentBadges);
  for (const code of newBadges) {
    await awardBadge(env, waFrom, code);
    const info = BADGE_INFO[code];
    notifications.push(`${info.emoji} *Badge earned: ${info.label}!*`);
  }

  // 5. Send all notifications as one message
  if (notifications.length > 0) {
    await sendText(env, waFrom, notifications.join("\n\n---\n\n"));
  }

  // 6. Update last_user_message_at
  await upsertBudgetProfile(env, waFrom, { last_user_message_at: new Date().toISOString() });
}

// --- Budget: Post-expense hook ---

async function budgetPostExpenseHook(env, waFrom) {
  const profile = await getBudgetProfile(env, waFrom);
  if (!profile) return;

  const todayISO = getBudgetUserDateISO(profile.timezone);
  const now = new Date().toISOString();

  // 1. Update logging streak
  const streakUpdate = computeStreakUpdate(profile, todayISO);
  const patch = { last_expense_log_at: now };
  if (streakUpdate) {
    Object.assign(patch, streakUpdate);
  }
  await upsertBudgetProfile(env, waFrom, patch);

  // 2. Micro-reward check
  const logsToday = await getTodayExpenseCount(env, waFrom, todayISO);
  const dayOfWeek = getBudgetUserDate(profile.timezone).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isComeback = streakUpdate && streakUpdate.current_streak === 1 && (profile.current_streak || 0) >= 3;
  const newStreakMilestone = streakUpdate && [7, 14, 21, 30, 60, 90].includes(streakUpdate.current_streak);

  const rewardMsg = shouldSendMicroReward(profile, todayISO, {
    logsToday,
    isWeekend,
    isComeback,
    newStreakMilestone,
  });

  if (rewardMsg) {
    await sendText(env, waFrom, rewardMsg);
    await upsertBudgetProfile(env, waFrom, { last_micro_reward_date: todayISO });
  }
}

// --- Budget: Reminder toggle handler ---

async function handleBudgetToggleReminders(env, waFrom, enabled) {
  const profile = await getBudgetProfile(env, waFrom);
  if (!profile) {
    await sendText(env, waFrom, "You don\u2019t have a budget set up yet.\n\nReply *budget* to get started.");
    return;
  }
  await upsertBudgetProfile(env, waFrom, { reminders_enabled: enabled });
  const msg = enabled
    ? "\u2705 Budget reminders *resumed*. I\u2019ll check in when you\u2019ve been away for a day."
    : "\u23f8\ufe0f Budget reminders *paused*. Reply *resume reminders* to turn them back on.";
  await sendText(env, waFrom, msg);
}

// --- Budget: Flow handlers ---

async function startBudgetFlow(env, customerId) {
  // Check if profile exists
  const profile = await getBudgetProfile(env, customerId);

  if (profile) {
    // Profile exists -> go to expense logging
    await startBudgetExpenseLog(env, customerId);
  } else {
    // No profile -> show mode selector
    await sendText(
      env,
      customerId,
      `\ud83d\udcb8 *Budget Setup*

Choose how you'd like to track your money:

1\ufe0f\u20e3 *Full Monthly Budget*
Track income, fixed costs, savings, and spending.

2\ufe0f\u20e3 *Spending Limit Mode*
For when you only have a set amount left this month
and want to make sure you don't overspend.

Reply 1 or 2 \ud83d\udc47`
    );
    await setState(env, customerId, "budget_select_mode", 0);
  }
}

async function handleBudgetSelectMode(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_select_mode") return false;

  const choice = raw.trim();

  if (choice === "1") {
    // Mode A: Full Monthly Budget
    await sendText(
      env,
      customerId,
      `\ud83d\udcca *Full Monthly Budget Setup*

Step 1 of 4:
What is your *total monthly income* (VND)?

e.g. 40000000`
    );
    await setState(env, customerId, "budget_full_1", 0);
    return true;
  }

  if (choice === "2") {
    // Mode B: Spending Limit
    await sendText(
      env,
      customerId,
      `\ud83d\udcb0 *Spending Limit Setup*

Step 1 of 2:
What is your *available spending money* for this month (VND)?

e.g. 5000000`
    );
    await setState(env, customerId, "budget_limit_1", 0);
    return true;
  }

  await sendText(env, customerId, "Please reply *1* or *2* to choose a mode.");
  return true;
}

// --- Mode A: Full Monthly Budget Onboarding (4 steps) ---

async function handleBudgetFull1(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_full_1") return false;

  const amount = parseVND(raw);
  if (!amount) {
    await sendText(env, customerId, "Please enter a valid amount in VND (numbers only).\ne.g. 40000000");
    return true;
  }

  // Save total budget, move to step 2
  await upsertBudgetProfile(env, customerId, {
    mode: "full",
    total_budget_vnd: amount,
  });

  await sendText(
    env,
    customerId,
    `\u2705 Total income: ${formatVND(amount)}

Step 2 of 4:
What are your *total fixed costs* per month (VND)?
(rent, bills, subscriptions, etc.)

e.g. 15000000`
  );
  await setState(env, customerId, "budget_full_2", 0);
  return true;
}

async function handleBudgetFull2(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_full_2") return false;

  const amount = parseVND(raw);
  if (!amount) {
    await sendText(env, customerId, "Please enter a valid amount in VND.\ne.g. 15000000");
    return true;
  }

  await upsertBudgetProfile(env, customerId, {
    mode: "full",
    fixed_costs_vnd: amount,
  });

  await sendText(
    env,
    customerId,
    `\u2705 Fixed costs: ${formatVND(amount)}

Step 3 of 4:
How much do you want to *save* this month (VND)?

e.g. 5000000`
  );
  await setState(env, customerId, "budget_full_3", 0);
  return true;
}

async function handleBudgetFull3(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_full_3") return false;

  const amount = parseVND(raw);
  if (!amount) {
    await sendText(env, customerId, "Please enter a valid amount in VND.\ne.g. 5000000");
    return true;
  }

  // Calculate discretionary
  const profile = await getBudgetProfile(env, customerId);
  const total = profile?.total_budget_vnd || 0;
  const fixed = profile?.fixed_costs_vnd || 0;
  const discretionary = Math.max(0, total - fixed - amount);

  await upsertBudgetProfile(env, customerId, {
    mode: "full",
    savings_goal_vnd: amount,
    discretionary_budget_vnd: discretionary,
  });

  await sendText(
    env,
    customerId,
    `\u2705 Savings goal: ${formatVND(amount)}

\ud83d\udcca *Your discretionary budget:*
${formatVND(total)} - ${formatVND(fixed)} - ${formatVND(amount)} = *${formatVND(discretionary)}*

Step 4 of 4:
List your *spending categories* (comma-separated).

e.g. Food, Transport, Fun, Kids, Health`
  );
  await setState(env, customerId, "budget_full_4", 0);
  return true;
}

async function handleBudgetFull4(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_full_4") return false;

  const categories = raw.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  if (categories.length === 0) {
    await sendText(env, customerId, "Please enter at least one category.\ne.g. Food, Transport, Fun");
    return true;
  }

  await saveBudgetCategories(env, customerId, categories);

  const profile = await getBudgetProfile(env, customerId);

  await sendText(
    env,
    customerId,
    `\u2705 *Budget Setup Complete!*

\ud83d\udcca Mode: Full Monthly Budget
\ud83d\udcb0 Income: ${formatVND(profile?.total_budget_vnd)}
\ud83c\udfe0 Fixed costs: ${formatVND(profile?.fixed_costs_vnd)}
\ud83d\udcb3 Savings: ${formatVND(profile?.savings_goal_vnd)}
\ud83d\udcb8 Discretionary: ${formatVND(profile?.discretionary_budget_vnd)}
\ud83d\udcc1 Categories: ${categories.join(", ")}

Reply *budget* to log an expense.
Reply *budget status* anytime for your dashboard.`
  );
  await clearState(env, customerId);
  return true;
}

// --- Mode B: Spending Limit Onboarding (2 steps) ---

async function handleBudgetLimit1(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_limit_1") return false;

  const amount = parseVND(raw);
  if (!amount) {
    await sendText(env, customerId, "Please enter a valid amount in VND.\ne.g. 5000000");
    return true;
  }

  await upsertBudgetProfile(env, customerId, {
    mode: "limit",
    available_budget_vnd: amount,
  });

  await sendText(
    env,
    customerId,
    `\u2705 Available budget: ${formatVND(amount)}

Step 2 of 2:
List your *spending categories* (comma-separated).

e.g. Food, Transport, Fun, Kids, Health`
  );
  await setState(env, customerId, "budget_limit_2", 0);
  return true;
}

async function handleBudgetLimit2(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_limit_2") return false;

  const categories = raw.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  if (categories.length === 0) {
    await sendText(env, customerId, "Please enter at least one category.\ne.g. Food, Transport, Fun");
    return true;
  }

  await saveBudgetCategories(env, customerId, categories);

  const profile = await getBudgetProfile(env, customerId);

  await sendText(
    env,
    customerId,
    `\u2705 *Budget Setup Complete!*

\ud83d\udcb0 Mode: Spending Limit
\ud83d\udcb8 Available: ${formatVND(profile?.available_budget_vnd)}
\ud83d\udcc1 Categories: ${categories.join(", ")}

Reply *budget* to log an expense.
Reply *budget status* anytime for your dashboard.`
  );
  await clearState(env, customerId);
  return true;
}

// --- Expense Logging Flow ---

async function startBudgetExpenseLog(env, customerId) {
  await sendText(
    env,
    customerId,
    `\ud83d\udcb8 *Log Expense*

How much did you spend? (VND)

e.g. 150000`
  );
  await setState(env, customerId, "budget_log_amount", 0);
}

async function handleBudgetLogAmount(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_log_amount") return false;

  const amount = parseVND(raw);
  if (!amount) {
    await sendText(env, customerId, "Please enter a valid amount in VND.\ne.g. 150000");
    return true;
  }

  // Store amount temporarily in step field (we'll use step as the amount)
  // To pass amount between steps, we store it in the profile's updated_at hack
  // Actually, let's use a simpler approach: store pending expense amount in conversation_state step
  // step will hold the amount as a number
  await setState(env, customerId, "budget_log_category", amount);

  const categories = await getBudgetCategories(env, customerId);
  const catList = categories.length > 0
    ? categories.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "No categories set up. Type your category name.";

  await sendText(
    env,
    customerId,
    `\u2705 Amount: ${formatVND(amount)}

Which category?

${catList}

Reply with the *number* or *name*.`
  );
  return true;
}

async function handleBudgetLogCategory(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_log_category") return false;

  const amount = st.step; // Amount stored in step field
  const categories = await getBudgetCategories(env, customerId);

  let selectedCategory = raw.trim();

  // Check if user typed a number
  const num = parseInt(raw.trim(), 10);
  if (!isNaN(num) && num >= 1 && num <= categories.length) {
    selectedCategory = categories[num - 1];
  } else {
    // Check if it matches a category name (case-insensitive)
    const match = categories.find(
      (c) => c.toLowerCase() === raw.trim().toLowerCase()
    );
    if (match) {
      selectedCategory = match;
    }
  }

  // Store category and amount together: use step as a combined value
  // We'll encode amount|category in the active_flow suffix
  // Actually simpler: store amount in step, category will be passed to note step
  // Let's use a JSON-encoded step approach by using the active_flow to carry data

  // Use active_flow = "budget_log_note" and step = amount
  // Store category in a temp approach: we'll set the flow to budget_log_note_{encodedCategory}
  // But that's fragile. Better: store pending data in budget_profiles as a JSON field.
  // Simplest: encode amount and category in flow name.

  // Cleanest approach: use budget_log_note as flow, and store {amount, category} encoded in step.
  // Since step is a number, we can't. Let's use the flow name to carry category.
  // Flow: budget_log_note and step = amount. Category stored via setState with a special flow name.

  // Most pragmatic: save expense immediately without note, then ask for note as optional update.
  // OR: just chain through — save partial data to a pending field.

  // Let's use the cleanest approach consistent with the codebase:
  // Store pending expense data in budget_profiles.updated_at as a temp JSON? No, that's bad.
  // Best: just save the expense now with no note, then prompt for an optional note,
  // and UPDATE the last expense if user provides one.

  // Save expense immediately
  await saveBudgetExpense(env, customerId, amount, selectedCategory, null);

  // Post-expense hook: update streaks, check micro-rewards
  await budgetPostExpenseHook(env, customerId);

  // Fetch updated profile for streak display
  const updatedProfile = await getBudgetProfile(env, customerId);
  const streakLine = (updatedProfile?.current_streak || 0) > 1
    ? `\n\ud83d\udd25 Streak: ${updatedProfile.current_streak} days`
    : "";

  await sendText(
    env,
    customerId,
    `\u2705 Logged: ${formatVND(amount)} \u2192 *${selectedCategory}*${streakLine}

Add an optional note? (or reply *skip*)

e.g. Lunch with team`
  );

  // Store a reference: we use step=0 for budget_log_note to indicate "update last expense"
  await setState(env, customerId, "budget_log_note", 0);
  return true;
}

async function handleBudgetLogNote(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_log_note") return false;

  const token = raw.trim().toUpperCase();

  if (token !== "SKIP" && raw.trim().length > 0) {
    // Update the most recent expense with the note
    const { url } = getSupabaseConfig(env);
    // Get last expense for this user
    const lastExpense = await sbSelectOne(
      env,
      "budget_expenses",
      `wa_from=eq.${encodeURIComponent(customerId)}&order=created_at.desc`,
      "id"
    );
    if (lastExpense?.id) {
      await sbUpdate(
        env,
        "budget_expenses",
        `id=eq.${encodeURIComponent(lastExpense.id)}`,
        { note: raw.trim() }
      );
    }
  }

  await sendText(
    env,
    customerId,
    `\u2705 Expense saved!

Log another? Reply *yes* or *no*.`
  );
  await setState(env, customerId, "budget_log_another", 0);
  return true;
}

async function handleBudgetLogAnother(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "budget_log_another") return false;

  const token = raw.trim().toUpperCase();

  if (token === "YES" || token === "Y") {
    await startBudgetExpenseLog(env, customerId);
    return true;
  }

  // Show quick summary then exit
  const profile = await getBudgetProfile(env, customerId);
  const expenses = await getMonthlyExpenses(env, customerId);
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount_vnd), 0);

  let tracked = 0;
  if (profile?.mode === "full") {
    tracked = profile.discretionary_budget_vnd || 0;
  } else if (profile?.mode === "limit") {
    tracked = profile.available_budget_vnd || 0;
  }

  const remaining = tracked - totalSpent;
  const pct = tracked > 0 ? Math.round((totalSpent / tracked) * 100) : 0;
  const streakNote = (profile?.current_streak || 0) > 1 ? ` | \ud83d\udd25 ${profile.current_streak}-day streak` : "";

  await sendText(
    env,
    customerId,
    `\ud83d\udc4d Done!

\ud83d\udcb0 Spent this month: ${formatVND(totalSpent)} (${pct}%)${streakNote}
\ud83d\udcbc Remaining: ${formatVND(remaining)}

Reply *budget* to log more.
Reply *budget status* for full dashboard.`
  );
  await clearState(env, customerId);
  return true;
}

// --- Budget Status Command ---

async function handleBudgetStatus(env, customerId) {
  const profile = await getBudgetProfile(env, customerId);

  if (!profile) {
    await sendText(
      env,
      customerId,
      `You don't have a budget set up yet.

Reply *budget* to get started.`
    );
    return;
  }

  const expenses = await getMonthlyExpenses(env, customerId);
  const monthLabel = getBudgetMonthLabel();
  const { totalDays, daysElapsed, daysRemaining } = getBudgetMonthInfo();

  // Determine tracked budget
  let trackedBudget = 0;
  if (profile.mode === "full") {
    trackedBudget = Number(profile.discretionary_budget_vnd) || 0;
  } else {
    trackedBudget = Number(profile.available_budget_vnd) || 0;
  }

  // Calculate totals
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount_vnd), 0);
  const remaining = trackedBudget - totalSpent;
  const percentUsed = trackedBudget > 0 ? Math.round((totalSpent / trackedBudget) * 100) : 0;

  // Pace analysis
  const idealDaily = totalDays > 0 ? trackedBudget / totalDays : 0;
  const actualDaily = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
  const dailyVariance = actualDaily - idealDaily;
  const weeklyVariance = dailyVariance * 7;

  // Pace emoji and message
  let paceMsg = "";
  if (dailyVariance > 0) {
    paceMsg = `\u26a0\ufe0f Over target by:
+${formatVND(Math.round(dailyVariance))} / day
+${formatVND(Math.round(weeklyVariance))} / week`;
  } else if (dailyVariance < 0) {
    paceMsg = `\u2705 Under target by:
${formatVND(Math.round(Math.abs(dailyVariance)))} / day
${formatVND(Math.round(Math.abs(weeklyVariance)))} / week`;
  } else {
    paceMsg = `\u2705 Right on target!`;
  }

  // Top categories
  const catTotals = {};
  for (const e of expenses) {
    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount_vnd);
  }
  const sorted = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let catMsg = "";
  if (sorted.length > 0) {
    catMsg = sorted
      .map(([cat, amt]) => {
        const pct = totalSpent > 0 ? Math.round((amt / totalSpent) * 100) : 0;
        return `- ${cat}: ${pct}%`;
      })
      .join("\n");
  } else {
    catMsg = "- No expenses logged yet.";
  }

  // Gamification section
  const badges = await getBudgetBadges(env, customerId);
  const streakSection = `\ud83d\udd25 *Streaks*
- Logging: ${profile.current_streak || 0} day${(profile.current_streak || 0) !== 1 ? "s" : ""} (best: ${profile.longest_streak || 0})
- On-track: ${profile.on_track_streak || 0} day${(profile.on_track_streak || 0) !== 1 ? "s" : ""}`;

  const badgeSection = badges.length > 0
    ? `\n\n\ud83c\udfc5 *Badges* (${badges.length})\n` + badges.map((b) => `${BADGE_INFO[b]?.emoji || "\ud83c\udfc5"} ${BADGE_INFO[b]?.label || b}`).join(" | ")
    : "";

  const summary = `\ud83d\udcca *Budget Status (${monthLabel})*

\ud83d\udcb0 Budget: ${formatVND(trackedBudget)}
\ud83d\udcc9 Spent: ${formatVND(totalSpent)} (${percentUsed}%)
\ud83d\udcbc Remaining: ${formatVND(remaining)}

\u23f1 *Spending Pace*
${paceMsg}

\ud83d\udcca *Top Categories*
${catMsg}

${streakSection}${badgeSection}

Reply *budget* to log more.
Reply *budget status* anytime.`;

  await sendText(env, customerId, summary);
}

// --- Budget: Cancel / Restart ---

function isBudgetFlow(flow) {
  return flow && flow.startsWith("budget_");
}

async function handleBudgetCancel(env, customerId) {
  const st = await getState(env, customerId);
  if (!isBudgetFlow(st.active_flow)) return false;

  await sendText(
    env,
    customerId,
    `\u274c Budget flow cancelled.

Reply *budget* to start again.`
  );
  await clearState(env, customerId);
  return true;
}

async function handleBudgetRestart(env, customerId) {
  const st = await getState(env, customerId);
  if (!isBudgetFlow(st.active_flow)) return false;

  // Delete profile to force fresh setup
  const { url } = getSupabaseConfig(env);
  await fetch(
    `${url}/rest/v1/budget_profiles?wa_from=eq.${encodeURIComponent(customerId)}`,
    {
      method: "DELETE",
      headers: sbHeaders(env),
    }
  );
  await fetch(
    `${url}/rest/v1/budget_categories?wa_from=eq.${encodeURIComponent(customerId)}`,
    {
      method: "DELETE",
      headers: sbHeaders(env),
    }
  );

  await clearState(env, customerId);
  await startBudgetFlow(env, customerId);
  return true;
}

// --- Budget: Master text handler (routes to correct sub-handler) ---

async function handleBudgetText(env, customerId, raw) {
  const st = await getState(env, customerId);
  if (!isBudgetFlow(st.active_flow)) return false;

  // Lazy evaluation check on any budget interaction
  await budgetLazyCheck(env, customerId);

  const token = raw.trim().toUpperCase();

  // Handle cancel/restart from any budget state
  if (token === "CANCEL") {
    return await handleBudgetCancel(env, customerId);
  }
  if (token === "RESTART") {
    return await handleBudgetRestart(env, customerId);
  }

  // Route to the correct handler based on current state
  switch (st.active_flow) {
    case "budget_select_mode":
      return await handleBudgetSelectMode(env, customerId, raw);
    case "budget_full_1":
      return await handleBudgetFull1(env, customerId, raw);
    case "budget_full_2":
      return await handleBudgetFull2(env, customerId, raw);
    case "budget_full_3":
      return await handleBudgetFull3(env, customerId, raw);
    case "budget_full_4":
      return await handleBudgetFull4(env, customerId, raw);
    case "budget_limit_1":
      return await handleBudgetLimit1(env, customerId, raw);
    case "budget_limit_2":
      return await handleBudgetLimit2(env, customerId, raw);
    case "budget_log_amount":
      return await handleBudgetLogAmount(env, customerId, raw);
    case "budget_log_category":
      return await handleBudgetLogCategory(env, customerId, raw);
    case "budget_log_note":
      return await handleBudgetLogNote(env, customerId, raw);
    case "budget_log_another":
      return await handleBudgetLogAnother(env, customerId, raw);
    default:
      return false;
  }
}

// ---------- END BUDGET TRACKER ----------

// ---------- STAMP handling ----------

async function handleStamp(env, customerId, token) {
  const st = await getState(env, customerId);
  const inDemoStamp = st.active_flow === "demo_stamp" && st.step === 1;
  const inDemoAfterFirst = st.active_flow === "demo_after_first_stamp";
  const inDemoStreak = st.active_flow === "demo_streak";

  if (!inDemoStamp && !inDemoAfterFirst && !inDemoStreak) {
    if (token !== "STAMP") return false;
  }

  if (token !== "STAMP") {
    await sendText(
      env,
      customerId,
      "To continue the demo, type *STAMP* after your ‘purchase’ ☕️"
    );
    return true;
  }

  const row = await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "number_of_visits"
  );

  const current = row && row.number_of_visits ? Number(row.number_of_visits) : 0;
  const next = current + 1;
  const now = new Date().toISOString();

  await sbUpsert(
    env,
    "customers",
    [
      {
        customer_id: customerId,
        number_of_visits: next,
        last_visit_at: now,
      },
    ],
    "customer_id"
  );

  if (!inDemoStreak) {
    const streakUpdate = await updateStreak(env, customerId);
    await maybeSendStreakMilestones(env, customerId, streakUpdate.streak, streakUpdate);
  }

  const shareLink = buildShareLink(env);

  if (inDemoStreak) {
    const capped = Math.max(1, Math.min(10, next));

    if (next === 5) {
      await sendText(
        env,
        customerId,
        `Great — you’ve unlocked *double stamps*! 🎉🔥

Well done.`
      );
      const streakCardVisits = Math.min(10, next + 1);
      await sendImage(env, customerId, buildCardUrl(env, streakCardVisits));
      await sendInteractiveButtons(
        env,
        customerId,
        `🎉 *Demo complete.*

Here's the link to share the demo:
${shareLink}

What would you like to do next?`,
        [
          { id: "more_features", title: "MORE" },
          { id: "book_meeting", title: "MEETING" },
        ]
      );

      await setState(env, customerId, "demo_complete", 0);
      return true;
    }

    await sendImage(env, customerId, buildCardUrl(env, capped));

    if (next === 2) {
      await sendText(
        env,
        customerId,
        `Wow — you’re on a *2-day streak* 🙌

Hit a *5-day streak* to unlock double stamps 🔥

Send *STAMP* three more times to reach day 5.

_(Reply with stamp, hit send, repeat x3)_`
      );
      await setState(env, customerId, "demo_streak", 2);
    } else if (next === 3 || next === 4) {
      await sendText(env, customerId, "Nice! Keep going — send *STAMP* again.");
      await setState(env, customerId, "demo_streak", next);
    }
    return true;
  }

  const capped = Math.max(1, Math.min(10, next));
  await sendImage(env, customerId, buildCardUrl(env, capped));

  if (next === 1) {
    await sendText(
      env,
      customerId,
      `Thanks for visiting 🙌

Now you’ve got your first stamp.

Want to test more features? Reply *MORE*.

Want to explore how this can be applied to your business? Reply *MEETING*.

`
    );
    await setState(env, customerId, "demo_after_first_stamp", 1);
    return true;
  }

  await sendText(
    env,
    customerId,
    `Thanks for ‘visiting’ 🙌 You now have a stamp on your demo card.

🎉 *Demo complete.* 

Share it with colleagues:
${shareLink}

Want to test more features? 

Reply *MORE*.`
  );

  await setState(env, customerId, "demo_complete", 0);
  return true;
}

// ---------- GET: webhook verification ----------

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken =
    env.VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN || "myverifytoken";

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---------- POST: handle incoming WhatsApp messages ----------

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();

    const entry = data.entry?.[0] || {};
    const changes = entry.changes?.[0] || {};
    const value = changes.value || {};
    const message = value.messages?.[0];

    if (!message) {
      return new Response("ignored", { status: 200 });
    }

    // Only process messages for this phone number (ignore messages for other numbers on same Meta app)
    const recipientPhoneNumberId = value.metadata?.phone_number_id;
    const ourPhoneNumberId = getPhoneNumberId(env);
    if (recipientPhoneNumberId && recipientPhoneNumberId !== ourPhoneNumberId) {
      console.log('[WA-DEMO] Ignoring message for different phone number:', recipientPhoneNumberId);
      return new Response("ok", { status: 200 });
    }

    const msgId = message.id;
    const from = message.from;
    const contacts = value.contacts || [];
    const waName = contacts[0]?.profile?.name || null;

    if (await alreadyProcessed(env, msgId)) {
      return new Response("ok", { status: 200 });
    }
    await markProcessed(env, msgId);

    await upsertCustomer(env, from, waName);

    const type = message.type;

    // Handle audio for log flow FIRST (higher priority)
    if (type === "audio") {
      const session = await getLogSession(env, from);
      if (session && session.status === "awaiting_audio") {
        await handleLogAudio(env, from, message);
        return new Response("ok", { status: 200 });
      }
    }

    if (type === "audio" || type === "image") {
      if (await handleEduMedia(env, from, message)) {
        return new Response("ok", { status: 200 });
      }
    }

    if (type === "interactive") {
      const interactive = message.interactive || {};
      let replyId = null;
      if (interactive.type === "button_reply") {
        replyId = interactive.button_reply?.id;
      } else if (interactive.type === "list_reply") {
        replyId = interactive.list_reply?.id;
      }

      if (replyId && (await handleEduInteractive(env, from, replyId))) {
        return new Response("ok", { status: 200 });
      }

      if (replyId === "connect_meeting") {
        await startMeetingFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId === "connect_demo") {
        await startDemoFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      if (replyId && (await handleMeetingServiceReply(env, from, replyId, waName))) {
        return new Response("ok", { status: 200 });
      }

      if (replyId === "more_streak") {
        await handleStreakCommand(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId === "more_dash") {
        await sendDashboardLink(env, from);
        await clearState(env, from);
        return new Response("ok", { status: 200 });
      }

      // NEW: buttons on the "Demo complete" card
      if (replyId === "more_features") {
        await sendMoreMenu(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId === "book_meeting") {
        await startMeetingFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId && (await handleSignupInteractiveStep2(env, from, replyId))) {
        return new Response("ok", { status: 200 });
      }

      // Qmunity speed buttons
      if (
        replyId === "qmunity_speed_quickly" ||
        replyId === "qmunity_speed_moderately" ||
        replyId === "qmunity_speed_slow"
      ) {
        await handleQmunitySpeedReply(env, from, replyId);
        return new Response("ok", { status: 200 });
      }

      // Qmunity issue/done buttons
      if (replyId === "qmunity_report_issue") {
        await promptQmunityIssue(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId === "qmunity_done") {
        await handleQmunityDone(env, from);
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    if (type === "text") {
      const raw = (message.text?.body || "").trim();
      const token = raw.toUpperCase();

      // Handle LOG command
      if (token === "LOG") {
        await handleLogCommand(env, from);
        return new Response("ok", { status: 200 });
      }

      // Handle BUDGET reminder opt-out controls
      if (token === "PAUSE REMINDERS" || token === "BUDGET PAUSE" || token === "STOP REMINDERS" || token === "BUDGET STOP") {
        await handleBudgetToggleReminders(env, from, false);
        return new Response("ok", { status: 200 });
      }
      if (token === "RESUME REMINDERS" || token === "BUDGET RESUME") {
        await handleBudgetToggleReminders(env, from, true);
        return new Response("ok", { status: 200 });
      }

      // Handle BUDGET STATUS command (must check before BUDGET to avoid partial match)
      if (token === "BUDGET STATUS") {
        await budgetLazyCheck(env, from);
        await handleBudgetStatus(env, from);
        return new Response("ok", { status: 200 });
      }

      // Handle BUDGET command
      if (token === "BUDGET") {
        await budgetLazyCheck(env, from);
        await startBudgetFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      // Handle active budget flow text input
      if (await handleBudgetText(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      // Handle QUEUE command (Qmunity flow) - always starts fresh
      if (token === "QUEUE") {
        await clearState(env, from); // Clear any existing flow
        await startQmunityFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      // Handle queue number input for Qmunity flow
      const qmunityState = await getState(env, from);
      if (qmunityState.active_flow === "qmunity_awaiting_queue_number") {
        if (await handleQmunityQueueNumber(env, from, raw)) {
          return new Response("ok", { status: 200 });
        }
      }

      // Handle issue text input for Qmunity flow
      if (qmunityState.active_flow === "qmunity_typing_issue") {
        await handleQmunityIssueText(env, from, raw);
        return new Response("ok", { status: 200 });
      }

      // Handle DONE command for log flow
      if (token === "DONE") {
        // First check Qmunity flow
        if (await handleQmunityDone(env, from)) {
          return new Response("ok", { status: 200 });
        }
        // Then check log flow
        if (await handleLogDone(env, from)) {
          return new Response("ok", { status: 200 });
        }
      }

      if (token === "SIGNUP" || token === "SIGN UP") {
        await resetVisitCount(env, from);
        await resetStreakState(env, from);
        await clearState(env, from);
        await startSignupFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      if (token === "DEMO") {
        await startDemoFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      if (token === "EDUSAFE") {
        await clearState(env, from);
        await startEduSafeFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      if (await handleEduMedia(env, from, message)) {
        return new Response("ok", { status: 200 });
      }

      if (await handleMeetingTimeText(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      if (await handleMeetingEmailText(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      if (token === "CONNECT") {
        await sendConnectMenu(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      if (token === "MEETING") {
        await startMeetingFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      if (await handleSignupTextStep1(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      if (token === "MORE") {
        await sendMoreMenu(env, from);
        return new Response("ok", { status: 200 });
      }

      if (token === "STREAK") {
        await handleStreakCommand(env, from);
        return new Response("ok", { status: 200 });
      }

      if (token === "DASH") {
        await sendDashboardLink(env, from);
        return new Response("ok", { status: 200 });
      }

      if (token === "STAMP") {
        await handleStamp(env, from, token);
        return new Response("ok", { status: 200 });
      }

      await sendText(
        env,
        from,
        `👋 Welcome to the WhatsApp stamp card demo.

Type *CONNECT* to see options, *DEMO* to start, or *STAMP* after a visit.`
      );
      return new Response("ok", { status: 200 });
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return new Response("ok", { status: 200 });
}
