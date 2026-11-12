'use strict';

/* =========================================================================
 * auth.js — Supabase Auth + cloud storage for multi-user support.
 *
 * Provides: Google OAuth login, per-user settings sync, profile auto-create.
 * Supabase JS loaded from CDN before this file.
 * ========================================================================= */

const SUPABASE_URL = 'https://gytxwjlicawlfdehszil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5dHh3amxpY2F3bGZkZWhzemlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MTUyMzgsImV4cCI6MjEwMTA5MTIzOH0.LIBV2W0FTq4MHlyO2Z4iiPvBBGBP1btJaJ-qzUrig64';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let _currentUser = null;

function currentUser() { return _currentUser; }

/* --- Auth flow --------------------------------------------------------- */

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) throw error;
}

async function signOut() {
  await sb.auth.signOut();
  _currentUser = null;
  localStorage.clear();
  window.location.reload();
}

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    _currentUser = session.user;
    await _ensureProfile(session.user);
    await _pullSettingsFromCloud();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      _currentUser = session.user;
      await _ensureProfile(session.user);
      await _pullSettingsFromCloud();
      window.location.reload();
    }
    if (event === 'SIGNED_OUT') {
      _currentUser = null;
    }
  });

  return _currentUser;
}

/* --- Profile auto-create ----------------------------------------------- */

async function _ensureProfile(user) {
  const { data } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!data) {
    const name = user.user_metadata?.full_name || user.user_metadata?.name || '';
    await sb.from('profiles').insert({ id: user.id, display_name: name });
  }
}

/* --- Settings sync (localStorage ↔ Supabase user_settings) ------------- */

const SYNCED_KEYS = [
  'health_profile_v1', 'weight_log_v1', 'strength_checks_v1', 'run_tags_v1',
  'runs_history_v1', 'workout_plan_v1', 'aero_plan_v1', 'strength_week_plan_v1',
  'strength_programs_v1', 'strength_sessions_v1', 'strength_active_v1',
  'target_race_v1', 'goal_adapt_v1', 'sleep_prefs_v1', 'sleep_order_v1',
  'insights_prefs_v1', 'insights_order_v1', 'anomaly_tags_v1',
  'garmin_api_key', 'garmin_proxy_url', 'garmin_token',
  'selected_sports_v1',
];

async function _pullSettingsFromCloud() {
  if (!_currentUser) return;
  const { data } = await sb.from('user_settings')
    .select('key, value')
    .eq('user_id', _currentUser.id);

  // Pull cloud → localStorage (cloud wins for existing keys)
  for (const row of (data || [])) {
    try {
      const val = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      _origSetItem(row.key, val);
    } catch {}
  }

  // Push ALL local keys to cloud (upsert — safe to call every time)
  const cloudKeys = new Set((data || []).map(r => r.key));
  const pushes = [];
  for (const key of SYNCED_KEYS) {
    if (cloudKeys.has(key)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      let jsonVal;
      try { jsonVal = JSON.parse(raw); } catch { jsonVal = raw; }
      pushes.push({
        user_id: _currentUser.id, key, value: jsonVal,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }
  if (pushes.length) {
    const { error } = await sb.from('user_settings')
      .upsert(pushes, { onConflict: 'user_id,key' });
    if (error) console.error('Settings push failed:', error);
    else console.log(`Pushed ${pushes.length} settings to cloud`);
  }
}

/* Force-push all local settings to cloud (called from profile modal) */
async function forceSyncSettings() {
  if (!_currentUser) return;
  const pushes = [];
  for (const key of SYNCED_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      let jsonVal;
      try { jsonVal = JSON.parse(raw); } catch { jsonVal = raw; }
      pushes.push({
        user_id: _currentUser.id, key, value: jsonVal,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }
  if (pushes.length) {
    const { error } = await sb.from('user_settings')
      .upsert(pushes, { onConflict: 'user_id,key' });
    if (error) console.error('Force sync failed:', error);
    return !error;
  }
  return true;
}

/* --- Auto-sync localStorage writes to cloud ----------------------------- */

const _origSetItem = localStorage.setItem.bind(localStorage);
const _origRemoveItem = localStorage.removeItem.bind(localStorage);

localStorage.setItem = function(key, value) {
  _origSetItem(key, value);
  if (_currentUser && SYNCED_KEYS.includes(key)) {
    let jsonVal;
    try { jsonVal = JSON.parse(value); } catch { jsonVal = value; }
    sb.from('user_settings').upsert({
      user_id: _currentUser.id, key, value: jsonVal,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' }).then(() => {});
  }
};

localStorage.removeItem = function(key) {
  _origRemoveItem(key);
  if (_currentUser && SYNCED_KEYS.includes(key)) {
    sb.from('user_settings').delete()
      .eq('user_id', _currentUser.id).eq('key', key).then(() => {});
  }
};

/* --- Daily data (replaces IndexedDB) ----------------------------------- */

async function dbGetAll() {
  if (!_currentUser) return [];
  const { data, error } = await sb.from('daily_data')
    .select('date, data')
    .eq('user_id', _currentUser.id)
    .order('date', { ascending: true });
  if (error) { console.error('dbGetAll:', error); return []; }
  return (data || []).map(r => ({ date: r.date, ...r.data }));
}

async function dbPutDays(rows) {
  if (!rows.length || !_currentUser) return;
  const uid = _currentUser.id;

  // Fetch existing rows for merge
  const dates = rows.map(r => r.date);
  const { data: existing } = await sb.from('daily_data')
    .select('date, data')
    .eq('user_id', uid)
    .in('date', dates);

  const existMap = {};
  for (const e of (existing || [])) existMap[e.date] = e.data;

  const upserts = rows.map(row => {
    const { date, ...fields } = row;
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)
    );
    const merged = { ...(existMap[date] || {}), ...patch };
    return { user_id: uid, date, data: merged, updated_at: new Date().toISOString() };
  });

  // Upsert in chunks of 500
  for (let i = 0; i < upserts.length; i += 500) {
    const chunk = upserts.slice(i, i + 500);
    const { error } = await sb.from('daily_data')
      .upsert(chunk, { onConflict: 'user_id,date' });
    if (error) console.error('dbPutDays chunk error:', error);
  }
}

async function dbClear() {
  if (!_currentUser) return;
  await sb.from('daily_data').delete().eq('user_id', _currentUser.id);
}

async function dbCount() {
  if (!_currentUser) return 0;
  const { count } = await sb.from('daily_data')
    .select('date', { count: 'exact', head: true })
    .eq('user_id', _currentUser.id);
  return count || 0;
}
