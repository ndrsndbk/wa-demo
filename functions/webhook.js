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

// ---------- Birthday parsing ----------

function parseBirthday(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;

  // DD/MM/YYYY or DD-MM-YYYY -> ISO
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

// ---------- SIGNUP flow ----------

async function startSignupFlow(env, customerId, waName) {
  const msg =
    `Welcome${waName ? ", " + waName : ""} 👋\n` +
    "2 quick steps to join the stamp card:\n\n" +
    "1️⃣ When is your birthday? (e.g. 1995-07-12)\n" +
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
    "Now imagine you’ve just bought a coffee ☕️\nType *STAMP* to claim your first stamp."
  );

  await setState(env, customerId, "demo_stamp", 1);
  return true;
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

  const capped = Math.max(1, Math.min(10, next));
  await sendImage(env, customerId, buildCardUrl(env, capped));

  await sendText(
    env,
    customerId,
    "Thanks for ‘visiting’ 🙌 You now have a stamp on your demo card.\n\n" +
      "🎉 *Demo complete.* Reply *SIGNUP* to restart or share this with your team."
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

    if (!message) return new Response("ignored", { status: 200 });

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

    // Interactive: drink selection
    if (type === "interactive") {
      const interactive = message.interactive || {};
      let replyId = null;
      if (interactive.type === "button_reply") {
        replyId = interactive.button_reply?.id;
      } else if (interactive.type === "list_reply") {
        replyId = interactive.list_reply?.id;
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

      // Start demo/sign-up
      if (token === "DEMO" || token === "SIGNUP") {
        await startSignupFlow(env, from, waName);
        return new Response("ok", { status: 200 });
      }

      // Birthday step
      if (await handleSignupTextStep1(env, from, raw)) {
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
        "👋 Welcome to the WhatsApp stamp card demo.\n" +
          "Send *DEMO* or *SIGNUP* to start, or *STAMP* after a visit."
      );
      return new Response("ok", { status: 200 });
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  // Always 200 so Meta doesn't retry endlessly
  return new Response("ok", { status: 200 });
}
