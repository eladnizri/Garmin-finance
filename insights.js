'use strict';
/* =========================================================================
 * insights.js — מנוע התובנות האישיות.
 *
 * שלוש שכבות מעל הנתונים הגולמיים:
 *   1. מנוע קורלציות — מה *הנתונים שלך* מלמדים, עם בדיקת מובהקות.
 *   2. כרטיס "היום" — המלצה אחת שמצליבה מוכנות עם המטרות שהוגדרו בפועל.
 *   3. פוקוס שבועי — הפער היחיד שהכי שווה לסגור בשבוע הקרוב.
 *
 * העיקרון שמנחה את הכול: עדיף לשתוק מאשר להציג רעש כתובנה. כל מסקנה כאן
 * נגזרת מההיסטוריה של המשתמש, עוברת סף מובהקות, והטקסט הוא תבנית שממולאת
 * במספרים אמיתיים — לא משפט קבוע שנבחר מתוך מאגר.
 * ========================================================================= */

/* =========================================================================
 * סטטיסטיקה
 * ========================================================================= */

/* ערכי r קריטיים ל-p<0.05 דו-צדדי לפי גודל המדגם. מתחת ל-MIN_N לא בודקים
 * כלל — במדגם קטן כל צירוף מקרים נראה כמו קשר. */
const MIN_N = 10;
const CRIT_R = [[10, .632], [12, .576], [15, .514], [20, .444], [25, .396],
                [30, .361], [40, .312], [50, .279], [60, .254], [80, .220], [100, .197]];
function critR(n) {
  if (n <= CRIT_R[0][0]) return CRIT_R[0][1];
  const last = CRIT_R[CRIT_R.length - 1];
  if (n >= last[0]) return last[1];
  for (let i = 1; i < CRIT_R.length; i++) {
    const [n1, r1] = CRIT_R[i - 1], [n2, r2] = CRIT_R[i];
    if (n <= n2) return r1 + (r2 - r1) * (n - n1) / (n2 - n1);
  }
  return last[1];
}

const isNum = v => v != null && !Number.isNaN(v) && Number.isFinite(v);
const meanOf = a => a.reduce((s, x) => s + x, 0) / a.length;
function sdOf(a) {
  if (a.length < 2) return 0;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}
function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function corrOf(pairs) {
  const n = pairs.length;
  if (n < MIN_N) return { r: null, n };
  const mx = meanOf(pairs.map(p => p[0])), my = meanOf(pairs.map(p => p[1]));
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  if (!dx || !dy) return { r: null, n };
  return { r: num / Math.sqrt(dx * dy), n };
}
/* חלוקה לשתי קבוצות סביב חציון ה-x. מקדם מתאם אומר "יש קשר"; ההפרש בין
 * שתי הקבוצות אומר *כמה* — וזה מה שאפשר לקרוא כמשפט. */
function splitAt(pairs) {
  const cut = medianOf(pairs.map(p => p[0]));
  const lo = pairs.filter(p => p[0] < cut).map(p => p[1]);
  const hi = pairs.filter(p => p[0] >= cut).map(p => p[1]);
  if (lo.length < 3 || hi.length < 3) return null;
  return { cut, lo: meanOf(lo), hi: meanOf(hi), nLo: lo.length, nHi: hi.length };
}
/* הבדיקה המלאה על זוג סדרות: מובהקות + גודל אפקט ביחידות סטיית תקן */
function relate(pairs) {
  const { r, n } = corrOf(pairs);
  if (r === null || Math.abs(r) < critR(n)) return null;
  const sp = splitAt(pairs);
  if (!sp) return null;
  const sdY = sdOf(pairs.map(p => p[1]));
  if (!sdY) return null;
  return { r, n, ...sp, sdY, effect: Math.abs(sp.hi - sp.lo) / sdY };
}

/* =========================================================================
 * תיוג חריגות — יום שיש לו הסבר ידוע לא מלמד כלום על הדפוס
 * ========================================================================= */
const ANOM_TAG_KEY = 'anomaly_tags_v1';
const ANOM_REASONS = {
  travel: 'טיסה או נסיעה', alcohol: 'אלכוהול', sick: 'מחלה', stress: 'לחץ',
  hard: 'אימון קשה', late: 'לילה קצר מתוכנן', other: 'סיבה אחרת',
};
let anomTags = {};
function loadAnomTags() { try { anomTags = jsonGet(ANOM_TAG_KEY, {}) || {}; } catch { anomTags = {}; } }
function saveAnomTags() { jsonSet(ANOM_TAG_KEY, anomTags); }
const isTagged = iso => !!anomTags[iso];
const tagLabel = iso => ANOM_REASONS[anomTags[iso]] || null;

/* =========================================================================
 * בניית זוגות מהנתונים
 * ========================================================================= */
const shiftISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
function dayIndex() {
  const m = new Map();
  for (const r of (state.data || [])) m.set(r.date, r);
  return m;
}
/* זוגות (x ביום D, y ביום D+lag). הזיווג לפי תאריך אמיתי ולא לפי מיקום
 * במערך, כך שחור בנתונים לא יוצר זוג מזויף. ימים מתויגים יוצאים משני הצדדים. */
function pairsOf(getX, getY, lag = 0) {
  const idx = dayIndex(), out = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date)) continue;
    const to = lag ? idx.get(shiftISO(r.date, lag)) : r;
    if (!to || isTagged(to.date)) continue;
    const x = getX(r), y = getY(to);
    if (isNum(x) && isNum(y)) out.push([x, y]);
  }
  return out;
}
const field = k => r => r[k];

/* תאריכים שבהם היה אימון כלשהו — גרמין או כוח שתועד ידנית */
function workoutDates() {
  const set = new Set();
  for (const r of (state.data || [])) if ((r.workouts || []).length) set.add(r.date);
  for (const s of (typeof sessions !== 'undefined' ? sessions : [])) set.add(s.date);
  return set;
}
/* נפח אימון כוח ליום: סך המשקל×חזרות בסטים שבוצעו */
function strengthVolumeByDate() {
  const m = new Map();
  for (const s of (typeof sessions !== 'undefined' ? sessions : [])) {
    let vol = 0;
    for (const e of (s.entries || [])) for (const st of (e.sets || []))
      if (st.done && isNum(st.kg) && isNum(st.reps)) vol += st.kg * st.reps;
    if (vol > 0) m.set(s.date, (m.get(s.date) || 0) + vol);
  }
  return m;
}
/* קצב הריצה ליום (הריצה הארוכה ביותר באותו יום, כדי לא לערבב ריצות) */
function runPaceByDate() {
  const m = new Map();
  const runs = (typeof allRuns === 'function' ? allRuns() : []).filter(r => r.real && isNum(r.pace));
  for (const r of runs) {
    const cur = m.get(r.date);
    if (!cur || (r.km || 0) > cur.km) m.set(r.date, { pace: r.pace, km: r.km || 0 });
  }
  return m;
}

