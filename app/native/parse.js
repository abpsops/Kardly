// Turns OCR'd text lines from a visiting card into contact fields.
// lines: [{ text, h (line height px), y, x, block, conf (0-100) }]
// options: { region: "AE" } default country for numbers printed without a country code.
import { findPhoneNumbersInText } from "libphonenumber-js/max";  // full data: knows mobile vs landline ranges

const TITLE_WORDS = /\b(ceo|cfo|coo|cto|cmo|cio|founder|co-?founder|owner|partner|president|vice|vp|svp|evp|director|head|manager|mgr|lead|leader|officer|executive|engineer|consultant|specialist|architect|designer|developer|analyst|advisor|adviser|associate|coordinator|supervisor|administrator|accountant|chairman|chairperson|principal|proprietor|representative|sales|business development|operations|procurement|purchasing|human resources|chief|secretary|agent|broker|doctor|dr\.|lawyer|advocate|attorney|surveyor|technician|assistant|intern|trainee|managing|general manager|gm|md|account|relationship|marketing manager)\b/i;
const COMPANY_WORDS = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co\.|company|pvt|private|plc|gmbh|ag|s\.?a\.?|srl|bv|fze|fzco|fz-?llc|fzc|dmcc|est\.?|establishment|group|holding|holdings|trading|enterprises?|industries|international|solutions|technologies|technology|systems|services|consulting|consultants|associates|partners|studio|labs?|ventures|capital|logistics|shipping|properties|real estate|realty|contracting|construction|engineering|electricals?|electronics|motors|foods?|catering|hospitality|hotels?|resorts?|clinic|hospital|pharma(ceuticals?)?|media|agency|bank|insurance|exchange|travels?|tours|textiles|garments|jewell?ers|furniture|interiors|architects?|solar|energy|global|digital)\b/i;
const ADDRESS_WORDS = /\b(street|st\.|road|rd\.?|avenue|ave\.?|boulevard|blvd|lane|ln\.|floor|flr|suite|ste\.?|office\s*(no\.?|#)?\s*\d|unit|bldg|building|tower|plaza|centre|center|mall|p\.?\s?o\.?\s?box|block|plot|sector|phase|nagar|marg|chowk|district|industrial area|free\s?zone|business bay|jlt|jafza|difc|dmcc|al quoz|al barsha|deira|bur dubai|dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|riyadh|jeddah|dammam|doha|muscat|kuwait|manama|mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|pune|kolkata|ahmedabad|karachi|lahore|cairo|london|new york|singapore|uae|u\.a\.e|india|saudi arabia|ksa|qatar|oman|bahrain|usa|u\.s\.a|uk|germany|france|zip|pin)\b/i;
const COUNTRY_HINTS = [
  [/\b(uae|u\.a\.e|united arab emirates|dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah)\b/i, "AE"],
  [/\b(india|mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|pune|kolkata|ahmedabad)\b/i, "IN"],
  [/\b(saudi|ksa|riyadh|jeddah|dammam)\b/i, "SA"], [/\b(qatar|doha)\b/i, "QA"], [/\b(oman|muscat)\b/i, "OM"],
  [/\b(kuwait)\b/i, "KW"], [/\b(bahrain|manama)\b/i, "BH"], [/\b(pakistan|karachi|lahore|islamabad)\b/i, "PK"],
  [/\b(egypt|cairo)\b/i, "EG"], [/\b(united kingdom|london|\buk\b)\b/i, "GB"], [/\b(germany|berlin|munich|deutschland)\b/i, "DE"],
  [/\b(usa|u\.s\.a|united states|new york)\b/i, "US"], [/\b(singapore)\b/i, "SG"],
];
const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail|ymail|rediffmail|zoho|msn)$/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const WEB_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ae|in|uk|de|sa|qa|om|kw|bh|pk|eg|biz|info|me|ai|app|dev|tech|store|shop|online|site|xyz|us|ca|au|sg|my|fr|es|it|nl|ch|global|agency|studio|design)(?:\.[a-z]{2})?(?:\/[^\s,;]*)?)/gi;
const LABEL_RE = /\b(tel(ephone)?|phone|ph|mob(ile)?|cell|fax|off(ice)?|direct|dir|whats\s?app|wa|landline|toll\s?free|hotline|t|m|f|p|o|d|c|w)\s*[:.\-]?\s*$/i;

