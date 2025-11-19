// Cloudflare Pages Function: WhatsApp Stamp Card Demo
// Single-file version (A) with Supabase + WhatsApp Cloud API integration.

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

// Safe JSON parser for Supabase responses
async function safeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Supabase JSON:", e, "Body was:", text);
    throw e;
  }
}

async function sbSelectOne(env, table, filter, columns = "*") {
  const { url } = getSupabaseConfig(env);
  const qs = `select=${encodeURIComponent(columns)}&${filter}&limit=1`;
  const resp = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    method: "GET",
    headers: sbHeaders(env),
  });
  if (!resp.ok) {
    console.error(`Supabase SELECT error on ${table}:`, resp.status, await resp.text());
    throw new Error("Supabase select error");
  }
  const data = (await safeJson(resp)) || [];
  return data[0] || null;
}

async function sbInsert(env, table, rows) {
  const { url } = getSupabaseConfig(env);
  const resp = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    console.error(`Supabase INSERT error on ${table}:`, resp.status, await resp.text());
    throw new Error("Supabase insert error");
  }
  // We don't currently use the response body; avoid JSON.parse on empty
  return null;
}

async function sbUpsert(env, table, rows, onConflict) {
  const { url } = getSupabaseConfig(env);
  const resp = await fetch(
    `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(rows),
    }
  );
  if (!resp.ok) {
    console.error(`Supabase UPSERT error on ${table}:`, resp.status, await resp.text());
    throw new Error("Supabase upsert error");
  }
  // Not using response body
  return null;
}

async function sbUpdate(env, table, filter, patch) {
  const { url } = getSupabaseConfig(env);
  const resp = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: sbHeaders(env),
    body: JSON.stringify(patch),
  });
  if (!resp.ok) {
    console.error(`Supabase UPDATE error on ${table}:`, resp.status, await resp.text());
    throw new Error("Supabase update error");
  }
  // Not using response body
  return null;
}

// ---------- WhatsApp send helpers ----------

async function sendWhatsApp(env, payload) {
  const token = env.WHATSAPP_TOKEN;
  const fromPhoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !fromPhoneId) {
    throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
  }

  const url = `https://graph.facebook.com/v17.0/${fromPhoneId}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    console.error("WhatsApp send error:", resp.status, await resp.text());
  }
}

async function sendText(env, to, body) {
  await sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

async function sendImage(env, to, imageUrl) {
  await sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl },
  });
}

async function sendInteractiveButtons(env, to, body, buttons) {
  await sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

// ---------- Card image helpers ----------

function getBaseCardUrl(env) {
  if (env.CARD_BASE_URL) return env.CARD_BASE_URL.replace(/\/+$/, "");
  return "https://example.com/cards";
}

function getZeroCardUrl(env) {
  const base = getBaseCardUrl(env);
  return `${base}/card-0.png`;
}

function buildCardUrl(env, stamps) {
  const base = getBaseCardUrl(env);
  const capped = Math.max(0, Math.min(10, stamps));
  return `${base}/card-${capped}.png`;
}

// ---------- Conversation / state helpers ----------

async function getOrCreateCustomer(env, customerId, profileName) {
  const existing = await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id"
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  await sbInsert(env, "customers", [
    {
      customer_id: customerId,
      profile_name: profileName || null,
      created_at: now,
      last_seen_at: now,
      number_of_visits: 0,
    },
  ]);
  return { customer_id: customerId };
}

async function touchCustomer(env, customerId) {
  const now = new Date().toISOString();
  await sbUpdate(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    { last_seen_at: now }
  );
}

async function getState(env, customerId) {
  const row = await sbSelectOne(
    env,
    "conversation_state",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "active_flow,step"
  );
  return row || { active_flow: null, step: 0 };
}

async function setState(env, customerId, flow, step) {
  await sbUpsert(
    env,
    "conversation_state",
    [
      {
        customer_id: customerId,
        active_flow: flow,
        step,
        updated_at: new Date().toISOString(),
      },
    ],
    "customer_id"
  );
}

async function clearState(env, customerId) {
  await sbUpdate(
    env,
    "conversation_state",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    { active_flow: null, step: 0, updated_at: new Date().toISOString() }
  );
}

// ---------- Idempotency for incoming messages ----------

async function isAlreadyProcessed(env, messageId) {
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
  await sbInsert(env, "processed_events", [
    { message_id: messageId, created_at: new Date().toISOString() },
  ]);
}

// ---------- Birthday & profile helpers ----------

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

async function resetCustomerVisits(env, customerId) {
  await sbUpdate(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    { number_of_visits: 0, last_visit_at: null }
  );
}

// ---------- Birthday parsing ----------

function parseBirthday(text) {
  const t = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

// ---------- SIGNUP flow ----------

async function startSignupFlow(env, customerId, waName) {
  const msg =
    `Welcome${waName ? ", " + waName : ""} 👋
` +
    "2 quick steps to join the stamp card:

" +
    "1️⃣ When is your birthday? (e.g. 1995-07-12)
" +
    "_You get a free drink on your birthday._";
  await sendText(env, customerId, msg);
  await setState(env, customerId, "signup", 1);
}

async function handleSignupTextStep1(env, customerId, text) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 1) return false;

  const iso = parseBirthday(text);
  if (!iso) {
    await sendText(
      env,
      customerId,
      "Please send your birthday in this format: *1995-07-12* 🙏"
    );
    return true;
  }

  await setCustomerBirthday(env, customerId, iso);

  await sendInteractiveButtons(env, customerId, "2️⃣ Choose your go-to drink:", [
    { id: "drink_matcha", title: "Matcha" },
    { id: "drink_americano", title: "Americano" },
    { id: "drink_cappuccino", title: "Cappuccino" },
  ]);

  await setState(env, customerId, "signup", 2);
  return true;
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
    "Now imagine you’ve just bought a coffee ☕️
Type *STAMP* to claim your first stamp."
  );

  await setState(env, customerId, "demo_stamp", 1);
  return true;
}