/* =========================================================================
 * מסקנות — כל בדיקה מחזירה ממצא או null
 * ========================================================================= */
function mk(id, group, text, s) {
  return { id, group, text, r: s.r, n: s.n, effect: s.effect };
}

/* --- שינה מול הביצועים למחרת. אצל גרמין שורת יום D כוללת את השינה של
 *     הלילה שהסתיים באותו בוקר, ולכן ההצלבה היא באותה שורה. --- */
function probeSleepVsMetric(yKey, id, phrase) {
  const s = relate(pairsOf(field('sleep_hours'), field(yKey)));
  if (!s) return null;
  const d = METRICS[yKey] || { dec: 0, label: yKey };
  return mk(id, 'sleep-perf',
    `בלילות מתחת ל־<b>${fmt(s.cut, 1)} שעות</b>, ${phrase} היה <b>${fmt(s.lo, d.dec)}</b> ` +
    `— לעומת <b>${fmt(s.hi, d.dec)}</b> בלילות הארוכים יותר.`, s);
}

/* --- מה שקורה ביום מסוים מול השינה של הלילה שאחריו (lag של יום) --- */
function probeDayVsNight(xKey, id, phrase) {
  const s = relate(pairsOf(field(xKey), field('sleep_score'), 1));
  if (!s) return null;
  const dx = METRICS[xKey] || { dec: 0 };
  return mk(id, 'sleep-quality',
    `אחרי ימים עם ${phrase} מעל <b>${fmt(s.cut, dx.dec)}</b>, ציון השינה באותו לילה היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> אחרי ימים שקטים יותר.`, s);
}

/* --- חלק השינה העמוקה מול המוכנות של אותו יום --- */
function probeDeepShare() {
  const deepShare = r => {
    const tot = (r.deep_min || 0) + (r.light_min || 0) + (r.rem_min || 0);
    return tot > 0 ? (r.deep_min || 0) / tot * 100 : null;
  };
  const s = relate(pairsOf(deepShare, field('readiness_score')));
  if (!s) return null;
  return mk('deep-readiness', 'sleep-quality',
    `כששינה עמוקה עברה <b>${fmt(s.cut, 0)}%</b> מהלילה, ציון המוכנות היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> בלילות עם פחות עומק.`, s);
}

/* --- עקביות: סטיית התקן של שעות השינה בשבוע שקדם, מול ציון השינה --- */
function probeRegularity() {
  const idx = dayIndex();
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_score)) continue;
    const prev = [];
    for (let k = 1; k <= 7; k++) {
      const p = idx.get(shiftISO(r.date, -k));
      if (p && !isTagged(p.date) && isNum(p.sleep_hours)) prev.push(p.sleep_hours);
    }
    if (prev.length >= 5) pairs.push([sdOf(prev), r.sleep_score]);
  }
  const s = relate(pairs);
  if (!s) return null;
  // lo = השבועות היציבים (סטיית תקן נמוכה), hi = המקופצים. הכיוון אינו מובטח מראש.
  const gap = fmt(Math.abs(s.lo - s.hi), 0);
  return mk('regularity', 'sleep-quality', s.lo > s.hi
    ? `בתקופות שבהן שעות השינה שלך היו יציבות, ציון השינה היה <b>${fmt(s.lo, 0)}</b> — ` +
      `לעומת <b>${fmt(s.hi, 0)}</b> כשהן קפצו מלילה ללילה. העקביות שווה לך <b>${gap} נקודות</b>.`
    : `דווקא בתקופות שבהן שעות השינה שלך קפצו מלילה ללילה ציון השינה היה גבוה יותר — ` +
      `<b>${fmt(s.hi, 0)}</b> לעומת <b>${fmt(s.lo, 0)}</b>. קשר לא צפוי, שווה מעקב.`, s);
}

/* --- כמה ימי מנוחה קדמו ליום, מול ה-HRV שלו --- */
function probeRestDays() {
  const wd = workoutDates();
  const restBefore = r => {
    let n = 0;
    for (let k = 1; k <= 3; k++) if (!wd.has(shiftISO(r.date, -k))) n++;
    return n;
  };
  const s = relate(pairsOf(restBefore, field('hrv')));
  if (!s) return null;
  return mk('rest-hrv', 'training',
    `אחרי <b>${fmt(s.cut, 0)} ימי מנוחה ומעלה</b> בשלושת הימים שקדמו, ה-HRV שלך היה ` +
    `<b>${fmt(s.hi, 0)}</b> — לעומת <b>${fmt(s.lo, 0)}</b> אחרי רצף אימונים.`, s);
}

/* --- שינה מול נפח אימון הכוח באותו יום --- */
function probeSleepVsStrength() {
  const vol = strengthVolumeByDate();
  if (vol.size < MIN_N) return null;
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_hours)) continue;
    const v = vol.get(r.date);
    if (isNum(v)) pairs.push([r.sleep_hours, v]);
  }
  const s = relate(pairs);
  if (!s) return null;
  // האחוז נמדד ביחס ללילות הקצרים, והכיוון נקרא מהנתונים ולא מונח מראש
  const pct = s.lo ? Math.abs(s.hi - s.lo) / s.lo * 100 : 0;
  return mk('sleep-strength', 'training',
    `אחרי לילות של <b>${fmt(s.cut, 1)} שעות ומעלה</b>, נפח אימון הכוח שלך היה ` +
    `${s.hi > s.lo ? 'גבוה' : 'נמוך'} ב־<b>${fmt(pct, 0)}%</b> בממוצע מאשר אחרי לילות קצרים יותר.`, s);
}

/* --- שינה מול קצב הריצה באותו יום (קצב נמוך = מהיר יותר) --- */
function probeSleepVsRun() {
  const byDate = runPaceByDate();
  if (byDate.size < MIN_N) return null;
  const pairs = [];
  for (const r of (state.data || [])) {
    if (isTagged(r.date) || !isNum(r.sleep_hours)) continue;
    const run = byDate.get(r.date);
    if (run) pairs.push([r.sleep_hours, run.pace]);
  }
  const s = relate(pairs);
  if (!s) return null;
  return mk('sleep-run', 'training',
    `בימים שרצת אחרי <b>${fmt(s.cut, 1)} שעות שינה ומעלה</b>, הקצב הממוצע היה ` +
    `<b>${paceTxt(s.hi)}</b> — לעומת <b>${paceTxt(s.lo)}</b> אחרי לילות קצרים.`, s);
}

