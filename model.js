'use strict';
/* =========================================================================
 * model.js — המודל האישי.
 *
 * insights.js עונה על "מה הנתונים שלך מלמדים". הקובץ הזה עונה על שאלה אחרת,
 * אישית יותר: *מה עובד אצלך ספציפית*, ובאיזה סדר חשיבות.
 *
 *   1. דירוג מנופים — מה מבין שינה/מתח/עומס/פעילות הכי מזיז את ההתאוששות שלך.
 *   2. משקלים אישיים — הדירוג הזה מחליף את נוסחת המוכנות הקבועה.
 *   3. זיהוי משטר — מתי "הרגיל שלך" באמת השתנה, כדי שהבסיס יתכייל מחדש.
 *   4. הסבר שבועי — לקשור תזוזה במדד למנוף שזז איתה.
 *   5. לחץ עומס — סף אישי שנלמד מהפעמים שגרמין סימן אותך בעומס גבוה.
 *
 * הקובץ נטען אחרי insights.js ומשתמש בעזרים שלו (relate, pairsOf, isTagged…).
 * ========================================================================= */

/* =========================================================================
 * מנופים והתוצאות שהם מזיזים
 * ========================================================================= */
const deepShareOf = r => {
  const tot = (r.deep_min || 0) + (r.light_min || 0) + (r.rem_min || 0);
  return tot > 0 ? (r.deep_min || 0) / tot * 100 : null;
};

/* lag=0 למנופי שינה: אצל גרמין שורת יום D כוללת את השינה *וגם* את ה-HRV של
 * אותו לילה עצמו. lag=1 למנופי היום: מה שקרה ביום D משפיע על הלילה שאחריו. */
/* g = מין דקדוקי, כדי שהפעלים במשפטים המורכבים יתאימו לשם ("רמת מתח עלתה",
 * לא "עלה"). m = זכר יחיד, f = נקבה יחידה, fp = נקבה רבים. */
const LEVERS = [
  { id: 'sleep_hours',   label: 'שעות שינה',    g: 'fp', unit: 'שעות', dec: 1, lag: 0, get: r => r.sleep_hours },
  { id: 'deep_share',    label: 'עומק השינה',   g: 'm',  unit: '%',    dec: 0, lag: 0, get: deepShareOf },
  { id: 'stress_avg',    label: 'רמת מתח',      g: 'f',  unit: '',     dec: 0, lag: 1, get: r => r.stress_avg },
  { id: 'intensity_min', label: 'עומס אימון',   g: 'm',  unit: 'דק׳',  dec: 0, lag: 1, get: r => r.intensity_min },
  { id: 'steps',         label: 'פעילות יומית', g: 'f',  unit: '',     dec: 0, lag: 1, get: r => r.steps },
];

const VERB = {
  up:    { m: 'עלה',  f: 'עלתה', fp: 'עלו' },
  down:  { m: 'ירד',  f: 'ירדה', fp: 'ירדו' },
  cross: { m: 'עובר', f: 'עוברת', fp: 'עוברות' },
};
const verb = (kind, g) => VERB[kind][g || 'm'];

/* בכוונה לא readiness_score: גרמין מחשב אותו מתוך השינה והמתח עצמם, ולכן
 * מתאם אליו היה מעגלי — הוא היה "מגלה" את הנוסחה של גרמין, לא משהו עלייך.
 * HRV ודופק מנוחה הם מדידות פיזיולוגיות עצמאיות, ולכן תוצאה כנה. */
const OUTCOMES = [
  { key: 'hrv', label: 'ה-HRV', dec: 0 },
  { key: 'rhr', label: 'דופק המנוחה', dec: 0 },
];

const leverAvg = (rows, lv) => {
  const v = rows.map(lv.get).filter(isNum);
  return v.length ? meanOf(v) : null;
};
const leverSd = lv => sdOf((state.data || []).map(lv.get).filter(isNum));

/* מפתח מטמון: משתנה כשנוספים ימים או כשתיוג שינה את מה שנכלל בחישוב */
const modelKey = () => `${(state.data || []).length}|${Object.keys(anomTags || {}).join(',')}`;

/* =========================================================================
 * 1. דירוג מנופים
 * ========================================================================= */
/* כל המנופים שנבדקו — גם אלה שלא נמצא להם קשר. "שינה לא מזיזה לך את ה-HRV"
 * הוא ממצא אישי בפני עצמו, ולא סיבה להעלים את השורה. */
