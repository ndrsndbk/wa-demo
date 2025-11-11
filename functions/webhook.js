import { createClient } from "@supabase/supabase-js";

/***
 * Helper: Supabase client (per-request)
 */
function getSupabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Helper: WhatsApp send
 */
function getPhoneNumberId(env) {
  return env.PHONE_NUMBER_ID || "858272234034248"; // real ID (can be overridden)
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

  const txt = await res.text();
  if (!res.ok) {
    console.error("[WA SEND] error", res.status, txt);
  } else {
    console.log("[WA SEND] ok", res.status, txt);
  }
}

async function sendText(env, to, body) {
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

async function sendImage(env, to, link, caption) {
  const image = { link };
  if (caption) image.caption = caption;
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image,
  });
}

async function sendInteractiveButtons(env, to, bodyText, buttons) {
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

/**
 * Helper: Card URL, same concept as Python version
 */
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
  return (
    env.STAMP_CARD_ZERO_URL || buildCardUrl(env, 0)
  );
}

/**
 * Idempotency helpers (processed_events table)
 */
async function alreadyProcessed(supabase, messageId) {
  if (!messageId) return false;
  const { data, error } = await supabase
    .from("processed_events")
    .select("message_id")
    .eq("message_id", messageId)
    .limit(1);
  if (error) {
    console.error("processed_events select error:", error);
    return false;
  }
  return data && data.length > 0;
}

async function markProcessed(supabase, messageId) {
  if (!messageId) return;
  const { error } = await supabase
    .from("processed_events")
    .insert({ message_id: messageId });
  if (error) {
    // ignore unique violation races
    console.warn("processed_events insert error:", error);
  }
}

/**
 * Conversation state helpers (conversation_state table)
 */
async function getState(supabase, customerId) {
  const { data, error } = await supabase
    .from("conversation_state")
    .select("active_flow, step")
    .eq("customer_id", customerId)
    .limit(1);

  if (error) {
    console.error("get_state error:", error);
    return { active_flow: null, step: 0 };
  }
  if (!data || data.length === 0) {
    return { active_flow: null, step: 0 };
  }
  return data[0];
}

async function setState(supabase, customerId, flow, step = 0) {
  const payload = {
    customer_id: customerId,
    active_flow: flow,
    step,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("conversation_state")
    .upsert(payload);
  if (error) console.error("set_state error:", error);
}

async function clearState(supabase, customerId) {
  await setState(supabase, customerId, null, 0);
}

/**
 * Customer helpers (customers table)
 */
async function upsertCustomer(supabase, customerId, profileName) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("customers")
    .select("customer_id")
    .eq("customer_id", customerId)
    .limit(1);

  if (error) {
    console.error("upsert_customer select error:", error);
    return;
  }

  if (data && data.length > 0) {
    const { error: updErr } = await supabase
      .from("customers")
      .update({ last_seen_at: now, profile_name: profileName })
      .eq("customer_id", customerId);
    if (updErr) console.error("upsert_customer update error:", updErr);
  } else {
    const { error: insErr } = await supabase
      .from("customers")
      .insert({
        customer_id: customerId,
        profile_name: profileName,
        created_at: now,
        last_seen_at: now,
      });
    if (insErr) console.error("upsert_customer insert error:", insErr);
  }
}

async function setCustomerBirthday(supabase, customerId, birthdayIso) {
  const { error } = await supabase
    .from("customers")
    .update({ birthday: birthdayIso })
    .eq("customer_id", customerId);
  if (error) console.error("set_customer_birthday error:", error);
}

async function setCustomerPreferredDrink(supabase, customerId, drink) {
  const { error } = await supabase
    .from("customers")
    .update({ preferred_drink: drink })
    .eq("customer_id", customerId);
  if (error) console.error("set_customer_preferred_drink error:", error);
}

/**
 * Birthday parser (like Python _parse_birthday)
 */
function parseBirthday(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [_, y, mo, d] = m;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(
      2,
      "0"
    )}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const [_, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null; // keep simple for demo
}

/**
 * SIGNUP FLOW (mirrors Python logic)
 */

async function startSignupFlow(env, supabase, customerId, waName) {
  const wave = "👋";
  const welcome =
    `Welcome${waName ? ", " + waName : ""} ${wave} ` +
    "Answer 2 quick questions to signup for the stamp card:\n\n" +
    "First, when is your birthday?\n_You get a free drink on your birthday_";
  await sendText(env, customerId, welcome);
  await setState(supabase, customerId, "signup", 1);
}

async function handleSignupTextStep1(env, supabase, customerId, userText) {
  const st = await getState(supabase, customerId);
  if (st.active_flow !== "signup" || st.step !== 1) return false;

  const bdayIso = parseBirthday(userText || "");
  await setCustomerBirthday(supabase, customerId, bdayIso);

  await sendInteractiveButtons(env, customerId,
    "Last question: What's your preferred drink?",
    [
      { id: "drink_matcha", title: "matcha" },
      { id: "drink_americano", title: "americano" },
      { id: "drink_cappuccino", title: "cappuccino" },
    ]
  );

  await setState(supabase, customerId, "signup", 2);
  return true;
}