/* --- יום בשבוע חריג: לא קשר בין מדדים אלא דפוס בלוח השנה --- */
const WEEKDAY_KEYS = ['sleep_hours', 'sleep_score', 'steps', 'rhr'];
function probeWeekday() {
  let best = null;
  for (const key of WEEKDAY_KEYS) {
    const byDay = Array.from({ length: 7 }, () => []);
    for (const r of (state.data || [])) {
      if (isTagged(r.date) || !isNum(r[key])) continue;
      byDay[new Date(`${r.date}T12:00:00`).getDay()].push(r[key]);
    }
    const all = byDay.flat();
    if (all.length < 21) continue;
    const sd = sdOf(all);
    if (!sd) continue;
    for (let d = 0; d < 7; d++) {
      if (byDay[d].length < 4) continue;
      const others = byDay.filter((_, i) => i !== d).flat();
      if (others.length < 10) continue;
      const delta = meanOf(byDay[d]) - meanOf(others);
      const eff = Math.abs(delta) / sd;
      if (eff < 0.8) continue;
      if (!best || eff > best.effect) {
        const def = METRICS[key];
        const worse = def.goodUp ? delta < 0 : delta > 0;
        best = {
          id: `weekday-${key}-${d}`, group: 'pattern', r: null, n: byDay[d].length, effect: eff,
          // ניסוח בשמות עצם ולא בתארים — כדי שההתאמה במין ובמספר תעבוד לכל מדד
          text: `בימי <b>${DAY_NAMES[d]}</b> יש אצלך ${delta > 0 ? 'עלייה' : 'ירידה'} של ` +
            `<b>${fmt(Math.abs(delta), def.dec)}${def.unit && !def.unit.startsWith('/') ? ' ' + def.unit : ''}</b> ` +
            `ב${def.label}, לעומת שאר ימות השבוע${worse ? ' — היום שהכי שווה לטפל בו' : ''}.`,
        };
      }
    }
  }
  return best;
}

/* --- מגמה: לאן מדד זז בשבועיים האחרונים, ובכמה --- */
const TREND_KEYS = ['rhr', 'hrv', 'sleep_hours', 'sleep_score', 'stress_avg'];
function probeTrend() {
  let best = null;
  for (const key of TREND_KEYS) {
    const rows = (state.data || []).slice(-14).filter(r => !isTagged(r.date) && isNum(r[key]));
    if (rows.length < MIN_N) continue;
    const pairs = rows.map((r, i) => [i, r[key]]);
    const { r, n } = corrOf(pairs);
    if (r === null || Math.abs(r) < critR(n)) continue;
    // ערכי ההתחלה והסוף על קו המגמה עצמו, לא הנקודות הגולמיות
    const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
    const mx = meanOf(xs), my = meanOf(ys);
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
                  xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const from = my + slope * (xs[0] - mx), to = my + slope * (xs[xs.length - 1] - mx);
    const sd = sdOf(ys);
    const eff = sd ? Math.abs(to - from) / sd : 0;
    if (eff < 0.8) continue;
    const def = METRICS[key];
    const good = def.goodUp ? to > from : to < from;
    if (!best || eff > best.effect) {
      best = {
        id: `trend-${key}`, group: 'pattern', r, n, effect: eff,
        text: `מגמת ${to > from ? 'עלייה' : 'ירידה'} ב${def.label} בשבועיים האחרונים — מ־` +
          `<b>${fmt(from, def.dec)}</b> ל־<b>${fmt(to, def.dec)}</b>${good ? ' — מגמה טובה' : ' — שווה תשומת לב'}.`,
      };
    }
  }
  return best;
}

/* =========================================================================
 * המנוע: מריץ הכול, מסנן, ומגוון בין נושאים
 * ========================================================================= */
/* רצף ימים באותו צד של הבסיס האישי — לא מגמה (עלייה/ירידה), אלא "תקוע" */
function probeStreak() {
  let best = null;
  for (const key of TREND_KEYS) {
    const b = typeof baselineOf === 'function' ? baselineOf(key) : null;
    if (!b || !b.sd) continue;
    const series = (state.data || []).slice(-14)
      .filter(r => !isTagged(r.date) && isNum(r[key])).map(r => r[key]);
    if (series.length < 3) continue;

    let run = 0, side = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      const dev = (series[i] - b.mean) / b.sd;
      const s = dev > 0.5 ? 1 : dev < -0.5 ? -1 : 0;
      if (s === 0 || (side && s !== side)) break;
      side = s; run++;
    }
    if (run < 3) continue;

    const def = METRICS[key];
    const good = def.goodUp ? side > 0 : side < 0;
    const eff = run / 3; // רצף ארוך יותר = ממצא חזק יותר
    if (!best || eff > best.effect) {
      best = {
        id: `streak-${key}`, group: 'pattern', r: null, n: run, effect: eff,
        text: `${def.label} ${side < 0 ? 'מתחת ל' : 'מעל ה'}בסיס האישי שלך ` +
          `<b>${run} ימים ברצף</b>${good ? ' — מגמה חיובית' : ' — שווה תשומת לב'}.`,
      };
    }
  }
  return best;
}

const PROBES = [
  () => probeSleepVsMetric('rhr', 'sleep-rhr', 'דופק המנוחה'),
  () => probeSleepVsMetric('hrv', 'sleep-hrv', 'ה-HRV'),
  () => probeSleepVsMetric('readiness_score', 'sleep-readiness', 'ציון המוכנות'),
  () => probeDayVsNight('stress_avg', 'stress-sleep', 'מתח'),
  () => probeDayVsNight('intensity_min', 'load-sleep', 'דקות פעילות אינטנסיבית'),
  () => probeDayVsNight('steps', 'steps-sleep', 'צעדים'),
  probeDeepShare, probeRegularity, probeRestDays,
  probeSleepVsStrength, probeSleepVsRun, probeWeekday, probeTrend, probeStreak,
];

function allFindings() {
  const out = [];
  for (const p of PROBES) {
    try { const f = p(); if (f) out.push(f); } catch (_) { /* בדיקה אחת שנפלה לא מפילה את השאר */ }
  }
  out.sort((a, b) => b.effect - a.effect || a.id.localeCompare(b.id));
  // גיוון: קודם החזק מכל נושא, ורק אחר כך השאר לפי עוצמה
  const picked = [], seen = new Set();
  for (const f of out) if (!seen.has(f.group)) { picked.push(f); seen.add(f.group); }
  for (const f of out) if (!picked.includes(f)) picked.push(f);
  return picked;
}