let _rank = null, _rankKey = '';
function allLevers() {
  const k = modelKey();
  if (_rank && _rankKey === k) return _rank;
  const out = [];
  for (const lv of LEVERS) {
    let best = null;
    for (const oc of OUTCOMES) {
      const s = relate(pairsOf(lv.get, field(oc.key), lv.lag));
      if (s && (!best || s.effect > best.effect)) best = { ...s, outcome: oc };
    }
    out.push(best ? { ...lv, ...best, sig: true } : { ...lv, sig: false, effect: 0 });
  }
  out.sort((a, b) => b.effect - a.effect);
  _rank = out; _rankKey = k;
  return out;
}

const leverRanking = () => allLevers().filter(l => l.sig);
const topLever = () => leverRanking()[0] || null;

/* =========================================================================
 * 2. משקלים אישיים — הדירוג כאחוזים
 * ========================================================================= */
function personalWeights() {
  const rank = leverRanking();
  if (!rank.length) return null;
  const tot = rank.reduce((s, l) => s + l.effect, 0);
  if (!tot) return null;
  return rank.map(l => ({ ...l, pct: l.effect / tot * 100 }));
}

/* נוסחת המוכנות החלופית (כשאין ציון מגרמין) — במשקלים שנלמדו ממך.
 * מחזיר null כשאין עדיין מודל, ואז app.js נשאר עם הנוסחה הקבועה. */
function weightedReadiness() {
  const w = personalWeights();
  // מנוף בודד הופך את המוכנות למדד של משתנה אחד — פחות טוב מהנוסחה הקבועה
  if (!w || w.length < 2) return null;
  const recent = state.data.slice(-3);
  const parts = [];
  for (const lv of w) {
    const all = (state.data || []).map(lv.get).filter(isNum);
    const v = leverAvg(recent, lv), sd = sdOf(all);
    if (v === null || !sd) continue;
    // z בכיוון "טוב": מנוף שמתאם שלילי עם תוצאה טובה מתהפך, וכך גם דופק מנוחה
    const good = Math.sign(lv.r) * (lv.outcome.key === 'rhr' ? -1 : 1);
    const z = ((v - meanOf(all)) / sd) * good;
    parts.push({ w: lv.pct, v: clamp(50 + z * 20, 0, 100) });
  }
  if (!parts.length) return null;
  const tot = parts.reduce((a, p) => a + p.w, 0);
  return Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / tot);
}

/* =========================================================================
 * 3. זיהוי משטר — מתי "הרגיל שלך" באמת השתנה
 * ========================================================================= */
const REGIME_KEYS = ['rhr', 'hrv', 'sleep_hours'];
const REGIME_SIDE = 10;      // ימים מינימום בכל צד של נקודת השבר
const REGIME_LOOKBACK = 60;
const REGIME_SHIFT = 1.0;    // גודל הקפיצה בסטיות תקן

let _regime, _regimeKey = '';
function detectRegime() {
  const k = modelKey();
  if (_regimeKey === k) return _regime;
  const rows = (state.data || []).slice(-REGIME_LOOKBACK).filter(r => !isTagged(r.date));
  let best = null;
  for (const key of REGIME_KEYS) {
    const pts = rows.filter(r => isNum(r[key]));
    if (pts.length < REGIME_SIDE * 2) continue;
    const series = pts.map(r => r[key]);
    const sd = sdOf(series);
    if (!sd) continue;
    for (let i = REGIME_SIDE; i <= pts.length - REGIME_SIDE; i++) {
      const before = meanOf(series.slice(0, i)), after = meanOf(series.slice(i));
      const shift = Math.abs(after - before) / sd;
      if (shift < REGIME_SHIFT) continue;
      if (!best || shift > best.shift) {
        best = { key, date: pts[i].date, shift, before, after, nAfter: pts.length - i };
      }
    }
  }
  _regime = best; _regimeKey = k;
  return best;
}

/* התאריך שממנו לחשב את הבסיס האישי — או null כדי להישאר עם חלון 30 הימים.
 * נדרש שהשבר יהיה טרי (בתוך החלון) ושיהיו מספיק ימים אחריו. */
function baselineCutoff() {
  const rg = detectRegime();
  if (!rg || rg.nAfter < REGIME_SIDE) return null;
  const recent = (state.data || []).slice(-30);
  return recent.some(r => r.date === rg.date) ? rg.date : null;
}

/* =========================================================================
 * 4. הסבר שבועי — מה זז, ומה זז יחד איתו
 * ========================================================================= */
