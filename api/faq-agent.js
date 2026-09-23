// ============================================================================
//  AUTOSZERVIZ - automata árajánlatkészítő (shared engine)
//
//  Everything trade-specific - the questions, their buttons, the price model
//  and the facts the AI may repeat - lives in lib/flow.js, so this file never
//  needs editing to rebrand a workshop.
//
//  Division of labour:
//   - The BACKEND owns the conversation. It decides which question comes next,
//     words it, renders its buttons and maps the answer onto a value. A clicked
//     button never costs a model call, so the bot answers instantly and cannot
//     drift out of step with its own buttons.
//   - The AI is called only when the customer types something the backend
//     cannot map: a question of their own, or an answer in their own words. It
//     replies in a fixed JSON shape - what to say, and which option the words
//     meant, if any - and the backend checks that option against the flow.
//   - The PRICE is computed here from lib/flow.js, deterministically. The model
//     never does arithmetic, so it cannot invent a number.
//
//  WHO USES THIS BUILD: the workshop owner, after he has had the car on the
//  lift. Not the customer. That changes the shape of the whole conversation:
//   - it opens by asking for HIS hourly rates, once, and remembers them;
//   - no question offers a "Nem tudom", because he has already looked;
//   - the last screen is not a price but the PRICED LINES, editable - his
//     normaidő and his part prices type straight over the proposal;
//   - the output is a final, itemised, net/gross quote plus the plain-text
//     version he copies to the customer, not an estimate with a floor;
//   - a feedback step asks what is missing before he would really use it.
// ============================================================================
import { waitUntil } from "@vercel/functions";
import * as FLOW from "../lib/flow.js";

const PHONE = process.env.LEAD_PHONE || FLOW.BOT.phone;
const leadTo = () => process.env.LEAD_EMAIL_TO || FLOW.BOT.email;
const leadFrom = () => process.env.LEAD_EMAIL_FROM || "Autószerviz minta <onboarding@resend.dev>";

// Flow prices are NET. The mechanic works in net and the customer pays gross,
// so a quote built here shows both - at the SHOP's VAT rate, set in its build:
// a good few one-man workshops in Hungary are alanyi adómentes, and stapling
// 27% onto their quote would make every number they issue wrong.
const vatRate = () => FLOW.SHOP.vat;

// ---------------------------------------------------------------------------
//  Formatting
// ---------------------------------------------------------------------------
function formatHuf(n) {
    return Math.round(n).toLocaleString("hu-HU").replace(/\s/g, " ") + " Ft";
}
const roundTo = (n, step) => Math.round(n / step) * step;
const oneLine = (s) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim();
const plain = (s) => String(s == null ? "" : s).replace(/\*\*/g, "");

// ===========================================================================
//  SECURITY - this endpoint is public and spends real money (LLM API + e-mail),
//  so abuse (cost-draining floods, spam relay, prompt/HTML injection) has to be
//  impractical.
// ===========================================================================
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function stripControl(text) {
    return String(text || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\[\[SPLIT\]\]/g, "\n\n")
        .trim();
}

function transcriptHtml(rows) {
    if (!Array.isArray(rows)) return "";
    return rows
        .filter((m) => m && typeof m.content === "string" && m.content.trim())
        .map((m) => {
            const who = (m.role === "assistant" || m.role === "model") ? "Asszisztens" : "Ügyfél";
            const clean = stripControl(m.content);
            if (!clean) return "";
            return `<p style="margin:0 0 10px"><b>${who}:</b><br>${esc(clean).replace(/\n/g, "<br>")}</p>`;
        })
        .join("");
}

function transcriptText(rows) {
    if (!Array.isArray(rows)) return "";
    return rows
        .filter((m) => m && typeof m.content === "string" && m.content.trim())
        .map((m) => {
            const who = (m.role === "assistant" || m.role === "model") ? "Asszisztens" : "Ügyfél";
            const clean = plain(stripControl(m.content));
            return clean ? `${who}:\n${clean}\n` : "";
        })
        .filter(Boolean)
        .join("\n");
}

function customerTurns(rows) {
    if (!Array.isArray(rows)) return 0;
    return rows.filter((m) => m && m.role === "user" && typeof m.content === "string" && m.content.trim()).length;
}

function clientIp(req) {
    const xf = req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
    if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
    return (req.socket && req.socket.remoteAddress) || "unknown";
}

const RL_BUCKETS = new Map();
function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    let b = RL_BUCKETS.get(key);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + windowMs }; RL_BUCKETS.set(key, b); }
    b.count++;
    if (RL_BUCKETS.size > 10000) {
        for (const [k, v] of RL_BUCKETS) if (now > v.resetAt) RL_BUCKETS.delete(k);
    }
    return b.count <= limit ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}
const RL_CHAT = { limit: Number(process.env.RL_CHAT_PER_MIN) || 40, windowMs: 60_000 };
const RL_TRANSCRIPT = { limit: Number(process.env.RL_TRANSCRIPT_PER_HOUR) || 20, windowMs: 60 * 60_000 };
const RL_SELFTEST = { limit: Number(process.env.RL_SELFTEST_PER_HOUR) || 6, windowMs: 60 * 60_000 };
// One set of contact details per person per day. Somebody can still price as
// many cars as they like - that is what the restart button is for - but the
// workshop should not get the same person's details ten times over, and the
// inbox should not fill up with duplicates of one tester.
const RL_LEAD = { limit: Number(process.env.RL_LEAD_PER_DAY) || 1, windowMs: 24 * 60 * 60_000 };

const MAX_QUESTION_LEN = 2000;
const MAX_HISTORY_MSGS = 80;
const MAX_MSG_LEN = 8000;
const ALLOWED_ROLES = new Set(["user", "assistant", "model"]); // NB: no "system"
function validateChatInput(question, history) {
    if (question != null && (typeof question !== "string" || question.length > MAX_QUESTION_LEN)) return "Ez az üzenet túl hosszú.";
    if (history != null) {
        if (!Array.isArray(history) || history.length > MAX_HISTORY_MSGS) return "Érvénytelen előzmény.";
        for (const m of history) {
            if (!m || typeof m !== "object") return "Érvénytelen előzmény.";
            if (typeof m.content !== "string" || m.content.length > MAX_MSG_LEN) return "Érvénytelen előzmény.";
            if (!ALLOWED_ROLES.has(m.role)) return "Érvénytelen előzmény.";
        }
    }
    return null;
}

function applyCors(req, res) {
    const allow = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = (req.headers && req.headers.origin) || "";
    let value = "*";
    if (allow.length) value = allow.includes(origin) ? origin : allow[0];
    res.setHeader("Access-Control-Allow-Origin", value);
    if (allow.length) res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
}

// ---------------------------------------------------------------------------
//  Contact detail checks
// ---------------------------------------------------------------------------
const GMAIL_TYPOS = new Set([
    "gmial.com", "gmai.com", "gmal.com", "gmil.com", "gmali.com", "gamil.com",
    "gmaill.com", "gmaul.com", "gmsil.com", "gmaik.com", "gmqil.com", "gnail.com",
    "gmile.com", "gmaol.com", "gmail.con", "gmail.co", "gmail.cm", "gmail.om",
    "gmail.comm", "gmail.cpm", "gmail.vom", "gmail.xom", "gmail.ocm", "gmail.cim",
    "gmail.coom", "gmaill.con", "freemail.h", "freemial.hu", "fremail.hu",
]);
function emailIssue(email) {
    const e = String(email || "").trim().toLowerCase();
    const m = e.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
    if (!m) return "format";
    const domain = m[1];
    if (domain === "gmail.com") return null;
    if (domain.startsWith("gmail.")) return "gmail";
    if (GMAIL_TYPOS.has(domain)) return "gmail";
    return null;
}

// A Hungarian plate is AAA-123 (old) or AA-BB-123 (2022-). Anything else is
// accepted as-is and simply flagged as foreign on the owner's card - we never
// guess WHICH country, because that is not something a plate reliably tells us.
const PLATE_HU = /^[A-ZÁÉÍÓÖŐÚÜŰ]{3}-?\d{3}$|^[A-Z]{2}-?[A-Z]{2}-?\d{3}$/i;
const plateIsHungarian = (p) => PLATE_HU.test(String(p || "").replace(/\s/g, ""));

// ===========================================================================
//  FLOW MACHINERY - generic over whatever lib/flow.js defines
// ===========================================================================
const has = (s, k) => !!s && s[k] != null && String(s[k]).trim() !== "";
const fieldDef = (field) => (field && FLOW.FIELDS[field]) || null;
const textOf = (v, sel) => (typeof v === "function" ? v(sel || {}) : v);

function optionsFor(field, sel) {
    const f = fieldDef(field);
    if (!f) return [];
    return (typeof f.options === "function" ? f.options(sel || {}) : f.options) || [];
}

function allValues(field) {
    const f = fieldDef(field);
    if (!f) return [];
    if (Array.isArray(f.values)) return f.values;
    return Array.isArray(f.options) ? f.options.map((o) => o.value) : [];
}

function projectOrder(sel) {
    return FLOW.fieldOrder(sel || {}).filter((f) => fieldDef(f));
}
function pendingField(sel) {
    for (const f of projectOrder(sel)) if (!has(sel, f)) return f;
    return null;
}
// The progress bar stays hidden until the jobs are chosen, because only then is
// the number of remaining questions settled: an oil change needs three more, a
// clutch eight. Showing a bar before that means watching it jump BACKWARDS when
// the customer ticks a second job, which reads as "wait, it got longer".
function progressOf(sel) {
    if (!has(sel, "jobs")) return {};
    const order = projectOrder(sel);
    return { progress: order.filter((f) => has(sel, f)).length, progressTotal: order.length };
}