const INSIGHTS_SHOWN = 3;
function renderInsights() {
  const el = $('insights-card');
  if (!el) return;
  const found = allFindings();
  if (!found.length) {
    const days = (state.data || []).length;
    el.innerHTML = `<article class="card"><div class="card-head"><h2>${icon('bulb', 18)} מה הנתונים שלך מלמדים</h2></div>
      <p class="tr-empty">${days < 20
        ? `נאספו ${days} ימי מדידה. כשיצטברו עוד, יופיעו כאן קשרים שנמצאו בנתונים שלך עצמם.`
        : 'לא נמצא כרגע אף קשר מובהק מספיק כדי להציג. זה תקין — עדיף לשתוק מאשר להמציא דפוס.'}</p></article>`;
    return;
  }
  const items = found.slice(0, INSIGHTS_SHOWN).map(f => `
    <div class="ins-row">
      <span class="ins-dot"></span>
      <div><p class="ins-txt">${f.text}</p>
        <span class="ins-meta">${f.n} ימים${f.r !== null ? ` · מתאם ${fmt(Math.abs(f.r), 2)}` : ''}</span></div>
    </div>`).join('');
  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('bulb', 18)} מה הנתונים שלך מלמדים</h2>
      <span class="unit">${found.length} ממצאים</span></div>
    ${items}
    <p class="ins-note">מוצג רק מה שעבר בדיקת מובהקות סטטיסטית על ההיסטוריה שלך.</p></article>`;
}

/* =========================================================================
 * כרטיס "היום" — המלצה אחת, מוצלבת מול המטרות שהוגדרו בפועל
 * ========================================================================= */
function daysSinceLastRun() {
  const runs = (typeof allRuns === 'function' ? allRuns() : []).filter(r => r.real);
  if (!runs.length) return null;
  const last = runs[runs.length - 1].date;
  return Math.round((new Date(`${todayISO()}T12:00:00`) - new Date(`${last}T12:00:00`)) / 864e5);
}
function daysSinceQualityRun() {
  const runs = (typeof allRuns === 'function' ? allRuns() : [])
    .filter(r => r.real && (r.kind === 'tempo' || r.kind === 'intervals'));
  if (!runs.length) return null;
  const last = runs[runs.length - 1].date;
  return Math.round((new Date(`${todayISO()}T12:00:00`) - new Date(`${last}T12:00:00`)) / 864e5);
}
/* קבוצות שריר שלא קיבלו עבודה ישירה בחלון הכיסוי */
function missingMuscles() {
  if (typeof muscleCoverage !== 'function') return [];
  const cov = muscleCoverage();
  return MUSCLE_KEYS.filter(k => !cov[k].primary && !cov[k].secondary);
}

function todayPlan() {
  if (!state.data || !state.data.length) return null;
  const readiness = latest('readiness_score', 2) ?? heuristicReadiness();
  const alerts = anomalies().filter(a => a.level === 'alert');
  const watches = anomalies().filter(a => a.level === 'watch');

  const auto = autoStrengthDates();
  const cur = weekRows(0);
  const strDone = strengthCountInWeek(cur, auto), strGoal = goalStrength();
  const strLeft = Math.max(0, strGoal - strDone);
  const missing = missingMuscles();
  // כמה ימים נשארו בשבוע כולל היום
  const dow = new Date(`${todayISO()}T12:00:00`).getDay();
  const daysLeftInWeek = 7 - dow;

  const weekKm = (typeof weekRunKm === 'function') ? weekRunKm(cur) : 0;
  // יעד הנפח מותאם לשלב המירוץ — בטייפר הוא נמוך יותר בכוונה
  const kmGoal = (typeof adjustedRunGoal === 'function') ? adjustedRunGoal()
    : (typeof goalRunKm === 'function') ? goalRunKm() : null;
  const phase = (typeof racePhase === 'function') ? racePhase() : null;
  const sinceRun = daysSinceLastRun(), sinceQuality = daysSinceQualityRun();
  const raceDays = (typeof race !== 'undefined' && race && race.date)
    ? Math.ceil((new Date(`${race.date}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 864e5) : null;

  const why = [];
  const push = t => { if (t) why.push(t); };
  const muscleTxt = missing.length
    ? missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו') : null;

  /* סולם ההחלטה — מהסיבה שהכי גוברת על השאר ומטה */
  let key, title, detail, tone;

  if (readiness !== null && readiness < 50) {
    key = 'rest'; tone = 'rest'; title = 'יום מנוחה';
    detail = 'הגוף עוד לא חזר — אימון היום יעלה יותר ממה שייתן.';
    push(`ציון מוכנות ${Math.round(readiness)}`);
  } else if (phase && phase.key === 'raceday') {
    key = 'race'; tone = 'go'; title = `${race.name || 'המירוץ'} — היום`;
    detail = `${fmt(race.km, race.km % 1 ? 1 : 0)} ק״מ בקצב יעד ${paceTxt(raceTargetPace())}. בהצלחה.`;
    push(`יעד ${raceTimeTxt(race.timeSec)}`);
  } else if (phase && phase.key === 'raceweek') {
    key = 'easy'; tone = 'easy'; title = 'שבוע המירוץ — לשמור אנרגיה';
    detail = `${phase.daysLeft} ימים למירוץ. ${phase.note}`;
    push('בלי כוח כבד השבוע');
  } else if (phase && phase.key === 'recovery') {
    key = 'rest'; tone = 'rest'; title = 'התאוששות אחרי המירוץ';
    detail = `עברו ${Math.abs(phase.daysLeft)} ימים מהמירוץ — ${phase.note}`;
  } else if (alerts.length) {
    key = 'easy'; tone = 'rest'; title = 'יום קל בלבד';
    detail = 'יש מדד שחורג משמעותית מהרגיל שלך — שווה לתת לו יום.';
    alerts.slice(0, 2).forEach(a => push(`${METRICS[a.key].label} ${valueText(a.key, a.value)} — ${a.text}`));
  } else if (strLeft > 0 && daysLeftInWeek <= strLeft + 1) {
    key = 'strength'; tone = 'go';
    title = phase && phase.key === 'taper' ? 'אימון כוח קל' : 'אימון כוח — ולא לדחות';
    detail = phase && phase.key === 'taper'
      ? `${phase.daysLeft} ימים למירוץ — כוח קל בלבד, בלי לרדת למשקלים כבדים.`
      : muscleTxt
        ? `נשארו ${daysLeftInWeek} ימים בשבוע ו-${strLeft} אימונים ליעד. ${muscleTxt} עוד לא עבדו.`
        : `נשארו ${daysLeftInWeek} ימים בשבוע ו-${strLeft} אימונים ליעד — אין הרבה מרווח.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else if (raceDays !== null && raceDays >= 0 && raceDays <= 28
             && readiness !== null && readiness >= 70
             && (sinceQuality === null || sinceQuality >= 4)) {
    const tapering = phase && phase.key === 'taper';
    key = 'quality'; tone = 'go'; title = tapering ? 'ריצה קצרה בקצב המירוץ' : 'ריצת איכות';
    detail = tapering
      ? `${raceDays} ימים למירוץ — שומרים חדות בנפח נמוך: כמה קילומטרים בקצב היעד ודי.`
      : `המירוץ בעוד ${raceDays} ימים והמוכנות גבוהה — זה היום לטמפו או אינטרוולים.`;
    push(sinceQuality === null ? 'עוד לא תועדה ריצת איכות' : `${sinceQuality} ימים מאז ריצת איכות`);
    const gap = (typeof raceTargetPace === 'function') ? raceTargetPace() : null;
    if (gap) push(`קצב היעד ${paceTxt(gap)}`);
  } else if (strLeft > 0 && readiness !== null && readiness >= 60) {
    key = 'strength'; tone = 'go'; title = 'אימון כוח';
    detail = muscleTxt
      ? `${muscleTxt} לא קיבלו עבודה ב-${COVER_DAYS} הימים האחרונים.`
      : `נשאר ${strLeft === 1 ? 'אימון אחד' : `${strLeft} אימונים`} ליעד השבועי.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else if (kmGoal && weekKm < kmGoal && (sinceRun === null || sinceRun >= 2)) {
    key = 'volume'; tone = 'go'; title = 'ריצת נפח קלה';
    detail = `נשארו ${fmt(kmGoal - weekKm, 1)} ק״מ ליעד השבועי — בקצב נוח, לא מאמץ.`;
    push(`${fmt(weekKm, 1)}/${fmt(kmGoal, 1)} ק״מ השבוע`);
  } else if (strLeft === 0 && missing.length) {
    key = 'gap'; tone = 'go'; title = `אימון משלים — ${muscleTxt}`;
    detail = `עמדת ביעד הכוח, אבל ${muscleTxt} עדיין לא קיבלו עבודה.`;
    push(`${strDone}/${strGoal} אימוני כוח השבוע`);
  } else {
    key = 'maintain'; tone = 'easy'; title = 'יום קל או מנוחה';
    detail = 'היעדים השבועיים בדרך — אין צורך להוסיף עומס היום.';
    if (strGoal) push(`${strDone}/${strGoal} אימוני כוח`);
    if (kmGoal) push(`${fmt(weekKm, 1)}/${fmt(kmGoal, 1)} ק״מ`);
  }

  // תוכנית אירובית — אם יש אימון מתוכנן להיום ואין סיבה דחופה יותר, ההמלצה מתאימה
  if (key === 'maintain' || key === 'volume') {
    const ap = (typeof loadAeroPlan === 'function') ? loadAeroPlan() : [];
    const todayDow = new Date(`${todayISO()}T12:00:00`).getDay();
    const planned = ap.find(s => s.day === todayDow);
    if (planned && planned.type !== 'rest') {
      const sportLabel = (typeof AERO_SPORTS !== 'undefined') ? (AERO_SPORTS.find(s => s.key === planned.sport)?.label || '') : '';
      const typeLabel = (typeof AERO_WORKOUT_TYPES !== 'undefined') ? (AERO_WORKOUT_TYPES.find(t => t.key === planned.type)?.label || '') : '';
      key = planned.type === 'intervals' || planned.type === 'tempo' ? 'quality' : 'volume';
      tone = 'go';
      title = sportLabel ? `${sportLabel} — ${typeLabel}` : typeLabel;
      detail = `לפי התוכנית השבועית שלך, היום מתוכנן ${sportLabel} ${typeLabel}.`;
      push('לפי תוכנית');
    }
  }

  if (readiness !== null && key !== 'rest' && !alerts.length) push(`מוכנות ${Math.round(readiness)}`);
  if (watches.length && tone === 'go') push(`${METRICS[watches[0].key].label} ${watches[0].text}`);

  return { key, tone, title, detail, why, readiness };
}

