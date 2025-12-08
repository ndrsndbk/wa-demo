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
      `Supabase selectOne error: ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase selectOne failed");
  }
  const data = await res.json();
  return data[0] || null;
}

async function sbUpsert(env, table, row) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error(
      `Supabase upsert error: ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase upsert failed");
  }
  return res.json().catch(() => null);
}

async function sbUpdate(env, table, filterQuery, patch) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: sbHeaders(env),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error(
      `Supabase update error: ${res.status} ${res.statusText}`,
      await res.text()
    );
    throw new Error("Supabase update failed");
  }
  return res.json().catch(() => null);
}

// ---------- WhatsApp Cloud API helpers ----------

function getWhatsAppConfig(env) {
  const token = env.WHATSAPP_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID");
  }
  return {
    token,
    phoneId,
    apiUrl: `https://graph.facebook.com/v20.0/${phoneId}/messages`,
  };
}

async function sendWhatsAppRequest(env, payload) {
  const { token, apiUrl } = getWhatsAppConfig(env);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(
      "WhatsApp send error:",
      res.status,
      res.statusText,
      body.slice(0, 500)
    );
    throw new Error("WhatsApp message send failed");
  }
  return res.json().catch(() => null);
}

async function sendText(env, to, text) {
  return sendWhatsAppRequest(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

async function sendImage(env, to, imageUrl, caption) {
  return sendWhatsAppRequest(env, {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: caption ? { link: imageUrl, caption } : { link: imageUrl },
  });
}

async function sendInteractiveButtons(env, to, bodyText, buttons) {
  return sendWhatsAppRequest(env, {
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

async function sendInteractiveList(env, to, bodyText, sections) {
  return sendWhatsAppRequest(env, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: "Options",
        sections,
      },
    },
  });
}

// ---------- State helpers (Supabase tables) ----------

async function getCustomer(env, waId) {
  return sbSelectOne(
    env,
    "customers",
    `wa_id=eq.${encodeURIComponent(waId)}`
  );
}

async function ensureCustomer(env, waId, waName) {
  let c = await getCustomer(env, waId);
  if (!c) {
    const row = {
      wa_id: waId,
      wa_name: waName || null,
      created_at: new Date().toISOString(),
    };
    await sbUpsert(env, "customers", row);
    c = await getCustomer(env, waId);
  }
  return c;
}

async function getState(env, waId) {
  return sbSelectOne(env, "states", `wa_id=eq.${encodeURIComponent(waId)}`);
}

async function setState(env, waId, flow, step, extra = {}) {
  const row = {
    wa_id: waId,
    flow,
    step,
    data: extra,
    updated_at: new Date().toISOString(),
  };
  await sbUpsert(env, "states", row);
}

async function clearState(env, waId) {
  const { url } = getSupabaseConfig(env);
  const filterQuery = `wa_id=eq.${encodeURIComponent(waId)}`;
  const res = await fetch(`${url}/rest/v1/states?${filterQuery}`, {
    method: "DELETE",
    headers: sbHeaders(env),
  });
  if (!res.ok) {
    console.error(
      `Supabase delete state error: ${res.status} ${res.statusText}`,
      await res.text()
    );
  }
}

// ---------- Demo stamp card logic ----------

function buildCardUrl(env, stamps) {
  const base = env.CARD_BASE_URL || "";
  return `${base}/card?stamps=${stamps}`;
}

async function recordVisit(env, waId) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/visits`, {
    method: "POST",
    headers: sbHeaders(env),
    body: JSON.stringify({
      wa_id: waId,
      visited_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    console.error(
      "Supabase recordVisit error:",
      res.status,
      res.statusText,
      await res.text()
    );
  }
}

async function getVisitCount(env, waId) {
  const { url } = getSupabaseConfig(env);
  const res = await fetch(
    `${url}/rest/v1/visits?wa_id=eq.${encodeURIComponent(
      waId
    )}&select=count`,
    {
      method: "GET",
      headers: sbHeaders(env),
    }
  );
  if (!res.ok) {
    console.error(
      "Supabase getVisitCount error:",
      res.status,
      res.statusText,
      await res.text()
    );
    return 0;
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data[0] || typeof data[0].count !== "number") {
    return 0;
  }
  return data[0].count;
}

async function resetVisitCount(env, waId) {
  const { url } = getSupabaseConfig(env);
  const filterQuery = `wa_id=eq.${encodeURIComponent(waId)}`;
  const res = await fetch(`${url}/rest/v1/visits?${filterQuery}`, {
    method: "DELETE",
    headers: sbHeaders(env),
  });
  if (!res.ok) {
    console.error(
      "Supabase resetVisitCount error:",
      res.status,
      res.statusText,
      await res.text()
    );
  }
}

// Streak tracking in separate table
async function getStreakState(env, waId) {
  return sbSelectOne(env, "streaks", `wa_id=eq.${encodeURIComponent(waId)}`);
}

async function setStreakState(env, waId, streak, lastVisitIso) {
  const row = {
    wa_id: waId,
    streak,
    last_visit_at: lastVisitIso,
    updated_at: new Date().toISOString(),
  };
  await sbUpsert(env, "streaks", row);
}

async function resetStreakState(env, waId) {
  const { url } = getSupabaseConfig(env);
  const filterQuery = `wa_id=eq.${encodeURIComponent(waId)}`;
  const res = await fetch(`${url}/rest/v1/streaks?${filterQuery}`, {
    method: "DELETE",
    headers: sbHeaders(env),
  });
  if (!res.ok) {
    console.error(
      "Supabase resetStreakState error:",
      res.status,
      res.statusText,
      await res.text()
    );
  }
}

// Will be expanded: meeting bookings, dashboards, etc.

// ---------- Meeting booking helpers ----------

async function startMeetingFlow(env, waId) {
  await setState(env, waId, "meeting", 1);
  await sendText(
    env,
    waId,
    `📅 *Book a meeting*

Reply with a time window that suits you (e.g. "Tuesday morning" or "Any day after 3pm"). I'll send a link to pick a slot.`
  );
}