function norm(s) {
    return String(s || "").normalize("NFC").toLowerCase()
        .replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

const MULTI_SEP = "·";
function joinMulti(field, vals) {
    const f = fieldDef(field);
    let v = [...new Set(vals)];
    const none = (f && f.none) || [];
    if (v.length > 1) v = v.filter((x) => !none.includes(x));
    return v.length ? v.join(",") : null;
}

// A typed model year: "2008", "2008-as", "kb 2012".
function parseYear(text) {
    const m = String(text || "").match(/\b(19[7-9]\d|20[0-4]\d)\b/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1970 && n <= new Date().getFullYear() + 1 ? String(n) : null;
}

const cleanVin = (s) => String(s || "").replace(/[\s-]/g, "").toUpperCase();

// Map the customer's message onto the field being asked, WITHOUT the model.
// Beyond the chip labels this understands the field types the car flow adds:
// a typed VIN, a typed year, a free-text make/model/engine, and a free
// description of a symptom.
function mapAnswer(field, text, sel) {
    const f = fieldDef(field);
    const raw = String(text || "").trim();
    const a = norm(raw);
    if (!f || !a) return null;
    const opts = optionsFor(field, sel);
    const byLabel = (s) => opts.find((o) => norm(o.label) === s);

    if (f.type === "multi") {
        const vals = [];
        for (const p of a.split(MULTI_SEP).map((x) => x.trim()).filter(Boolean)) {
            const o = byLabel(p);
            if (!o) return null;
            vals.push(o.value);
        }
        return joinMulti(field, vals);
    }

    const o = byLabel(a);
    if (o) {
        // "Beírok egy mintát" fills a real, decodable VIN that belongs to no car.
        if (field === "vin" && o.value === "__minta") return FLOW.SAMPLE_VIN;
        // "Egyéb márka (beírom)" is not an answer, it is an invitation to type.
        if (o.value === "__egyeb") return null;
        return o.value;
    }

    if (field === "vin") {
        const v = cleanVin(raw);
        if (FLOW.vinLooksValid(v)) return v;
        // Somebody clearly saying they do not have it, in their own words.
        if (/(nincs|nem tudom|nem találom|nem talalom|kés[őo]bb|skip|hagyjuk)/i.test(a)) return "nincs";
        return null;
    }
    if (f.type === "year") {
        // Terminal for the same reason as in sanitizeState: the field is `free`
        // so a typed year works, and without this an unparseable one would be
        // taken at face value by the free-text branch at the bottom.
        return parseYear(raw);
    }
    if (f.type === "text") {
        return raw.length >= 3 ? oneLine(raw).slice(0, 400) : null;
    }
    // Free-text fields (make, model, engine): anything short and plausible is
    // taken at face value. The catalogue is a convenience, not a gate - a car it
    // has never heard of still gets a quote, it just loses the engine filter.
    if (f.free && raw.length >= 2 && raw.length <= 40 && !/[<>{}]/.test(raw)) {
        return oneLine(raw);
    }
    return null;
}

// Who the quote is for. Optional throughout - a shop pricing a car it already
// has in the workshop knows perfectly well whose it is, and making him retype
// it would be the tool adding work rather than removing it.
const CONTACT_KEYS = ["ugyfel", "plate"];
const FEEDBACK_KEYS = ["fb_verdict", "fb_price", "fb_text", "fb_role", "lead_name", "lead_contact", "lead_shop"];

// An optional row the mechanic deliberately left blank. It has to be RECORDED,
// not merely absent: pendingField looks for missing keys, so a blank optional
// field with no marker would be asked again forever.
const SKIP = "-";

function sanitizeState(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const field of Object.keys(FLOW.FIELDS)) {
        if (!has(raw, field)) continue;
        const f = FLOW.FIELDS[field];
        const v = String(raw[field]).slice(0, 400);
        const allowed = new Set(allValues(field));
        if (f.optional && v === SKIP) {
            out[field] = SKIP;
            continue;
        }
        if (f.type === "tetelek") {
            // Re-serialised through the parser, so nothing the client invents
            // survives into the price model.
            const parsed = FLOW.parseOverrides(String(raw[field]).slice(0, 20000));
            out[field] = FLOW.serializeOverrides(parsed);
            continue;
        }
        if (f.type === "multi") {
            const vals = v.split(",").filter((x) => allowed.has(x));
            if (vals.length) out[field] = [...new Set(vals)].join(",");
        } else if (allowed.has(v)) {
            out[field] = v;
        } else if (field === "vin") {
            // The VIN is the one free field with a hard shape. Anything that is
            // not one of its buttons and not a real 17-character VIN is dropped,
            // so a half-typed number can never reach the owner's card looking
            // like a confirmed one.
            if (FLOW.vinLooksValid(v)) out[field] = cleanVin(v);
        } else if (f.type === "year") {
            // The year box accepts a typed year as well as the bands, which
            // means `free` is set on it - so it has to be terminal here, or an
            // impossible "3000" falls through to the free-text branch below and
            // is kept verbatim.
            const y = parseYear(v);
            if (y) out[field] = y;
        } else if ((f.type === "text" || f.free) && v.length >= 2 && !/[<>{}]/.test(v)) {
            out[field] = oneLine(v);
        }
    }
    for (const k of [...CONTACT_KEYS, ...FEEDBACK_KEYS]) if (has(raw, k)) out[k] = oneLine(raw[k]).slice(0, 600);
    return out;
}

function labelFor(field, value, sel) {
    const f = fieldDef(field);
    if (!f || value == null || String(value) === "") return "-";
    if (String(value) === SKIP) return "-";
    const opts = optionsFor(field, sel);
    const find = (v) => opts.find((o) => o.value === v);
    if (f.type === "multi") return String(value).split(",").map((v) => (find(v) || {}).label || v).join(", ");
    const o = find(String(value));
    if (o) return o.label;
    if (field === "vin" && FLOW.vinLooksValid(value)) return cleanVin(value);
    return String(value);
}

function summaryPairs(sel) {
    return projectOrder(sel)
        .filter((f) => has(sel, f))
        .map((f) => [textOf(fieldDef(f).short, sel) || f, labelFor(f, sel[f], sel)]);
}

function questionText(field, sel) {
    const f = fieldDef(field);
    const lines = [`**${textOf(f.q, sel)}**`];
    const hint = textOf(f.hint, sel);
    if (hint) lines.push(hint);
    if (f.type === "multi") lines.push("Több is választható - a végén nyomd meg a **Tovább** gombot.");
    if (f.type === "text") lines.push("Írd be ide, a saját szavaiddal.");
    return lines.join("\n");
}

// Short confirmation of the answer just recorded, plus anything the flow wants
// said about it (the VIN read-back, an expertise note).
const ACK = ["Rendben", "Megvan", "Köszönöm", "Jó"];
function ackText(field, sel) {
    const f = fieldDef(field);
    const i = Math.max(0, projectOrder(sel).indexOf(field)) % ACK.length;
    if (field === "vin" && FLOW.vinLooksValid(sel.vin)) return FLOW.vinNote(sel.vin, sel);
    const note = textOf(f.after, sel);
    return `${ACK[i]}: **${labelFor(field, sel[field], sel)}**.` + (note ? `\n${note}` : "");
}

// ---------------------------------------------------------------------------
//  Contact form. Once every question that moves the price is answered, the rest
//  is admin, so it is one form instead of four more bubbles.
// ---------------------------------------------------------------------------
const FORM = "__tetelek";
const FEEDBACK = "__feedback";
const FORM_INTRO = "Megvannak a tételek. Nézd át, és ha ennél az autónál más kell, írd át.";

// Offered after every finished quote. Without a way on, the conversation
// simply dead-ended - exactly what the first tester reported: "egy lekérdezés
// után megakadt és többet nem tudott mondani".
const RESTART_CHIP = "Új ajánlat másik autóra";
const EDIT_CHIP = "Tételek módosítása";
const isRestart = (text) => norm(text) === norm(RESTART_CHIP);
const isEdit = (text) => norm(text) === norm(EDIT_CHIP);

// ---------------------------------------------------------------------------
//  ONE QUOTE PER PERSON (the Facebook-group demo).
//
//  Two layers, because neither holds on its own:
//   - the BROWSER is the real limit: once a quote is done, the widget remembers
//     it and every later visit opens on the "már kipróbáltad" message;
//   - the SERVER is a backstop against simply clearing that: a session may
//     only ever finish ONE car, and one IP may open only a few sessions a day.
//  The IP cap is deliberately not 1. Hungarian mobile carriers put many phones
//  behind one shared address, so "one per IP" would lock out real mechanics
//  who never touched it - in a group where almost everyone is on mobile data.
//  The server memory is per instance and resets on a cold start: this stops
//  casual re-runs, not someone determined, and it does not need to.
//
//  OWNER_KEY: open the page as ?teszt=<OWNER_KEY> and none of this applies,
//  so testing your own demo does not lock you out of it.
// ---------------------------------------------------------------------------
const oneQuote = () => (process.env.ONE_QUOTE || "on").toLowerCase() !== "off";
const sessionsPerIp = () => Number(process.env.QUOTE_SESSIONS_PER_IP) || 3;
const QUOTA_WINDOW_MS = 24 * 60 * 60_000;
const QUOTA = new Map(); // ip -> [{ session, fp, at }]
const isOwner = (key) => !!process.env.OWNER_KEY && typeof key === "string" && key === process.env.OWNER_KEY;
const limited = (ctx) => oneQuote() && !(ctx && ctx.owner);
// What makes two quotes "the same one": the car and the jobs. Re-opening the
// line editor and changing an hour does not make a second quote.
const fingerprint = (sel) => `${FLOW.carLine(sel)}|${sel.jobs || ""}`;

function quotaEntries(ip) {
    const now = Date.now();
    const list = (QUOTA.get(ip) || []).filter((e) => now - e.at < QUOTA_WINDOW_MS);
    QUOTA.set(ip, list);
    return list;
}
// Has THIS session already finished a quote?
function sessionUsed(ctx) {
    if (!limited(ctx)) return false;
    return quotaEntries(ctx.ip).some((e) => e.session === ctx.sessionId);
}
// May this session start, or finish this particular quote?
function quotaBlocked(ctx, sel) {
    if (!limited(ctx)) return false;
    const list = quotaEntries(ctx.ip);
    const mine = list.find((e) => e.session === ctx.sessionId);
    if (mine) return !!sel && mine.fp !== fingerprint(sel);
    return list.length >= sessionsPerIp();
}
function quotaRecord(ctx, sel) {
    if (!limited(ctx)) return;
    const list = quotaEntries(ctx.ip);
    if (!list.some((e) => e.session === ctx.sessionId)) {
        list.push({ session: ctx.sessionId, fp: fingerprint(sel), at: Date.now() });
    }
}
const LIMIT_TEXT = "Ezt a mintát **mindenki egyszer** próbálhatja ki - a tiéd már elkészült.\n\nHa kérsz egy sajátot, a te óradíjaddal, árlistáddal és munkáiddal, hagyd itt, hol érlek el, és megcsinálom neked.";
function limitResponse(response, sel) {
    return response.status(200).json({
        answer: LIMIT_TEXT, chips: [], state: sel, limited: true, form: leadForm(sel),
    });
}
// After a quote the only way on is the line editor - unless the limit is off.
const moreChips = (ctx) => (limited(ctx) ? [] : [RESTART_CHIP]);

// Whether a finished quote is e-mailed.
//
// OFF by default. On the first day in a Facebook group this sent 25 quotes and
// hit the daily sending quota by teatime - and not one of them was a lead,
// because the prototype deliberately does not collect contact details. They
// were telemetry, and telemetry does not belong in an inbox. A real workshop
// turns it on with EMAIL_QUOTES=on, where every quote IS a lead.
// Mechanic feedback is always e-mailed: it is rare and it is the whole point.
const EMAIL_QUOTES = (process.env.EMAIL_QUOTES || "").toLowerCase() === "on";

// A plausible but deliberately fake plate for the prototype's fill button. PR-OT
// is not a live Hungarian series, so it reads as a sample to anyone who knows
// plates, while still being the right shape.
function samplePlate() {
    return `PR-OT-${String(100 + Math.floor(Math.random() * 900))}`;
}

// ---------------------------------------------------------------------------
//  THE TÉTELEK SCREEN - the one that makes this a mechanic's tool.
//
//  Everything before it is the same sort of questionnaire the customer-facing
//  build had. This screen is the difference: the engine proposes a normaidő and
//  a part price for every line, and the man who has just had the car on the
//  lift types over whichever ones he disagrees with. A proposal he accepts
//  costs him nothing; a proposal he rejects costs him one number.
//
//  It is also the honest stand-in for the two licensed databases this prototype
//  does not have. A real build pulls the hours from a normaidő licence and the
//  part price from the shop's supplier catalogue by part number; here they are
//  defaults with an override on top. The override is not a workaround - it stays
//  in the live version too, because the mechanic is right more often than the
//  table is.
// ---------------------------------------------------------------------------
const hourStr = (h) => String(Math.round(h * 100) / 100).replace(".", ",");

function tetelekForm(sel) {
    const quote = assembleQuote(sel);
    const fields = [];
    for (const it of quote.items) {
        if (it.kind === "munka") {
            fields.push({
                key: it.key, type: "number", decimal: true, unit: "óra",
                label: it.label,
                // A dot, not the Hungarian comma: this lands in an
                // <input type="number">, which silently blanks "5,5".
                value: String(Math.round(it.hours * 100) / 100),
                note: `alap: ${hourStr(it.proposedHours)} óra · ${formatHuf(it.rate)}/óra`,
                optional: true,
            });
        } else if (it.kind === "alkatresz") {
            fields.push({
                key: it.key, type: "number", unit: "Ft",
                label: it.label + (it.qty > 1 ? ` (${hourStr(it.qty)} ×, egységár)` : ""),
                value: String(Math.round(it.unit)),
                note: `alap: ${formatHuf(it.proposedUnit)} nettó`,
                optional: true,
            });
        }
    }
    // Lines he added himself last time round come back editable rather than
    // frozen, so a typo in one is fixable without starting again.
    const ov = FLOW.parseOverrides(sel.tetelek);
    ov.extra.forEach((e, i) => {
        fields.push({ key: `xlabel:${i}`, type: "text", label: "Saját tétel", value: e.label, optional: true, placeholder: "pl. Beszorult csavar kifúrása" });
        fields.push({ key: `xar:${i}`, type: "number", unit: "Ft", label: "Saját tétel nettó ára", value: String(Math.round(e.amount)), optional: true });
    });
    fields.push({ key: "ugyfel", label: "Ügyfél neve (nem kötelező)", type: "text", placeholder: "pl. Nagy Péter", value: has(sel, "ugyfel") && sel.ugyfel !== SKIP ? String(sel.ugyfel) : "", optional: true });
    fields.push({ key: "plate", label: "Rendszám (nem kötelező)", type: "text", placeholder: "AA-BB-123", value: has(sel, "plate") && sel.plate !== SKIP ? String(sel.plate) : "", optional: true, sample: samplePlate(), sampleLabel: "Minta rendszám" });

    return {
        action: "tetelek",
        title: "A tételek - írd át, ami nálad más",
        why: "Ezek a szerviz beépített normaidői és árai. Ha ennél az autónál más kell, írd át - csak erre az ajánlatra vonatkozik. Új sort is felvehetsz: amit a bontásnál találtál, a vizsgadíj, a gumi ára.",
        submit: "Kész, mutasd az ajánlatot",
        allowExtras: true,
        extraFrom: ov.extra.length,
        fields,
    };
}

// Turn the submitted rows back into the override object. Anything unparseable
// is simply left out, so the proposal stands for that line - a half-typed
// number can never silently zero out a part.
function validateTetelek(raw, sel) {
    const c = raw && typeof raw === "object" ? raw : {};
    const ov = { ora: {}, ar: {}, extra: [] };
    const values = {};
    const errors = {};
    const parseNum = (v) => {
        const s = oneLine(v).replace(/\s/g, "").replace(/ft$/i, "").replace(",", ".");
        if (!s) return null;
        const n = parseFloat(s);
        return Number.isFinite(n) && n >= 0 ? n : NaN;
    };

    // Every box comes back filled, because it was pre-filled with the proposal.
    // Only a number he actually CHANGED is an override. Saving the untouched
    // ones as well would freeze derived lines: raise the hours and the
    // apróanyag, which is a share of the labour, would stay stuck at its old
    // figure because the old figure had been "typed" back in.
    // The yardstick is the proposal as it stood when the form was drawn - the
    // state BEFORE this submission. A box whose number still equals that was
    // not touched, and the proposal stays live for it; so a consumables line he
    // never looked at follows his new hours instead of freezing at the figure
    // it showed a moment ago.
    const proposal = {};
    for (const it of assembleQuote(sel).items) {
        proposal[it.key] = it.kind === "munka" ? it.proposedHours : it.proposedUnit;
    }
    const labels = {};
    for (const key of Object.keys(c)) {
        if (!(key.startsWith("ora:") || key.startsWith("ar:") || key.startsWith("xar:"))) continue;
        const n = parseNum(c[key]);
        if (n == null) continue;
        if (Number.isNaN(n)) { errors[key] = "Számot írj ide."; continue; }
        if (key.startsWith("xar:")) { labels[key] = n; continue; }
        const tol = key.startsWith("ora:") ? 0.001 : 0.5;
        if (proposal[key] != null && Math.abs(proposal[key] - n) < tol) continue;
        if (key.startsWith("ora:")) ov.ora[key] = n;
        else ov.ar[key] = n;
    }
    // A custom line needs both halves. A label with no price, or a price with no
    // label, is dropped rather than guessed at.
    for (const key of Object.keys(c)) {
        if (!key.startsWith("xlabel:")) continue;
        const i = key.slice("xlabel:".length);
        const label = oneLine(c[key]).slice(0, 120);
        const amount = labels[`xar:${i}`];
        if (label && amount > 0) ov.extra.push({ label, amount });
    }

    const ugyfel = oneLine(c.ugyfel).slice(0, 120);
    values.ugyfel = ugyfel || SKIP;
    const plate = oneLine(c.plate).slice(0, 20);
    values.plate = plate ? plate.toUpperCase() : SKIP;
    values.tetelek = FLOW.serializeOverrides(FLOW.parseOverrides(ov));

    return Object.keys(errors).length ? { errors, values } : { values };
}

// ---------------------------------------------------------------------------
//  Detail form - every remaining job detail on ONE screen.
//
//  The flow deliberately asks more than the obvious questions, because that is
//  where the accuracy is: a chain is not a belt, an AGM battery is not a
//  battery, a 19-inch wheel is not a 15-inch one. Asked one bubble at a time
//  that would feel like an interrogation, so they are asked together, as a
//  short form with a button per answer. Questions that only become relevant
//  after an earlier answer (the electric handbrake, which depends on which axle)
//  stay out of here and come afterwards as a single question - see CONDITIONAL
//  in lib/flow.js.
// ---------------------------------------------------------------------------
const GROUP = "__group";

// The still-open fields of a group, in fieldOrder's order.
const pendingIn = (group, sel) => group.fields(sel).filter((f) => !has(sel, f));

// Which group, if any, the next question belongs to. A group only takes over
// when it has MORE THAN ONE question left: a form with a single row on it is
// just a clumsy button, so the last straggler goes back to being a chat bubble.
function groupFor(sel, next) {
    for (const g of FLOW.GROUPS) {
        const pending = pendingIn(g, sel);
        if (pending.length > 1 && pending.includes(next)) return g;
    }
    return null;
}

function groupIntro(group, sel) {
    const n = pendingIn(group, sel).length;
    return group.key === "car"
        ? "**Melyik autóról van szó?** Kezdd el írni a márkát, a többit felkínálom."
        : `Már csak **${n} kérdés** a munkáról, egy képernyőn - utána jönnek a tételek.`;
}

// Which car fields are type-ahead boxes, and what fills each one. The brand box
// holds every make; the model box fills from whatever brand was typed; the
// engine box from the model. That last link is the point: a customer who has no
// idea what to write in "Motor" gets this car's real engines offered the moment
// the model is in, instead of guessing at a format.
const COMBO = {
    make: { source: "makes" },
    model: { source: "models", dependsOn: "make" },
    engine: { source: "engines", dependsOn: "model" },
};

function groupForm(group, sel) {
    const fields = pendingIn(group, sel).map((key) => {
        const f = fieldDef(key);
        const base = {
            key,
            label: textOf(f.q, sel),
            help: textOf(f.hint, sel) || undefined,
            placeholder: f.placeholder || undefined,
            value: has(sel, key) ? String(sel[key]) : "",
        };
        if (COMBO[key]) return { ...base, type: "combo", ...COMBO[key] };
        // The VIN is a typed value with a one-tap sample, and it is the one row
        // here that may be left empty - a blank is recorded as "nincs" rather
        // than bouncing the whole form.
        if (f.type === "vin") {
            return { ...base, type: "text", placeholder: "17 karakter, vagy hagyd üresen",
                optional: true, sample: FLOW.SAMPLE_VIN, sampleLabel: "Minta alvázszám" };
        }
        if (f.type === "text") return { ...base, type: "textarea", placeholder: "Írd le a saját szavaiddal" };
        return { ...base, type: "select", options: optionsFor(key, sel).map((o) => o.label) };
    });
    const form = { action: "group", title: group.title, why: group.why, submit: group.submit, fields };
    // The catalogue rides along only on the screen that needs it, so the other
    // forms stay small.
    if (fields.some((x) => x.type === "combo")) form.catalog = FLOW.CATALOG;
    return form;
}

// Validate a submitted group form. Every value has to map onto one of that
// field's own options, so nothing the client invents can reach the price model.
// A blank optional row is recorded as its "skipped" value; a blank required one
// simply stays open and the form comes back shorter.
function validateGroupForm(group, sel, raw) {
    const c = raw && typeof raw === "object" ? raw : {};
    const values = {};
    const errors = {};
    for (const key of pendingIn(group, sel)) {
        const given = oneLine(c[key]).slice(0, 400);
        if (!given) {
            // A blank optional row is a decision, so it is recorded as one.
            // Without the marker pendingField would keep finding the field
            // missing and ask the same screen again, forever.
            if (fieldDef(key).optional) values[key] = SKIP;
            else if (fieldDef(key).type === "vin") values[key] = "nincs";
            else errors[key] = "Válassz egyet.";
            continue;
        }
        const v = mapAnswer(key, given, { ...sel, ...values });
        if (v) values[key] = v;
        else errors[key] = fieldDef(key).type === "vin"
            ? "Az alvázszám 17 karakter. Hagyd üresen, ha nincs kéznél."
            : "Ezt nem sikerült értelmezni.";
    }
    return Object.keys(errors).length ? { errors, values } : { values };
}

// ---------------------------------------------------------------------------
//  Feedback form - the whole point of the prototype. It is shown after the
//  quote, to everyone, and its most valuable field is the last one: what the
//  job would cost at their own workshop.
// ---------------------------------------------------------------------------
const FB_VERDICT = ["Használnám", "Nem használnám", "Kevés a kérdés", "Sok a kérdés"];
const FB_ROLE = ["Szerelő vagyok", "Szerviztulajdonos vagyok", "Autós vagyok"];

function feedbackForm(sel) {
    return {
        action: "feedback",
        title: "Használható ez így?",
        why: "Prototípus. Te vagy az, akinek készül - ha valami hiányzik belőle vagy hülyeség benne, az a leghasznosabb, amit mondhatsz.",
        submit: "Elküldöm",
        // The question changed with the audience. The old one asked a mechanic
        // to check a price meant for a customer; this asks whether the thing he
        // has just used would survive a real day in his own workshop.
        fields: [
            { key: "fb_text", label: "Mi hiányzik ahhoz, hogy ezt tényleg használnád?", placeholder: "Írd le nyugodtan", type: "textarea", value: "", optional: true },
            { key: "fb_price", label: "Mennyiért adtad volna ki te ezt a munkát?", placeholder: "pl. 85 000 Ft", type: "text", value: "", optional: true },
            { key: "fb_verdict", label: "Egy szóban", type: "select", options: FB_VERDICT, value: "", optional: true },
        ],
    };
}

// ---------------------------------------------------------------------------
//  The opt-in. This is the only place the prototype asks to be contacted back.
//
//  It exists because the first version asked for a name and phone BEFORE the
//  price, under a label that said "Hívni senki nem fog" - which made those
//  details unusable, correctly. An opt-in asked AFTER somebody has given their
//  own price, framed as an offer rather than a toll, is both honest and the
//  actual sales conversation: "megmutatom ugyanezt a TE óradíjaddal".
// ---------------------------------------------------------------------------
const LEAD = "__lead";
function leadForm(sel) {
    return {
        action: "lead",
        title: "Kérsz egy sajátot?",
        why: "Ez a prototípus alapértelmezésekkel dolgozik. A tiédbe a te normaidőid, a te beszállítód árai és a te ajánlatsablonod kerülnének. Ha érdekel, megcsinálom és megmutatom - nem küldök semmi mást.",
        submit: "Érdekel, mutasd meg",
        fields: [
            { key: "lead_name", label: "Neved", placeholder: "pl. Kovács Zoltán", type: "text", value: "", optional: true },
            { key: "lead_contact", label: "Hol érlek el?", placeholder: "e-mail cím (vagy telefon, ha úgy jobb)", type: "text", value: "", optional: true },
            { key: "lead_shop", label: "Szerviz neve, helye (nem kötelező)", placeholder: "pl. Kovács Autószerviz, Debrecen", type: "text", value: "", optional: true },
        ],
    };
}
const LEAD_KEYS = ["lead_name", "lead_contact", "lead_shop"];
function pickLead(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const k of LEAD_KEYS) if (has(raw, k)) out[k] = oneLine(raw[k]).slice(0, 200);
    return out;
}