const TODAY_ICON = { rest: 'yoga', easy: 'walk', strength: 'dumbbell', quality: 'bolt', volume: 'run', gap: 'dumbbell', maintain: 'yoga', race: 'trophy' };
const SPORT_ICON = { running: 'run', swimming: 'drop', cycling: 'bike' };

function todayAeroItems() {
  if (typeof loadAeroPlan !== 'function' || typeof AERO_SPORTS === 'undefined') return [];
  const ap = loadAeroPlan();
  const todayDow = new Date(`${todayISO()}T12:00:00`).getDay();
  return ap.filter(s => s.day === todayDow && s.type !== 'rest').map(s => {
    const sportInfo = AERO_SPORTS.find(sp => sp.key === s.sport);
    const typeInfo = (typeof AERO_WORKOUT_TYPES !== 'undefined') ? AERO_WORKOUT_TYPES.find(t => t.key === s.type) : null;
    return {
      sport: s.sport,
      icon: SPORT_ICON[s.sport] || 'run',
      title: `${sportInfo?.label || s.sport} — ${typeInfo?.label || s.type}`,
      key: (s.type === 'intervals' || s.type === 'tempo') ? 'quality' : 'volume',
    };
  });
}

function todayStrengthItem() {
  if (typeof loadStrengthWeekPlan !== 'function') return null;
  const plan = loadStrengthWeekPlan();
  const todayDow = new Date(`${todayISO()}T12:00:00`).getDay();
  const entry = plan.find(s => s.day === todayDow);
  if (!entry) return null;
  const progs = (typeof programs !== 'undefined') ? programs : [];
  const prog = progs.find(p => p.id === entry.programId);
  if (!prog) return null;
  return { programId: entry.programId, title: prog.name || 'אימון כוח', icon: 'dumbbell' };
}

function renderToday() {
  const el = $('today-card');
  if (!el) return;
  const p = todayPlan();
  if (!p) { el.innerHTML = ''; return; }

  const aeroItems = todayAeroItems();
  const strItem = todayStrengthItem();

  // Build extra sessions: aero items not already the main rec, plus strength from weekly plan
  const extras = [];
  const mainIsAero = p.key === 'volume' || p.key === 'quality';
  const mainIsStrength = p.key === 'strength' || p.key === 'gap';

  // Add aero items if main is not already this specific aero
  for (const a of aeroItems) {
    if (mainIsAero && p.title.includes(a.title.split('—')[0].trim())) continue;
    extras.push({ icon: a.icon, title: a.title, detail: 'לפי התוכנית האירובית שלך', tone: 'go' });
  }

  // Add strength from weekly plan if main is not strength
  if (strItem && !mainIsStrength) {
    extras.push({ icon: 'dumbbell', title: strItem.title, detail: 'לפי תוכנית הכוח השבועית שלך', tone: 'go' });
  }

  // If main is aero and there's a strength week plan for today, add it
  if (mainIsAero && strItem) {
    extras.push({ icon: 'dumbbell', title: strItem.title, detail: 'לפי תוכנית הכוח השבועית שלך', tone: 'go' });
  }

  const totalSessions = 1 + extras.length;
  let sessionsHtml = `<div class="today-session tone-${p.tone}">
    <span class="today-ic">${icon(TODAY_ICON[p.key] || 'bolt', 22)}</span>
    <div class="today-session-body">
      <h2 class="today-title">${p.title}</h2>
      <p class="today-detail">${p.detail}</p>
      ${p.why.length ? `<div class="today-why">${p.why.map(w => `<span>${w}</span>`).join('')}</div>` : ''}
    </div>
  </div>`;

  for (const ex of extras) {
    sessionsHtml += `<div class="today-session tone-${ex.tone} today-session-extra">
      <span class="today-ic">${icon(ex.icon, 22)}</span>
      <div class="today-session-body">
        <h2 class="today-title">${ex.title}</h2>
        <p class="today-detail today-detail-sm">${ex.detail}</p>
      </div>
    </div>`;
  }

  el.innerHTML = `<article class="card today-card${extras.length > 0 ? ' today-multi' : ''}">
    <span class="today-kicker">היום${totalSessions > 1 ? ` · ${totalSessions} אימונים` : ''}</span>
    ${sessionsHtml}
  </article>`;
}