const uniq = a => [...new Set(a)];
function clean(s) {
  return String(s || "")
    .replace(/[|_~`^©®™•·●■▪►◆]+/g, " ")
    .replace(/\s*@\s*/g, "@")                                    // "name @ domain"
    .replace(/\b(www)\s*[.,]\s*/gi, "$1.")                       // "www . site"
    .replace(/([a-z0-9])\s*[.,]\s*(com|net|org|ae|in|co|io|uk|sa|qa)\b/gi, "$1.$2") // "site . com"
    .replace(/\s+/g, " ").replace(/^[\s:;,.\-]+|[\s:;,\-]+$/g, "").trim();
}
function phoneLabel(prefix) {
  const m = prefix.match(LABEL_RE); const p = (m ? m[1] : "").toLowerCase().replace(/\s/g, "");
  if (!p) return "";
  if (/^(fax|f)$/.test(p)) return "Fax";
  if (/^(whatsapp|wa|w)$/.test(p)) return "WhatsApp";
  if (/^(mob|mobile|cell|m|c)$/.test(p)) return "Mobile";
  if (/^(direct|dir|d)$/.test(p)) return "Direct";
  if (/^(tollfree|hotline)$/.test(p)) return "Toll free";
  return "Office";
}
const letters = s => s.toLowerCase().replace(/[^a-z]/g, "");

export function parseCard(rawLines, { region = "AE" } = {}) {
  const L = rawLines.map((l, i) => ({ i, t: clean(l.text), h: l.h || 0, y: l.y == null ? i * 10 : l.y, x: l.x || 0, block: l.block == null ? i : l.block, side: l.side || 0, conf: l.conf == null ? 100 : l.conf }))
    .filter(l => l.t.length > 1 && l.conf >= 30);
  const out = { name: "", title: "", company: "", phones: [], emails: [], website: "", address: "", linkedin: "", links: [] };
  const all = L.map(l => l.t).join("\n");
  let country = region;
  for (const [re, cc] of COUNTRY_HINTS) if (re.test(all)) { country = cc; break; }

  // emails
  for (const l of L) {
    const m = l.t.match(EMAIL_RE);
    if (!m) continue;
    out.emails.push(...m.map(e => e.toLowerCase().replace(/[.,]+$/, "")));
    l.hasEmail = true;
    if (l.t.replace(EMAIL_RE, "").replace(/\b(e-?mail|email|e)\s*[:.]?/gi, "").trim().length < 3) l.used = true;
  }
  out.emails = uniq(out.emails);
  const domains = out.emails.map(e => e.split("@")[1]).filter(Boolean);

  // websites and social links
  const webs = [];
  for (const l of L) {
    const emailSpans = [...l.t.matchAll(EMAIL_RE)].map(m => [m.index, m.index + m[0].length]);
    for (const m of l.t.matchAll(WEB_RE)) {
      const s = m[1], i = m.index;
      if (emailSpans.some(([a, b]) => i < b && i + s.length > a)) continue; // part of an email
      if (/^\d+(\.\d+)+$/.test(s)) continue;
      if (/linkedin\./i.test(s)) out.linkedin = out.linkedin || s;
      else if (/(instagram|facebook|fb|twitter|x|youtube|tiktok|behance|github)\.com/i.test(s)) out.links.push(s);
      else webs.push(s);
      l.hasWeb = true;
    }
    if (l.hasWeb && l.t.replace(WEB_RE, "").replace(/\b(web(site)?|w|url)\s*[:.]?/gi, "").trim().length < 3) l.used = true;
  }
  out.website = webs.find(w => /www\./i.test(w)) || webs.find(w => domains.some(d => w.toLowerCase().includes(d))) || webs[0] || "";
  if (out.website) domains.push(out.website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
  out.links = uniq(out.links);

  // phones: validated with libphonenumber; the label is the word printed just before the number
  for (const l of L) {
    if (l.used) continue;
    const text = l.t.replace(EMAIL_RE, m => " ".repeat(m.length));
    let found = [];
    try { found = findPhoneNumbersInText(text, { defaultCountry: country }); } catch { found = []; }
    if (!found.length) {
      // numbers libphonenumber doesn't know (short local formats): keep only clear 8-15 digit runs
      for (const m of text.matchAll(/(\+?\(?\d[\d\s().\-\/]{6,}\d)/g)) {
        const d = m[1].replace(/\D/g, "");
        if (d.length >= 8 && d.length <= 15 && !/^\d{5,6}$/.test(m[1].trim())) found.push({ raw: m[1].trim(), startsAt: m.index });
      }
    }
    for (const f of found) {
      let label = phoneLabel(text.slice(0, f.startsAt));
      const type = f.number && f.number.getType ? f.number.getType() : undefined;
      const typeLabel = type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE" ? "Mobile" : type === "FIXED_LINE" ? "Office" : /TOLL_FREE|SHARED_COST/.test(type || "") ? "Toll free" : "";
      if (label !== "Fax") {
        if (!label) label = typeLabel;
        else if (type === "FIXED_LINE" && /Mobile|WhatsApp/.test(label)) label = "Office";      // e.g. "M: +971 4 …" is still a landline
        else if (type === "MOBILE" && /Office|Direct/.test(label)) label = "Mobile";
      }
      const num = f.number ? f.number.formatInternational() : f.raw.replace(/\s+/g, " ");
      out.phones.push(num + (label ? ` (${label})` : ""));
    }
    if (found.length) {
      l.hasPhone = true;
      let rest = text;
      for (const f of found) rest = rest.replace(f.number ? text.slice(f.startsAt, f.endsAt) : f.raw, " ");
      if (rest.replace(/\b(tel|telephone|phone|ph|mob(ile)?|cell|fax|off(ice)?|direct|whats\s?app|t|m|f|p|o|d|c|w)\b\s*[:.\-]?/gi, "").replace(/[\s/|,]+/g, "").length < 3) l.used = true;
    }
  }
  out.phones = uniq(out.phones).slice(0, 6);

  // address: keyword lines, joined top to bottom
  const addr = [];
  for (const l of L) {
    if (l.used || l.hasEmail || l.hasWeb) continue;
    const looksAddr = ADDRESS_WORDS.test(l.t) && (/\d/.test(l.t) || /,/.test(l.t) || COUNTRY_HINTS.some(([re]) => re.test(l.t)));
    if (looksAddr && !TITLE_WORDS.test(l.t)) { addr.push(l); l.used = true; }
  }
  out.address = addr.sort((a, b) => a.side - b.side || a.y - b.y).map(l => l.t.replace(/^(add(ress)?|a)\s*[:.]\s*/i, "")).join(", ").replace(/,\s*,/g, ",");

  const free = L.filter(l => !l.used && !l.hasEmail && !l.hasWeb && !l.hasPhone && /\p{L}{2,}/u.test(l.t));
  const maxH = Math.max(1, ...free.map(l => l.h));

  // a combined "Sales Director, Gulf Trading LLC" line
  for (const l of free) {
    if (l.used) continue;
    const parts = l.t.split(/\s*(?:,|\||\s-\s|\s–\s|\bat\b)\s*/).filter(Boolean);
    if (parts.length !== 2) continue;
    const [a, b] = parts;
    if (TITLE_WORDS.test(a) && COMPANY_WORDS.test(b) && !out.title) { out.title = a; out.company = b; l.used = true; }
    else if (TITLE_WORDS.test(b) && COMPANY_WORDS.test(a) && !out.title) { out.title = b; out.company = a; l.used = true; }
  }

  // title
  let titleLine = null;
  if (!out.title) {
    titleLine = free.filter(l => !l.used && TITLE_WORDS.test(l.t) && l.t.split(" ").length <= 9 && !/\d{3,}/.test(l.t))
      .sort((a, b) => (COMPANY_WORDS.test(a.t) - COMPANY_WORDS.test(b.t)) || b.h - a.h)[0] || null;
    if (titleLine) { out.title = titleLine.t; titleLine.used = true; }
  }

  // name: 2-4 alphabetic words; big text, matches the email, sits next to the title
  const locals = out.emails.map(e => e.split("@")[0].toLowerCase().replace(/[^a-z]/g, " "));
  const domainKeys = domains.map(d => d.split(".")[0].toLowerCase()).filter(d => d.length >= 3 && !FREEMAIL.test(d));
  const isNameShape = t => /^[\p{L}][\p{L}.'\-]*(\s+[\p{L}][\p{L}.'\-]*){1,3}$/u.test(t) && !/\d/.test(t);
  const nameCands = free.filter(l => !l.used && isNameShape(l.t) && !COMPANY_WORDS.test(l.t) && !TITLE_WORDS.test(l.t) && !ADDRESS_WORDS.test(l.t)
      && !domainKeys.some(k => letters(l.t) === k || (k.length >= 5 && letters(l.t).startsWith(k))))
    .map(l => {
      const words = l.t.toLowerCase().split(/\s+/);
      const emailHit = locals.some(loc => words.some(w => w.length > 2 && loc.includes(w))) ? 3 : 0;
      const nearTitle = titleLine && titleLine.side === l.side && Math.abs(titleLine.y - l.y) < Math.max(l.h, titleLine.h) * 2.6 ? 1.5 : 0;
      const caps = l.t.split(/\s+/).every(w => /^[\p{Lu}]/u.test(w)) ? 0.5 : 0;
      return { l, score: (l.h / maxH) * 3 + emailHit + nearTitle + caps - (l.side > 0 ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  if (nameCands[0]) { out.name = toTitle(nameCands[0].l.t); nameCands[0].l.used = true; }

  // company: matches the email/website domain, or has company words, or is the logo-sized text left over
  if (!out.company) {
    const compCands = free.filter(l => !l.used && l.t.length <= 60).map(l => {
      const key = letters(l.t);
      const domainHit = domainKeys.some(k => key && (key.startsWith(k.slice(0, 5)) || k.startsWith(key.slice(0, 5)))) ? 4 : 0;
      const words = COMPANY_WORDS.test(l.t) ? 3 : 0;
      const tagline = l.t.split(" ").length > 5 && !words ? -2 : 0;
      return { l, score: domainHit + words + (l.h / maxH) * 2 + tagline - (l.side > 0 ? 0.5 : 0) };
    }).sort((a, b) => b.score - a.score);
    if (compCands[0] && compCands[0].score > 1.2) {
      let c = compCands[0].l; c.used = true;
      // a two-line logo ("HALDEN & RAO" / "ARCHITECTS"): join the line right under it
      const next = free.find(l => !l.used && l.side === c.side && l.y > c.y && l.y - c.y < c.h * 2.2 && COMPANY_WORDS.test(l.t) && l.t.split(" ").length <= 3);
      out.company = next ? `${c.t} ${next.t}` : c.t;
      if (next) next.used = true;
    }
  }
  if (!out.company && domainKeys[0]) out.company = domainKeys[0].charAt(0).toUpperCase() + domainKeys[0].slice(1);
  if (/^[\p{Lu}\s&.'\-]+$/u.test(out.company) && out.company.length > 3) out.company = toTitle(out.company);
  return out;
}
function toTitle(s) {
  return /^[\p{Lu}\s.&'\-]+$/u.test(s) ? s.toLowerCase().replace(/(^|[\s'\-&])\p{L}/gu, m => m.toUpperCase()).replace(/\b(Llc|Fze|Fzco|Dmcc|Plc|Gmbh|Ltd|Pvt)\b/g, m => m.toUpperCase()) : s;
}