async function handleMeetingServiceReply(env, waId, replyId, waName) {
  if (replyId === "meeting_service_whatsapp") {
    await sendText(
      env,
      waId,
      `Great, I'll book through WhatsApp. 
For now, here's a Calendly link (placeholder) to pick a time:

https://calendly.com/thepotentialcompany/meta-loyalty-demo`
    );
    await clearState(env, waId);
    return true;
  }

  if (replyId === "meeting_service_google") {
    await sendText(
      env,
      waId,
      `Great, I'll send a Google Meet invite.
For now, here's a Calendly link (placeholder) to pick a time:

https://calendly.com/thepotentialcompany/meta-loyalty-demo`
    );
    await clearState(env, waId);
    return true;
  }

  return false;
}

async function sendMeetingServiceOptions(env, waId, waName) {
  await sendInteractiveButtons(
    env,
    waId,
    `How would you like to meet?`,
    [
      { id: "meeting_service_whatsapp", title: "WhatsApp Call" },
      { id: "meeting_service_google", title: "Google Meet" },
    ]
  );
}

// ---------- "More" menu helpers ----------

async function sendMoreMenu(env, waId) {
  await sendInteractiveButtons(
    env,
    waId,
    `What would you like to see next?`,
    [
      { id: "more_streak", title: "Streak Demo" },
      { id: "more_dash", title: "Dashboard" },
    ]
  );
}

// ---------- Signup flow helpers ----------

async function startSignupFlow(env, waId, waName) {
  await setState(env, waId, "signup", 1, {});
  await sendText(
    env,
    waId,
    `Awesome ${waName || ""}! Let's set up a quick demo profile.

What's the *name of your business*?`
  );
}