/* =========================================================================
 * פוקוס שבועי — משפט אחד שמצטרף לסיכום השבועי
 * ========================================================================= */
function weekFocus() {
  try {
    const auto = autoStrengthDates();
    const cur = weekRows(0);
    const strDone = strengthCountInWeek(cur, auto), strGoal = goalStrength();
    const missing = missingMuscles();
    const kmGoal = (typeof adjustedRunGoal === 'function') ? adjustedRunGoal()
      : (typeof goalRunKm === 'function') ? goalRunKm() : null;
    const weekKm = (typeof weekRunKm === 'function') ? weekRunKm(cur) : 0;
    const trend = probeTrend();
    const phase = (typeof racePhase === 'function') ? racePhase() : null;

    // שלב המירוץ גובר: הוא ידוע מראש וקובע את כל השבוע
    if (phase && ['raceweek', 'taper', 'raceday', 'recovery'].includes(phase.key))
      return `${phase.label} — ${phase.note}`;

    if (strDone < strGoal && missing.length)
      return `להשלים ${strGoal - strDone === 1 ? 'אימון כוח אחד' : `${strGoal - strDone} אימוני כוח`}, ובאחד מהם לכלול ${missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו')}.`;
    if (missing.length)
      return `${missing.slice(0, 2).map(k => MUSCLES[k]).join(' ו')} לא קיבלו עבודה — כדאי לשלב אותם בתוכנית.`;
    if (trend && trend.text.includes('תשומת לב'))
      return `לעקוב אחרי המגמה שזוהתה — ${trend.text.replace(/<\/?b>/g, '')}`;
    if (kmGoal && weekKm < kmGoal * 0.8)
      return `להעלות את נפח הריצה — השבוע נסגר על ${fmt(weekKm, 1)} מתוך ${fmt(kmGoal, 1)} ק״מ.`;
    if (strDone >= strGoal && !missing.length)
      return 'לשמור על מה שעובד — היעדים נסגרו וכל קבוצות השריר קיבלו עבודה.';
    return null;
  } catch (_) { return null; }
}

/* =========================================================================
 * תיוג חריגה — למה היום הזה היה חריג
 * ========================================================================= */
let tagDate = null;
function openAnomTag(iso) {
  tagDate = iso;
  const cur = anomTags[iso] || '';
  $('tag-date').textContent = longDate(iso);
  $('tag-options').innerHTML = Object.entries(ANOM_REASONS).map(([k, label]) =>
    `<button type="button" class="tag-opt${k === cur ? ' on' : ''}" data-reason="${k}">${label}</button>`).join('');
  $('tag-clear').classList.toggle('hidden', !cur);
  $('tag-modal').classList.remove('hidden');
}
function closeAnomTag() { $('tag-modal').classList.add('hidden'); tagDate = null; }
function applyAnomTag(reason) {
  if (!tagDate) return;
  if (reason) anomTags[tagDate] = reason; else delete anomTags[tagDate];
  saveAnomTags();
  closeAnomTag();
  if (typeof renderAll === 'function') renderAll();
  toast(reason ? 'תויג — היום הזה לא ישפיע על הבסיס האישי' : 'התיוג הוסר');
}
function initInsights() {
  loadAnomTags();
  const modal = $('tag-modal');
  if (!modal) return;
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closeAnomTag(); return; }
    const opt = e.target.closest('[data-reason]');
    if (opt) { haptic(8); applyAnomTag(opt.dataset.reason); return; }
    if (e.target.closest('#tag-clear')) applyAnomTag(null);
  });
  $('anomalies').addEventListener('click', e => {
    const row = e.target.closest('[data-anom-date]');
    if (row) { haptic(6); openAnomTag(row.dataset.anomDate); }
  });
}

/* =========================================================================
 * עמוד תובנות — 7 רכיבים + התאמה אישית
 * ========================================================================= */
const INSIGHTS_PREFS_KEY = 'insights_prefs_v1';
const INSIGHTS_SECTIONS = [
  { key: 'correlations', label: 'קורלציות אישיות',    desc: 'קשרים שנמצאו בנתונים שלך' },
  { key: 'trends',       label: 'מגמות חודשיות',      desc: 'שינוי ממוצעים ב-30 יום' },
  { key: 'records',      label: 'שיאים אישיים',       desc: 'ערכי שיא בכל מדד' },
  { key: 'consistency',  label: 'עקביות',              desc: 'אחוז השבועות שעמדת ביעד' },
  { key: 'load',         label: 'עומס vs התאוששות',   desc: 'עומס אימונים מול מוכנות' },
  { key: 'anomalies',    label: 'ימים חריגים',         desc: 'ימים שחרגו מהרגיל' },
  { key: 'forecast',     label: 'תחזית שבועית',        desc: 'הערכה להמשך השבוע' },
];

function loadInsightsPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(INSIGHTS_PREFS_KEY)) || {};
    const defaults = Object.fromEntries(INSIGHTS_SECTIONS.map(s => [s.key, true]));
    return { ...defaults, ...saved };
  } catch { return Object.fromEntries(INSIGHTS_SECTIONS.map(s => [s.key, true])); }
}
function saveInsightsPrefs(p) {
  try { localStorage.setItem(INSIGHTS_PREFS_KEY, JSON.stringify(p)); } catch {}
}

function insightsTrends() {
  const data = state.data || [];
  const keys = ['sleep_hours', 'rhr', 'hrv', 'sleep_score'];
  const labels = { sleep_hours: 'שינה', rhr: 'דופק מנוחה', hrv: 'HRV', sleep_score: 'ציון שינה' };
  const goodUp = { sleep_hours: true, rhr: false, hrv: true, sleep_score: true };
  const units = { sleep_hours: 'ש׳', rhr: 'bpm', hrv: 'ms', sleep_score: '' };
  const dec = { sleep_hours: 1, rhr: 0, hrv: 0, sleep_score: 0 };
  const now = new Date(todayISO());
  const d30ago = new Date(now); d30ago.setDate(now.getDate() - 30);
  const d60ago = new Date(now); d60ago.setDate(now.getDate() - 60);
  const d30str = d30ago.toISOString().slice(0,10);
  const d60str = d60ago.toISOString().slice(0,10);
  return keys.map(k => {
    const recent = data.filter(r => r.date >= d30str && isNum(r[k])).map(r => r[k]);
    const prior  = data.filter(r => r.date >= d60str && r.date < d30str && isNum(r[k])).map(r => r[k]);
    if (recent.length < 5) return null;
    const avgR = meanOf(recent), avgP = prior.length >= 5 ? meanOf(prior) : null;
    const pct = avgP ? Math.round((avgR - avgP) / avgP * 100) : null;
    const up = avgP !== null ? avgR > avgP : false;
    const good = goodUp[k] ? up : !up;
    return { key: k, label: labels[k], avg: avgR, pct, good, up, unit: units[k], dec: dec[k] };
  }).filter(Boolean);
}