function weekWhy() {
  try {
    const cur = weekRows(0), prev = weekRows(1);
    if (cur.length < 3 || prev.length < 3) return null;
    const rank = leverRanking();
    if (!rank.length) return null;

    // המדד שהכי זז השבוע, ביחידות הבסיס האישי
    let moved = null;
    for (const oc of OUTCOMES) {
      const a = avg(prev, oc.key), b = avg(cur, oc.key), base = baselineOf(oc.key);
      if (a === null || b === null || !base || !base.sd) continue;
      const z = (b - a) / base.sd;
      if (Math.abs(z) < 0.5) continue;
      if (!moved || Math.abs(z) > Math.abs(moved.z)) moved = { oc, from: a, to: b, z };
    }
    if (!moved) return null;

    // המנוף שזז איתו — ובכיוון שמתיישב עם המתאם שנמדד אצלך
    let cause = null;
    for (const lv of rank) {
      if (lv.outcome.key !== moved.oc.key) continue;
      const a = leverAvg(prev, lv), b = leverAvg(cur, lv), sd = leverSd(lv);
      if (a === null || b === null || !sd) continue;
      const dz = (b - a) / sd;
      if (Math.abs(dz) < 0.4) continue;
      if (Math.sign(dz) * Math.sign(lv.r) !== Math.sign(moved.z)) continue;
      const score = Math.abs(dz) * lv.effect;
      if (!cause || score > cause.score) cause = { lv, from: a, to: b, score };
    }
    if (!cause) return null;

    return `${moved.oc.label} ${moved.z > 0 ? 'עלה' : 'ירד'} השבוע מ־<b>${fmt(moved.from, moved.oc.dec)}</b> ` +
      `ל־<b>${fmt(moved.to, moved.oc.dec)}</b>, ובמקביל ${cause.lv.label} ` +
      `${verb(cause.to > cause.from ? 'up' : 'down', cause.lv.g)} מ־<b>${fmt(cause.from, cause.lv.dec)}</b> ` +
      `ל־<b>${fmt(cause.to, cause.lv.dec)}</b> — המנוף שהכי מזיז אצלך את ${moved.oc.label}.`;
  } catch (_) { return null; }
}

/* =========================================================================
 * 5. לחץ עומס — סף אישי, לא ספרותי
 * ========================================================================= */
const STRAIN_RE = /STRAINED|OVERREACHING|UNPRODUCTIVE/;

/* החתימה הפיזיולוגית של התקופות שגרמין סימן בהן עומס.
 *
 * במכוון *לא* סף על training_load: בנתונים של המשתמש הזה התקופה המסומנת
 * דווקא הייתה בעומס נמוך (דופק מנוחה גבוה ו-HRV נמוך — כלומר העומס לא הגיע
 * מהאימונים), בעוד שהעומס הגבוה ביותר הופיע יחד עם הפיזיולוגיה הטובה ביותר.
 * סף על המספר היה מתריע בדיוק בשבוע הטוב ביותר. */
function strainSignature() {
  const inside = (state.data || []).filter(r => STRAIN_RE.test(r.training_status || ''));
  if (inside.length < 5) return null;
  const out = { n: inside.length };
  for (const k of ['rhr', 'hrv']) {
    const a = inside.map(r => r[k]).filter(isNum);
    const all = (state.data || []).map(r => r[k]).filter(isNum);
    if (a.length < 5 || all.length < 20) continue;
    const sd = sdOf(all);
    if (!sd) continue;
    out[k] = { mean: meanOf(a), z: (meanOf(a) - meanOf(all)) / sd };
  }
  return (out.rhr || out.hrv) ? out : null;
}

/* עד כמה היום דומה לאותה חתימה, ב-0..1 */
function strainResemblance() {
  const sig = strainSignature();
  if (!sig) return null;
  let hits = 0, tested = 0;
  for (const k of ['rhr', 'hrv']) {
    if (!sig[k] || Math.abs(sig[k].z) < 0.3) continue;   // לא היה מאפיין מבדיל
    const v = latest(k);
    if (!isNum(v)) continue;
    tested++;
    const all = (state.data || []).map(r => r[k]).filter(isNum);
    const z = (v - meanOf(all)) / (sdOf(all) || 1);
    // באותו כיוון כמו החתימה, ולפחות בחצי מהעוצמה שלה
    if (Math.sign(z) === Math.sign(sig[k].z) && Math.abs(z) >= Math.abs(sig[k].z) * 0.5) hits++;
  }
  return tested ? { score: hits / tested, hits, tested, sig } : null;
}