function pickFeedback(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const k of FEEDBACK_KEYS) if (has(raw, k)) out[k] = oneLine(raw[k]).slice(0, 1000);
    return out;
}

// ---------------------------------------------------------------------------
//  Quote - the flow prices the job in net Ft; this puts it on the gross basis
//  the customer actually pays and rounds it for display.
// ---------------------------------------------------------------------------
// This is now a real quote, not an estimate, so the arithmetic follows invoice
// rules rather than display convenience. Line items stay EXACT and net - the
// mechanic typed 18 000 Ft for a part and 18 000 Ft is what appears - and the
// VAT is worked out once on the net total, the way it goes on the paperwork.
// The old build rounded every gross line to the nearest thousand, which is
// right for a "-tól" estimate and wrong for a number somebody will invoice.
function assembleQuote(sel) {
    const rate = vatRate(sel);
    const money = (n) => formatHuf(Math.round(n));
    const raw = FLOW.buildQuote(sel, { money, itemMoney: money });
    const items = raw.items
        .filter((i) => i.amount > 0)
        .map((i) => ({ ...i, amount: Math.round(i.amount) }));
    const net = items.reduce((s, i) => s + i.amount, 0);
    const vat = Math.round(net * rate);
    const labour = items.filter((i) => i.kind === "munka").reduce((s, i) => s + i.amount, 0);
    return {
        title: raw.title,
        workings: raw.workings || [],
        notes: raw.notes || [],
        billing: raw.billing || null,
        tier: raw.tier,
        items,
        labour,
        parts: net - labour,
        net,
        vat,
        vatRate: rate,
        total: net + vat,
        edited: items.filter((i) => i.edited).length,
    };
}

