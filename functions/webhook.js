// Cloudflare Pages Function: WhatsApp Stamp Card Demo
// No external npm deps; Supabase via REST; WhatsApp Cloud API for messaging.
//
// Required environment variables (no defaults to avoid accidental leaks):
// - SUPABASE_URL: Supabase project URL (no trailing slash)
// - SUPABASE_WEBHOOK_KEY or SUPABASE_ANON_KEY (or a restricted service key as last resort)
// - WHATSAPP_APP_SECRET: Meta app secret used to verify X-Hub-Signature-256
// - WHATSAPP_TOKEN: WhatsApp Cloud API token for sending messages
// - PHONE_NUMBER_ID: WhatsApp phone number ID for outbound messages
// - VERIFY_TOKEN or WHATSAPP_VERIFY_TOKEN: subscription verification shared secret
// Optional hardening/customization:
// - CARDS_BASE_URL / CARDS_VERSION / CARD_PREFIX / STAMP_CARD_ZERO_URL / SHARE_LINK
// - WEBSITE_URL / DASHBOARD_URL / REPORT_URL
//
// Ensure WHATSAPP_APP_SECRET and the verify token never appear in client bundles or logs.

// ---------- Supabase REST helpers ----------

function getSupabaseConfig(env) {
  const url = env.SUPABASE_URL;
  const key =
    env.SUPABASE_WEBHOOK_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_WEBHOOK/ANON KEY");
  }
  return { url: url.replace(/\+$/, ""), key };
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

// ---------- WhatsApp helpers ----------

function getPhoneNumberId(env) {
  return env.PHONE_NUMBER_ID;
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

function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyMetaSignature(appSecret, signatureHeader, rawBody) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const signature = signatureHeader.slice("sha256=".length);
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEquals(hex, signature);
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

First, when’s your birthday?
e.g. 1993-02-07

_(you get a free drink on your birthday)_`;
  await sendText(env, customerId, msg);
  await setState(env, customerId, "signup", 1);
}

async function handleSignupInteractiveStep2(env, customerId, replyId) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 2) return false;

  const map = {
    drink_matcha: "Matcha",
    drink_americano: "Americano",
    drink_cappuccino: "Cappuccino",
  };
  const drink = map[replyId] || replyId || "Unknown";
  await setCustomerPreferredDrink(env, customerId, drink);

  await sendText(
    env,
    customerId,
    `Nice! We’ve saved your preference: *${drink}*.

We’ll let you know about offers and surprises.`
  );

  await clearState(env, customerId);
  return true;
}

async function handleSignupTextStep1(env, customerId, text) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 1) return false;

  const iso = parseBirthday(text);
  const birthdayValue = iso || text.trim();
  await setCustomerBirthday(env, customerId, birthdayValue);

  await sendInteractiveButtons(env, customerId, "Which drink do you prefer?", [
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

Would you like to book a meeting or try a demo?`;

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
      { id: "meeting_apps", title: "APPs & AUTOs" },
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

async function handleMeetingServiceReply(env, customerId, replyId, waName) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "meeting" || st.step !== 1) return false;

  const map = {
    meeting_meta: "Meta Systems",
    meeting_apps: "Applications / Automation",
    meeting_advisory: "Strategic Advisory",
  };
  const selection = map[replyId] || replyId || "Unknown";
  await logMeetingSelection(env, customerId, waName, selection);

  await sendText(
    env,
    customerId,
    `Great — we’ll schedule time to discuss *${selection}*.

Share your availability here (or send a calendar link).`
  );

  await setState(env, customerId, "meeting", 2);
  return true;
}

async function handleMeetingTimeText(env, customerId, rawText) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "meeting" || st.step !== 2) return false;

  await updateMeetingRequestTime(env, customerId, rawText);
  await sendText(
    env,
    customerId,
    "Thanks! We’ll confirm a meeting time shortly."
  );

  await clearState(env, customerId);
  return true;
}

// ---------- Demo flow ----------

async function sendDashboardLink(env, customerId) {
  const url = getDashboardUrl(env);
  await sendText(
    env,
    customerId,
    `Here’s the live dashboard:\n${url}\n\nShare it with your team.`
  );
}

async function sendMoreMenu(env, customerId) {
  await sendInteractiveButtons(env, customerId, "Want to try more features?", [
    { id: "more_streak", title: "STREAK" },
    { id: "more_dash", title: "DASHBOARD" },
  ]);
}