async function handleSignupStep(env, waId, text, waName) {
  const st = await getState(env, waId);
  if (!st || st.flow !== "signup") return false;

  const step = st.step || 1;
  const data = st.data || {};

  if (step === 1) {
    data.business_name = text;
    await setState(env, waId, "signup", 2, data);
    await sendText(
      env,
      waId,
      `Nice. Which *industry* best describes your business? (e.g. "Coffee shop", "Restaurant", "Gym")`
    );
    return true;
  }

  if (step === 2) {
    data.industry = text;
    await setState(env, waId, "signup", 3, data);
    await sendText(
      env,
      waId,
      `Thanks! Roughly how many *customers per month* do you serve?`
    );
    return true;
  }

  if (step === 3) {
    data.customer_volume = text;
    await setState(env, waId, "signup", 4, data);
    await sendText(
      env,
      waId,
      `Got it. Last question: what's your *best contact email*?`
    );
    return true;
  }

  if (step === 4) {
    data.email = text;
    await setState(env, waId, "signup", 5, data);

    const { url } = getSupabaseConfig(env);
    await fetch(`${url}/rest/v1/signup_leads`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({
        wa_id: waId,
        wa_name: waName || null,
        business_name: data.business_name || null,
        industry: data.industry || null,
        customer_volume: data.customer_volume || null,
        email: data.email || null,
        created_at: new Date().toISOString(),
      }),
    }).catch((err) => console.error("signup_leads insert error", err));

    await sendText(
      env,
      waId,
      `✅ Thanks! You're all set.

I'll follow up soon with a personalised demo and next steps.`
    );
    await clearState(env, waId);
    return true;
  }

  return false;
}

async function handleSignupInteractiveStep2(env, waId, replyId) {
  if (!replyId || !replyId.startsWith("signup_industry_")) return false;
  const industry = replyId.replace("signup_industry_", "").replace(/_/g, " ");

  const st = await getState(env, waId);
  if (!st || st.flow !== "signup") return false;
  const data = st.data || {};
  data.industry = industry;

  await setState(env, waId, "signup", 3, data);
  await sendText(
    env,
    waId,
    `Got it. Roughly how many *customers per month* do you serve?`
  );
  return true;
}

// ---------- Streak demo helpers ----------

async function handleStreakCommand(env, waId) {
  await recordVisit(env, waId);

  const visits = await getVisitCount(env, waId);
  const stamps = Math.min(10, visits);

  const shareLink = `https://wa.me/${waId}?text=DEMO`;

  await sendImage(env, waId, buildCardUrl(env, stamps));

  const streakState = await getStreakState(env, waId);
  const now = new Date();
  const lastVisit = streakState?.last_visit_at
    ? new Date(streakState.last_visit_at)
    : null;

  let newStreak = 1;

  if (lastVisit) {
    const diffMs = now - lastVisit;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 2) {
      newStreak = (streakState?.streak || 0) + 1;
    } else {
      newStreak = 1;
    }
  }

  await setStreakState(env, waId, newStreak, now.toISOString());

  if (newStreak > 1) {
    await sendText(
      env,
      waId,
      `🔥 You're on a streak: *${newStreak} visits* in a row!

(Imagine we trigger this automatically when your customers visit multiple times in a short period.)`
    );
  } else {
    await sendText(
      env,
      waId,
      `Thanks for visiting again! You've now stamped your card *${stamps}* time(s).

(For real customers, we'd track this automatically from your POS or ordering system.)`
    );
  }

  if (visits >= 10) {
    await sendText(
      env,
      waId,
      `🎁 In a real system, you'd now unlock a *free coffee* or chosen reward.

Here it's just a demo – but this is how the logic would work.`
    );
  }

  await sendInteractiveButtons(env, waId, `What would you like to do next?`, [
    { id: "more_streak", title: "Streak again" },
    { id: "more_dash", title: "Dashboard" },
  ]);
}

// ---------- Dashboard helpers ----------

async function sendDashboardLink(env, waId) {
  const dashboardUrl =
    env.DASHBOARD_URL ||
    "https://tpc-demo-dashboard.pages.dev/demo-dashboard";
  await sendText(
    env,
    waId,
    `📊 Here's a simple *demo dashboard* that could connect to your loyalty system:

${dashboardUrl}

(Imagine this being your real-time view of visits, streaks, and rewards.)`
  );
}