function insightsRecords() {
  const data = state.data || [];
  if (!data.length) return [];
  const defs = [
    { key: 'sleep_hours', label: 'שינה ארוכה ביותר', fn: 'max', unit: 'ש׳', dec: 1 },
    { key: 'rhr',         label: 'דופק מנוחה נמוך',  fn: 'min', unit: 'bpm', dec: 0 },
    { key: 'hrv',         label: 'HRV גבוה',         fn: 'max', unit: 'ms',  dec: 0 },
    { key: 'sleep_score', label: 'ציון שינה גבוה',   fn: 'max', unit: '',    dec: 0 },
  ];
  return defs.map(d => {
    const vals = data.filter(r => isNum(r[d.key]));
    if (!vals.length) return null;
    const row = d.fn === 'max'
      ? vals.reduce((a, b) => b[d.key] > a[d.key] ? b : a)
      : vals.reduce((a, b) => b[d.key] < a[d.key] ? b : a);
    return { label: d.label, value: row[d.key], date: row.date, unit: d.unit, dec: d.dec };
  }).filter(Boolean);
}

function insightsConsistency() {
  const result = [];
  const strGoalN = (typeof goalStrength === 'function') ? goalStrength() : 2;
  const kmGoal = (typeof goalRunKm === 'function') ? goalRunKm() : null;
  let strMet = 0, strTotal = 0, aeroMet = 0, aeroTotal = 0;
  for (let w = 0; w < 12; w++) {
    const ws = new Date(todayISO()); ws.setDate(ws.getDate() - ws.getDay() - w * 7);
    const wsStr = ws.toISOString().slice(0,10);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const weStr = we.toISOString().slice(0,10);
    const rows = (state.data || []).filter(r => r.date >= wsStr && r.date <= weStr);
    const auto = (typeof autoStrengthDates === 'function') ? autoStrengthDates() : new Set();
    const strDone = (typeof strengthCountInWeek === 'function') ? strengthCountInWeek(rows, auto) : 0;
    strTotal++;
    if (strDone >= strGoalN) strMet++;
    if (kmGoal) {
      aeroTotal++;
      let weekKm = 0;
      for (const r of rows) for (const wk of (r.workouts || [])) if (wk.km) weekKm += wk.km;
      if (weekKm >= kmGoal * 0.9) aeroMet++;
    }
  }
  if (strTotal) result.push({ label: 'יעד כוח שבועי', met: strMet, total: strTotal, pct: Math.round(strMet / strTotal * 100) });
  if (aeroTotal && kmGoal) result.push({ label: 'יעד ריצה שבועי', met: aeroMet, total: aeroTotal, pct: Math.round(aeroMet / aeroTotal * 100) });
  return result;
}

function insightsLoadRecovery() {
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const ws = new Date(todayISO()); ws.setDate(ws.getDate() - ws.getDay() - w * 7);
    const wsStr = ws.toISOString().slice(0,10);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const weStr = we.toISOString().slice(0,10);
    const rows = (state.data || []).filter(r => r.date >= wsStr && r.date <= weStr);
    if (!rows.length) continue;
    const workouts = rows.reduce((s, r) => s + (r.workouts || []).length, 0);
    const readRows = rows.filter(r => isNum(r.readiness_score));
    const avgR = readRows.length ? Math.round(meanOf(readRows.map(r => r.readiness_score))) : null;
    weeks.push({ wsStr, workouts, readiness: avgR, isCurrent: w === 0 });
  }
  return weeks;
}

function insightsForecast() {
  const strGoal = (typeof goalStrength === 'function') ? goalStrength() : 0;
  const kmGoal = (typeof goalRunKm === 'function') ? goalRunKm() : null;
  if (!strGoal && !kmGoal) return null;
  const auto = (typeof autoStrengthDates === 'function') ? autoStrengthDates() : new Set();
  const cur = (typeof weekRows === 'function') ? weekRows(0) : [];
  const strDone = (typeof strengthCountInWeek === 'function') ? strengthCountInWeek(cur, auto) : 0;
  const strLeft = Math.max(0, strGoal - strDone);
  let weekKm = 0;
  for (const r of cur) for (const w of (r.workouts || [])) if (w.km) weekKm += w.km;
  const kmLeft = kmGoal ? Math.max(0, kmGoal - weekKm) : null;
  const todayDow = new Date(todayISO()).getDay();
  const daysLeft = 7 - todayDow;
  const lines = [];
  if (strLeft > 0) lines.push(`נשארו ${strLeft} ${strLeft === 1 ? 'אימון כוח' : 'אימוני כוח'} ל-${daysLeft} ${daysLeft === 1 ? 'יום' : 'ימים'} שנותרו.`);
  if (kmLeft && kmLeft > 0) lines.push(`נשארו ${fmt(kmLeft, 1)} ק״מ ליעד האירובי השבועי.`);
  if (!lines.length) lines.push('עמדת בכל היעדים השבועיים שלך — כל הכבוד!');
  return lines;
}

