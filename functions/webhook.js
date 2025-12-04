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
    console.error(`Supabase selectOne ${table} error`, res.status, await res.text());
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
    console.error(`Supabase insert ${table} error`, res.status, await res.text());
  }
}

async function sbUpsert(env, table, rows, keyCols) {
  const { url } = getSupabaseConfig(env);
  const onConflict = Array.isArray(keyCols)
    ? keyCols.join(",")
    : keyCols;
  const res = await fetch(
    `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    console.error(`Supabase upsert ${table} error`, res.status, await res.text());
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
    console.error(`Supabase update ${table} error`, res.status, await res.text());
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

  // Public URL (for a public bucket)
  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${path}`;
  return publicUrl;
}

// ---------- WhatsApp helpers ----------

function getPhoneNumberId(env) {
  return env.PHONE_NUMBER_ID || "858272234034248"; // your real WA number ID
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
    [
      { customer_id: customerId, number_of_visits: 0, last_visit_at: null },
    ],
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

  // Keep legacy ISO parsing but allow any free-text; caller can ignore null.
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
    `customer_id=eq.${encodeURIComponent(customerId)}&status=eq.${encodeURIComponent(
      "service_selected"
    )}&order=created_at.desc`,
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

  await sendText(env, customerId, "Nice choice 😎 Here’s your digital stamp card:");
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

  // Step 1: Yes / No
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

  // Step 2: Incident type selection
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

  // Step 4: Team leader selection
  if (st.step === 4) {
    const map = {
      edu_leader_A: "Leader A",
      edu_lea_