// ---------- Edu content helpers ----------

async function handleEduMedia(env, waId, message) {
  if (message.type !== "text") return false;
  const text = (message.text?.body || "").trim().toUpperCase();
  if (text !== "EDU") return false;

  const yt = env.EDU_YT_URL || "https://youtu.be/nX5SfBdnHHU";
  const yt2 = env.EDU_YT2_URL || "https://youtu.be/px87QNYduwI";

  await sendText(
    env,
    waId,
    `🎓 *Meta Loyalty Systems – Product Videos*

1️⃣ Overview: ${yt}
2️⃣ Stamp card & gamification: ${yt2}

(Short videos showing how the system works from both the customer and owner side.)`
  );
  return true;
}

async function handleEduInteractive(env, waId, replyId) {
  if (!replyId?.startsWith("edu_")) return false;

  const yt = env.EDU_YT_URL || "https://youtu.be/nX5SfBdnHHU";
  const yt2 = env.EDU_YT2_URL || "https://youtu.be/px87QNYduwI";

  if (replyId === "edu_overview") {
    await sendText(env, waId, `Overview video:\n${yt}`);
    return true;
  }
  if (replyId === "edu_stamp") {
    await sendText(env, waId, `Stamp card & gamification:\n${yt2}`);
    return true;
  }

  return false;
}

// ---------- Demo flow helpers ----------

async function startDemoFlow(env, waId, waName) {
  await ensureCustomer(env, waId, waName);
  await resetVisitCount(env, waId);
  await resetStreakState(env, waId);
  await clearState(env, waId);

  await sendText(
    env,
    waId,
    `👋 *Welcome to the Meta Loyalty Stamp-Card Demo.*

We'll simulate a simple coffee shop:
- Each visit = 1 stamp
- 10 stamps = 1 free coffee
- We'll also show how we could detect *streaks* (multiple visits in a short time) and surprise customers with extra rewards.

Reply *VISIT* to simulate a customer visit.`
  );

  await sendImage(env, waId, buildCardUrl(env, 0));
  await setState(env, waId, "demo", 0, {});
}

async function handleDemoVisit(env, waId, text) {
  const token = text.trim().toUpperCase();
  if (token !== "VISIT") return false;

  const st = await getState(env, waId);
  if (!st || st.flow !== "demo") {
    return false;
  }

  await recordVisit(env, waId);
  const visits = await getVisitCount(env, waId);

  const stamps = Math.min(10, visits);
  await sendImage(env, waId, buildCardUrl(env, stamps));

  if (visits < 10) {
    await sendText(
      env,
      waId,
      `Nice! You've now got *${stamps}* stamp(s) on your card.

Reply *VISIT* again to simulate another visit.`
    );
  } else {
    await sendText(
      env,
      waId,
      `🎉 You've reached *10 stamps* – in a real system, you'd now unlock a free coffee or reward.

Next, we'll show how streaks and surprise bonuses could work. Reply *STREAK* to continue.`
    );
    await setState(env, waId, "demo_streak_intro", 0, {});
  }

  return true;
}

async function handleDemoStreakIntro(env, waId, text) {
  const token = text.trim().toUpperCase();
  if (token !== "STREAK") return false;

  const st = await getState(env, waId);
  if (!st || st.flow !== "demo_streak_intro") return false;

  await sendText(
    env,
    waId,
    `Great. Now we'll pretend this customer keeps visiting regularly.

We'll simulate visits and show how a *streak* can trigger extra rewards or personalised messages.

Reply *GO* to simulate the streak visits.`
  );

  await setState(env, waId, "demo_streak", 0, {});
  return true;
}