/* עומס מול הסתגלות: האם העלייה בעומס מלווה בשיפור פיזיולוגי או בשחיקה */
function loadAdaptation() {
  const rows = (state.data || []).filter(r => isNum(r.training_load));
  if (rows.length < 21) return null;
  const recent = rows.slice(-14), prior = rows.slice(-28, -14);
  if (prior.length < 7) return null;
  const lNow = meanOf(recent.map(r => r.training_load));
  const lPrev = meanOf(prior.map(r => r.training_load));
  if (!lPrev) return null;

  const phys = {};
  for (const k of ['rhr', 'hrv']) {
    const a = avg(prior, k), b = avg(recent, k);
    if (a !== null && b !== null) phys[k] = { from: a, to: b, d: b - a };
  }
  if (!phys.rhr && !phys.hrv) return null;

  // תזוזה קטנה יותר מזה היא רעש ולא שינוי — בלעדיה "ירד מ-52 ל-52"
  const MOVED = { rhr: 1, hrv: 3 };
  for (const k of Object.keys(phys)) phys[k].real = Math.abs(phys[k].d) >= MOVED[k];

  // "סופג" = ההתאוששות לא נשחקה. יציבות מול עלייה בעומס נחשבת הצלחה,
  // ולכן רק הידרדרות אמיתית נספרת לרעה.
  let score = 0;
  if (phys.rhr?.real) score += phys.rhr.d < 0 ? 1 : -1;
  if (phys.hrv?.real) score += phys.hrv.d > 0 ? 1 : -1;

  return { loadPct: (lNow - lPrev) / lPrev * 100, lNow, lPrev, phys, coping: score >= 0 };
}

/* =========================================================================
 * תצוגה — כרטיס המודל
 * ========================================================================= */
/* גודל האפקט בסטיות תקן, במילים — "1.02 SD" לא אומר כלום במסך של אפליקציה */
const effLabel = e => e >= 0.8 ? 'השפעה חזקה' : e >= 0.5 ? 'השפעה בינונית' : 'השפעה מתונה';

function renderModel() {
  const el = $('model-card');
  if (!el) return;
  const w = personalWeights();
  const rg = detectRegime();
  const cut = baselineCutoff();

  if (!w) {
    const days = (state.data || []).length;
    el.innerHTML = `<article class="card"><div class="card-head"><h2>${icon('gauge', 18)} המודל שלך</h2></div>
      <p class="tr-empty">${days < 25
        ? `נאספו ${days} ימי מדידה. כשיצטברו עוד, כאן יופיע דירוג אישי של מה שהכי מזיז את ההתאוששות שלך.`
        : 'אף מנוף לא עבר עדיין סף מובהקות. זה קורה כשההרגלים שלך יציבים מאוד — אין מספיק שונות כדי ללמוד ממנה.'}</p></article>`;
    return;
  }

  const all = allLevers();
  const sig = all.filter(l => l.sig), none = all.filter(l => !l.sig);
  const maxEff = sig[0]?.effect || 1;
  const rows = sig.map((lv, i) => {
    // הפועל מתאר את התנועה מ-lo ל-hi, לא אם היא טובה או רעה
    const moveVerb = lv.hi > lv.lo ? 'עולה' : 'יורד';   // התוצאה תמיד זכר יחיד
    return `<div class="mdl-row">
      <div class="mdl-top"><span class="mdl-rank">${i + 1}</span>
        <span class="mdl-name">${lv.label}</span>
        <span class="mdl-pct">${effLabel(lv.effect)}</span></div>
      <div class="mdl-bar"><i style="width:${Math.round(lv.effect / maxEff * 100)}%"></i></div>
      <p class="mdl-note">כש${lv.label} ${verb('cross', lv.g)} <b>${fmt(lv.cut, lv.dec)}${lv.unit ? ' ' + lv.unit : ''}</b>,
        ${lv.outcome.label} ${moveVerb} מ־<b>${fmt(lv.lo, lv.outcome.dec)}</b> ל־<b>${fmt(lv.hi, lv.outcome.dec)}</b>
        <span class="mdl-n">(${lv.n} ימים)</span></p>
    </div>`;
  }).join('');

  // מה שלא נמצא מרוכז לשורה אחת — "לא מצאתי" הוא ממצא, אבל לא כזה שמגיע לו
  // ארבע שורות ריקות שדוחפות למטה את מה שכן נמצא
  const noneLine = none.length
    ? `<p class="mdl-none">לא נמצא קשר מובהק בין ${none.map(l => l.label).join(', ')}
        לבין ההתאוששות שלך — אצלך זה פשוט לא מה שמזיז את המחט.</p>`
    : '';

  const regimeNote = rg && cut
    ? `<p class="mdl-regime">${icon('info', 14)} זיהיתי שינוי ב-${shortDate(rg.date)}:
        ${METRICS[rg.key]?.label || rg.key} עבר מ־<b>${fmt(rg.before, METRICS[rg.key]?.dec ?? 0)}</b>
        ל־<b>${fmt(rg.after, METRICS[rg.key]?.dec ?? 0)}</b>. הבסיס האישי שלך מחושב מאז, כדי שלא יושווה לתקופה אחרת.</p>`
    : '';

  el.innerHTML = `<article class="card">
    <div class="card-head"><h2>${icon('gauge', 18)} המודל שלך</h2>
      <span class="unit">${w[0].n} ימים</span></div>
    <p class="mdl-lead">מה הכי מזיז אצלך את ההתאוששות, מדורג לפי עוצמת ההשפעה בנתונים שלך:</p>
    ${rows}${noneLine}${adaptNote()}${regimeNote}
    <p class="ins-note">נמדד מול HRV ודופק מנוחה — מדידות עצמאיות, ולא מול ציון המוכנות שגרמין ממילא גוזר מהשינה והמתח.</p>
  </article>`;
}

