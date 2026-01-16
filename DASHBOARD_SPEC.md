# TPC OS Dashboard - Complete Specification

## Overview
Build a sleek, minimalist, mobile-first dashboard that connects to Supabase to display weekly reflection logs with AI-powered summaries using Grok (xAI).

## Tech Stack
- **Frontend**: Pure HTML, CSS, JavaScript (no frameworks)
- **Database**: Supabase (PostgreSQL with REST API)
- **AI**: Grok API (xAI) for summaries
- **Hosting**: GitHub Pages
- **Authentication**: Supabase service role key (read-only)

---

## Design Requirements

### Visual Style
- **Mobile-first**: Optimized for phones, responsive for desktop
- **Minimalist**: Clean, spacious layout with ample whitespace
- **Color Scheme**:
  - Background: White or very light gray (#F9FAFB)
  - Primary: Dark blue/navy (#1E293B)
  - Accent: Teal/cyan (#06B6D4)
  - Text: Dark gray (#334155)
  - Cards: White with subtle shadow
- **Typography**:
  - Headers: Inter or System UI (sans-serif)
  - Body: 16px base, line-height 1.6
  - Monospace for numbers/stats
- **Layout**: Single column, cards stacked vertically with rounded corners

---

## Components

### 1. Header
```
┌─────────────────────────────┐
│         TPC OS              │
│    (logo/icon optional)     │
└─────────────────────────────┘
```
- Centered title "TPC OS"
- Subtitle: "Weekly Reflection System"
- Minimal, clean typography

### 2. Stats Scorecards (3 cards in grid)
```
┌───────┬───────┬───────┐
│ Logs  │ Days  │ Week  │
│  15   │   3   │   2   │
└───────┴───────┴───────┘
```

**Card 1: Learnings Logged**
- Label: "Learnings Logged"
- Value: Total count of logs from `weekly_reflection_logs`
- Style: Large number (48px), bold

**Card 2: Days Since Last Log**
- Label: "Days Since Last Log"
- Value: Calculate from most recent `created_at`
- Formula: `floor((now - last_log_date) / 86400000)`
- Color: Green if ≤7 days, Yellow if 8-14, Red if >14

**Card 3: Current Week**
- Label: "Current Week"
- Value: ISO week number
- Small text: "(Week of [year])"

### 3. Action Buttons (2 large buttons)

**Button 1: Get Summary - All Time**
```
┌─────────────────────────────┐
│   Get Summary - All Time    │
│         (AI Icon)            │
└─────────────────────────────┘
```
- Full width on mobile
- Primary color background
- Icon: AI/robot/sparkle
- On click: Fetch ALL logs → send to Grok → display summary

**Button 2: Recent Reflections**
```
┌─────────────────────────────┐
│    Recent Reflections        │
│         (Calendar Icon)      │
└─────────────────────────────┘
```
- Full width on mobile
- Secondary/outline style
- Icon: Calendar/clock
- On click: Fetch 2 most recent logs → send to Grok → display analysis

### 4. Summary Display Section
```
┌─────────────────────────────┐
│  📊 Ray Dalio Analysis      │
│                             │
│  [Grok summary appears here]│
│                             │
│  - Wins: ...                │
│  - Key Learnings: ...       │
│  - Patterns: ...            │
│                             │
└─────────────────────────────┘
```
- Hidden by default
- Appears below buttons when AI generates summary
- Markdown-style formatting
- Loading spinner while processing
- Collapsible/dismissible

---

## Technical Implementation

### File Structure
```
tpc-os-dashboard/
├── index.html          (Main dashboard)
├── styles.css          (All styles)
├── app.js              (Main logic)
├── config.js           (Supabase + Grok config)
└── README.md           (Setup instructions)
```

### Configuration (config.js)
```javascript
const CONFIG = {
  supabase: {
    url: 'YOUR_SUPABASE_URL',
    anonKey: 'YOUR_SUPABASE_ANON_KEY', // Read-only key
  },
  grok: {
    apiKey: 'YOUR_XAI_API_KEY',
    model: 'grok-beta',
  },
  phoneNumber: 'YOUR_PHONE_NUMBER', // Filter logs by this number
};
```

### API Endpoints

#### 1. Fetch Stats
```javascript
// Count total logs
GET {supabase_url}/rest/v1/weekly_reflection_logs?select=count&wa_from=eq.{phone}

// Get latest log date
GET {supabase_url}/rest/v1/weekly_reflection_logs?select=created_at&wa_from=eq.{phone}&order=created_at.desc&limit=1
```

#### 2. Fetch All Logs (for All-Time Summary)
```javascript
GET {supabase_url}/rest/v1/weekly_reflection_logs?select=log_date,week_number,transcript_text,structured_json&wa_from=eq.{phone}&order=log_date.desc
```

#### 3. Fetch Recent 2 Logs
```javascript
GET {supabase_url}/rest/v1/weekly_reflection_logs?select=log_date,week_number,transcript_text,structured_json&wa_from=eq.{phone}&order=created_at.desc&limit=2
```

### Grok API Integration

#### Prompt for "All-Time Summary"
```javascript
const systemPrompt = `You are Ray Dalio's AI analyst. Analyze these weekly reflection logs and provide a comprehensive summary in Ray Dalio's style (from "Principles").

Structure your response as:
1. **Key Patterns Observed**: Recurring themes across weeks
2. **Major Wins & Progress**: Significant achievements
3. **Critical Learnings**: Most important lessons learned
4. **Systematic Errors**: Repeated mistakes or gaps
5. **Strategic Insights**: Big-picture observations
6. **Recommended Principles**: 2-3 actionable principles based on the data

Use Ray Dalio's direct, honest, and principle-driven tone. Be specific and reference patterns from the logs.`;

const userPrompt = `Here are ${logCount} weeks of reflection logs:\n\n${logsFormatted}`;

// POST to https://api.x.ai/v1/chat/completions
{
  model: "grok-beta",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  temperature: 0.5,
  max_tokens: 2000
}
```

#### Prompt for "Recent Reflections"
```javascript
const systemPrompt = `You are Ray Dalio's AI coach. Analyze these 2 most recent weekly reflection logs and provide actionable feedback in Ray Dalio's style.

Structure your response as:
1. **Recent Progress**: What's working well
2. **Emerging Challenges**: New or recurring issues
3. **Immediate Lessons**: Key takeaways from these 2 weeks
4. **Action Items**: 3-5 specific actions for next week
5. **Mindset Check**: Observations on emotional/strategic state

Be direct, constructive, and principle-focused. Compare the 2 weeks to identify trends.`;

const userPrompt = `Last 2 weeks of reflections:\n\nWeek ${week1}:\n${log1}\n\nWeek ${week2}:\n${log2}`;

// POST to https://api.x.ai/v1/chat/completions
{
  model: "grok-beta",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  temperature: 0.5,
  max_tokens: 1500
}
```

---

## User Flow

### Initial Load
1. Page loads with header and empty stats
2. Fetch stats from Supabase (count, last log date, current week)
3. Display stats in scorecards
4. Buttons are enabled and ready

### Click "Get Summary - All Time"
1. Button shows loading spinner
2. Fetch ALL logs from Supabase (filtered by phone number)
3. Format logs into readable text
4. Send to Grok with "All-Time Summary" prompt
5. Display Grok's response in summary section below
6. Show success message

### Click "Recent Reflections"
1. Button shows loading spinner
2. Fetch 2 most recent logs from Supabase
3. Format logs with week numbers and dates
4. Send to Grok with "Recent Reflections" prompt
5. Display Grok's response in summary section below
6. Show success message

### Error Handling
- Show friendly error messages if:
  - Supabase fetch fails (network issue)
  - No logs found (prompt user to create first log)
  - Grok API fails (show logs anyway, AI summary unavailable)
  - API keys missing/invalid

---

## Mobile Responsiveness

### Breakpoints
```css
/* Mobile (default) */
@media (max-width: 767px) {
  - Single column layout
  - Full-width buttons
  - Stats cards in 3 columns (tight grid)
  - 16px padding
}

/* Tablet */
@media (min-width: 768px) and (max-width: 1023px) {
  - Max width 600px, centered
  - Stats cards with more spacing
  - Larger touch targets
}

/* Desktop */
@media (min-width: 1024px) {
  - Max width 800px, centered
  - Stats cards in comfortable 3-column grid
  - Buttons side-by-side (50% each)
  - Larger typography
}
```

---

## Sample HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TPC OS - Weekly Reflection Dashboard</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <h1 class="title">TPC OS</h1>
      <p class="subtitle">Weekly Reflection System</p>
    </header>

    <!-- Stats Scorecards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Learnings Logged</div>
        <div class="stat-value" id="total-logs">--</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Days Since Last Log</div>
        <div class="stat-value" id="days-since">--</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Current Week</div>
        <div class="stat-value" id="current-week">--</div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="actions">
      <button class="btn btn-primary" id="btn-all-time">
        <span class="btn-icon">🤖</span>
        <span class="btn-text">Get Summary - All Time</span>
      </button>
      <button class="btn btn-secondary" id="btn-recent">
        <span class="btn-icon">📅</span>
        <span class="btn-text">Recent Reflections</span>
      </button>
    </div>

    <!-- Summary Display -->
    <div class="summary-section" id="summary-section" style="display: none;">
      <div class="summary-header">
        <h2 class="summary-title" id="summary-title">Analysis</h2>
        <button class="btn-close" id="btn-close-summary">✕</button>
      </div>
      <div class="summary-content" id="summary-content">
        <!-- Grok response appears here -->
      </div>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loading-overlay" style="display: none;">
      <div class="spinner"></div>
      <p class="loading-text">Analyzing your reflections...</p>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <p>Powered by Grok AI & Supabase</p>
    </footer>
  </div>

  <script src="config.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

---

## Sample CSS (Key Styles)

```css
/* Modern, mobile-first CSS */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  background: #F9FAFB;
  color: #334155;
  line-height: 1.6;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
}

.header {
  text-align: center;
  padding: 2rem 0 1rem;
}

.title {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1E293B;
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 0.9rem;
  color: #64748B;
  margin-top: 0.25rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin: 1.5rem 0;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 1.25rem 0.75rem;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.stat-label {
  font-size: 0.75rem;
  color: #64748B;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #1E293B;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 2rem 0;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #06B6D4;
  color: white;
}

.btn-primary:hover {
  background: #0891B2;
  transform: translateY(-1px);
}

.btn-secondary {
  background: white;
  color: #1E293B;
  border: 2px solid #E2E8F0;
}

.btn-secondary:hover {
  border-color: #06B6D4;
  color: #06B6D4;
}

.summary-section {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-top: 2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.summary-content {
  line-height: 1.8;
  white-space: pre-wrap;
}

/* Responsive */
@media (min-width: 768px) {
  .actions {
    flex-direction: row;
  }

  .btn {
    flex: 1;
  }
}
```

---

## Sample JavaScript (app.js skeleton)

```javascript
// app.js - Main dashboard logic

// Load stats on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
});

async function loadStats() {
  try {
    // Fetch total logs count
    const countRes = await fetch(
      `${CONFIG.supabase.url}/rest/v1/weekly_reflection_logs?select=id&wa_from=eq.${CONFIG.phoneNumber}`,
      {
        headers: {
          'apikey': CONFIG.supabase.anonKey,
          'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        }
      }
    );
    const logs = await countRes.json();
    document.getElementById('total-logs').textContent = logs.length;

    // Fetch latest log date
    const latestRes = await fetch(
      `${CONFIG.supabase.url}/rest/v1/weekly_reflection_logs?select=created_at&wa_from=eq.${CONFIG.phoneNumber}&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey': CONFIG.supabase.anonKey,
          'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        }
      }
    );
    const latest = await latestRes.json();
    if (latest.length > 0) {
      const daysSince = Math.floor((Date.now() - new Date(latest[0].created_at)) / 86400000);
      document.getElementById('days-since').textContent = daysSince;
    }

    // Display current week
    const currentWeek = getISOWeek(new Date());
    document.getElementById('current-week').textContent = currentWeek;

  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function setupEventListeners() {
  document.getElementById('btn-all-time').addEventListener('click', handleAllTimeSummary);
  document.getElementById('btn-recent').addEventListener('click', handleRecentReflections);
  document.getElementById('btn-close-summary').addEventListener('click', closeSummary);
}

async function handleAllTimeSummary() {
  showLoading();

  try {
    // Fetch all logs
    const res = await fetch(
      `${CONFIG.supabase.url}/rest/v1/weekly_reflection_logs?select=log_date,week_number,structured_json&wa_from=eq.${CONFIG.phoneNumber}&order=log_date.desc`,
      {
        headers: {
          'apikey': CONFIG.supabase.anonKey,
          'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        }
      }
    );
    const logs = await res.json();

    // Format for Grok
    const logsText = logs.map(log => {
      return `Week ${log.week_number} (${log.log_date}):\n${JSON.stringify(log.structured_json, null, 2)}`;
    }).join('\n\n');

    // Call Grok
    const summary = await getGrokSummary(logsText, 'all-time');

    // Display
    showSummary('All-Time Analysis', summary);

  } catch (error) {
    console.error('Error:', error);
    alert('Failed to generate summary. Check console for details.');
  } finally {
    hideLoading();
  }
}

async function handleRecentReflections() {
  showLoading();

  try {
    // Fetch 2 most recent logs
    const res = await fetch(
      `${CONFIG.supabase.url}/rest/v1/weekly_reflection_logs?select=log_date,week_number,structured_json&wa_from=eq.${CONFIG.phoneNumber}&order=created_at.desc&limit=2`,
      {
        headers: {
          'apikey': CONFIG.supabase.anonKey,
          'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        }
      }
    );
    const logs = await res.json();

    // Format for Grok
    const logsText = logs.map(log => {
      return `Week ${log.week_number} (${log.log_date}):\n${JSON.stringify(log.structured_json, null, 2)}`;
    }).join('\n\n');

    // Call Grok
    const summary = await getGrokSummary(logsText, 'recent');

    // Display
    showSummary('Recent Reflections Analysis', summary);

  } catch (error) {
    console.error('Error:', error);
    alert('Failed to generate analysis. Check console for details.');
  } finally {
    hideLoading();
  }
}

async function getGrokSummary(logsText, type) {
  const systemPrompts = {
    'all-time': `You are Ray Dalio's AI analyst. Analyze these weekly reflection logs and provide a comprehensive summary in Ray Dalio's style (from "Principles").

Structure your response as:
1. **Key Patterns Observed**: Recurring themes across weeks
2. **Major Wins & Progress**: Significant achievements
3. **Critical Learnings**: Most important lessons learned
4. **Systematic Errors**: Repeated mistakes or gaps
5. **Strategic Insights**: Big-picture observations
6. **Recommended Principles**: 2-3 actionable principles based on the data

Use Ray Dalio's direct, honest, and principle-driven tone.`,

    'recent': `You are Ray Dalio's AI coach. Analyze these 2 most recent weekly reflection logs and provide actionable feedback in Ray Dalio's style.

Structure your response as:
1. **Recent Progress**: What's working well
2. **Emerging Challenges**: New or recurring issues
3. **Immediate Lessons**: Key takeaways from these 2 weeks
4. **Action Items**: 3-5 specific actions for next week
5. **Mindset Check**: Observations on emotional/strategic state`
  };

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.grok.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [
        { role: 'system', content: systemPrompts[type] },
        { role: 'user', content: logsText }
      ],
      temperature: 0.5,
      max_tokens: type === 'all-time' ? 2000 : 1500,
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

function showSummary(title, content) {
  document.getElementById('summary-title').textContent = title;
  document.getElementById('summary-content').textContent = content;
  document.getElementById('summary-section').style.display = 'block';
  document.getElementById('summary-section').scrollIntoView({ behavior: 'smooth' });
}

function closeSummary() {
  document.getElementById('summary-section').style.display = 'none';
}

function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
```

---

## Setup Instructions for GitHub Pages

### 1. Create Repository
```bash
# On GitHub: Create new repo "tpc-os-dashboard"
git clone https://github.com/YOUR_USERNAME/tpc-os-dashboard.git
cd tpc-os-dashboard
```

### 2. Add Files
```
tpc-os-dashboard/
├── index.html
├── styles.css
├── app.js
├── config.js
└── README.md
```

### 3. Configure config.js
```javascript
const CONFIG = {
  supabase: {
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key-here', // Read-only
  },
  grok: {
    apiKey: 'xai-your-key-here',
    model: 'grok-beta',
  },
  phoneNumber: 'YOUR_WHATSAPP_NUMBER',
};
```

### 4. Enable GitHub Pages
1. Go to repo **Settings** → **Pages**
2. Source: **Deploy from branch**
3. Branch: **main** → **/root**
4. Click **Save**
5. Wait 1-2 minutes for deployment
6. Visit: `https://YOUR_USERNAME.github.io/tpc-os-dashboard/`

---

## Security Notes

⚠️ **IMPORTANT**:
- Use Supabase **anon key** (not service role key) for public dashboard
- Set up Row Level Security (RLS) in Supabase to restrict access by `wa_from`
- Consider adding simple password protection for Grok API key exposure
- Or use Supabase Edge Functions to proxy Grok API calls (hide key server-side)

### Option: Password Protection
Add simple password prompt before loading dashboard:
```javascript
const DASHBOARD_PASSWORD = 'your-secure-password';
const enteredPassword = prompt('Enter dashboard password:');
if (enteredPassword !== DASHBOARD_PASSWORD) {
  document.body.innerHTML = '<h1>Access Denied</h1>';
}
```

---

## Testing Checklist

- [ ] Stats load correctly on page load
- [ ] "Days Since Last Log" calculates properly
- [ ] "Get Summary - All Time" fetches all logs
- [ ] "Recent Reflections" fetches only 2 logs
- [ ] Grok summaries display in Ray Dalio style
- [ ] Loading spinners appear during API calls
- [ ] Error messages display if API fails
- [ ] Responsive on mobile (320px width)
- [ ] Responsive on tablet (768px)
- [ ] Responsive on desktop (1024px+)
- [ ] Close button works on summary section
- [ ] GitHub Pages deployment successful

---

## Future Enhancements (Optional)

1. **Charts**: Add Chart.js for weekly log frequency visualization
2. **Search**: Filter logs by keyword in structured_json
3. **Export**: Download all logs as JSON/PDF
4. **Dark Mode**: Toggle for dark theme
5. **Multi-user**: Support multiple phone numbers with login
6. **Notifications**: Browser notifications for missed logs

---

## Summary

This dashboard provides a clean, mobile-first interface to:
1. View reflection log statistics
2. Generate AI-powered summaries of all-time data
3. Get recent reflections analysis
4. All using pure HTML/CSS/JS for easy GitHub Pages hosting

**Next Steps**: Use this spec to build the dashboard, or provide it to an AI coding assistant (like me!) to generate the complete code files.
