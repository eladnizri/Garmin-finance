'use strict';

/* =========================================================================
 * garmin-api.js — Garmin Personal API client (browser-side).
 *
 * Auth flow: API key → POST /oauth/token → 24h access token → Bearer header.
 * All requests go through the CORS proxy (Cloudflare Worker).
 *
 * Env/config stored in localStorage:
 *   garmin_api_key   — the user's Personal API consumer key
 *   garmin_proxy_url — the worker URL (e.g. https://garmin-proxy.xxx.workers.dev)
 *   garmin_token     — cached { access_token, expires_at }
 * ========================================================================= */

const GARMIN_KEY_LS   = 'garmin_api_key';
const GARMIN_PROXY_LS = 'garmin_proxy_url';
const GARMIN_TOKEN_LS = 'garmin_token';

const DEFAULT_PROXY = 'https://gytxwjlicawlfdehszil.supabase.co/functions/v1/garmin-proxy';

function garminApiKey()  { try { return localStorage.getItem(GARMIN_KEY_LS) || ''; } catch { return ''; } }
function garminProxy()   { try { return localStorage.getItem(GARMIN_PROXY_LS) || DEFAULT_PROXY; } catch { return DEFAULT_PROXY; } }
function setGarminKey(k) { try { localStorage.setItem(GARMIN_KEY_LS, k); } catch {} }
function setGarminProxy(u) { try { localStorage.setItem(GARMIN_PROXY_LS, u); } catch {} }

function hasGarminSetup() { return !!(garminApiKey() && garminProxy()); }

/* --- Token management -------------------------------------------------- */

function _cachedToken() {
  try {
    const raw = localStorage.getItem(GARMIN_TOKEN_LS);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t.expires_at > Date.now() + 60_000) return t.access_token;
  } catch {}
  return null;
}

async function getAccessToken() {
  const cached = _cachedToken();
  if (cached) return cached;

  const proxy = garminProxy();
  const key = garminApiKey();
  if (!proxy || !key) throw new Error('SETUP');

  const res = await fetch(`${proxy}/oauth-service/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: key }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new Error('INVALID_KEY');
    throw new Error(`TOKEN_${res.status}: ${text.slice(0, 200)}`);
  }

  // Garmin returns the token as plain text
  const accessToken = (await res.text()).trim();
  if (!accessToken) throw new Error('EMPTY_TOKEN');

  try {
    localStorage.setItem(GARMIN_TOKEN_LS, JSON.stringify({
      access_token: accessToken,
      expires_at: Date.now() + 23 * 3600_000, // refresh ~1h before expiry
    }));
  } catch {}

  return accessToken;
}

function clearGarminToken() {
  try { localStorage.removeItem(GARMIN_TOKEN_LS); } catch {}
}

/* --- API calls --------------------------------------------------------- */

async function garminFetch(path) {
  const token = await getAccessToken();
  const proxy = garminProxy();
  const res = await fetch(`${proxy}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.status === 401) { clearGarminToken(); throw new Error('TOKEN_EXPIRED'); }
  if (!res.ok) throw new Error(`GARMIN_${res.status}`);
  return res.json();
}

/* --- Date helpers ------------------------------------------------------- */

function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

/* --- Data fetching ----------------------------------------------------- */

async function fetchGarminDailySummaries(start, end) {
  // endpoint: /dailies?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (max 60 days)
  const chunks = [];
  let cursor = new Date(start);
  const endDate = new Date(end);
  while (cursor <= endDate) {
    const chunkEnd = new Date(Math.min(addDays(cursor, 59).getTime(), endDate.getTime()));
    chunks.push(garminFetch(
      `/dailies?startDate=${isoDate(cursor)}&endDate=${isoDate(chunkEnd)}`
    ));
    cursor = addDays(chunkEnd, 1);
  }
  return (await Promise.all(chunks)).flat();
}