// The mechanic's own view of the finished quote. Net lines, because that is
// what he works in, with the VAT and the gross shown once at the bottom the way
// they appear on the paperwork. No "-tól", no exclusions list, no hedging: he
// has seen the car, this is the number.
function renderQuote(q, sel) {
    const who = has(sel, "ugyfel") && sel.ugyfel !== SKIP ? String(sel.ugyfel) : null;
    const plate = has(sel, "plate") && sel.plate !== SKIP ? String(sel.plate) : null;

    const head = [
        `**${q.title}**`,
        `${FLOW.carLine(sel)}${plate ? ` · ${plate}` : ""}${who ? ` · ${who}` : ""}`,
        ``,
        ...q.items.map((i) => `• ${i.label} - **${formatHuf(i.amount)}**${i.edited ? " ✎" : ""}`),
        ``,
        `Munkadíj: **${formatHuf(q.labour)}** · Alkatrész és anyag: **${formatHuf(q.parts)}**`,
        `Nettó összesen: **${formatHuf(q.net)}**`,
        ...(q.vatRate > 0
            ? [`ÁFA (27%): **${formatHuf(q.vat)}**`, ``, `**Bruttó végösszeg: ${formatHuf(q.total)}**`]
            : [``, `**Végösszeg: ${formatHuf(q.total)}**`, `(alanyi adómentes, ÁFA nincs felszámítva)`]),
    ];

    const next = [
        q.edited
            ? `${q.edited} sort írtál át - azok a ✎ jelölt tételek.`
            : `Minden sor a javaslat szerint ment. Ha valamelyik nem stimmel, a „${EDIT_CHIP}” gombbal átírhatod.`,
        ``,
        `Lent megtalálod az **ügyfélnek átadható változatot** - azt másolhatod e-mailbe vagy üzenetbe.`,
    ].filter((x) => x !== null).join("\n");

    return [head.join("\n"), next].join("\n[[SPLIT]]\n");
}

// The half the customer sees. Plain text on purpose: no markdown, no internal
// working, no net/gross split beyond the one line that matters - it is written
// to be pasted straight into an e-mail, a Messenger reply or a printed slip.
// A quoting tool that cannot produce the document the customer receives has
// only done half the job.
function customerText(q, sel) {
    const shop = FLOW.SHOP.name;
    const who = has(sel, "ugyfel") && sel.ugyfel !== SKIP ? String(sel.ugyfel) : null;
    const plate = has(sel, "plate") && sel.plate !== SKIP ? String(sel.plate) : null;
    const vin = FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : null;
    const d = new Date();
    const date = `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}.`;

    const lines = [];
    lines.push(`ÁRAJÁNLAT - ${shop}`);
    lines.push(date);
    lines.push("");
    if (who) lines.push(`Ügyfél: ${who}`);
    lines.push(`Gépjármű: ${FLOW.carLine(sel)}`);
    if (plate) lines.push(`Rendszám: ${plate}`);
    if (vin) lines.push(`Alvázszám: ${vin}`);
    lines.push(`Munka: ${q.title}`);
    lines.push("");
    lines.push("TÉTELEK");
    for (const i of q.items) lines.push(`- ${i.label}: ${formatHuf(i.amount)}`);
    lines.push("");
    if (q.vatRate > 0) {
        lines.push(`Nettó összesen: ${formatHuf(q.net)}`);
        lines.push(`ÁFA (27%): ${formatHuf(q.vat)}`);
        lines.push(`BRUTTÓ VÉGÖSSZEG: ${formatHuf(q.total)}`);
    } else {
        lines.push(`VÉGÖSSZEG: ${formatHuf(q.total)}`);
        lines.push("(alanyi adómentes, az ÁFA nem kerül felszámításra)");
    }
    lines.push("");
    lines.push("Az ajánlat a fenti tételekre vonatkozik. Ha a munka során olyan hiba kerül elő,");
    lines.push("ami ebben nem szerepel, a javítás megkezdése előtt egyeztetünk.");
    return lines.join("\n");
}