/* קריאת העומס: עלייה שהגוף סופג היא בשורה טובה, ולא אזהרה */
function adaptNote() {
  const la = loadAdaptation();
  if (!la || Math.abs(la.loadPct) < 15) return '';
  const bits = [];
  if (la.phys.rhr?.real) bits.push(`דופק המנוחה ${la.phys.rhr.d < 0 ? 'ירד' : 'עלה'} מ־<b>${fmt(la.phys.rhr.from, 0)}</b> ל־<b>${fmt(la.phys.rhr.to, 0)}</b>`);
  if (la.phys.hrv?.real) bits.push(`ה-HRV ${la.phys.hrv.d > 0 ? 'עלה' : 'ירד'} מ־<b>${fmt(la.phys.hrv.from, 0)}</b> ל־<b>${fmt(la.phys.hrv.to, 0)}</b>`);
  const up = la.loadPct > 0;
  const moved = bits.length ? `ובמקביל ${bits.join(' ו')}` : 'וההתאוששות שלך נשארה יציבה';
  return `<p class="mdl-adapt ${la.coping ? 'good' : 'warn'}">
    עומס האימון ${up ? 'עלה' : 'ירד'} ב-<b>${fmt(Math.abs(la.loadPct), 0)}%</b> בשבועיים האחרונים, ${moved} —
    ${la.coping
      ? (up ? 'הגוף סופג את העלייה היטב.' : 'ההתאוששות מחזיקה.')
      : (up ? 'סימן שכדאי להאט את קצב העלייה.' : 'ההתאוששות עדיין לא השתפרה.')}</p>`;
}

/* =========================================================================
 * אזהרת עומס — משדרגת את renderStrain עם סף אישי
 * ========================================================================= */
function strainCard() {
  const signals = [];
  for (const [key, txt] of [['rhr', 'דופק מנוחה מוגבר'], ['hrv', 'HRV נמוך'], ['respiration_avg', 'קצב נשימה מוגבר']]) {
    const s = statusOf(key);
    if (s && (s.level === 'watch' || s.level === 'alert')) signals.push(txt);
  }
  const res = strainResemblance();
  const la = loadAdaptation();
  const rising = la && la.loadPct > 15 && !la.coping;   // עומס עולה בלי הסתגלות

  // שני סימנים מצטלבים, או סימן אחד כשהעומס עולה בלי שהגוף סופג אותו
  if (signals.length < 2 && !(rising && signals.length === 1)) return '';

  const bits = [signals.join(' · ')];
  if (rising) bits.push(`עומס האימון עלה ב-${fmt(la.loadPct, 0)}% בשבועיים האחרונים בלי שיפור בהתאוששות`);

  // התקדים האישי: איך נראתה אצלך התקופה שגרמין סימן בה עומס
  let precedent = '';
  if (res && res.score >= 0.5 && res.sig.rhr) {
    precedent = `<div class="strain-prec">זה דומה לתקופה שגרמין סימן אותך בעומס
      (${res.sig.n} ימים): דופק המנוחה שלך היה אז <b>${fmt(res.sig.rhr.mean, 0)}</b>
      ${res.sig.hrv ? ` וה-HRV <b>${fmt(res.sig.hrv.mean, 0)}</b>` : ''}.</div>`;
  }

  return `<div class="strain-card">
    <span class="strain-ic">${icon('stetho', 22)}</span>
    <div><div class="strain-title">הגוף תחת עומס</div>
      <div class="strain-body">${bits.join(' · ')} — שקול יום מנוחה, שתייה מרובה ושינה מוקדמת.</div>
      ${precedent}</div></div>`;
}