async function startDemoFlow(env, customerId, waName) {
  const shareLink = buildShareLink(env);
  await sendText(
    env,
    customerId,
    `Hi${waName ? ` ${waName}` : ""}! 👋 This is the WhatsApp stamp card demo.

Send *STAMP* each time you “visit” to see your card fill up.

Want to skip ahead? Send *STREAK* to fast-forward and test milestones.

Share link: ${shareLink}`
  );

  const zeroUrl = getZeroCardUrl(env);
  await sendImage(env, customerId, zeroUrl, "Your digital stamp card (0/10)");

  await setState(env, customerId, "demo", 0);
}

async function handleStreakCommand(env, customerId) {
  await sendText(
    env,
    customerId,
    `Testing streak mode — send *STAMP* repeatedly to simulate daily visits.

We’ll message you when you hit streak milestones.`
  );
  await setState(env, customerId, "demo_streak", 1);
}

async function handleStamp(env, customerId, rawText) {
  const st = await getState(env, customerId);
  const shareLink = buildShareLink(env);

  const customer = await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "number_of_visits,last_visit_at"
  );
  const visits = Number(customer?.number_of_visits || 0);
  const next = visits + 1;
  const capped = Math.max(1, Math.min(10, next));

  const now = new Date().toISOString();

  await sbUpsert(
    env,
    "customers",
    [
      {
        customer_id: customerId,
        number_of_visits: capped,
        last_visit_at: now,
      },
    ],
    "customer_id"
  );

  const streakInfo = await updateStreak(env, customerId);
  await maybeSendStreakMilestones(env, customerId, streakInfo.streak, streakInfo);

  if (st.active_flow === "demo_streak") {
    await sendImage(env, customerId, buildCardUrl(env, capped));

    if (st.step >= 1 && st.step < 5) {
      const nextStep = st.step + 1;
      if (nextStep === 5) {
        await sendText(
          env,
          customerId,
          `🎉 *Demo complete.*
Share it with colleagues:
${shareLink}

Want to test more features?
Reply *MORE*.`
        );
        await setState(env, customerId, "demo_complete", 0);
        return true;
      }

      await sendText(env, customerId, "Nice! Keep going — send *STAMP* again.");
      await setState(env, customerId, "demo_streak", nextStep);
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

  await sendImage(env, customerId, buildCardUrl(env, capped));

  if (next === 1) {
    await sendText(
      env,
      customerId,
      `Thanks for visiting 🙌

Now you’ve got your first stamp.

Want to test more features? Reply *MORE*.`
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

  const verifyToken = env.VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return new Response("verify token missing", { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---------- POST: handle incoming WhatsApp messages ----------

export async function onRequestPost({ request, env }) {
  try {
    const appSecret = env.WHATSAPP_APP_SECRET || env.APP_SECRET;
    if (!appSecret) {
      return new Response("app secret missing", { status: 500 });
    }

    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature-256");

    const signatureValid = await verifyMetaSignature(
      appSecret,
      signatureHeader,
      rawBody
    );

    if (!signatureValid) {
      return new Response("invalid signature", { status: 401 });
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error("Invalid JSON body", parseErr);
      return new Response("invalid json", { status: 400 });
    }

    const entry = data.entry?.[0] || {};
    const changes = entry.changes?.[0] || {};
    const value = changes.value || {};
    const message = value.messages?.[0];

    if (!message) {
      // Likely a status/update webhook without inbound user message
      return new Response("ignored", { status: 200 });
    }

    const msgId = message.id;
    const from = message.from;
    const contacts = value.contacts || [];
    const waName = contacts[0]?.profile?.name || null;

    // idempotency
    if (await alreadyProcessed(env, msgId)) {
      return new Response("ok", { status: 200 });
    }
    await markProcessed(env, msgId);

    await upsertCustomer(env, from, waName);

    const type = message.type;

    // Interactive: buttons
    if (type === "interactive") {
      const interactive = message.interactive || {};
      let replyId = null;
      if (interactive.type === "button_reply") {
        replyId = interactive.button_reply?.id;
      } else if (interactive.type === "list_reply") {
        replyId = interactive.list_reply?.id;
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

      if (replyId && (await handleSignupInteractiveStep2(env, from, replyId))) {
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    // Text messages
    if (type === "text") {
      const raw = (message.text?.body || "").trim();
      const token = raw.toUpperCase();

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

      // Meeting availability reply
      if (await handleMeetingTimeText(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      // Start connect menu
      if (token === "CONNECT") {
        await sendConnectMenu(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      // Meeting branch
      if (token === "MEETING") {
        await startMeetingFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      // Birthday step
      if (await handleSignupTextStep1(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      // Streak test entry
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

      // Stamp
      if (token === "STAMP") {
        await handleStamp(env, from, token);
        return new Response("ok", { status: 200 });
      }

      // Default help
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

  // Always 200 so Meta doesn't retry endlessly
  return new Response("ok", { status: 200 });
}