function openInsightsCustomize() {
  const prefs = loadInsightsPrefs();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="modal-backdrop"></div>
    <div class="modal-sheet">
      <div class="modal-head"><h2>התאמה אישית</h2>
        <button class="close-btn" aria-label="סגירה">✕</button></div>
      <p style="font-size:.85rem;color:var(--ink-2);margin-bottom:12px;">בחר אילו חלקים יוצגו בעמוד התובנות:</p>
      <div class="plan-grouped-list">
        ${INSIGHTS_SECTIONS.map(s => `
          <label class="plan-grouped-row" style="cursor:pointer;gap:12px;">
            <div class="plan-grouped-label">${s.label}<small>${s.desc}</small></div>
            <input type="checkbox" name="${s.key}" ${prefs[s.key] ? 'checked' : ''}
              style="width:20px;height:20px;accent-color:var(--primary-500);">
          </label>`).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-primary" id="insights-prefs-save">שמור</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.close-btn').onclick = close;
  modal.querySelector('.modal-backdrop').onclick = close;
  modal.querySelector('#insights-prefs-save').onclick = () => {
    const newPrefs = {};
    INSIGHTS_SECTIONS.forEach(s => { newPrefs[s.key] = modal.querySelector(`[name="${s.key}"]`)?.checked || false; });
    saveInsightsPrefs(newPrefs);
    close();
    renderInsightsPage();
  };
}

function renderInsightsPage() {
  const el = $('insights-page');
  if (!el) return;
  const prefs = loadInsightsPrefs();

  let html = `<article class="card" style="padding:14px 16px 12px;">
    <div class="card-head">
      <h2>${icon('bulb', 18)} תובנות</h2>
      <button class="btn-ghost" id="insights-customize" style="font-size:.8rem;padding:5px 10px;">התאמה אישית ⚙</button>
    </div>
  </article>`;

  let hasContent = false;

  if (prefs.correlations) {
    const found = allFindings();
    if (found.length) {
      hasContent = true;
      const items = found.slice(0, 5).map(f => {
        const strength = f.r !== null ? Math.abs(f.r) : 0;
        const strengthPct = Math.round(strength * 100);
        const strengthLabel = strength >= 0.6 ? 'חזק' : strength >= 0.4 ? 'בינוני' : 'עדין';
        return `<div class="ins-row">
          <div class="ins-corr-strength"><div class="ins-corr-bar"><div style="width:${strengthPct}%"></div></div><span class="ins-corr-label">${strengthLabel}</span></div>
          <div><p class="ins-txt">${f.text}</p>
            <span class="ins-meta">${f.n} ימים${f.r !== null ? ` · r=${fmt(Math.abs(f.r), 2)}` : ''}</span></div>
        </div>`;
      }).join('');
      html += `<article class="card"><div class="card-head"><h2>קורלציות אישיות</h2><span class="unit">${found.length} ממצאים</span></div>
        ${items}<p class="ins-note">מוצג רק מה שעבר בדיקת מובהקות סטטיסטית על ההיסטוריה שלך.</p></article>`;
    }
  }

  if (prefs.trends) {
    const trends = insightsTrends();
    if (trends.length) {
      hasContent = true;
      const rows = trends.map(t => {
        const arrow = t.up ? '↑' : '↓';
        const color = t.good ? 'var(--ok)' : 'var(--alert)';
        const pctTxt = t.pct !== null ? `${t.pct > 0 ? '+' : ''}${t.pct}%` : '';
        const barW = t.pct !== null ? Math.min(Math.abs(t.pct) * 8, 100) : 0;
        return `<div class="ins-trend-row">
          <span class="ins-trend-label">${t.label}</span>
          <div class="ins-trend-right">
            <div class="ins-trend-top">
              <span class="ins-trend-val">${fmt(t.avg, t.dec)} ${t.unit}</span>
              <span class="ins-trend-delta" style="color:${color}">${arrow} ${pctTxt}</span>
            </div>
            <div class="ins-delta-bar"><div class="ins-delta-fill" style="width:${barW}%;background:${color}"></div></div>
          </div>
        </div>`;
      }).join('');
      html += `<article class="card"><div class="card-head"><h2>מגמות 30 יום</h2><span class="unit">מול 30 הימים הקודמים</span></div>${rows}</article>`;
    }
  }

  if (prefs.records) {
    const recs = insightsRecords();
    if (recs.length) {
      hasContent = true;
      const rows = recs.map(r => `<div class="ins-trend-row">
        <span class="ins-trend-label">${r.label}</span>
        <div class="ins-rec-right">
          <span class="ins-trend-val" style="font-weight:700;color:var(--primary-500)">${fmt(r.value, r.dec)} ${r.unit}</span>
          <span class="ins-rec-date">${typeof shortDate === 'function' ? shortDate(r.date) : r.date}</span>
        </div>
      </div>`).join('');
      html += `<article class="card"><div class="card-head"><h2>שיאים אישיים</h2></div>${rows}</article>`;
    }
  }

  if (prefs.consistency) {
    const cons = insightsConsistency();
    if (cons.length) {
      hasContent = true;
      const rows = cons.map(c => {
        const color = c.pct >= 75 ? 'var(--ok)' : c.pct >= 50 ? 'var(--watch)' : 'var(--alert)';
        return `<div class="plan-sport">
          <div class="plan-sport-top">
            <span class="plan-sport-name">${c.label}</span>
            <span class="plan-sport-num" style="color:${color}">${c.pct}% (${c.met}/${c.total} שבועות)</span>
          </div>
          <div class="plan-bar"><i style="width:${c.pct}%;background:${color}"></i></div>
        </div>`;
      }).join('');
      html += `<article class="card"><div class="card-head"><h2>עקביות</h2><span class="unit">12 שבועות אחרונים</span></div><div class="plan-aero">${rows}</div></article>`;
    }
  }

  if (prefs.load) {
    const weeks = insightsLoadRecovery();
    if (weeks.length >= 3) {
      hasContent = true;
      const maxW = Math.max(...weeks.map(w => w.workouts), 1);
      const bars = weeks.map((w, i) => {
        const hPct = Math.round(w.workouts / maxW * 100);
        const rPct = w.readiness;
        const rColor = rPct === null ? 'var(--ink-3)' : rPct >= 70 ? 'var(--ok)' : rPct >= 50 ? 'var(--watch)' : 'var(--alert)';
        return `<div class="load-week-col">
          <div class="load-bar-wrap"><div class="load-bar" style="height:${hPct}%"></div></div>
          <div class="load-readiness" style="color:${rColor}">${rPct !== null ? rPct : '—'}</div>
          <div class="load-label">${w.isCurrent ? 'עכשיו' : `שב׳ ${i + 1}`}</div>
        </div>`;
      }).join('');
      html += `<article class="card"><div class="card-head"><h2>עומס vs התאוששות</h2><span class="unit">עמודות=אימונים · מספר=מוכנות</span></div>
        <div class="load-chart">${bars}</div></article>`;
    }
  }

  if (prefs.anomalies) {
    const anom = $('anomalies');
    if (anom && anom.innerHTML.trim()) {
      hasContent = true;
      html += `<article class="card"><div class="card-head"><h2>ימים חריגים</h2></div>${anom.innerHTML}</article>`;
    }
  }

  if (prefs.forecast) {
    const lines = insightsForecast();
    if (lines) {
      hasContent = true;
      const listHtml = lines.map(l => `<div class="ins-row"><span class="ins-dot"></span><p class="ins-txt">${l}</p></div>`).join('');
      html += `<article class="card"><div class="card-head"><h2>תחזית שבועית</h2></div>${listHtml}</article>`;
    }
  }

  if (!hasContent) {
    html += `<article class="card"><p class="tr-empty">כל הסעיפים מוסתרים או אין עדיין מספיק נתונים. לחץ "התאמה אישית" להפעיל.</p></article>`;
  }

  el.innerHTML = html;
  const btn = $('insights-customize');
  if (btn) btn.onclick = openInsightsCustomize;
}