async function handleDemoStreak(env, waId, text) {
  const token = text.trim().toUpperCase();
  if (token !== "GO") return false;

  const st = await getState(env, waId);
  if (!st || st.flow !== "demo_streak") return false;

  const visits = await getVisitCount(env, waId);
  const next = visits + 1;

  await recordVisit(env, waId);

  const cardVisits = Math.min(10, next);
  await sendImage(env, waId, buildCardUrl(env, cardVisits));

  const streakState = await getStreakState(env, waId);
  const now = new Date();
  const lastVisit = streakState?.last_visit_at
    ? new Date(streakState.last_visit_at)
    : null;

  let newStreak = 1;
  if (lastVisit) {
    const diffMs = now - lastVisit;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 2) {
      newStreak = (streakState?.streak || 0) + 1;
    } else {
      newStreak = 1;
    }
  }
  await setStreakState(env, waId, newStreak, now.toISOString());

  const shareLink = `https://wa.me/${waId}?text=DEMO`;

  if (newStreak >= 3) {
    await sendText(
      env,
      waId,
      `🔥 This customer has visited *${newStreak} times in a row*.

We could:
- send them double stamps,
- invite them to try a new menu item,
- or simply say "thanks" in a personalised way.`
    );
  } else {
    await sendText(
      env,
      waId,
      `Visit recorded. Streaks are how we detect your most engaged customers – a bit like Netflix tracking how often you watch a show.`
    );
  }

  if (next >= 5) {
    const streakCardVisits = Math.min(10, next + 1);
    await sendImage(env, waId, buildCardUrl(env, streakCardVisits));
    await sendInteractiveButtons(
      env,
      waId,
      `🎉 *Demo complete.*

Here's the link to share the demo:
${shareLink}

What would you like to do next?`,
      [
        { id: "more_features", title: "MORE" },
        { id: "book_meeting", title: "MEETING" },
      ]
    );

    await setState(env, waId, "demo_complete", 0, {});
  } else {
    await sendText(
      env,
      waId,
      `Reply *GO* again to simulate more streak visits.`
    );
    await setState(env, waId, "demo_streak", next, {});
  }

  return true;
}

// ---------- Main handler ----------

export default {
  async onRequestPost({ request, env }) {
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
      const profile = contacts[0]?.profile || {};
      const waName = profile.name || null;

      const type = message.type;

      await ensureCustomer(env, from, waName);

      if (type === "text") {
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

        if (
          replyId &&
          (await handleMeetingServiceReply(env, from, replyId, waName))
        ) {
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

        // NEW: handle buttons from the "Demo complete" card
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

        if (token === "VISIT") {
          if (await handleDemoVisit(env, from, raw)) {
            return new Response("ok", { status: 200 });
          }
        }

        if (token === "STREAK") {
          if (await handleDemoStreakIntro(env, from, raw)) {
            return new Response("ok", { status: 200 });
          }
        }

        if (token === "GO") {
          if (await handleDemoStreak(env, from, raw)) {
            return new Response("ok", { status: 200 });
          }
        }

        if (token === "MEETING") {
          await startMeetingFlow(env, from);
          return new Response("ok", { status: 200 });
        }

        if (token === "MORE") {
          await sendMoreMenu(env, from);
          return new Response("ok", { status: 200 });
        }

        if (await handleSignupStep(env, from, raw, waName)) {
          return new Response("ok", { status: 200 });
        }

        const st = await getState(env, from);
        if (st?.flow === "meeting" && st.step === 1) {
          await sendMeetingServiceOptions(env, from, waName);
          await setState(env, from, "meeting", 2, {
            window: raw,
          });
          return new Response("ok", { status: 200 });
        }

        await sendText(
          env,
          from,
          `Hi ${
            waName || ""
          } 👋

This is a demo of *Meta Loyalty Systems* – stamp cards, streak-based rewards, and dashboards built on WhatsApp.

Reply:
- *DEMO* to see the stamp card demo
- *SIGNUP* if you're a business owner wanting a tailored walkthrough
- *EDU* for short explainer videos
`
        );
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    } catch (err) {
      console.error("webhook error:", err);
      return new Response("error", { status: 500 });
    }
  },

  async onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }

    return new Response("forbidden", { status: 403 });
  },
};