// Reminders, not explanations. A mechanic does not need to be told how brakes
// work; what is worth his time is the line that gets left off the invoice -
// coolant with a water pump, the waste oil charge, the test fee he paid up
// front. Every one of these is money he has already earned and might not bill.
function notesPanel(q) {
    const lines = [];
    if (q.billing) lines.push(`**Erre gondolj:** ${q.billing}`);
    for (const n of q.notes) lines.push(`**Ne maradjon le:** ${n}`);
    if (!lines.length) return null;
    return { title: "Amit ilyenkor ki szoktak felejteni", lines };
}

// What this prototype cannot do, and what a real build for his shop would.
// Named plainly, because the gap IS the thing being sold - and because a
// mechanic who has just used it will spot every one of these anyway.
function liveVersionPanel(sel, quote) {
    return {
        title: "Ez egy minta szerviz. A tiédet én építem meg:",
        lines: [
            "a **te óradíjaiddal és árlistáddal**, beépítve - neked nem kell semmit beállítani",
            "a **te munkáiddal**, azokkal a normaidőkkel, amikkel te dolgozol",
            "a **te fejléceddel** az ügyfélnek kimenő ajánlaton",
            "ha van beszállítói hozzáférésed, az **alkatrészár onnan**, cikkszámra",
        ],
        footer: "Te csak kiválasztod a munkát, és ha kell, átírsz egy sort.",
    };
}

// The arithmetic, in full. A mechanic wants to audit the number, and letting him
// is what stops this looking like a black box - it is also the fastest way to
// show that the price was not invented by a chatbot.
function workingsPanel(q) {
    if (!q.workings.length) return null;
    return {
        title: "Miből jött ki ez az ár?",
        note: "Minden sor nettó. Ahol átírtad a javaslatot, ott az szerepel, hogy a te számod ment bele.",
        lines: q.workings,
        footer: `Nettó összesen ${formatHuf(q.net)}${q.vatRate > 0 ? `, ÁFA-val ${formatHuf(q.total)}` : ""}.`,
    };
}

// ===========================================================================
//  AI - only for messages the backend cannot map
// ===========================================================================
function systemPrompt() {
    return `SZEMÉLYISÉG
Te egy autószerviz árajánlat-készítőjének a beszélgetős része vagy. A felhasználó NEM az ügyfél, hanem MAGA A SZERELŐ vagy a szerviztulajdonos, aki már látta az autót és most árat ad rá. TEGEZŐDVE beszélsz, kizárólag MAGYARUL. Tömör, szakmai, kolléga-hangnem - nem magyarázod neki a saját szakmáját.

AMIT TUDSZ
${FLOW.KNOWLEDGE}
- Telefon: ${PHONE}

SZABÁLYOK
- SOHA ne mondj, ne becsülj és ne számolj árat. Az árat a rendszer számolja ki; ha rákérdez, mondd, hogy a tételek képernyőn mindjárt látja, és ott át is írhatja.
- SOHA ne magyarázd el neki, hogyan kell autót szerelni. Ő tudja. Te az adminisztrációt viszed.
- SOHA ne találj ki alkatrészszámot, normaidőt vagy készletadatot.
- Ha megkérdezik, ki vagy, mondd meg egyszerűen: a szerviz árajánlat-készítője vagy.
- Ha elkalandozik, válaszolj röviden, és térj vissza a kérdéshez.
- Ne ígérj konkrét időpontot vagy kedvezményt.
- Legfeljebb 60 szó. A kulcsszavakat **félkövérrel** emeld ki; felsorolásnál a sor "• " jellel kezdődjön.
- Soha ne használj emojit és hosszú gondolatjelet; helyette sima kötőjelet írj.
- Ne mondd magadra, hogy chatbot, AI vagy rendszer - egyszerűen csak beszélgetsz.
- A válaszgombokat a rendszer jeleníti meg, neked nem kell kiírnod őket.`;
}

// The model answers in a fixed JSON shape: what to say, and - when the words
// were an answer - which option they meant. A hidden tag at the end of free text
// was tried first and proved unreliable: the model would confirm an answer in
// its reply and still leave the tag out, so the answer never got recorded.
function directive(field, sel, mode) {
    const known = summaryPairs(sel).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- még semmi";
    const head = `\n\n=== AMIT EDDIG TUDUNK ===\n${known}\n`;
    const format = `

=== A VÁLASZ FORMÁTUMA ===
Kizárólag egyetlen JSON objektumot írj, semmi mást: {"valasz": "<az ügyfélnek szóló üzenet>", "ertek": <lásd lent>}
A "valasz" szövegében használhatsz **félkövért** és "• " kezdetű felsorolást, de a választási lehetőségeket SOHA ne sorold fel - a gombokat a rendszer mutatja.`;
    if (mode === "form" || mode === "done") {
        const situation = mode === "form"
            ? "A képernyőn ott vannak a kiszámolt tételek, szerkeszthető formában: minden sor óraszáma és ára átírható, és új sor is felvehető. Válaszolj röviden az üzenetére, majd kérd meg, hogy nézze át és írja át, ami nála más."
            : "Az ajánlat elkészült, a szerelő látja. Válaszolj röviden a kérdésére. Új árat ne adj; ha a tételeken változtatna, mondd, hogy a „Tételek módosítása” gombbal átírhatja.";
        return head + `\n=== HELYZET ===\n${situation}` + format + `\nAz "ertek" mindig null.`;
    }
    const f = fieldDef(field);
    const options = optionsFor(field, sel);
    const multi = f.type === "multi";
    const free = !!f.free || f.type === "text";
    const example = multi
        ? `a választott értékek tömbje, pl. ["${options.slice(0, 2).map((o) => o.value).join('", "')}"]`
        : free
            ? `az ügyfél saját szavaival megadott érték szövegként, pl. "${options[0] ? options[0].value : "Alfa Romeo"}"`
            : `a választott érték, pl. "${options[0] ? options[0].value : ""}"`;
    return head + `
=== A JELENLEGI KÉRDÉS (a rendszer határozza meg) ===
"${textOf(f.q, sel)}"
${options.length ? `A lehetséges értékek (érték: felirat):\n${options.map((o) => `- ${o.value}: ${o.label}`).join("\n")}` : "Erre a kérdésre szabad szöveggel válaszol az ügyfél."}
${multi ? "Ennél a kérdésnél TÖBB érték is választható.\n" : ""}${free ? "Ennél a kérdésnél a listán kívüli, saját szavas válasz is elfogadható - add vissza szövegként.\n" : ""}` + format + `

MIT TEGYÉL
1. Ha az ügyfél üzenete EGYÉRTELMŰEN megválaszolja ezt a kérdést, akár a saját szavaival (pl. "kopog a fék elöl" = fék, "nem megy a hideg levegő" = klíma): "valasz" = egyetlen rövid visszaigazoló mondat, és a következő kérdést NE tedd fel, azt a rendszer teszi fel; "ertek" = ${example}.
2. Ha az ügyfél kérdezett valamit, vagy a válasza nem egyértelmű: "valasz" = rövid válasz, majd kérd meg, hogy válasszon a lenti gombok közül, és a kérdést ismételd meg **félkövérrel**; "ertek" = null.
3. Ha az üzenet kérdés ÉS egyértelmű válasz is: válaszolj a kérdésre, és add meg az "ertek"-et is.
4. Soha ne tegyél fel a fentitől eltérő adatgyűjtő kérdést, és soha ne mondj árat.

=== EGY MONDAT, TÖBB VÁLASZ (ettől lesz gyors) ===
Az ügyfél gyakran egyszerre több mindent is elárul: "Passat 2.0 TDI, 2012-es, vezérműszíj kellene". Ilyenkor a fenti kérdésre add meg az "ertek"-et, MINDEN további felismert adatot pedig tegyél be egy "tovabbi" objektumba, a mezők nevével:
{"valasz": "...", "ertek": ..., "tovabbi": {"make": "Volkswagen", "model": "Passat", "engine": "2.0 TDI dízel", "year": "2012"}}
Használható mezőnevek és értékeik:
${Object.keys(FLOW.FIELDS).map((k) => {
        const d = FLOW.FIELDS[k];
        if (d.type === "text" || d.type === "vin") return `- ${k}: szabad szöveg`;
        if (d.type === "year") return `- ${k}: négyjegyű évszám`;
        const o = (typeof d.options === "function" ? d.options(sel) : d.options) || [];
        return o.length ? `- ${k}: ${o.map((x) => x.value).join(" | ")}` : `- ${k}: szabad szöveg`;
    }).join("\n")}
CSAK olyat írj a "tovabbi"-ba, amit az ügyfél TÉNYLEG mondott. Semmit ne találj ki, és a "tovabbi" maradjon üres objektum, ha nincs ilyen. Amit nem ismersz fel, azt a rendszer külön megkérdezi.`;
}