// ---------- Meeting (MEET) flow ----------

async function logMeetingResponse(env, customerId, waName, kind, answer) {
  const now = new Date().toISOString();
  const row = {
    customer_id: customerId,
    wa_name: waName || null,
    whatsapp_number: customerId,
    kind,
    answer,
    created_at: now,
  };
  await sbInsert(env, "responses", [row]);
}

async function startMeetFlow(env, customerId, waName) {
  const greeting =
    `Awesome${waName ? " " + waName : ""}! 👋

` +
    "Which bespoke service are you interested in?";
  await sendInteractiveButtons(env, customerId, greeting, [
    { id: "meet_meta", title: "Meta" },
    { id: "meet_apps", title: "Apps" },
    { id: "meet_strategy", title: "Strategy" },
  ]);
  await setState(env, customerId, "meet", 1);
}

async function handleMeetInteractiveStep(env, customerId, waName, replyId) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "meet" || st.step !== 1) return false;

  const map = {
    meet_meta: "Meta",
    meet_apps: "Apps",
    meet_strategy: "Strategy",
  };
  const service = map[replyId];
  if (!service) return false;

  await logMeetingResponse(env, customerId, waName, "meeting_service", service);

  await sendText(
    env,
    customerId,
    "Thanks! 🙌

Please respond with a *day + time* that suits you best for a chat."
  );

  await setState(env, customerId, "meet", 2);
  return true;
}

async function handleMeetTextStep2(env, customerId, waName, text) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "meet" || st.step !== 2) return false;

  await logMeetingResponse(env, customerId, waName, "meeting_time", text);

  await sendText(
    env,
    customerId,
    "All set ✅

We’ve received your meeting request and will get back to you soon!

" +
      "Please feel free to reply here with any extra info or context for our chat."
  );

  await clearState(env, customerId);
  return true;
}

// ---------- STREAK helpers ----------

function getTodayDateString() {
  // Use UTC date portion for consistent streak calculation
  return new Date().toISOString().slice(0, 10);
}

async function updateCustomerStreak(env, customerId) {
  const today = getTodayDateString();

  const row = await sbSelectOne(
    env,
    "customer_streaks",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id,streak_days,last_day"
  );

  let prevStreak = 0;
  let newStreak = 1;

  if (row) {
    prevStreak = row.streak_days ? Number(row.streak_days) : 0;
    const lastDayStr = row.last_day;
    if (lastDayStr) {
      const last = new Date(`${lastDayStr}T00:00:00Z`);
      const todayDate = new Date(`${today}T00:00:00Z`);
      const diffDays = Math.round(
        (todayDate.getTime() - last.getTime()) / (24 * 60 * 60 * 1000)
      );

      if (diffDays === 0) {
        // Same calendar day – keep the current streak
        newStreak = prevStreak || 1;
      } else if (diffDays === 1) {
        // Consecutive day – increment
        newStreak = prevStreak + 1;
      } else {
        // Gap – reset streak
        newStreak = 1;
      }
    }
  }

  await sbUpsert(
    env,
    "customer_streaks",
    [
      {
        customer_id: customerId,
        streak_days: newStreak,
        last_day: today,
      },
    ],
    "customer_id"
  );

  return { prevStreak, newStreak };
}

// ---------- STAMP handling ----------

async function handleStamp(env, customerId, token) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "demo_stamp" || st.step !== 1) {
    // allow STAMP even outside strict state for demo
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

  // Update streak and fire any milestone messages once
  const { prevStreak, newStreak } = await updateCustomerStreak(env, customerId);

  const capped = Math.max(1, Math.min(10, next));
  await sendImage(env, customerId, buildCardUrl(env, capped));

  // Base confirmation
  await sendText(
    env,
    customerId,
    "Thanks for ‘visiting’ 🙌 You now have a stamp on your demo card."
  );

  // Streak milestone: first time reaching 2-in-a-row (but less than 5)
  if (prevStreak < 2 && newStreak >= 2 && newStreak < 5) {
    await sendText(
      env,
      customerId,
      "🔥 You’re on a streak!

" +
        `That’s *${newStreak} visits in a row*.

` +
        "Keep it going — hit a streak of *5* visits and you’ll earn *extra stamps* on your card. 💪"
    );
  }

  // Streak milestone: first time reaching 5-in-a-row
  if (prevStreak < 5 && newStreak >= 5) {
    await sendText(
      env,
      customerId,
      "🎉 Streak unlocked!

You’ve hit a *5-visit streak* — you’ve earned *double stamps* on this visit. 🙌"
    );
  }

  // Close out the demo
  await sendText(
    env,
    customerId,
    "🎉 *Demo complete.*

" +
      "Reply *SIGNUP* to restart, or share this demo with your team:
" +
      "https://wa.me/84764929881?text=DEMO"
  );

  await setState(env, customerId, "demo_complete", 0);
  return true;
}

