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

async function sbSelectOne(env, table, filter, columns = "*") {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/${table}?${filter}&select=${encodeURIComponent(
      columns
    )}&limit=1`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    console.error(
      `[SB SELECT ONE] ${table} ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase selectOne failed");
  }
  const json = await res.json();
  return json[0] || null;
}

async function sbUpsert(env, table, rows, conflictTarget) {
  const { url } = getSupabaseConfig(env);
  const headers = sbHeaders(env, {
    Prefer: conflictTarget
      ? `resolution=merge-duplicates,conflict-target=${conflictTarget}`
      : "resolution=merge-duplicates",
  });
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(
      `[SB UPSERT] ${table} ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase upsert failed");
  }
  return res.json().catch(() => null);
}

async function sbUpdate(env, table, filter, patch) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: sbHeaders(env),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error(
      `[SB UPDATE] ${table} ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase update failed");
  }
  return res.json().catch(() => null);
}

// ---------- WhatsApp helpers ----------

function getWhatsAppConfig(env) {
  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneNumberId) {
    throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID");
  }
  return { token, phoneNumberId };
}

async function sendWhatsApp(env, payload) {
  const { token, phoneNumberId } = getWhatsAppConfig(env);
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

function sendInteractiveButtons(env, to, body, buttons) {
  return sendWhatsApp(env, {
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

function sendInteractiveList(env, to, body, sections) {
  return sendWhatsApp(env, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: "Options",
        sections,
      },
    },
  });
}

// ---------- Idempotency helpers ----------

async function alreadyProcessed(env, msgId) {
  const row = await sbSelectOne(
    env,
    "processed_messages",
    `message_id=eq.${encodeURIComponent(msgId)}`,
    "message_id"
  );
  return !!row;
}

async function markProcessed(env, msgId) {
  await sbUpsert(
    env,
    "processed_messages",
    [
      {
        message_id: msgId,
        processed_at: new Date().toISOString(),
      },
    ],
    "message_id"
  );
}

// ---------- Customer + state helpers ----------

async function ensureCustomer(env, customerId, waName) {
  const row = await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id"
  );
  if (row) return row;

  const insert = [
    {
      customer_id: customerId,
      wa_name: waName || null,
      created_at: new Date().toISOString(),
    },
  ];
  await sbUpsert(env, "customers", insert, "customer_id");
  return await sbSelectOne(
    env,
    "customers",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "*"
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

async function getState(env, customerId) {
  const row = await sbSelectOne(
    env,
    "customer_states",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "*"
  );
  if (!row) {
    return {
      customer_id: customerId,
      active_flow: null,
      step: 0,
      created_at: null,
      updated_at: null,
    };
  }
  return row;
}

async function setState(env, customerId, flow, step) {
  await sbUpsert(
    env,
    "customer_states",
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
  await sbUpsert(
    env,
    "customer_states",
    [
      {
        customer_id: customerId,
        active_flow: null,
        step: 0,
        updated_at: new Date().toISOString(),
      },
    ],
    "customer_id"
  );
}

// ---------- Stamp card + streak helpers ----------

function buildCardUrl(env, stamps) {
  const base = env.CARD_BASE_URL || "https://tpc-demo-dashboard.pages.dev";
  return `${base}/card?stamps=${encodeURIComponent(stamps)}`;
}

async function recordVisit(env, customerId) {
  const now = new Date().toISOString();
  await sbUpsert(
    env,
    "visits",
    [{ customer_id: customerId, visited_at: now }],
    "id"
  );
}

async function resetVisitCount(env, customerId) {
  await sbUpsert(
    env,
    "customers",
    [
      {
        customer_id: customerId,
        number_of_visits: 0,
        last_visit_at: null,
      },
    ],
    "customer_id"
  );
}

async function getStreakState(env, customerId) {
  const row = await sbSelectOne(
    env,
    "customer_streaks",
    `customer_id=eq.${encodeURIComponent(customerId)}`,
    "customer_id,streak_count,last_visit_date,two_day_sent,five_day_sent"
  );
  if (!row) {
    return {
      customer_id: customerId,
      streak_count: 0,
      last_visit_date: null,
      two_day_sent: false,
      five_day_sent: false,
    };
  }
  return row;
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

// ---------- Connect / meeting / more menus ----------

async function sendConnectMenu(env, to, waName) {
  const body = `Hi${waName ? " " + waName : ""} 👋

*The Potential Company* helps “good” businesses grow via:

1️⃣ Meta-powered loyalty systems (WhatsApp/Instagram)
2️⃣ Digital products & automations
3️⃣ Strategic & financial advisory

_Meta loyalty systems, digital products, and strategic advisory_

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
      { id: "meeting_loyalty", title: "Meta Loyalty Systems" },
      { id: "meeting_digital", title: "Digital Products" },
      { id: "meeting_strategy", title: "Strategic Advisory" },
    ]
  );
  await setState(env, customerId, "meeting", 1);
}

async function handleMeetingServiceReply(env, customerId, replyId, waName) {
  if (!replyId?.startsWith("meeting_")) return false;

  const map = {
    meeting_loyalty: "Meta Loyalty Systems",
    meeting_digital: "Digital Products & Automations",
    meeting_strategy: "Strategic & Financial Advisory",
  };
  const service = map[replyId] || "Meta Loyalty Systems";

  await sendText(
    env,
    customerId,
    `Great — let's set up a meeting about *${service}*.

For now, here's a placeholder Calendly link to pick a time:

https://calendly.com/thepotentialcompany/meta-loyalty-demo`
  );
  await clearState(env, customerId);
  return true;
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

// ---------- Signup flow ----------

async function startSignupFlow(env, customerId, waName) {
  const greetingName = waName || "there";
  await sendText(
    env,
    customerId,
    `Awesome ${greetingName}! Let's capture a few details so we can tailor the demo.

First up: *What’s the name of your business?*`
  );
  await setState(env, customerId, "signup", 1);
}

async function handleSignupTextStep1(env, customerId, text) {
  const st = await getState(env, customerId);
  if (st.active_flow !== "signup" || st.step !== 1) return false;

  await sbUpsert(
    env,
    "signup_leads",
    [
      {
        customer_id: customerId,
        business_name: text,
        created_at: new Date().toISOString(),
      },
    ],
    "customer_id"
  );

  const body = `Nice — *${text}* sounds great.

Which drink best matches your hero product?`;
  await sendInteractiveButtons(env, customerId, body, [
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

  await sendText(
    env,
    customerId,
    "Nice choice 😎 Here’s your digital stamp card:"
  );
  const cardUrl = buildCardUrl(env, 0);
  await sendImage(env, customerId, cardUrl);

  await sendText(
    env,
    customerId,
    `From here, we track when your customers “stamp” their card via real orders.

To continue the demo, type *STAMP* after your ‘purchase’ ☕️`
  );
  await setState(env, customerId, "demo", 0);
  return true;
}

// ---------- Edu videos ----------

async function handleEduMedia(env, customerId, message) {
  if (message.type !== "text") return false;
  const text = (message.text?.body || "").trim().toUpperCase();
  if (text !== "EDU") return false;

  const yt1 = env.EDU_YT_URL || "https://youtu.be/nX5SfBdnHHU";
  const yt2 = env.EDU_YT2_URL || "https://youtu.be/px87QNYduwI";

  await sendText(
    env,
    customerId,
    `🎓 *Meta Loyalty Systems – Product Videos*

1️⃣ Overview: ${yt1}
2️⃣ Stamp card & gamification: ${yt2}

(Short videos showing how the system works from both the customer and owner side.)`
  );
  return true;
}

async function handleEduInteractive(env, customerId, replyId) {
  if (!replyId?.startsWith("edu_")) return false;

  const yt1 = env.EDU_YT_URL || "https://youtu.be/nX5SfBdnHHU";
  const yt2 = env.EDU_YT2_URL || "https://youtu.be/px87QNYduwI";

  if (replyId === "edu_overview") {
    await sendText(env, customerId, `Overview video:\n${yt1}`);
    return true;
  }
  if (replyId === "edu_stamp") {
    await sendText(env, customerId, `Stamp card & gamification:\n${yt2}`);
    return true;
  }

  return false;
}

// ---------- Demo flow: stamp, streak, dashboard ----------

async function handleStamp(env, customerId, token) {
  const st = await getState(env, customerId);
  const nowIso = new Date().toISOString();

  if (st.active_flow === "demo_complete") {
    return false;
  }

  if (st.active_flow === "demo_streak") {
    // treat as streak “GO”
    const streakRow = await getStreakState(env, customerId);
    const currentStreak = streakRow.streak_count || 0;
    const nextStreak = currentStreak + 1;

    await sbUpsert(
      env,
      "customer_streaks",
      [
        {
          customer_id: customerId,
          streak_count: nextStreak,
          last_visit_date: nowIso,
        },
      ],
      "customer_id"
    );

    const row = await sbSelectOne(
      env,
      "customers",
      `customer_id=eq.${encodeURIComponent(customerId)}`,
      "number_of_visits"
    );
    const currentVisits =
      row && row.number_of_visits ? Number(row.number_of_visits) : 0;
    const nextVisits = currentVisits + 1;

    await sbUpsert(
      env,
      "customers",
      [
        {
          customer_id: customerId,
          number_of_visits: nextVisits,
          last_visit_at: nowIso,
        },
      ],
      "customer_id"
    );

    const capped = Math.min(nextVisits, 10);
    await sendImage(env, customerId, buildCardUrl(env, capped));

    if (nextStreak === 2) {
      await sendText(
        env,
        customerId,
        `Wow — you’re on a *2-day streak* 🙌

Hit a *5-day streak* to unlock surprise bonuses.`
      );
    } else if (nextStreak === 5) {
      await sendText(
        env,
        customerId,
        `🔥 *5-day streak unlocked!*

In a real system, we’d trigger:
- double stamps,
- a secret menu item,
- or a personalised thank-you message.`
      );
    } else {
      await sendText(
        env,
        customerId,
        `Streak recorded. You’re now on *${nextStreak} consecutive visits*.`
      );
    }

    if (nextStreak >= 5) {
      const shareLink = `https://wa.me/${customerId}?text=DEMO`;

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

    if (nextStreak === 2) {
      await sendText(
        env,
        customerId,
        `Let’s test streak gamification 🔥 

A streak means visiting multiple days in a row.

Send *STAMP* to make another “purchase”.`
      );
    }

    return true;
  }

  // base demo: stamping only
  if (token === "STAMP") {
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

    const capped = Math.min(next, 10);
    const cardUrl = buildCardUrl(env, capped);
    await sendImage(env, customerId, cardUrl);

    if (next < 10) {
      await sendText(
        env,
        customerId,
        `Nice — you've now got *${next}* stamp(s).

Type *STAMP* again after the next visit.`
      );
      await setState(env, customerId, "demo", next);
    } else {
      await sendText(
        env,
        customerId,
        `🎁 You've reached *10 stamps* — in a real system, this would unlock a free coffee or reward.

Now let's test streak-based rewards. Type *STREAK* to continue.`
      );
      await setState(env, customerId, "demo_streak_intro", 0);
    }
    return true;
  }

  return false;
}

async function handleStreakIntro(env, customerId, token) {
  if (token !== "STREAK") return false;

  const st = await getState(env, customerId);
  if (st.active_flow !== "demo_streak_intro") return false;

  await sendText(
    env,
    customerId,
    `Let’s test streak gamification 🔥 

A streak means visiting multiple days in a row.

Send *STAMP* to make another “purchase”.`
  );
  await setState(env, customerId, "demo_streak", 1);
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

    const msgId = message.id;
    const from = message.from;
    const contacts = value.contacts || [];
    const waName = contacts[0]?.profile?.name || null;

    if (await alreadyProcessed(env, msgId)) {
      return new Response("ok", { status: 200 });
    }
    await markProcessed(env, msgId);

    await ensureCustomer(env, from, waName);

    const type = message.type;

    // ---------- INTERACTIVE ----------
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
        await sendText(
          env,
          from,
          "Great — let’s run the demo. Type *STAMP* to simulate a visit."
        );
        await setState(env, from, "demo", 0);
        const cardUrl = buildCardUrl(env, 0);
        await sendImage(env, from, cardUrl);
        return new Response("ok", { status: 200 });
      }

      if (
        replyId &&
        (await handleMeetingServiceReply(env, from, replyId, waName))
      ) {
        return new Response("ok", { status: 200 });
      }

      if (replyId === "more_streak") {
        await setState(env, from, "demo_streak_intro", 0);
        await sendText(
          env,
          from,
          `We’ll now simulate consecutive visits and show how streak rewards work.

Type *STREAK* to begin.`
        );
        return new Response("ok", { status: 200 });
      }

      if (replyId === "more_dash") {
        const dashUrl =
          env.DASHBOARD_URL ||
          "https://tpc-demo-dashboard.pages.dev/demo-dashboard";
        await sendText(
          env,
          from,
          `📊 Here's a simple *demo dashboard* that could connect to your loyalty system:

${dashUrl}`
        );
        await clearState(env, from);
        return new Response("ok", { status: 200 });
      }

      // NEW: buttons on "Demo complete" card
      if (replyId === "more_features") {
        await sendMoreMenu(env, from);
        return new Response("ok", { status: 200 });
      }

      if (replyId === "book_meeting") {
        await startMeetingFlow(env, from);
        return new Response("ok", { status: 200 });
      }

      if (
        replyId &&
        (await handleSignupInteractiveStep2(env, from, replyId))
      ) {
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    // ---------- TEXT ----------
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
        await resetVisitCount(env, from);
        await resetStreakState(env, from);
        await clearState(env, from);
        await sendText(
          env,
          from,
          `👋 Welcome to the WhatsApp stamp card demo.

We’ll simulate a simple coffee shop: 
- Each visit = 1 stamp
- 10 stamps = 1 free coffee

Type *STAMP* after each “visit” to see your card fill up.`
        );
        const cardUrl = buildCardUrl(env, 0);
        await sendImage(env, from, cardUrl);
        await setState(env, from, "demo", 0);
        return new Response("ok", { status: 200 });
      }

      if (token === "EDUSAFE") {
        // placeholder for any extra flow
        return new Response("ok", { status: 200 });
      }

      if (await handleEduMedia(env, from, message)) {
        return new Response("ok", { status: 200 });
      }

      // meeting-related text handlers could go here if you add them
      // (e.g., handleMeetingTimeText, handleMeetingEmailText)

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

      if (token === "STREAK") {
        if (await handleStreakIntro(env, from, token)) {
          return new Response("ok", { status: 200 });
        }
      }

      if (token === "STAMP") {
        if (await handleStamp(env, from, token)) {
          return new Response("ok", { status: 200 });
        }
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