async function handleSignupInteractiveStep2(
  env,
  supabase,
  customerId,
  replyId
) {
  const st = await getState(supabase, customerId);
  if (st.active_flow !== "signup" || st.step !== 2) return false;

  const mapping = {
    drink_matcha: "matcha",
    drink_americano: "americano",
    drink_cappuccino: "cappuccino",
  };
  const choice = mapping[replyId];
  if (!choice) return false;

  await setCustomerPreferredDrink(supabase, customerId, choice);

  await sendText(env, customerId, "Thanks! Here's your stamp card 🎉");
  await sendImage(env, customerId, getZeroCardUrl(env));
  await clearState(supabase, customerId);
  return true;
}

/**
 * STAMP/SALE handling (simplified from Python)
 */
async function handleStampOrSale(env, supabase, fromNumber) {
  // Fetch current visits
  const { data, error } = await supabase
    .from("customers")
    .select("number_of_visits")
    .eq("customer_id", fromNumber)
    .limit(1);

  if (error) {
    console.error("fetch visits error:", error);
  }

  const current = (data && data[0] && Number(data[0].number_of_visits)) || 0;
  const next = current + 1;

  const now = new Date().toISOString();
  const { error: upErr } = await supabase.from("customers").upsert({
    customer_id: fromNumber,
    number_of_visits: next,
    last_visit_at: now,
  });
  if (upErr) {
    console.error("customers upsert error:", upErr);
    await sendText(
      env,
      fromNumber,
      "⚠️ Sorry, I couldn't record your visit. Please try again."
    );
    return true;
  }

  const capped = Math.max(1, Math.min(10, next));
  await sendImage(env, fromNumber, buildCardUrl(env, capped));

  if (capped >= 10) {
    await sendText(
      env,
      fromNumber,
      "🎉 Free coffee unlocked! Show this to the barista."
    );
  } else {
    await sendText(
      env,
      fromNumber,
      `Thanks for your visit! You now have ${capped} stamp(s).`
    );
  }
  return true;
}

/**
 * GET: Webhook verification for Meta
 */
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

/**
 * POST: Incoming WhatsApp messages
 */
export async function onRequestPost({ request, env }) {
  const supabase = getSupabase(env);

  try {
    const data = await request.json();

    const entry = data.entry?.[0] || {};
    const changes = entry.changes?.[0] || {};
    const value = changes.value || {};
    const message = value.messages?.[0];

    if (!message) {
      return new Response("ignored", { status: 200 });
    }

    const msgId = message.id;
    const fromNumber = message.from;
    const contacts = value.contacts || [];
    const waName =
      contacts[0]?.profile?.name || null;

    // Idempotency
    if (await alreadyProcessed(supabase, msgId)) {
      return new Response("ok", { status: 200 });
    }
    await markProcessed(supabase, msgId);

    // Ensure customer exists
    await upsertCustomer(supabase, fromNumber, waName);

    const type = message.type;

    // Handle interactive (drink selection)
    if (type === "interactive") {
      const interactive = message.interactive || {};
      let replyId = null;
      if (interactive.type === "button_reply") {
        replyId = interactive.button_reply?.id;
      } else if (interactive.type === "list_reply") {
        replyId = interactive.list_reply?.id;
      }

      if (
        replyId &&
        (await handleSignupInteractiveStep2(
          env,
          supabase,
          fromNumber,
          replyId
        ))
      ) {
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    // Handle text messages
    if (type === "text") {
      const raw = (message.text?.body || "").trim();
      const token = raw.toUpperCase();

      // SIGNUP trigger
      if (token === "SIGNUP") {
        await startSignupFlow(env, supabase, fromNumber, waName);
        return new Response("ok", { status: 200 });
      }

      // SIGNUP step 1: birthday
      if (
        await handleSignupTextStep1(env, supabase, fromNumber, raw)
      ) {
        return new Response("ok", { status: 200 });
      }

      // STAMP/SALE
      if (token === "STAMP" || token === "SALE") {
        await handleStampOrSale(env, supabase, fromNumber);
        return new Response("ok", { status: 200 });
      }

      // DEMO entry point: make it easy
      if (token === "DEMO") {
        await startSignupFlow(env, supabase, fromNumber, waName);
        return new Response("ok", { status: 200 });
      }

      // Fallback
      await sendText(
        env,
        fromNumber,
        "👋 Hi! Send *DEMO* or *SIGNUP* to start the stamp card flow, or *STAMP* after each visit."
      );
      return new Response("ok", { status: 200 });
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  // Always 200 so Meta doesn't keep retrying
  return new Response("ok", { status: 200 });
}