async function callOpenAI(messages) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Missing OPENAI_API_KEY" };
    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                messages,
                temperature: 0.4,
                max_tokens: 400,
                response_format: { type: "json_object" },
            }),
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return { ok: true, text };
        return { ok: false, error: data.error?.message || JSON.stringify(data) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function callGemini(messages) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, error: "Missing GEMINI_API_KEY" };
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const systemMsg = messages.find((m) => m.role === "system");
    const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system_instruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
                    contents,
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 800,
                        responseMimeType: "application/json",
                        thinkingConfig: { thinkingBudget: 0 },
                    },
                }),
            }
        );
        const data = await res.json();
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p?.text || "").join("");
        if (text) return { ok: true, text };
        return { ok: false, error: data.error?.message || JSON.stringify(data) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function askModel(sel, history, text, field, mode) {
    const messages = [{ role: "system", content: systemPrompt() + directive(field, sel, mode) }];
    const past = (Array.isArray(history) ? history : []).slice(-16);
    for (const m of past) {
        if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
        messages.push({ role: m.role === "user" ? "user" : "assistant", content: stripControl(m.content) });
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || last.content.trim() !== text) messages.push({ role: "user", content: text });
    const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
    const result = provider === "openai" ? await callOpenAI(messages) : await callGemini(messages);
    if (!result.ok) console.error(`[${provider}] AI hiba:`, result.error);
    return result;
}

function interpretModel(text, field, sel) {
    const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let said = raw;
    let value = null;
    let extra = null;
    try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
            said = obj.valasz != null ? String(obj.valasz) : "";
            value = obj.ertek != null ? obj.ertek : null;
            extra = obj.tovabbi && typeof obj.tovabbi === "object" ? obj.tovabbi : null;
        }
    } catch (e) {
        const m = raw.match(/<!--\s*ANSWER:\s*([\s\S]*?)-->/);
        if (m) value = m[1];
    }
    return {
        said: cleanModelText(said),
        value: field && value != null ? acceptModelValue(field, value, sel) : null,
        extra: extra ? acceptExtraValues(extra, sel) : {},
    };
}

// The fastest way through the flow is one sentence that answers four questions:
// "Passat 2.0 TDI, 2012-es, vezérműszíj kellene". The model is asked to fill in
// whatever else it can see, and every one of those values is checked against its
// own field's options here before it is allowed anywhere near the price. A value
// for a question that has not been reached yet is still accepted - that is the
// entire point - but a value that is not a real option is dropped silently.
function acceptExtraValues(extra, sel) {
    const out = {};
    const order = projectOrder(sel);
    for (const key of Object.keys(extra)) {
        if (!order.includes(key) || has(sel, key)) continue;
        const v = acceptModelValue(key, extra[key], { ...sel, ...out });
        if (v) out[key] = v;
    }
    return out;
}

// What the model says the customer meant, checked against this field's own
// options. Free-text fields (make, model, engine, the symptom) accept a string
// the model built from the customer's words; everything else must be a real
// option, and anything that is not one is dropped.
function acceptModelValue(field, raw, sel) {
    const f = fieldDef(field);
    if (!f) return null;
    const opts = optionsFor(field, sel);
    const one = (x) => {
        const s = String(x == null ? "" : x).trim();
        if (!s) return null;
        const o = opts.find((o) => o.value === s || norm(o.label) === norm(s));
        return o && o.value !== "__egyeb" ? o.value : null;
    };
    if (f.type === "multi") {
        const parts = Array.isArray(raw) ? raw : String(raw).split(",");
        const vals = parts.map(one).filter(Boolean);
        return vals.length ? joinMulti(field, vals) : null;
    }
    const v = one(Array.isArray(raw) ? raw[0] : raw);
    if (v) return v;
    const s = oneLine(Array.isArray(raw) ? raw[0] : raw);
    if (field === "vin") return FLOW.vinLooksValid(s) ? cleanVin(s) : null;
    if (f.type === "year") return parseYear(s);
    if ((f.free || f.type === "text") && s.length >= 2 && s.length <= 400 && !/[<>{}]/.test(s)) return s;
    return null;
}

function cleanModelText(text) {
    return String(text || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/—/g, "-")
        .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
        .trim();
}

// ===========================================================================
//  Handler
// ===========================================================================
function send(response, sel, answer, key, extra = {}) {
    const out = { answer, state: sel, chips: [], ...progressOf(sel), ...extra };
    if (key === FORM) {
        out.form = tetelekForm(sel);
    } else if (key === FEEDBACK) {
        out.form = feedbackForm(sel);
    } else if (key && key.group) {
        out.form = groupForm(key.group, sel);
    } else if (key) {
        const f = fieldDef(key);
        const opts = optionsFor(key, sel);
        out.chips = opts.map((o) => o.label);
        if (f.type === "multi") {
            out.multi = true;
            out.exclusive = opts.filter((o) => (f.none || []).includes(o.value)).map((o) => o.label);
            out.next = "Tovább";
        }
    }
    return response.status(200).json(out);
}

// Every question is answered AND the mechanic has been through the tételek
// screen, so the numbers on the quote are ones he has actually seen.
const priceReady = (sel) => !pendingField(sel);

async function advance(sel, history, response, ctx, prefix = "") {
    if (priceReady(sel)) return await finishQuote(sel, history, response, ctx, prefix);
    const step = nextStep(sel);
    return send(response, sel, prefix + step.text, step.key);
}

function nextStep(sel) {
    const next = pendingField(sel);
    if (!next) return { text: FORM_INTRO, key: FORM };
    // The last "question" is not a question at all: it is the priced lines,
    // rendered as an editable form. It can only be built once everything that
    // decides WHICH lines exist has been answered, which is why it sits last.
    if (next === "tetelek") return { text: FORM_INTRO, key: FORM };
    // Several job details still open -> ONE screen for all of them instead of
    // one round trip each. This is what lets the flow ask MORE questions (a
    // chain or a belt, an electric handbrake, a start-stop battery) without
    // taking longer: three questions, one screen, one tap to submit.
    const group = groupFor(sel, next);
    if (group) return { text: groupIntro(group, sel), key: { group } };
    return { text: questionText(next, sel), key: next };
}

