// Turns OCR'd text lines from a visiting card into contact fields.
// lines: [{ text, h (line height in px), conf (0-100) }]

const TITLE_WORDS = /\b(ceo|cfo|coo|cto|cmo|founder|co-?founder|owner|partner|president|vice|vp|director|head|manager|mgr|lead|leader|officer|executive|engineer|consultant|specialist|architect|designer|developer|analyst|advisor|adviser|associate|coordinator|supervisor|administrator|accountant|chairman|chairperson|principal|proprietor|representative|sales|marketing|business development|operations|procurement|purchasing|hr|human resources|chief|secretary|agent|broker|doctor|dr\.|lawyer|advocate|attorney|surveyor|technician|assistant|intern|trainee|managing)\b/i;
const COMPANY_WORDS = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co\.|company|pvt|private|plc|gmbh|ag|sa|srl|bv|fze|fzco|fz-llc|fzc|est\.?|establishment|group|holding|holdings|trading|enterprises?|industries|international|solutions|technologies|technology|tech|systems|services|consulting|consultants|associates|partners|studio|labs?|ventures|capital|logistics|shipping|properties|real estate|realty|contracting|construction|engineering|electricals?|electronics|motors|foods?|catering|hospitality|hotels?|resorts?|clinic|hospital|pharma|pharmaceuticals?|media|marketing|agency|bank|insurance|exchange|travels?|tours|textiles|garments|jewell?ers|furniture|interiors|design)\b/i;
const ADDRESS_WORDS = /\b(street|st\.|road|rd\.?|avenue|ave\.?|boulevard|blvd|lane|ln\.|floor|flr|suite|ste\.?|office no|office|unit|bldg|building|tower|plaza|centre|center|mall|p\.?\s?o\.?\s?box|block|plot|sector|phase|nagar|marg|chowk|district|industrial area|free zone|business bay|jlt|difc|al quoz|al barsha|al nahda|al qusais|dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|riyadh|jeddah|dammam|doha|muscat|kuwait|manama|mumbai|delhi|new delhi|bangalore|bengaluru|chennai|hyderabad|pune|kolkata|ahmedabad|karachi|lahore|cairo|london|new york|singapore|uae|u\.a\.e|india|saudi arabia|ksa|qatar|oman|bahrain|usa|u\.s\.a|uk|germany|france|zip|pin)\b/i;
const FREEMAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail|ymail|rediffmail|zoho)\./i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const WEB_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ae|in|uk|de|sa|qa|om|kw|bh|biz|info|me|ai|app|dev|tech|store|shop|online|site|xyz|us|ca|au|sg|my|pk|eg|fr|es|it|nl|ch|global|agency|studio|design)(?:\.[a-z]{2})?(?:\/[^\s,;]*)?)/gi;
const PHONE_RE = /(\+?\(?\d[\d\s().\-\/]{5,}\d)/g;

const uniq = a => [...new Set(a)];
const clean = s => String(s || "").replace(/[|_~`^©®™•·●■]+/g, " ").replace(/\s+/g, " ").replace(/^[\s:;,.\-]+|[\s:;,\-]+$/g, "").trim();

function phoneLabel(prefix) {
  const p = prefix.toLowerCase().slice(-14);
  if (/fax|\bf\s*[:.]?\s*$/.test(p)) return "Fax";
  if (/whats\s?app|\bwa\s*[:.]?\s*$/.test(p)) return "WhatsApp";
  if (/mob|cell|\bm\s*[:.]?\s*$|\bc\s*[:.]?\s*$/.test(p)) return "Mobile";
  if (/direct|\bd\s*[:.]?\s*$|dir/.test(p)) return "Direct";
  if (/tel|phone|ph|off|landline|\bt\s*[:.]?\s*$|\bp\s*[:.]?\s*$|\bo\s*[:.]?\s*$/.test(p)) return "Office";
  return "";
}

export function parseCard(rawLines) {
  const L = rawLines.map(l => ({ t: clean(l.text), h: l.h || 0, conf: l.conf == null ? 100 : l.conf, used: false }))
    .filter(l => l.t.length > 1 && l.conf >= 30);
  const out = { name: "", title: "", company: "", phones: [], emails: [], website: "", address: "", linkedin: "", links: [] };

  // emails
  for (const l of L) {
    const m = l.t.match(EMAIL_RE);
    if (m) { out.emails.push(...m.map(e => e.toLowerCase())); l.used = l.t.replace(EMAIL_RE, "").replace(/\b(e-?mail|email|e)\s*[:.]?/gi, "").trim().length < 3 || l.used; l.hasEmail = true; }
  }
  out.emails = uniq(out.emails);

  // websites and social links
  const webs = [];
  for (const l of L) {
    for (const m of l.t.matchAll(WEB_RE)) {
      const s = m[1], i = m.index;
      if (l.t[i - 1] === "@" || /@/.test(l.t.slice(Math.max(0, i - 40), i).split(/\s/).pop() || "")) continue; // part of an email
      if (/^\d+(\.\d+)+$/.test(s)) continue;
      if (/linkedin\./i.test(s)) out.linkedin = out.linkedin || s;
      else if (/(instagram|facebook|fb|twitter|x|youtube|tiktok|behance|github)\.com/i.test(s)) out.links.push(s);
      else webs.push(s);
      l.hasWeb = true;
    }
    if (l.hasWeb && l.t.replace(WEB_RE, "").replace(/\b(web(site)?|w|url)\s*[:.]?/gi, "").trim().length < 3) l.used = true;
  }
  out.website = webs.find(w => /www\./i.test(w)) || webs[0] || "";
  out.links = uniq(out.links);

  // phones
  for (const l of L) {
    if (l.hasEmail && !/\d{6,}/.test(l.t.replace(EMAIL_RE, ""))) continue;
    let found = false;
    for (const m of l.t.replace(EMAIL_RE, " ").matchAll(PHONE_RE)) {
      const raw = m[1].trim().replace(/[\s.\-\/]+$/, ""), digits = raw.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) continue;
      if (/^\d{5,6}$/.test(raw)) continue; // postal code
      const label = phoneLabel(l.t.slice(0, m.index));
      out.phones.push(raw.replace(/\s+/g, " ") + (label ? ` (${label})` : ""));
      found = true;
    }
    if (found) { const rest = l.t.replace(PHONE_RE, "").replace(/\b(tel|phone|mob(ile)?|cell|fax|off(ice)?|direct|whatsapp|t|m|f|p|o|d|c)\b\s*[:.]?/gi, "").trim(); if (rest.length < 4) l.used = true; else l.hasPhone = true; }
  }
  out.phones = uniq(out.phones).slice(0, 6);

  // address lines
  const addr = [];
  for (const l of L) {
    if (l.used || l.hasEmail || l.hasWeb) continue;
    const t = l.t;
    const looksAddr = ADDRESS_WORDS.test(t) && (/\d/.test(t) || /,/.test(t) || /\b(dubai|abu dhabi|sharjah|riyadh|doha|mumbai|delhi|bangalore|bengaluru|london|uae|india)\b/i.test(t));
    if (looksAddr && !TITLE_WORDS.test(t)) { addr.push(t.replace(/^(add(ress)?|a)\s*[:.]\s*/i, "")); l.used = true; }
  }
  out.address = addr.join(", ").replace(/,\s*,/g, ",");

  const free = L.filter(l => !l.used && !l.hasEmail && !l.hasWeb && !l.hasPhone);

  // a combined "Sales Director, Gulf Trading LLC" line: split into title and company
  for (const l of free) {
    if (l.used) continue;
    const parts = l.t.split(/\s*(?:,|\||\s-\s|\s–\s|\bat\b)\s*/).filter(Boolean);
    if (parts.length !== 2) continue;
    const [a, b] = parts, aT = TITLE_WORDS.test(a), bT = TITLE_WORDS.test(b), aC = COMPANY_WORDS.test(a), bC = COMPANY_WORDS.test(b);
    if (aT && bC && !out.title) { out.title = a; out.company = b; l.used = true; }
    else if (bT && aC && !out.title) { out.title = b; out.company = a; l.used = true; }
  }

  // title
  const titleLine = free.find(l => TITLE_WORDS.test(l.t) && l.t.split(" ").length <= 8 && !COMPANY_WORDS.test(l.t.replace(/\b(sales|marketing|design|engineering|operations)\b/gi, "")));
  if (titleLine && !out.title) { out.title = titleLine.t; titleLine.used = true; }

  // name: 2-4 alphabetic words, tallest wins; boosted when it matches the email's local part
  const local = (out.emails[0] || "").split("@")[0].toLowerCase().replace(/[^a-z]/g, " ");
  const nameCands = free.filter(l => !l.used && /^[\p{L}][\p{L}.'\-]*(\s+[\p{L}][\p{L}.'\-]*){1,3}$/u.test(l.t) && !COMPANY_WORDS.test(l.t) && !TITLE_WORDS.test(l.t) && !ADDRESS_WORDS.test(l.t))
    .map(l => {
      const words = l.t.toLowerCase().split(/\s+/);
      const emailHit = local && words.some(w => w.length > 2 && local.includes(w)) ? 1 : 0;
      const capsOk = l.t.split(/\s+/).every(w => /^[\p{Lu}]/u.test(w)) ? 1 : 0;
      return { l, score: l.h * (1 + emailHit * 0.8 + capsOk * 0.3) };
    })
    .sort((a, b) => b.score - a.score);
  if (nameCands[0]) { out.name = toTitle(nameCands[0].l.t); nameCands[0].l.used = true; }

  // company: explicit company words first, then the tallest remaining text line
  const compLine = out.company ? null : free.find(l => !l.used && COMPANY_WORDS.test(l.t) && l.t.length <= 60)
    || free.filter(l => !l.used && /\p{L}{2,}/u.test(l.t) && l.t.length <= 48).sort((a, b) => b.h - a.h)[0];
  if (compLine) { out.company = compLine.t; compLine.used = true; }
  if (!out.company && out.emails[0] && !FREEMAIL.test(out.emails[0])) {
    const dom = out.emails[0].split("@")[1].split(".")[0];
    if (dom) out.company = dom.charAt(0).toUpperCase() + dom.slice(1);
  }
  return out;
}
function toTitle(s) { return /^[\p{Lu}\s.'\-]+$/u.test(s) ? s.toLowerCase().replace(/(^|[\s'\-])\p{L}/gu, m => m.toUpperCase()) : s; }
