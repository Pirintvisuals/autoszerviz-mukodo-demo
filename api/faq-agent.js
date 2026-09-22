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
//  PROTOTYPE BEHAVIOUR (this build is for mechanics to test and try to break):
//   - a banner above the chat says the prices are sample data;
//   - every quote carries a "Miből jött ki?" panel with the normaidő, the
//     óradíj and the part price used, so a mechanic can audit the arithmetic;
//   - the owner's notification is shown on screen, because seeing what the shop
//     receives is the half of the product that a price alone never explains;
//   - a feedback step asks mechanics where it is wrong and what the job would
//     cost at their place, and mails the answer with the transcript.
// ============================================================================
import { waitUntil } from "@vercel/functions";
import * as FLOW from "../lib/flow.js";

const PHONE = process.env.LEAD_PHONE || FLOW.BOT.phone;
const leadTo = () => process.env.LEAD_EMAIL_TO || FLOW.BOT.email;
const leadFrom = () => process.env.LEAD_EMAIL_FROM || "Autószerviz minta <onboarding@resend.dev>";

// Flow prices are NET. A car owner is a private customer who pays the gross
// figure at the counter, so that is the number shown - saying "nettó" to
// somebody who will hand over a card is just a smaller lie than a wrong price.
const VAT_RATE = 0.27;

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