async function fetchGarminSleep(start, end) {
  // max 31 days per request
  const chunks = [];
  let cursor = new Date(start);
  const endDate = new Date(end);
  while (cursor <= endDate) {
    const chunkEnd = new Date(Math.min(addDays(cursor, 30).getTime(), endDate.getTime()));
    chunks.push(garminFetch(
      `/sleep?startDate=${isoDate(cursor)}&endDate=${isoDate(chunkEnd)}`
    ));
    cursor = addDays(chunkEnd, 1);
  }
  return (await Promise.all(chunks)).flat();
}

async function fetchGarminHRV(start, end) {
  // HRV supports up to 365 days
  return garminFetch(
    `/hrv?startDate=${isoDate(new Date(start))}&endDate=${isoDate(new Date(end))}`
  );
}

async function fetchGarminActivities(start, end) {
  // paginated, 20 per page
  const all = [];
  let page = 0;
  while (true) {
    const batch = await garminFetch(
      `/activities?startDate=${isoDate(new Date(start))}&endDate=${isoDate(new Date(end))}&start=${page * 20}&limit=20`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 20) break;
    page++;
  }
  return all;
}

async function fetchGarminFitnessAge() {
  // single call, returns current snapshot
  try { return await garminFetch('/fitnessAge'); } catch { return null; }
}

/* --- Activity name mapping --------------------------------------------- */

const ACTIVITY_NAMES = {
  running: 'ריצה', treadmill_running: 'ריצת הליכון', trail_running: 'ריצת שטח',
  walking: 'הליכה', hiking: 'טיול רגלי', cycling: 'אופניים',
  road_biking: 'אופני כביש', mountain_biking: 'אופני הרים',
  indoor_cycling: 'אופני כושר', lap_swimming: 'שחייה', open_water_swimming: 'שחייה במים פתוחים',
  strength_training: 'אימון כוח', indoor_cardio: 'קרדיו', elliptical: 'אליפטי',
  yoga: 'יוגה', pilates: 'פילאטיס', fitness_equipment: 'מכשירי כושר',
};

/* --- Main sync --------------------------------------------------------- */