export default async function handler(request, response) {
    applyCors(request, response);
    if (request.method === "OPTIONS") return response.status(204).end();

    // The transcript beacon arrives as text/plain (so it survives the page
    // closing without a CORS preflight), i.e. as a raw string body.
    if (typeof request.body === "string") {
        try { request.body = JSON.parse(request.body); } catch (e) { request.body = {}; }
    }
    const ip = clientIp(request);

    if (request.method === "GET" && request.query && request.query.selftest != null) {
        return await runSelfTest(request, response, ip);
    }
    if (request.method !== "POST") return response.status(405).json({ answer: "Method Not Allowed" });

    try {
        const body = request.body || {};
        const { action, question, history } = body;

        if (action === "transcript") {
            const rl = rateLimit(`transcript:${ip}`, RL_TRANSCRIPT.limit, RL_TRANSCRIPT.windowMs);
            if (!rl.ok) return response.status(429).json({ ok: false, error: "rate_limited" });
            if (validateChatInput(null, history)) return response.status(400).json({ ok: false, error: "invalid_history" });
            if (customerTurns(history) < 1) return response.status(200).json({ ok: false, skipped: "no_answers" });
            const sent = await sendTranscriptEmail(sanitizeState(body.state), history, {
                sessionId: body.sessionId, pageUrl: body.pageUrl, reason: body.reason, update: !!body.update,
            });
            return response.status(200).json({ ok: !!sent.ok });
        }

        const rlChat = rateLimit(`chat:${ip}`, RL_CHAT.limit, RL_CHAT.windowMs);
        if (!rlChat.ok) {
            response.setHeader("Retry-After", String(rlChat.retryAfter));
            return response.status(429).json({ answer: "Túl sok üzenet rövid idő alatt. Várj egy kicsit." });
        }
        const bad = validateChatInput(question, history);
        if (bad) return response.status(400).json({ answer: bad });

        let sel = sanitizeState(body.state);
        const ctx = {
            ip,
            sessionId: String(body.sessionId || ip).slice(0, 64),
            owner: isOwner(body.ownerKey),
        };

        // --- Opening: the first question, no model call. ---
        if (action === "start") {
            // The browser says it has already had its quote, or this address
            // has used up its sessions for the day.
            if (limited(ctx) && (body.used || quotaBlocked(ctx, null))) return limitResponse(response, {});
            const step = nextStep(sel);
            return send(response, sel, step.text, step.key);
        }

        // --- Feedback submitted. This is the prototype's whole point, so it is
        // handled before anything else can get in its way. ---
        if (body.feedback) {
            const fb = pickFeedback(body.feedback);
            sel = { ...sel, ...fb };
            const delivery = sendFeedbackEmail(sel, history, { sessionId: body.sessionId }).catch(() => {});
            if (hasVercelWaitUntil()) waitUntil(delivery); else await delivery;
            console.log("VISSZAJELZÉS:", JSON.stringify(fb));
            // A one-tap verdict is the opening, not the end: having answered
            // once, people finish the sentence far more often than they start it.
            if (fb.fb_verdict && !fb.fb_price && !fb.fb_text) {
                return response.status(200).json({
                    answer: "Kösz. **Mennyiért csinálnád meg nálad?** Ez a leghasznosabb, amit mondhatsz - egy szám is elég.",
                    chips: moreChips(ctx), state: sel, ...progressOf(sel),
                    form: feedbackForm(sel),
                });
            }
            return response.status(200).json({
                answer: "Köszönöm, ez tényleg sokat segít.",
                chips: moreChips(ctx), state: sel, ...progressOf(sel),
                form: leadForm(sel),
                feedbackDone: true,
            });
        }

        // --- Somebody asked to see it with their OWN prices. ---
        if (body.lead) {
            const lead = pickLead(body.lead);
            sel = { ...sel, ...lead };
            // A typo'd address is worse than a blank one: it looks answered and
            // silently goes nowhere. Only the obvious Gmail misspellings are
            // caught, because anything stricter rejects real addresses.
            const bad = !lead.lead_contact
                ? "Ide írj egy telefonszámot vagy e-mail címet, különben nem tudok visszajelezni."
                : (lead.lead_contact.includes("@") && emailIssue(lead.lead_contact) === "gmail"
                    ? "Elírás lehet a címben - a Gmail végződése gmail.com." : null);
            if (bad) {
                return response.status(200).json({
                    answer: "", chips: moreChips(ctx), state: sel, ...progressOf(sel),
                    form: leadForm(sel),
                    formErrors: { lead_contact: bad },
                });
            }
            // One set of details per person per day. He can price as many cars
            // as he likes - that is what the restart button is for - but the
            // same tester's contact details should not arrive ten times.
            if (!rateLimit(`lead:${ip}`, RL_LEAD.limit, RL_LEAD.windowMs).ok) {
                return send(response, sel, "Ezt már elküldted, megvan - jelentkezem. Közben nyugodtan árazz be további autókat.",
                    null, { chips: moreChips(ctx) });
            }
            const delivery = sendLeadEmail(sel, history, { sessionId: body.sessionId }).catch(() => {});
            if (hasVercelWaitUntil()) waitUntil(delivery); else await delivery;
            console.log("ÉRDEKLŐDŐ:", JSON.stringify(lead));
            return send(response, sel,
                `Köszönöm! Jelentkezem a megadott elérhetőségen. Ha addig kérdésed van: **${PHONE}**`,
                null, { chips: moreChips(ctx) });
        }

        // A browser that has already had its quote may still leave feedback or
        // its contact details (both handled above) - but not walk the flow again
        // by typing into the box under the limit message.
        if (limited(ctx) && body.used && !sessionUsed(ctx)) return limitResponse(response, {});

        // --- A one-screen group form submitted (the car, or the job details). ---
        if (body.group) {
            const next = pendingField(sel);
            const group = next && groupFor(sel, next);
            if (!group) {
                const step = nextStep(sel);
                return send(response, sel, step.text, step.key);
            }
            const res = validateGroupForm(group, sel, body.group);
            sel = { ...sel, ...res.values };
            if (res.errors) {
                // Whatever WAS answered is kept, so a bounced form comes back
                // shorter rather than blank.
                return response.status(200).json({
                    answer: "", chips: [], state: sel, ...progressOf(sel),
                    form: groupForm(group, sel),
                    formErrors: res.errors,
                });
            }
            const vin = FLOW.vinLooksValid(sel.vin) ? `${FLOW.vinNote(sel.vin, sel)}\n\n` : "";
            return await advance(sel, history, response, ctx, vin);
        }

        // --- The tételek screen came back: his numbers over the proposal. ---
        if (body.tetelek) {
            const pending = pendingField(sel);
            // Anything still genuinely unanswered outranks the line editor -
            // the lines are built FROM those answers, so they cannot be right
            // while one is missing.
            if (pending && pending !== "tetelek") return send(response, sel, questionText(pending, sel), pending);
            const res = validateTetelek(body.tetelek, sel);
            sel = { ...sel, ...res.values };
            if (res.errors) {
                return response.status(200).json({
                    answer: "", chips: [], state: sel, ...progressOf(sel),
                    form: tetelekForm(sel),
                    formErrors: res.errors,
                });
            }
            return await finishQuote(sel, history, response, ctx, "");
        }

        const text = typeof question === "string" ? question.trim() : "";

        if (text && isRestart(text)) {
            if (sessionUsed(ctx)) return limitResponse(response, sel);
            const fresh = {};
            const step = nextStep(fresh);
            return send(response, fresh, "Rendben, jöhet a következő autó.\n\n" + step.text, step.key);
        }
        // "Tételek módosítása" - back into the line editor with everything he
        // typed last time still in the boxes.
        if (text && isEdit(text) && !pendingField(sel)) {
            return send(response, sel, "Tessék, itt vannak a tételek.", FORM);
        }

        const field = pendingField(sel);
        if (!text) {
            const step = field ? { text: questionText(field, sel), key: field } : { text: "", key: null };
            return send(response, sel, step.text, step.key);
        }

        // --- An answer the backend can map on its own (every chip click). ---
        if (field) {
            const v = mapAnswer(field, text, sel);
            if (v) {
                sel = { ...sel, [field]: v };
                return await advance(sel, history, response, ctx, ackText(field, sel) + "\n\n");
            }
        }

        // --- Everything else goes to the model. ---
        const mode = field && field !== "tetelek" ? "question" : (priceReady(sel) ? "done" : "form");
        const ai = await askModel(sel, history, text, field, mode);
        const reading = ai.ok ? interpretModel(ai.text, mode === "question" ? field : null, sel) : null;

        if (!reading || !reading.said) {
            if (mode === "question") {
                return send(response, sel,
                    `Ezt most nem sikerült értelmeznem. Válassz a lenti lehetőségek közül - ha kérdésed van, hívj nyugodtan: **${PHONE}**.\n\n${questionText(field, sel)}`,
                    field);
            }
            if (mode === "form") {
                return send(response, sel, `Nézd át a tételeket lent, és írd át, ami nálad más.`, FORM);
            }
            return send(response, sel, `Erre most nem tudok válaszolni - hívj nyugodtan: **${PHONE}**.`, null);
        }

        if (mode === "question") {
            const q = textOf(fieldDef(field).q, sel);
            if (reading.value) {
                // Everything else the one sentence gave away is recorded at the
                // same time, so "Passat 2.0 TDI, 2012-es" skips three questions
                // instead of answering one.
                sel = { ...sel, ...reading.extra, [field]: reading.value };
                // The next question follows from the backend, so a trailing
                // question the model tacked on would sit right above it and read
                // as a second question.
                const trimmed = reading.said.replace(/\s*[^.!?\n]*\?\s*$/, "").trim();
                const said = trimmed || reading.said;
                const vin = field === "vin" && FLOW.vinLooksValid(sel.vin) ? `\n${FLOW.vinNote(sel.vin, sel)}` : "";
                // Say out loud what was picked up in passing, so a wrong guess is
                // visible immediately rather than turning up in the quote.
                const picked = Object.keys(reading.extra)
                    .map((k) => `${textOf(fieldDef(k).short, sel)}: **${labelFor(k, sel[k], sel)}**`);
                const alsoGot = picked.length ? `\nEzt is kiolvastam belőle - ${picked.join(", ")}.` : "";
                return await advance(sel, history, response, ctx, said + vin + alsoGot + "\n\n");
            }
            const reasked = /\*\*[^*]*\?\*\*/.test(reading.said) || norm(reading.said).includes(norm(q));
            return send(response, sel, reasked ? reading.said : `${reading.said}\n\n${questionText(field, sel)}`, field);
        }
        return send(response, sel, reading.said, mode === "form" ? FORM : null);
    } catch (error) {
        console.error("Function Crash:", error && error.stack || error);
        return response.status(500).json({ answer: `Elnézést, hiba történt. Próbáld újra, vagy hívj: ${PHONE}` });
    }
}

// ---------------------------------------------------------------------------
//  Deliver the finished quote: the mechanic's itemised view, the copyable
//  customer version, the arithmetic panel and the feedback form.
// ---------------------------------------------------------------------------
async function finishQuote(sel, history, response, ctx, prefix = "") {
    // A second, different car in the same session - or a new session from an
    // address that has used its allowance - gets the limit message, not a quote.
    if (quotaBlocked(ctx, sel)) return limitResponse(response, sel);
    quotaRecord(ctx, sel);
    const quote = assembleQuote(sel);
    const answer = renderQuote(quote, sel);
    const customer = customerText(quote, sel);

    console.log("\n========================================");
    console.log(`KÉSZ AJÁNLAT - ${quote.title}`);
    console.log(`Autó: ${FLOW.carLine(sel)} | Alvázszám: ${FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "-"} | Rendszám: ${sel.plate && sel.plate !== SKIP ? sel.plate : "-"}`);
    console.log(`Szerviz: ${FLOW.SHOP.name} | óradíj ${formatHuf(FLOW.SHOP.rates.altalanos)}`);
    console.log(`Nettó ${formatHuf(quote.net)} | Bruttó ${formatHuf(quote.total)} | átírt sorok: ${quote.edited}`);
    console.log("========================================\n");

    const transcript = [
        ...(Array.isArray(history) ? history : []),
        { role: "assistant", content: answer },
    ];
    // Still off by default. A prototype in a Facebook group generated 25 quotes
    // in a day and filled the sending quota with telemetry; a real workshop
    // turns it on with EMAIL_QUOTES=on and gets a copy of everything it issues.
    if (EMAIL_QUOTES) {
        const delivery = sendQuoteEmail(sel, quote, transcript).catch(() => {});
        if (hasVercelWaitUntil()) waitUntil(delivery); else if (process.env.VERCEL) await delivery;
    }

    return response.status(200).json({
        answer: prefix + answer,
        chips: [EDIT_CHIP, ...moreChips(ctx)],
        state: sel,
        done: true,
        ...progressOf(sel),
        // The document he actually hands over, as copyable plain text. This is
        // the output of the whole exercise: everything above it is the tool
        // working out the number, this is the thing the customer receives.
        customer: {
            title: "Az ügyfélnek átadható ajánlat",
            note: "Ezt másolhatod e-mailbe, Messengerbe vagy nyomtatható levélbe. Nettó/bruttó bontással, a belső számolás nélkül.",
            text: customer,
            copy: "Másolás",
            copied: "Kimásolva",
        },
        scope: notesPanel(quote),
        demo: {
            divider: "Eddig tart maga az ajánlat.",
            intro: "Innentől a prototípusról van szó, nem az ügyfélről.",
            workings: workingsPanel(quote),
            live: liveVersionPanel(sel, quote),
        },
        form: feedbackForm(sel),
        lead: { title: quote.title, total: quote.total, net: quote.net, edited: quote.edited },
    });
}

// ---------------------------------------------------------------------------
//  E-mail (Resend). Everything goes to LEAD_EMAIL_TO; there is no customer mail
//  in the prototype, because nobody here is a real customer.
// ---------------------------------------------------------------------------
function hasVercelWaitUntil() {
    try { return typeof waitUntil === "function" && !!process.env.VERCEL; } catch (e) { return false; }
}

async function resendSend({ subject, html, text, replyTo }) {
    const key = process.env.RESEND_API_KEY;
    const to = leadTo();
    if (!to) {
        console.warn("LEAD_EMAIL_TO nincs beallitva - az e-mail kimarad. Tartalom:\n" + text);
        return { ok: false, error: "no_recipient" };
    }
    if (!key) {
        console.warn("RESEND_API_KEY hianyzik - az e-mail kimarad. Tartalom:\n" + text);
        return { ok: false, error: "no_key" };
    }
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                from: leadFrom(), to: [to], subject, html, text,
                ...(replyTo ? { reply_to: replyTo } : {}),
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error("Resend hiba:", res.status, JSON.stringify(data));
            return { ok: false, error: data.message || `HTTP ${res.status}` };
        }
        return { ok: true, id: data.id };
    } catch (e) {
        console.error("Resend kivetel:", e.message);
        return { ok: false, error: e.message };
    }
}

function detailRows(sel) {
    return summaryPairs(sel).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("");
}