function phoneIssue(phone) {
    const d = String(phone || "").replace(/[^\d]/g, "");
    return d.length >= 9 && d.length <= 13 ? null : "format";
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
        const y = parseYear(raw);
        if (y) return y;
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

const CONTACT_KEYS = ["name", "phone", "email", "plate", "when_pref", "when_note"];
const FEEDBACK_KEYS = ["fb_verdict", "fb_price", "fb_text", "fb_role"];

function sanitizeState(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const field of Object.keys(FLOW.FIELDS)) {
        if (!has(raw, field)) continue;
        const f = FLOW.FIELDS[field];
        const v = String(raw[field]).slice(0, 400);
        const allowed = new Set(allValues(field));
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
        } else if (f.type === "year" && parseYear(v)) {
            out[field] = parseYear(v);
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
const FORM = "__contact";
const FEEDBACK = "__feedback";
const WHEN_PREF = ["Hétköznap délelőtt", "Hétköznap délután", "Szombaton", "Mindegy, hívjatok"];
const REQUIRED_CONTACT = ["name", "phone", "email"];
const contactReady = (s) => REQUIRED_CONTACT.every((k) => has(s, k));
const FORM_INTRO = "Köszönöm, megvan minden a számításhoz! Már csak az elérhetőséged kell, és mutatom az **árat**.";

// A plausible but deliberately fake plate for the prototype's fill button. PR-OT
// is not a live Hungarian series, so it reads as a sample to anyone who knows
// plates, while still being the right shape.
function samplePlate() {
    return `PR-OT-${String(100 + Math.floor(Math.random() * 900))}`;
}

function contactForm(sel) {
    const val = (k) => (has(sel, k) ? String(sel[k]) : "");
    return {
        title: "Kinek szól az árajánlat?",
        why: "Ez minta: az adataidat csak azért kérjük, hogy lásd, mit kapna meg a szerviz. Hívni senki nem fog.",
        submit: "Kérem az árat",
        fields: [
            { key: "name", label: "Név", placeholder: "A neved", type: "text", autocomplete: "name", value: val("name") },
            { key: "phone", label: "Telefonszám", placeholder: "+36 30 123 4567", type: "tel", autocomplete: "tel", value: val("phone") },
            { key: "email", label: "E-mail", placeholder: "pelda@gmail.com", type: "email", autocomplete: "email", value: val("email") },
            { key: "plate", label: "Rendszám", placeholder: "AA-BB-123", type: "text", value: val("plate"), optional: true,
              sample: samplePlate(), sampleLabel: "Minta rendszám" },
            { key: "when_pref", label: "Mikor jó behozni?", type: "select", options: WHEN_PREF, value: val("when_pref"), optional: true },
            { key: "when_note", label: "Mikortól? (nem kötelező)", placeholder: "pl. jövő hét kedd után", type: "text", value: val("when_note"), optional: true },
        ],
    };
}

function validateContactForm(contact) {
    const c = contact && typeof contact === "object" ? contact : {};
    const get = (k) => oneLine(c[k]).slice(0, 200);
    const errors = {};
    const values = {};
    const REQ = "Ezt kérlek töltsd ki.";

    const name = get("name");
    if (!name) errors.name = REQ;
    else if (name.length < 2) errors.name = "Kérlek, a teljes nevedet add meg.";
    else values.name = name;

    const phone = get("phone");
    if (!phone) errors.phone = REQ;
    else if (phoneIssue(phone)) errors.phone = "Ezt a számot nem sikerült értelmezni (pl. +36 30 123 4567).";
    else values.phone = phone;

    const email = get("email");
    if (!email) errors.email = REQ;
    else {
        const i = emailIssue(email);
        if (i === "gmail") errors.email = "Elírás lehet a címben - a Gmail végződése gmail.com.";
        else if (i) errors.email = "Ezt az e-mail címet nem sikerült értelmezni.";
        else values.email = email;
    }

    const plate = get("plate");
    if (plate) values.plate = plate.toUpperCase();

    const wp = WHEN_PREF.find((t) => norm(t) === norm(get("when_pref")));
    if (wp) values.when_pref = wp;
    const wn = get("when_note");
    if (wn) values.when_note = wn;

    return Object.keys(errors).length ? { errors } : { values };
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
        ? "Jó. **Milyen autóról van szó?** Kezdd el írni a márkát, a többit felkínálom."
        : `Már csak **${n} rövid kérdés** a munkáról, egy képernyőn - utána jön az ár.`;
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
            if (fieldDef(key).type === "vin") values[key] = "nincs";
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
const FB_VERDICT = ["Jó", "Rossz az ár", "Kevés a kérdés", "Sok a kérdés"];
const FB_ROLE = ["Szerelő vagyok", "Szerviztulajdonos vagyok", "Autós vagyok"];

function feedbackForm(sel) {
    return {
        action: "feedback",
        title: "Szerelő vagy? Hol téved?",
        why: "Ez egy prototípus, minta árakkal. Ha látsz benne hülyeséget, az a leghasznosabb, amit mondhatsz.",
        submit: "Elküldöm",
        fields: [
            { key: "fb_verdict", label: "Egy szóban", type: "select", options: FB_VERDICT, value: "", optional: true },
            { key: "fb_price", label: "Mennyiért csinálnád meg nálad ezt a munkát?", placeholder: "pl. 85 000 Ft", type: "text", value: "", optional: true },
            { key: "fb_text", label: "Hol téved, mit kérdeztél volna még?", placeholder: "Írd le nyugodtan", type: "textarea", value: "", optional: true },
            { key: "fb_role", label: "Te ki vagy?", type: "select", options: FB_ROLE, value: "", optional: true },
        ],
    };
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
function assembleQuote(sel) {
    const k = 1 + VAT_RATE;
    // Amounts the flow quotes inside sentences (the unit rates in the
    // exclusions) go through the same VAT basis and rounding as the line items,
    // so a water pump is not 20 000 Ft in the list and 20 320 Ft two lines below.
    const money = (n) => {
        const v = n * k;
        return formatHuf(roundTo(v, v >= 10000 ? 1000 : 100));
    };
    // Line items round to the nearest 1000, so the audit panel must use the
    // same rounding or it prints a different number from the line above it.
    const itemMoney = (n) => formatHuf(roundTo(n * k, 1000));
    const raw = FLOW.buildQuote(sel, { money, itemMoney });
    const items = raw.items
        .filter((i) => i.amount > 0)
        .map((i) => ({ label: i.label, amount: roundTo(i.amount * k, 1000) }));
    const total = items.reduce((s, i) => s + i.amount, 0);
    return {
        title: raw.title,
        includes: raw.includes,
        exclusions: raw.exclusions || [],
        flags: raw.flags || [],
        workings: raw.workings || [],
        expertise: raw.expertise || null,
        diagnosticOnly: !!raw.diagnosticOnly,
        items, total,
    };
}

// Customer-facing result, as bubbles split by [[SPLIT]].
function renderCustomerQuote(q, sel) {
    const name = oneLine(sel.name).split(/\s+/).slice(-1)[0] || "";
    const car = FLOW.carLine(sel);

    const head = q.diagnosticOnly
        ? [
            `Köszönöm${name ? ", " + name : ""}! Erre **szándékosan nem adok javítási árat**.`,
            ``,
            `Amit leírtál, az tünet, nem konkrét munka. Ezt meg kell nézni, anélkül csak tippelnénk - és egy rossz tipp mindkettőnknek rossz.`,
            ``,
            `**${car}**`,
            ...q.items.map((i) => `• ${i.label} - **${formatHuf(i.amount)}**`),
            ``,
            `**Diagnosztika: ${formatHuf(q.total)}**`,
            `(bruttó ár, az ÁFA benne van)`,
        ]
        : [
            `Köszönöm${name ? ", " + name : ""}! Itt van a becslés.`,
            ``,
            `**${q.title}**`,
            `${car}`,
            ``,
            ...q.items.map((i) => `• ${i.label} - **${formatHuf(i.amount)}**`),
            ``,
            `**${formatHuf(q.total)}-tól**`,
            `(bruttó ár, az ÁFA benne van)`,
            ``,
            `Tájékoztató ár. A szerviz erősíti meg, miután látta az autót.`,
        ];

    const scope = [`**Mit tartalmaz?**`, `Az ár ${q.includes}.`];
    if (q.exclusions.length) {
        scope.push(``, `**Ami ezen felül jöhet:**`, ...q.exclusions.map((e) => `• ${e}`));
    }
    if (q.flags.length) scope.push(``, ...q.flags.map((f) => `**Fontos:** ${f}`));
    if (q.expertise) scope.push(``, `**Egy tipp:** ${q.expertise}`);

    const when = has(sel, "when_pref") && !/^mindegy/i.test(sel.when_pref) ? ` - lehetőleg **${String(sel.when_pref).toLowerCase()}**` : "";
    const next = [
        `**Hogyan tovább?**`,
        q.diagnosticOnly
            ? `• Behozod az autót egy **diagnosztikára**${when}.`
            : `• Egyeztetünk egy **időpontot**${when}.`,
        `• A szerviz **megerősíti az árat**, mielőtt bármihez hozzányúl.`,
        has(sel, "when_note") ? `• Amit írtál az időzítésről: **${oneLine(sel.when_note)}**` : null,
        ``,
        `Sürgős? Hívj: **${PHONE}**`,
    ].filter((x) => x !== null).join("\n");

    return [head.join("\n"), scope.join("\n"), next].join("\n[[SPLIT]]\n");
}

// What the workshop would receive. Shown on screen because "the customer also
// gets captured for you" is the half of the product a price alone never
// explains - and a mechanic only believes it when he sees the card.
function renderOwnerCard(q, sel) {
    const rows = [];
    rows.push(`**Ezt kapná meg a szerviz**`);
    rows.push(`(ezt az ügyfél élesben nem látja - most azért mutatom, hogy lásd, mi érkezik be)`);
    rows.push(``);
    rows.push(`• Autó: **${FLOW.carLine(sel)}**`);
    rows.push(`• Alvázszám: **${FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "nem adta meg"}**`);
    if (has(sel, "km")) rows.push(`• Kilométeróra: **${labelFor("km", sel.km, sel)}**`);
    if (has(sel, "plate")) {
        rows.push(`• Rendszám: **${oneLine(sel.plate)}**${plateIsHungarian(sel.plate) ? "" : " (nem magyar rendszám)"}`);
    }
    rows.push(`• Munka: **${q.title}**`);
    if (has(sel, "tunet_leiras")) rows.push(`• Amit az ügyfél leírt: **${oneLine(sel.tunet_leiras)}**`);
    if (has(sel, "parts_tier")) rows.push(`• Alkatrész: **${labelFor("parts_tier", sel.parts_tier, sel)}**`);
    rows.push(`• Becsült összeg: **${formatHuf(q.total)}${q.diagnosticOnly ? "" : "-tól"}** (bruttó)`);
    if (has(sel, "when_pref") || has(sel, "when_note")) {
        rows.push(`• Mikor jó neki: **${[sel.when_pref, sel.when_note].filter(Boolean).map(oneLine).join(", ")}**`);
    }
    rows.push(`• Ügyfél: **${oneLine(sel.name)}** · ${oneLine(sel.phone)} · ${oneLine(sel.email)}`);
    rows.push(``);
    rows.push(`A teljes beszélgetés is megy vele, hogy a szerviz lássa, mit kérdezett az ügyfél.`);
    return rows.join("\n");
}

// What this prototype CANNOT do, and what the live version would - named
// explicitly, right under the quote.
//
// This is the most commercially useful block in the whole thing. A mechanic
// reading a sample price either dismisses it ("ez nem az én áram") or asks the
// only question that matters ("és az enyémmel hogyan menne?"). Saying the limits
// out loud, with the specific reason for each, turns the first reaction into the
// second - and it is honest, which is the point: the gap between this and a real
// quote is exactly the thing being sold.
function liveVersionPanel(sel, quote) {
    // Three lines, one clause each. The long version of this was correct and
    // nobody would have read it: it sat at the bottom of a finished quote, after
    // a mechanic already had the number he came for.
    return {
        title: "Ez minta ár. Nálad a te számaid mennének bele:",
        lines: [
            "a **te óradíjad** a budapesti átlag helyett",
            "a **te beszerzési árad** a webshopár helyett",
            "az **alvázszámból a pontos alkatrész**, a beszállítód rendszeréből",
        ],
        footer: "A kérdések és a kimenet pontosan ezek maradnak.",
    };
}

// The arithmetic, in full. A mechanic wants to audit the number, and letting him
// is what stops this looking like a black box - it is also the fastest way to
// show that the price was not invented by a chatbot.
function workingsPanel(q) {
    if (!q.workings.length) return null;
    return {
        title: "Miből jött ki ez az ár?",
        note: "Minta adatok. Élesben a szerviz saját óradíja és alkatrészárai alapján számol. Az ügyfél ezt a panelt nem látja.",
        lines: q.workings,
        footer: `Minden összeg bruttó, az ÁFA-val együtt - ugyanaz a szám, ami fent is szerepel.`,
    };
}

// ===========================================================================
//  AI - only for messages the backend cannot map
// ===========================================================================
function systemPrompt() {
    return `SZEMÉLYISÉG
Te egy autószerviz automata árajánlatkészítője vagy. Az ügyféllel TEGEZŐDVE beszélsz, kizárólag MAGYARUL. Nyugodt, hozzáértő, tömör - úgy beszélsz, mint egy tapasztalt szervizes pultos, aki ért az autókhoz és nem siet.

AMIT TUDSZ
${FLOW.KNOWLEDGE}
- Telefon: ${PHONE}

SZABÁLYOK
- SOHA ne mondj, ne becsülj és ne számolj árat. Az árat a rendszer számolja ki a kérdések végén; ha árat kérdeznek, mondd, hogy néhány kérdés után azonnal látja.
- SOHA ne adj árat olyan tünetre, amit nem vizsgált meg senki. Ilyenkor diagnosztika a válasz.
- SOHA ne találj ki alkatrészszámot, és ne állítsd, hogy valami raktáron van.
- SOHA ne adj árat olyan munkára, ami nincs a vállalt munkák között.
- Ha megkérdezik, ki vagy, mondd meg egyszerűen: a szerviz automata árajánlatkészítője vagy.
- Ha az ügyfél elkalandozik, válaszolj röviden, és térj vissza a kérdéshez.
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
            ? "Az ügyfél minden kérdésre válaszolt; a képernyőn egy rövid űrlap vár a nevére, telefonszámára és e-mail címére. Válaszolj röviden az üzenetére, majd kérd meg, hogy töltse ki az űrlapot - utána azonnal látja az árat."
            : "Az árajánlat már elkészült, az ügyfél látta. Válaszolj röviden a kérdésére. Új árat ne adj; ha a munkán változtatna, mondd, hogy ezt a szerviz a helyszínen pontosítja.";
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
        out.form = contactForm(sel);
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

function nextStep(sel) {
    const stop = FLOW.blocked(sel);
    if (stop) return { text: stop, key: "jobs", reset: ["jobs"] };
    const next = pendingField(sel);
    if (!next) return { text: FORM_INTRO, key: FORM };
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

        // --- Opening: the first question, no model call. ---
        if (action === "start") {
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
            return send(response, sel,
                "Köszönöm, ez tényleg sokat segít. Ha van még, amit hozzátennél, írd le ide nyugodtan.",
                null, { feedbackDone: true });
        }

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
            const step = nextStep(sel);
            const vin = FLOW.vinLooksValid(sel.vin) ? `${FLOW.vinNote(sel.vin, sel)}\n\n` : "";
            return send(response, sel, vin + step.text, step.key);
        }

        // --- Contact form submitted. ---
        if (body.contact) {
            const pending = pendingField(sel);
            if (pending) return send(response, sel, questionText(pending, sel), pending);
            const res = validateContactForm(body.contact);
            if (res.errors) {
                return response.status(200).json({
                    answer: "", chips: [], state: sel, ...progressOf(sel),
                    form: contactForm({ ...sel, ...pickContact(body.contact) }),
                    formErrors: res.errors,
                });
            }
            sel = { ...sel, ...res.values };
            return await finishQuote(sel, history, response, body.sessionId);
        }

        const field = pendingField(sel);
        const text = typeof question === "string" ? question.trim() : "";
        if (!text) {
            const step = field ? { text: questionText(field, sel), key: field } : (contactReady(sel) ? { text: "", key: null } : { text: FORM_INTRO, key: FORM });
            return send(response, sel, step.text, step.key);
        }

        // --- An answer the backend can map on its own (every chip click). ---
        if (field) {
            const v = mapAnswer(field, text, sel);
            if (v) {
                sel = { ...sel, [field]: v };
                // A job the shop does not do stops here: no price, no lead.
                const stop = FLOW.blocked(sel);
                if (stop) {
                    const cleared = { ...sel };
                    delete cleared.jobs;
                    return send(response, cleared, stop, "jobs");
                }
                const step = nextStep(sel);
                return send(response, sel, ackText(field, sel) + "\n\n" + step.text, step.key);
            }
        }

        // --- Everything else goes to the model. ---
        const mode = field ? "question" : (contactReady(sel) ? "done" : "form");
        const ai = await askModel(sel, history, text, field, mode);
        const reading = ai.ok ? interpretModel(ai.text, mode === "question" ? field : null, sel) : null;

        if (!reading || !reading.said) {
            if (mode === "question") {
                return send(response, sel,
                    `Ezt most nem sikerült értelmeznem. Válassz a lenti lehetőségek közül - ha kérdésed van, hívj nyugodtan: **${PHONE}**.\n\n${questionText(field, sel)}`,
                    field);
            }
            if (mode === "form") {
                return send(response, sel, `Töltsd ki a rövid űrlapot, és rögtön mutatom az árat.`, FORM);
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
                const stop = FLOW.blocked(sel);
                if (stop) {
                    const cleared = { ...sel };
                    delete cleared.jobs;
                    return send(response, cleared, stop, "jobs");
                }
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
                const step = nextStep(sel);
                return send(response, sel, said + vin + alsoGot + "\n\n" + step.text, step.key);
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

function pickContact(c) {
    const out = {};
    if (!c || typeof c !== "object") return out;
    for (const k of CONTACT_KEYS) if (has(c, k)) out[k] = oneLine(c[k]).slice(0, 200);
    return out;
}

// ---------------------------------------------------------------------------
//  Deliver the finished quote: the customer's bubbles, the owner's card, the
//  arithmetic panel and the feedback form, plus the owner e-mail.
// ---------------------------------------------------------------------------
async function finishQuote(sel, history, response, sessionId) {
    const quote = assembleQuote(sel);
    const customer = renderCustomerQuote(quote, sel);
    const owner = renderOwnerCard(quote, sel);
    const answer = [customer, owner].join("\n[[SPLIT]]\n");

    console.log("\n========================================");
    console.log(`ÚJ ÁRAJÁNLAT - ${quote.title}`);
    console.log(`Autó: ${FLOW.carLine(sel)} | Alvázszám: ${FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "-"} | Rendszám: ${sel.plate || "-"}`);
    console.log(`Ügyfél: ${sel.name} | ${sel.phone} | ${sel.email}`);
    console.log(`${quote.diagnosticOnly ? "Diagnosztika" : "Alapár"}: ${formatHuf(quote.total)}`);
    console.log("========================================\n");

    const transcript = [
        ...(Array.isArray(history) ? history : []),
        { role: "assistant", content: answer },
    ];
    const delivery = sendQuoteEmail(sel, quote, transcript).catch(() => {});
    if (hasVercelWaitUntil()) waitUntil(delivery); else if (process.env.VERCEL) await delivery;

    return response.status(200).json({
        answer,
        chips: [],
        state: sel,
        done: true,
        ...progressOf(sel),
        workings: workingsPanel(quote),
        live: liveVersionPanel(sel, quote),
        form: feedbackForm(sel),
        lead: { title: quote.title, total: quote.total, diagnosticOnly: quote.diagnosticOnly },
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

async function sendQuoteEmail(sel, quote, transcript) {
    const plate = has(sel, "plate") ? `${oneLine(sel.plate)}${plateIsHungarian(sel.plate) ? "" : " (nem magyar rendszám)"}` : "-";
    const lines = quote.items.map((i) => `<tr><td style="padding:4px 12px 4px 0">${esc(i.label)}</td><td style="padding:4px 0;text-align:right"><b>${esc(formatHuf(i.amount))}</b></td></tr>`).join("");
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
  <h2 style="margin:0 0 4px">${quote.diagnosticOnly ? "Diagnosztikai időpont" : "Új árajánlat"} - ${esc(quote.title)}</h2>
  <p style="margin:0 0 16px;color:#666">Prototípus, minta árakkal. ${esc(FLOW.SAMPLE_NOTICE)}</p>
  <h3 style="margin:16px 0 4px">Az autó és az ügyfél</h3>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#666">Autó</td><td style="padding:4px 0"><b>${esc(FLOW.carLine(sel))}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Alvázszám</td><td style="padding:4px 0"><b>${esc(FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "nem adta meg")}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Rendszám</td><td style="padding:4px 0"><b>${esc(plate)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Név</td><td style="padding:4px 0"><b>${esc(sel.name)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon</td><td style="padding:4px 0"><b>${esc(sel.phone)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">E-mail</td><td style="padding:4px 0"><b>${esc(sel.email || "-")}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">Mikor jó</td><td style="padding:4px 0"><b>${esc([sel.when_pref, sel.when_note].filter(Boolean).join(", ") || "-")}</b></td></tr>
  </table>
  <h3 style="margin:16px 0 4px">Az ajánlat</h3>
  <table style="border-collapse:collapse;font-size:14px;width:100%">${lines}
    <tr><td style="padding:8px 12px 4px 0;border-top:1px solid #ddd">${quote.diagnosticOnly ? "Diagnosztika" : "Alapár"}</td>
        <td style="padding:8px 0 4px;border-top:1px solid #ddd;text-align:right"><b>${esc(formatHuf(quote.total))}${quote.diagnosticOnly ? "" : "-tól"}</b></td></tr>
  </table>
  <p style="margin:4px 0 16px;color:#666;font-size:13px">Bruttó ár, az ÁFA-t tartalmazza. Tájékoztató ár, a szerviz erősíti meg.</p>
  <h3 style="margin:16px 0 4px">Minden válasz</h3>
  <table style="border-collapse:collapse;font-size:14px">${detailRows(sel)}</table>
  <h3 style="margin:16px 0 4px">Miből jött ki (bruttó, ÁFA-val)</h3>
  <ul style="font-size:13px;color:#444">${quote.workings.map((w) => `<li>${esc(plain(w))}</li>`).join("")}</ul>
  <h3 style="margin:16px 0 4px">A teljes beszélgetés</h3>
  ${transcriptHtml(transcript)}
</div>`;
    const text = [
        `${quote.diagnosticOnly ? "DIAGNOSZTIKA" : "ÚJ ÁRAJÁNLAT"} - ${quote.title}`,
        `Autó: ${FLOW.carLine(sel)}`,
        `Alvázszám: ${FLOW.vinLooksValid(sel.vin) ? cleanVin(sel.vin) : "-"} | Rendszám: ${plate}`,
        `Ügyfél: ${sel.name} | ${sel.phone} | ${sel.email || "-"}`,
        ``,
        ...quote.items.map((i) => `${i.label}: ${formatHuf(i.amount)}`),
        `${quote.diagnosticOnly ? "Diagnosztika" : "Alapár"}: ${formatHuf(quote.total)}`,
        ``,
        "Miből jött ki (bruttó, ÁFA-val):",
        ...quote.workings.map((w) => `- ${plain(w)}`),
        ``,
        transcriptText(transcript),
    ].join("\n");
    return await resendSend({
        subject: `[MINTA ÁRAJÁNLAT] ${quote.title} - ${formatHuf(quote.total)}`,
        html, text,
        replyTo: emailIssue(sel.email) ? undefined : sel.email,
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

export { assembleQuote, renderCustomerQuote, renderOwnerCard, workingsPanel, mapAnswer, sanitizeState, pendingField, projectOrder, formatHuf };