async function syncGarminData(onProgress, backfillDays) {
  if (!hasGarminSetup()) throw new Error('SETUP');

  const existingCount = await dbCount();
  const window = backfillDays || (existingCount > 0 ? 7 : 30);
  const today = new Date();
  const start = addDays(today, -window);

  onProgress?.('מתחבר לגרמין…');

  // Fetch all data sources in parallel where possible
  onProgress?.('מושך נתונים…');
  const [dailies, sleepData, hrvData, activities, fitnessAge] = await Promise.all([
    fetchGarminDailySummaries(start, today),
    fetchGarminSleep(start, today),
    fetchGarminHRV(start, today),
    fetchGarminActivities(start, today),
    fetchGarminFitnessAge(),
  ]);

  // Index sleep and HRV by date for merging
  const sleepByDate = {};
  for (const s of sleepData) {
    const day = s.calendarDate || s.startDate || '';
    if (day) sleepByDate[day] = s;
  }
  const hrvByDate = {};
  for (const h of hrvData) {
    const day = h.calendarDate || h.startDate || '';
    if (day) hrvByDate[day] = h;
  }

  // Index activities by date
  const actByDate = {};
  for (const a of activities) {
    const day = (a.startTimeLocal || a.startTimeGMT || '').split(/[ T]/)[0];
    if (!day) continue;
    const typeKey = a.activityType?.typeKey || a.typeKey || 'other';
    const entry = {
      type: ACTIVITY_NAMES[typeKey] || a.activityName || typeKey,
      type_key: typeKey,
    };
    if (a.duration) entry.minutes = Math.round(a.duration / 60);
    if (a.distance) entry.km = +(a.distance / 1000).toFixed(2);
    if (a.averageHR) entry.avg_hr = Math.round(a.averageHR);
    if (a.maxHR) entry.max_hr = Math.round(a.maxHR);
    if (a.calories) entry.calories = Math.round(a.calories);
    if (a.averageSpeed) entry.pace_s = Math.round(1000 / a.averageSpeed);
    if (a.elevationGain) entry.elev_gain = Math.round(a.elevationGain);
    if (a.averageRunningCadenceInStepsPerMinute) entry.cadence = Math.round(a.averageRunningCadenceInStepsPerMinute);
    if (a.aerobicTrainingEffect) entry.aerobic_te = +(a.aerobicTrainingEffect).toFixed(1);
    if (a.anaerobicTrainingEffect) entry.anaerobic_te = +(a.anaerobicTrainingEffect).toFixed(1);
    if (a.vO2MaxValue) entry.vo2max = +(a.vO2MaxValue).toFixed(1);
    (actByDate[day] ??= []).push(entry);
  }

  // Build rows
  onProgress?.('מעבד נתונים…');
  const rows = [];
  for (const d of dailies) {
    const day = d.calendarDate || d.startDate || '';
    if (!day) continue;
    const record = { date: day };

    // Daily summary fields
    if (d.restingHeartRate != null) record.rhr = d.restingHeartRate;
    if (d.averageStressLevel != null && d.averageStressLevel >= 0) record.stress_avg = d.averageStressLevel;
    if (d.totalSteps != null) record.steps = d.totalSteps;
    if (d.totalKilocalories != null) record.calories = Math.round(d.totalKilocalories);
    if (d.floorsAscended != null) record.floors = d.floorsAscended;
    const intense = (d.moderateIntensityMinutes || 0) + 2 * (d.vigorousIntensityMinutes || 0);
    if (intense > 0) record.intensity_min = intense;

    // Sleep
    const sl = sleepByDate[day];
    if (sl) {
      if (sl.sleepTimeSeconds) record.sleep_hours = +(sl.sleepTimeSeconds / 3600).toFixed(2);
      if (sl.deepSleepSeconds != null) record.deep_min = Math.round(sl.deepSleepSeconds / 60);
      if (sl.lightSleepSeconds != null) record.light_min = Math.round(sl.lightSleepSeconds / 60);
      if (sl.remSleepSeconds != null) record.rem_min = Math.round(sl.remSleepSeconds / 60);
      if (sl.awakeSleepSeconds != null) record.awake_min = Math.round(sl.awakeSleepSeconds / 60);
      if (sl.overallScore != null) record.sleep_score = sl.overallScore;
      else if (sl.sleepScores?.overall?.value != null) record.sleep_score = sl.sleepScores.overall.value;
      if (sl.avgSleepRespirationValue != null) record.respiration_avg = +(sl.avgSleepRespirationValue).toFixed(1);
      if (sl.averageSpO2Value != null) record.spo2_avg = Math.round(sl.averageSpO2Value);
      if (sl.lowestSpO2Value != null) record.spo2_low = sl.lowestSpO2Value;
    }

    // HRV
    const hr = hrvByDate[day];
    if (hr) {
      const avg = hr.lastNightAvg ?? hr.hrvValue ?? hr.weeklyAvg;
      if (avg != null) record.hrv = Math.round(avg);
    }

    // Activities
    if (actByDate[day]) record.workouts = actByDate[day];

    rows.push(record);
  }

  // Fitness age — apply to today's row
  if (fitnessAge) {
    const todayStr = isoDate(today);
    const todayRow = rows.find(r => r.date === todayStr);
    if (todayRow) {
      if (fitnessAge.fitnessAge != null) todayRow.fitness_age = fitnessAge.fitnessAge;
      if (fitnessAge.vo2Max != null) todayRow.vo2max = +(fitnessAge.vo2Max).toFixed(1);
    }
  }

  // Persist
  onProgress?.('שומר…');
  await dbPutDays(rows);

  const all = await dbGetAll();
  onProgress?.(null);
  return all;
}
