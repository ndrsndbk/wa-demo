// Cloudflare Pages Function: Qmunity Queue API
// Returns aggregated queue data for the dashboard
// No external npm deps; Supabase via REST.

// ---------- Supabase REST helpers (copied from webhook.js) ----------

function getSupabaseConfig(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/KEY");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function sbHeaders(env) {
  const { key } = getSupabaseConfig(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function sbSelect(env, table, filterQuery, columns = "*") {
  const { url } = getSupabaseConfig(env);
  const queryStr = filterQuery ? `?${filterQuery}&` : "?";
  const res = await fetch(
    `${url}/rest/v1/${table}${queryStr}select=${encodeURIComponent(columns)}`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) {
    console.error(
      `Supabase select ${table} error`,
      res.status,
      await res.text()
    );
    return [];
  }
  return await res.json();
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

// ---------- Timezone helpers ----------

// Get today's date boundaries in Africa/Johannesburg timezone (UTC+2)
function getTodayBoundariesSAST() {
  const now = new Date();
  // Africa/Johannesburg is UTC+2
  const offsetMs = 2 * 60 * 60 * 1000;

  // Get current time in SAST
  const sastNow = new Date(now.getTime() + offsetMs + now.getTimezoneOffset() * 60000);

  // Get start of today in SAST
  const startOfDaySAST = new Date(sastNow);
  startOfDaySAST.setHours(0, 0, 0, 0);

  // Convert back to UTC for database queries
  const startOfDayUTC = new Date(startOfDaySAST.getTime() - offsetMs - now.getTimezoneOffset() * 60000);

  // End of day
  const endOfDaySAST = new Date(sastNow);
  endOfDaySAST.setHours(23, 59, 59, 999);
  const endOfDayUTC = new Date(endOfDaySAST.getTime() - offsetMs - now.getTimezoneOffset() * 60000);

  return {
    start: startOfDayUTC.toISOString(),
    end: endOfDayUTC.toISOString(),
  };
}

// Format relative time (e.g., "5 min ago")
function formatTimeAgo(isoString) {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// ---------- GET: /qmunity?location=home-affairs ----------

export async function onRequestGet({ request, env }) {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const url = new URL(request.url);
    const locationSlug = url.searchParams.get("location") || "home-affairs";

    // Get the location
    const location = await sbSelectOne(
      env,
      "qmunity_locations",
      `slug=eq.${encodeURIComponent(locationSlug)}&is_active=eq.true`,
      "id,slug,name,max_capacity"
    );

    if (!location) {
      return new Response(
        JSON.stringify({ error: "Location not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    const { start: todayStart, end: todayEnd } = getTodayBoundariesSAST();

    // Fetch check-ins for today
    const checkinsToday = await sbSelect(
      env,
      "qmunity_checkins",
      `location_id=eq.${location.id}&created_at=gte.${todayStart}&created_at=lte.${todayEnd}&order=created_at.desc`,
      "id,wa_from,queue_number,created_at"
    );

    // Fetch speed reports for today
    const speedReportsToday = await sbSelect(
      env,
      "qmunity_speed_reports",
      `location_id=eq.${location.id}&created_at=gte.${todayStart}&created_at=lte.${todayEnd}`,
      "id,speed,created_at"
    );

    // Fetch recent issues (last 24 hours, limit 10)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentIssues = await sbSelect(
      env,
      "qmunity_issues",
      `location_id=eq.${location.id}&created_at=gte.${oneDayAgo}&order=created_at.desc&limit=10`,
      "id,message,created_at"
    );

    // Calculate stats
    const totalCheckins = checkinsToday.length;

    // Unique check-ins (by wa_from)
    const uniquePhones = new Set(checkinsToday.map((c) => c.wa_from));
    const uniqueCheckins = uniquePhones.size;

    // Latest queue number (most recent check-in)
    const latestQueueNumber = checkinsToday.length > 0
      ? checkinsToday[0].queue_number
      : null;

    // Latest capacity percentage
    const latestCapacityPct = latestQueueNumber !== null
      ? Math.round((latestQueueNumber / location.max_capacity) * 100)
      : null;

    // Speed distribution
    const speedDistribution = {
      QUICKLY: 0,
      MODERATELY: 0,
      SLOW: 0,
    };
    for (const sr of speedReportsToday) {
      if (speedDistribution.hasOwnProperty(sr.speed)) {
        speedDistribution[sr.speed]++;
      }
    }

    // Format issues with time ago
    const formattedIssues = recentIssues.map((issue) => ({
      message: issue.message,
      created_at: issue.created_at,
      time_ago: formatTimeAgo(issue.created_at),
    }));

    // Build response
    const responseData = {
      location: {
        slug: location.slug,
        name: location.name,
        max_capacity: location.max_capacity,
      },
      latest_capacity_pct: latestCapacityPct,
      latest_queue_number: latestQueueNumber,
      checkins_today: totalCheckins,
      unique_checkins_today: uniqueCheckins,
      speed_today: speedDistribution,
      recent_issues: formattedIssues,
      fetched_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("Qmunity API error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