// The shop's own copy of a quote it has just issued. Not a lead any more - the
// workshop IS the user here - so it is filed, not sold: the itemised lines, the
// text the customer got, and the arithmetic behind both.
async function sendQuoteEmail(sel, quote, transcript) {
    const val = (k) => (has(sel, k) && sel[k] !== SKIP ? oneLine(sel[k]) : "-");
    const plate = has(sel, "plate") && sel.plate !== SKIP
        ? `${oneLine(sel.plate)}${plateIsHungarian(sel.plate) ? "" : " (nem magyar rendszám)"}` : "-";
    const lines = quote.items.map((i) => `<tr><td style="padding:4px 12px 4px 0">${esc(i.label)}${i.edited ? ' <span style="color:#999">(átírva)</span>' : ""}</td><td style="padding:4px 0;text-align:right"><b>${esc(formatHuf(i.amount))}</b></td></tr>`).join("");
    const totals = quote.vatRate > 0
        ? `<tr><td style="padding:8px 12px 2px 0;border-top:1px solid #ddd">Nettó</td><td style="padding:8px 0 2px;border-top:1px solid #ddd;text-align:right">${esc(formatHuf(quote.net))}</td></tr>
           <tr><td style="padding:2px 12px 2px 0">ÁFA (27%)</td><td style="padding:2px 0;text-align:right">${esc(formatHuf(quote.vat))}</td></tr>
           <tr><td style="padding:2px 12px 4px 0"><b>Bruttó végösszeg</b></td><td style="padding:2px 0 4px;text-align:right"><b>${esc(formatHuf(quote.total))}</b></td></tr>`
        : `<tr><td style="padding:8px 12px 4px 0;border-top:1px solid #ddd"><b>Végösszeg</b> (alanyi adómentes)</td><td style="padding:8px 0 4px;border-top:1px solid #ddd;text-align:right"><b>${esc(formatHuf(quote.total))}</b></td></tr>`;
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="margin:0 0 4px">Kiadott ajánlat - ${esc(quote.title)}</h2>
  <p style="margin:0 0 16px;color:#666">${esc(FLOW.SHOP.name)} · óradíj ${esc(formatHuf(FLOW.SHOP.rates.altalanos))}/óra</p>
  <h3 style="margin:16px 0 4px">Az autó</h3>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#666">Autó</td><td style="padding:4px 0"><b>${esc(FLOW.carLine(sel))}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Alvázszám</td><td style="padding:4px 0"><b>${esc(FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "-")}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Rendszám</td><td style="padding:4px 0"><b>${esc(plate)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Ügyfél</td><td style="padding:4px 0"><b>${esc(val("ugyfel"))}</b></td></tr>
  </table>
  <h3 style="margin:16px 0 4px">Tételek (nettó)</h3>
  <table style="border-collapse:collapse;font-size:14px;width:100%">${lines}${totals}</table>
  <h3 style="margin:16px 0 4px">Amit az ügyfél kapott</h3>
  <pre style="font-size:13px;background:#f6f6f6;padding:12px;white-space:pre-wrap">${esc(customerText(quote, sel))}</pre>
  <h3 style="margin:16px 0 4px">Minden válasz</h3>
  <table style="border-collapse:collapse;font-size:14px">${detailRows(sel)}</table>
  <h3 style="margin:16px 0 4px">Miből jött ki (nettó)</h3>
  <ul style="font-size:13px;color:#444">${quote.workings.map((w) => `<li>${esc(plain(w))}</li>`).join("")}</ul>
  <h3 style="margin:16px 0 4px">A teljes beszélgetés</h3>
  ${transcriptHtml(transcript)}
</div>`;
    const text = [
        `KIADOTT AJÁNLAT - ${quote.title}`,
        `Szerviz: ${FLOW.SHOP.name} | óradíj ${formatHuf(FLOW.SHOP.rates.altalanos)}/óra`,
        `Autó: ${FLOW.carLine(sel)}`,
        `Alvázszám: ${FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "-"} | Rendszám: ${plate} | Ügyfél: ${val("ugyfel")}`,
        ``,
        ...quote.items.map((i) => `${i.label}: ${formatHuf(i.amount)}${i.edited ? " (átírva)" : ""}`),
        `Nettó: ${formatHuf(quote.net)}${quote.vatRate > 0 ? ` | ÁFA: ${formatHuf(quote.vat)} | Bruttó: ${formatHuf(quote.total)}` : " (alanyi adómentes)"}`,
        ``,
        "Amit az ügyfél kapott:",
        customerText(quote, sel),
        ``,
        "Miből jött ki (nettó):",
        ...quote.workings.map((w) => `- ${plain(w)}`),
        ``,
        transcriptText(transcript),
    ].join("\n");
    return await resendSend({
        subject: `[AJÁNLAT] ${quote.title} - ${formatHuf(quote.total)}`,
        html, text,
    });
}

async function sendFeedbackEmail(sel, history, meta = {}) {
    const rows = [
        ["Egy szóban", sel.fb_verdict],
        ["Nála mennyi lenne", sel.fb_price],
        ["Szöveges", sel.fb_text],
        ["Ki ő", sel.fb_role],
    ].filter(([, v]) => has({ v }, "v"));
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="margin:0 0 12px">Szerelői visszajelzés</h2>
  <table style="border-collapse:collapse;font-size:14px">
    ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}
  </table>
  <h3 style="margin:16px 0 4px">Amit kiszámolt neki</h3>
  <table style="border-collapse:collapse;font-size:14px">${detailRows(sel)}</table>
  <h3 style="margin:16px 0 4px">A teljes beszélgetés</h3>
  ${transcriptHtml(history)}
</div>`;
    const text = [
        "SZERELŐI VISSZAJELZÉS",
        ...rows.map(([k, v]) => `${k}: ${v}`),
        ``,
        transcriptText(history),
    ].join("\n");
    return await resendSend({ subject: `[VISSZAJELZÉS] ${sel.fb_verdict || "szerelő"}${sel.fb_price ? ` - nála ${sel.fb_price}` : ""}`, html, text });
}

async function sendLeadEmail(sel, history, meta = {}) {
    const rows = [
        ["Név", sel.lead_name],
        ["Elérhetőség", sel.lead_contact],
        ["Szerviz", sel.lead_shop],
        ["Nála mennyi lenne", sel.fb_price],
        ["Mit írt", sel.fb_text],
        ["Egy szóban", sel.fb_verdict],
    ].filter(([, v]) => String(v || "").trim());
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="margin:0 0 6px">Érdeklődő - kéri a saját áraival</h2>
  <p style="margin:0 0 14px;color:#666">Ő kérte, hogy keresd meg. Nem hideg megkeresés.</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}
  </table>
  <h3 style="margin:16px 0 4px">Amit kiszámolt neki</h3>
  <table style="border-collapse:collapse;font-size:14px">${detailRows(sel)}</table>
  <h3 style="margin:16px 0 4px">A teljes beszélgetés</h3>
  ${transcriptHtml(history)}
</div>`;
    const text = ["ÉRDEKLŐDŐ - kéri a saját áraival", ...rows.map(([k, v]) => `${k}: ${v}`), "", transcriptText(history)].join("\n");
    return await resendSend({ subject: `[ÉRDEKLŐDŐ] ${sel.lead_name || sel.lead_shop || "szerelő"} - ${sel.lead_contact}`, html, text });
}

async function sendTranscriptEmail(sel, history, meta = {}) {
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="margin:0 0 4px">Félbehagyott beszélgetés</h2>
  <p style="margin:0 0 12px;color:#666">${esc(meta.reason || "")}${meta.pageUrl ? ` - ${esc(meta.pageUrl)}` : ""}</p>
  <table style="border-collapse:collapse;font-size:14px">${detailRows(sel)}</table>
  <h3 style="margin:16px 0 4px">A beszélgetés</h3>
  ${transcriptHtml(history)}
</div>`;
    const text = ["FÉLBEHAGYOTT BESZÉLGETÉS", meta.reason || "", "", transcriptText(history)].join("\n");
    return await resendSend({ subject: `[BESZÉLGETÉS] ${FLOW.title(sel)}${meta.update ? " (frissítés)" : ""}`, html, text });
}

// ---------------------------------------------------------------------------
//  Self-test: open /api/faq-agent?selftest=1 to check the whole e-mail path.
//  It can never send to an address from the URL - only to LEAD_EMAIL_TO.
// ---------------------------------------------------------------------------
async function runSelfTest(request, response, ip) {
    const rl = rateLimit(`selftest:${ip}`, RL_SELFTEST.limit, RL_SELFTEST.windowMs);
    if (!rl.ok) return response.status(429).json({ ok: false, error: "rate_limited" });
    const key = process.env.OWNER_TEST_KEY;
    if (key && String(request.query.selftest) !== key) {
        return response.status(403).json({ ok: false, error: "forbidden" });
    }
    const sel = {
        jobs: "vezermuszij", make: "Volkswagen", model: "Passat", engine: "2.0 TDI dízel",
        year: "2012", vin: FLOW.SAMPLE_VIN, km: "k300", vez_vizpumpa: "igen", parts_tier: "markas",
        name: "Teszt Elek", phone: "+36 30 123 4567", email: leadTo(), plate: "PR-OT-123",
        when_pref: "Hétköznap délután",
    };
    const quote = assembleQuote(sel);
    const sent = await sendQuoteEmail(sel, quote, [
        { role: "user", content: "Vezérműszíjat kellene cserélni." },
        { role: "assistant", content: "Rendben, megnézem." },
    ]);
    return response.status(200).json({
        ok: !!sent.ok,
        error: sent.error || null,
        env: {
            AI_PROVIDER: process.env.AI_PROVIDER || "gemini",
            GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
            OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
            RESEND_API_KEY: !!process.env.RESEND_API_KEY,
            LEAD_EMAIL_TO: leadTo(),
            LEAD_EMAIL_FROM: leadFrom(),
        },
        sample: { title: quote.title, total: formatHuf(quote.total), workings: quote.workings },
    });
}

export { assembleQuote, renderQuote, customerText, tetelekForm, validateTetelek, workingsPanel, mapAnswer, sanitizeState, pendingField, projectOrder, formatHuf, SKIP };