// ---------- GET: webhook verification ----------

function verifyWhatsAppToken(env, url) {
  const token = env.WHATSAPP_VERIFY_TOKEN;
  if (!token) {
    console.warn("No WHATSAPP_VERIFY_TOKEN set");
  }
  const { searchParams } = new URL(url);

  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token");

  if (mode === "subscribe" && challenge && verifyToken === token) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---------- Cloudflare Pages export ----------

export const onRequestPost = async (context) => {
  const { request, env } = context;

  try {
    let json;
    try {
      json = await request.json();
    } catch (err) {
      console.error("JSON parse failed:", err);
      return new Response("ok", { status: 200 });
    }

    console.log("Incoming webhook:", JSON.stringify(json, null, 2));

    if (json.object !== "whatsapp_business_account") {
      return new Response("ok", { status: 200 });
    }

    const entry = json.entry && json.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const messages = (value && value.messages) || [];
    if (!messages.length) {
      return new Response("ok", { status: 200 });
    }

    const message = messages[0];
    const from = message.from; // WhatsApp user ID (phone)
    const msgId = message.id;
    const type = message.type;

    const contactProfile =
      value && value.contacts && value.contacts[0] && value.contacts[0].profile;
    const waName = contactProfile && contactProfile.name ? contactProfile.name : null;

    await getOrCreateCustomer(env, from, waName);
    await touchCustomer(env, from);

    if (await isAlreadyProcessed(env, msgId)) {
      console.log("Duplicate message, ignoring:", msgId);
      return new Response("ok", { status: 200 });
    }
    await markProcessed(env, msgId);

    // Interactive: buttons & lists
    if (type === "interactive") {
      const interactive = message.interactive || {};
      let replyId = null;
      if (interactive.type === "button_reply") {
        replyId = interactive.button_reply && interactive.button_reply.id;
      } else if (interactive.type === "list_reply") {
        replyId = interactive.list_reply && interactive.list_reply.id;
      }

      if (replyId) {
        if (await handleSignupInteractiveStep2(env, from, replyId)) {
          return new Response("ok", { status: 200 });
        }
        if (await handleMeetInteractiveStep(env, from, waName, replyId)) {
          return new Response("ok", { status: 200 });
        }
      }

      return new Response("ok", { status: 200 });
    }

    // Text messages
    if (type === "text") {
      const raw = (message.text && message.text.body ? message.text.body : "").trim();
      const token = raw.toUpperCase();

      // CONNECT: simple router to MEET or DEMO
      if (token === "CONNECT") {
        const namePart = waName ? ` ${waName}` : "";
        await sendText(
          env,
          from,
          `Hey${namePart} 👋

` +
            "Thanks for connecting! 🙌

" +
            "Reply:
" +
            "• *MEET* to book a meeting
" +
            "• *DEMO* if you'd like to test out the WhatsApp stamp card."
        );
        return new Response("ok", { status: 200 });
      }

      // MEET: start meeting flow with buttons
      if (token === "MEET") {
        await startMeetFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      // DEMO / SIGNUP: start or restart the sign-up flow
      if (token === "SIGNUP") {
        // Reset visits for a fresh demo experience
        await resetCustomerVisits(env, from);
        await startSignupFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }
      if (token === "DEMO") {
        await startSignupFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      // Meeting flow step 2: collect day + time preference
      if (await handleMeetTextStep2(env, from, waName, raw)) {
        return new Response("ok", { status: 200 });
      }

      // Birthday step in SIGNUP flow
      if (await handleSignupTextStep1(env, from, raw)) {
        return new Response("ok", { status: 200 });
      }

      // STAMP: award stamp (and streak logic)
      if (token === "STAMP") {
        await handleStamp(env, from, token);
        return new Response("ok", { status: 200 });
      }

      // Default help
      await sendText(
        env,
        from,
        "👋 Welcome to the WhatsApp stamp card demo.
" +
          "Send *CONNECT* to see options, *DEMO* or *SIGNUP* to start, or *STAMP* after a visit."
      );
      return new Response("ok", { status: 200 });
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  // Always 200 so Meta doesn't retry endlessly
  return new Response("ok", { status: 200 });
};

export const onRequestGet = async (context) => {
  const { request, env } = context;
  return verifyWhatsAppToken(env, request.url);
};
