// Flow tests - run with `node test-flow.mjs`. No API keys needed: every path
// here is one the backend answers without the model (button clicks), and with
// no RESEND_API_KEY nothing is mailed anywhere.
//
//  1. A random walk through EVERY branch of the flow, clicking random buttons,
//     accepting the proposed lines. Every step
//     must offer buttons (or be a typed field); every finished quote must be a
//     positive, itemised, net + ÁFA = gross total whose lines add up.
//  2. The fixed scenarios from lib/flow.js, printed with their price and
//     checked against loose 2026 market envelopes, so a rate edit that drifts
//     off-market is visible at a glance.
//  3. The guards that matter for THIS build, which is aimed at the mechanic:
//     - the shop's configured hourly rate actually drives the price;
//     - an overridden normaidő or part price actually replaces the proposal;
//     - a line he adds by hand reaches the total;
//     - an alanyi adómentes shop gets no ÁFA;
//     - there is NO settings screen: every client's tool is built for them;
//     - no question anywhere offers him a "Nem tudom", because he has seen
//       the car and a guess of his own would go onto his own invoice;
//     - a tampered state is cleaned before it can reach the price model.
import handler, { sanitizeState, projectOrder, formatHuf, assembleQuote, customerText, validateTetelek } from "./api/faq-agent.js";
import * as FLOW from "./lib/flow.js";

delete process.env.RESEND_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
// The one-quote-per-person limit is tested on its own below; everything else
// runs thousands of quotes and must not trip it.
process.env.ONE_QUOTE = "off";

const quiet = process.argv.includes("--verbose") ? null : console.log;
// The engine logs every finished quote and warns loudly when there is no
// RESEND_API_KEY (there never is, here), so a quiet run silences all three
// channels - otherwise the scenario table is buried in e-mail bodies.
if (quiet) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const log = (...a) => (quiet || console.log)(...a);

let failures = 0;
const fail = (msg, ctx) => { failures++; log("  FAIL:", msg, ctx ? JSON.stringify(ctx).slice(0, 700) : ""); };

let ipSeq = 0;
async function call(body, ip) {
    let out = null;
    const addr = ip || `10.0.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
    const req = { method: "POST", body, headers: { "x-forwarded-for": addr }, socket: {} };
    const res = {
        statusCode: 200,
        setHeader() {},
        status(c) { this.statusCode = c; return this; },
        json(d) { out = d; return this; },
        end() { return this; },
    };
    await handler(req, res);
    return { status: res.statusCode, data: out };
}

const rnd = (n) => Math.floor(Math.random() * n);
const MULTI_SEP = " · ";

// Typed answers for the fields that have no buttons.
const TYPED = {
    egyeb_munka: "Bal első lengőkar csere",
};

// Walk the whole flow. `editLines` optionally rewrites the tételek form before
// it is submitted, which is how the override tests drive his own numbers in.
async function run(choose, editLines) {
    const history = [];
    let { data } = await call({ action: "start", state: {} });
    let guard = 0;
    let steps = 0; // how many screens the mechanic had to get through
    let sawTetelek = null;
    for (;;) {
        if (++guard > 60) { fail("a folyamat nem ért véget", data.state); return null; }
        if (data.done) { data.__steps = steps; data.__tetelek = sawTetelek; return data; }
        steps++;

        // The line editor. Its fields arrive pre-filled with the engine's
        // proposal, so submitting it untouched is the "I accept the defaults"
        // path - which is what most of these tests want.
        if (data.form && data.form.action === "tetelek") {
            sawTetelek = data.form;
            const values = {};
            for (const f of data.form.fields) values[f.key] = f.value == null ? "" : String(f.value);
            if (editLines) editLines(values, data.form);
            history.push({ role: "assistant", content: data.answer });
            ({ data } = await call({ tetelek: values, history, state: data.state }));
            if (data.formErrors) { fail("a tételek űrlap visszapattant", data.formErrors); return null; }
            continue;
        }

        // A one-screen group form (the car, or the job details).
        if (data.form && data.form.action === "group") {
            const values = {};
            for (const f of data.form.fields) {
                if (f.type === "textarea") values[f.key] = TYPED[f.key] || "Valami furcsa hangot ad menet közben.";
                // A type-ahead row: the options come from the catalogue that
                // shipped with the form, narrowed by what is already filled in -
                // exactly what the browser does as somebody types.
                else if (f.type === "combo") {
                    values[f.key] = choose({ ...data, chips: comboOptions(f, data.form.catalog, values), multi: false, __field: f.key });
                }
                else if (f.type === "number" || f.type === "text") {
                    values[f.key] = choose({ ...data, chips: [], multi: false, __field: f.key, __typed: true });
                }
                else values[f.key] = choose({ ...data, chips: f.options, multi: false, __field: f.key });
            }
            history.push({ role: "assistant", content: data.answer },
                { role: "user", content: Object.values(values).filter(Boolean).join(" · ") });
            ({ data } = await call({ group: values, history, state: data.state }));
            if (data.formErrors) { fail("a csoportos űrlap visszapattant", data.formErrors); return null; }
            continue;
        }

        if (data.form) { fail("ismeretlen űrlap érkezett", data.form.action); return null; }
        const text = choose(data);
        if (text == null) { fail("nem volt mit válaszolni", data); return null; }
        history.push({ role: "assistant", content: data.answer }, { role: "user", content: text });
        const prev = data.progress;
        ({ data } = await call({ question: text, history, state: data.state }));
        if (data.progress <= prev && !data.form && !data.done) {
            fail("a válasz nem vitte előre a folyamatot", { text, answer: data.answer });
            return null;
        }
    }
}

// What a type-ahead box would offer, given what the other boxes hold. Mirrors
// comboOptions() in the widget, so the tests exercise the same narrowing the
// mechanic sees: brand -> that brand's models -> that model's engines.
function comboOptions(f, catalog, values) {
    if (!catalog) return [];
    if (f.source === "makes") return Object.keys(catalog);
    if (f.source === "models") return catalog[values.make] ? Object.keys(catalog[values.make]) : [];
    if (f.source === "engines") {
        const m = catalog[values.make];
        return m && m[values.model] ? m[values.model] : [];
    }
    return [];
}

// Which field a response is asking about, worked out from the state it carries.
const asking = (data) => {
    const order = projectOrder(data.state || {});
    for (const f of order) {
        const v = (data.state || {})[f];
        if (v == null || String(v).trim() === "") return f;
    }
    return null;
};

// A random valid answer for whatever is on screen. `__field` is set when the
// caller is filling one row of a one-screen form rather than answering the
// chat question the state points at.
function randomChoice(data) {
    const field = data.__field || asking(data);
    if (field && TYPED[field]) return TYPED[field];
    if (data.__typed) return ""; // an optional typed row, deliberately skipped
    const chips = data.chips || [];
    if (!chips.length) {
        fail("gomb nélküli kérdés, és nincs rá beírt válasz sem", { field, answer: data.answer });
        return null;
    }
    if (data.multi) {
        const n = 1 + rnd(Math.min(2, chips.length));
        const picked = [];
        while (picked.length < n) {
            const c = chips[rnd(chips.length)];
            if (!picked.includes(c)) picked.push(c);
        }
        return picked.join(MULTI_SEP);
    }
    // "Egyéb márka (beírom)" is an invitation to type, not an answer.
    const usable = chips.filter((c) => !/\(beírom\)/i.test(c));
    return usable[rnd(usable.length)] || chips[0];
}

function checkQuote(d, ctx) {
    if (!d || !d.done) return fail("nincs kész árajánlat", { ctx, d });
    const total = d.lead && d.lead.total;
    const net = d.lead && d.lead.net;
    if (!(total > 0)) return fail("a végösszeg nem pozitív", { ctx, total });
    if (!(net > 0)) return fail("a nettó összeg nem pozitív", { ctx, net });

    const bubbles = String(d.answer || "").split("[[SPLIT]]");
    const priceBubble = bubbles[0];
    const amounts = [...priceBubble.matchAll(/^• .* - \*\*([\d\s ]+)Ft\*\*/gm)]
        .map((m) => Number(m[1].replace(/\D/g, "")));
    if (!amounts.length) return fail("nincsenek tételsorok", { ctx, priceBubble });
    const sum = amounts.reduce((s, n) => s + n, 0);
    if (sum !== net) fail("a tételek nem adják ki a nettó összeget", { ctx, sum, net });

    // This is a FINAL quote, not an estimate. The old build's "-tól" and its
    // "tájékoztató ár" label were right for a price given before anyone saw the
    // car; here the mechanic HAS seen it, so either would be a lie.
    if (/-tól/.test(priceBubble)) fail("a kész ajánlatban '-tól' szerepel", { ctx, priceBubble });
    if (/Tájékoztató ár/i.test(priceBubble)) fail("a kész ajánlat tájékoztató árnak nevezi magát", { ctx });
    if (!/Nettó összesen|Végösszeg/.test(priceBubble)) fail("hiányzik a nettó/végösszeg sor", { ctx, priceBubble });

    // The document the mechanic actually hands over.
    if (!d.customer || !d.customer.text) return fail("hiányzik az ügyfélnek átadható ajánlat", { ctx });
    if (/\*\*/.test(d.customer.text)) fail("az ügyfél szövegében markdown maradt", { ctx });
    if (!/ÁRAJÁNLAT/.test(d.customer.text)) fail("az ügyfél szövegének nincs fejléce", { ctx });
    if (!d.customer.text.includes(formatHuf(total))) {
        fail("az ügyfél szövegében nem a végösszeg szerepel", { ctx, total });
    }

    if (!d.demo || !d.demo.divider) fail("hiányzik az elválasztó", { ctx });
    if (!d.demo.workings || !d.demo.workings.lines.length) fail("hiányzik a 'Miből jött ki' panel", { ctx });
    if (!d.demo.live || !d.demo.live.lines.length) fail("hiányzik az 'élesben' kártya", { ctx });
    if (!d.form || d.form.action !== "feedback") fail("hiányzik a visszajelzés űrlap", { ctx });
    // Back into the line editor, or on to the next car.
    const chips = d.chips || [];
    if (!chips.some((c) => /Tételek módosítása/i.test(c))) fail("nincs mód a tételek átírására", { ctx });
    if (!chips.some((c) => /másik autó/i.test(c))) fail("nincs mód új autóra ajánlatot adni", { ctx });
    return d;
}

// ---------------------------------------------------------------------------
log("\n1. VÉLETLEN VÉGIGJÁRÁS (60 beszélgetés)");
for (let i = 0; i < 60; i++) {
    const d = await run(randomChoice);
    if (d) checkQuote(d, `random #${i}`);
}
log("   kész");

// ---------------------------------------------------------------------------
log("\n2. RÖGZÍTETT FORGATÓKÖNYVEK");
const scenarioChooser = (answers) => (data) => {
    const field = data.__field || asking(data);
    if (!field) return null;
    const a = answers[field];
    if (a == null) {
        if (data.__typed) return "";
        return (data.chips || [])[0] || TYPED[field] || "";
    }
    return Array.isArray(a) ? a.join(MULTI_SEP) : a;
};
for (const sc of FLOW.TEST_SCENARIOS) {
    const d = await run(scenarioChooser(sc.answers));
    const ok = checkQuote(d, sc.name);
    if (!ok) continue;
    const total = d.lead.total;
    const flag = total < sc.min ? " <-- TÚL OLCSÓ" : total > sc.max ? " <-- TÚL DRÁGA" : "";
    if (flag) failures++;
    log(`   ${formatHuf(total).padStart(12)}  ${sc.name}${flag}`);
}

// ---------------------------------------------------------------------------
log("\n3. ŐRÖK");

// The whole premise of this build: the man answering has had the car on the
// lift, so there is nothing he does not know. A "Nem tudom" button would put a
// guess of his own onto his own invoice.
{
    let found = null;
    const seen = new Set();
    for (let i = 0; i < 25 && !found; i++) {
        await run((data) => {
            for (const c of data.chips || []) if (/nem tudom/i.test(c)) found = found || c;
            const f = data.form;
            for (const x of (f && f.fields) || []) {
                for (const o of x.options || []) if (/nem tudom/i.test(o)) found = found || `${x.key}: ${o}`;
                seen.add(x.key);
            }
            return randomChoice(data);
        });
    }
    if (found) fail("valahol mégis van 'Nem tudom' válasz", found);
    else log(`   sehol nincs 'Nem tudom' válasz (${seen.size} mezőt bejárva): OK`);
}

// Each client's tool is BUILT for them - rates, VAT and name live in the SHOP
// config, and the mechanic never sets anything up. So the flow must open
// straight on the job, and the labour must be priced at the configured rate.
{
    const { data } = await call({ action: "start", state: {} });
    const opening = projectOrder(data.state || {})[0];
    if (opening !== "jobs" || data.form) fail("a folyamat nem a munkával indul (beállítás-képernyő maradt?)", { opening, form: data.form && data.form.title });
    else log("   nincs beállítás-képernyő, rögtön a munkával indul: OK");

    const q = assembleQuote({ jobs: "fek", make: "Opel", model: "Astra", engine: "1.6 benzin", year: "2012",
        vin: "nincs", fek_hol: "elso", fek_tarcsa: "betet", parts_tier: "markas" });
    const l = q.items.find((i) => i.kind === "munka");
    if (l.rate !== FLOW.SHOP.rates.altalanos || l.amount !== Math.round(l.hours * FLOW.SHOP.rates.altalanos)) {
        fail("a munkadíj nem a szerviz beépített óradíjával számol", { rate: l.rate, amount: l.amount });
    } else log(`   munkadíj = óra × a szerviz beépített óradíja (${formatHuf(FLOW.SHOP.rates.altalanos)}): OK`);
}

// An overridden normaidő or part price must actually replace the proposal.
// This is the feature the whole build exists for.
{
    const base = { jobs: "fek", make: "Opel", model: "Astra", engine: "1.6 benzin", year: "2012",
        vin: "nincs", fek_hol: "elso", fek_tarcsa: "betet", parts_tier: "markas" };
    const proposed = assembleQuote(base);
    const labourLine = proposed.items.find((i) => i.kind === "munka");
    const partLine = proposed.items.find((i) => i.kind === "alkatresz" && i.key !== "ar:aproanyag");

    const withHours = assembleQuote({ ...base, tetelek: JSON.stringify({ ora: { [labourLine.key]: labourLine.hours + 1 } }) });
    const newLabour = withHours.items.find((i) => i.key === labourLine.key);
    if (newLabour.amount !== labourLine.amount + FLOW.SHOP.rates.altalanos) fail("a felülírt óraszám nem a megadott óradíjjal számolt", { was: labourLine.amount, now: newLabour.amount });
    else if (!newLabour.edited) fail("a felülírt sor nincs átírtként jelölve");
    else log(`   +1 óra a te óradíjaddal: ${formatHuf(labourLine.amount)} -> ${formatHuf(newLabour.amount)}, jelölve: OK`);

    const withPart = assembleQuote({ ...base, tetelek: JSON.stringify({ ar: { [partLine.key]: 33333 } }) });
    const newPart = withPart.items.find((i) => i.key === partLine.key);
    if (newPart.unit !== 33333) fail("a felülírt alkatrészár nem ment át", newPart);
    else if (newPart.amount !== 33333 * partLine.qty) fail("a felülírt egységár nem szorzódott a darabszámmal", newPart);
    else log(`   felülírt alkatrészár (${formatHuf(33333)} × ${partLine.qty}) átment: OK`);

    // A line he adds by hand reaches the total AND the customer's copy.
    const extraState = { ...base, tetelek: JSON.stringify({ extra: [{ label: "Beszorult csavar kifúrása", amount: 8000 }] }) };
    const extra = assembleQuote(extraState);
    if (extra.net !== proposed.net + 8000) fail("a saját tétel nem került bele a nettó összegbe", { was: proposed.net, now: extra.net });
    else if (!customerText(extra, extraState).includes("Beszorult csavar kifúrása")) fail("a saját tétel nem jelent meg az ügyfél ajánlatán");
    else log(`   saját tétel (+${formatHuf(8000)}) a végösszegben és az ügyfél ajánlatán is: OK`);

    // The editor comes back with EVERY box filled, because each was pre-filled
    // with the proposal. Only what he changed may become an override - or the
    // apróanyag, a share of the labour, freezes at its old figure when he
    // raises the hours. (Found by hand in the browser: 5,5 -> 6 hours left the
    // consumables stuck at 6 600 Ft.)
    {
        const form = {};
        for (const it of proposed.items) form[it.key] = String(it.kind === "munka" ? it.hours : it.unit);
        form[labourLine.key] = String(labourLine.hours + 2);
        const res = validateTetelek(form, base);
        const ov = FLOW.parseOverrides(res.values.tetelek);
        const after = assembleQuote({ ...base, tetelek: res.values.tetelek });
        const aproBefore = proposed.items.find((i) => i.key === "ar:aproanyag").amount;
        const aproAfter = after.items.find((i) => i.key === "ar:aproanyag").amount;
        if (Object.keys(ov.ar).length) fail("érintetlen alkatrészsorok felülírásként mentődtek", ov.ar);
        else if (!(aproAfter > aproBefore)) fail("az apróanyag nem követte a megemelt óraszámot", { aproBefore, aproAfter });
        else log(`   csak az átírt sor mentődik, az apróanyag követi az óraszámot (${formatHuf(aproBefore)} -> ${formatHuf(aproAfter)}): OK`);
    }

    // Garbage in an override is ignored, so a half-typed box cannot zero a part.
    const junk = assembleQuote({ ...base, tetelek: JSON.stringify({ ar: { [partLine.key]: "nyolcezer" }, ora: { [labourLine.key]: -5 } }) });
    if (junk.net !== proposed.net) fail("érvénytelen felülírás megváltoztatta az árat", { was: proposed.net, now: junk.net });
    else log("   értelmezhetetlen felülírás -> marad a javaslat: OK");
}

// VAT is the shop's, set in its build. An alanyi adómentes workshop issuing
// quotes with 27% on them would be issuing wrong paperwork every time.
{
    const base = { jobs: "olajcsere", make: "Suzuki", model: "Swift", engine: "1.2 benzin", year: "2012",
        vin: "nincs", km: "k150", olaj_szuro: "csak_olaj", parts_tier: "markas" };
    const vat = assembleQuote(base);
    if (vat.total !== vat.net + vat.vat) fail("a bruttó nem a nettó + ÁFA", vat);
    if (vat.vat !== Math.round(vat.net * FLOW.SHOP.vat)) fail("az ÁFA nem a beépített kulccsal számolt", vat);
    const saved = FLOW.SHOP.vat;
    FLOW.SHOP.vat = 0;
    const noVat = assembleQuote(base);
    const noVatText = customerText(noVat, base);
    FLOW.SHOP.vat = saved;
    if (noVat.vat !== 0 || noVat.total !== noVat.net) fail("alanyi adómentes szerviznél is számolt ÁFÁ-t", noVat);
    else if (!/alanyi adómentes/.test(noVatText)) fail("az ügyfél ajánlata nem mondja ki az adómentességet");
    else log(`   ÁFÁ-s: ${formatHuf(vat.net)} + ${formatHuf(vat.vat)} = ${formatHuf(vat.total)} · alanyi adómentes build: ${formatHuf(noVat.total)}: OK`);
}

// A tampered state cannot smuggle a value into the price model.
{
    const dirty = sanitizeState({
        jobs: "kuplung,__hack", parts_tier: "ingyen", vin: "NEM-EGY-VIN",
        year: "3000", make: "<script>", km: "k999", tetelek: "{nem json",
    });
    if (dirty.parts_tier) fail("érvénytelen alkatrész-kategória átment", dirty);
    if (dirty.vin) fail("érvénytelen alvázszám átment", dirty);
    if (dirty.year) fail("lehetetlen évjárat átment", dirty);
    if (dirty.km) fail("érvénytelen km átment", dirty);
    if (dirty.make) fail("HTML-t tartalmazó márka átment", dirty);
    if (String(dirty.jobs).includes("__hack")) fail("ismeretlen munka átment", dirty);
    if (!String(dirty.jobs).includes("kuplung")) fail("az érvényes munka kiesett", dirty);
    if (FLOW.parseOverrides(dirty.tetelek).extra.length) fail("hibás JSON-ból lett tétel", dirty.tetelek);
    log("   meghamisított állapot megtisztítva: OK");
}

// After a quote: a fresh car, or back into the line editor.
{
    const d = await run(scenarioChooser(FLOW.TEST_SCENARIOS[0].answers));
    if (!d) fail("nem jutott el a végéig");
    else {
        const r = await call({ question: "Új ajánlat másik autóra", history: [], state: d.state });
        const next = r.data.state || {};
        if (next.make || next.jobs || next.tetelek) fail("az előző autó adatai bennmaradtak", next);
        else log("   új autó -> az előző autó és a tételek törlődnek: OK");

        const e = await call({ question: "Tételek módosítása", history: [], state: d.state });
        if (!e.data.form || e.data.form.action !== "tetelek") fail("a tételek nem nyithatók újra", e.data.form);
        else log("   tételek újranyitása a kész ajánlatból: OK");
    }
}

// The lines the editor offers have to be the lines the quote is made of,
// otherwise he would be editing something other than what he issues.
{
    const d = await run(scenarioChooser(FLOW.TEST_SCENARIOS[4].answers));
    if (!d || !d.__tetelek) fail("nem jött elő a tételek űrlap");
    else {
        const keys = d.__tetelek.fields.map((f) => f.key).filter((k) => /^(ora|ar):/.test(k));
        const q = assembleQuote(d.state);
        const itemKeys = q.items.filter((i) => i.kind !== "extra").map((i) => i.key);
        const missing = itemKeys.filter((k) => !keys.includes(k));
        if (missing.length) fail("a kész ajánlat olyan sort tartalmaz, amit nem lehetett szerkeszteni", missing);
        else if (!d.__tetelek.allowExtras) fail("nem lehet saját tételt felvenni");
        else log(`   mind a ${itemKeys.length} tétel szerkeszthető volt, és felvehető saját sor is: OK`);
    }
}

// A valid VIN is read back with its year, which is the moment the thing proves
// it actually looked at what it was given.
{
    const y = FLOW.vinYear(FLOW.SAMPLE_VIN);
    if (!y) fail("a minta alvázszámból nem jött ki évjárat");
    else if (!/minta alvázszám/.test(FLOW.vinNote(FLOW.SAMPLE_VIN, { make: "Volkswagen" }))) fail("a minta alvázszámot valódiként olvasta vissza");
    else if (!/rossz alkatrész/.test(FLOW.vinNote("WVWZZZ1KZ8W123456", { make: "Opel" }))) fail("az eltérő márkájú alvázszámot nem jelezte");
    else if (!/2008/.test(FLOW.vinNote("WVWZZZ1KZ8W123456", { make: "Volkswagen" }))) fail("az egyező alvázszámból nem mondta az évjáratot");
    // Position 10 is only a model year at the makers who follow the North
    // American rule. On a French or Italian VIN it is not, so no year may be
    // claimed - a confident wrong year is worse than saying nothing.
    else if (FLOW.vinYear("VF1BB05CF31234567") != null) fail("francia alvázszámból évjáratot állított");
    else if (FLOW.vinYear("ZFA18800004123456") != null) fail("olasz alvázszámból évjáratot állított");
    else if (/évjárat/.test(FLOW.vinNote("VF1BB05CF31234567", { make: "Renault" }))) fail("francia alvázszámnál évjáratot mondott");
    else log("   alvázszám: minta jelölve, eltérő márka jelezve, egyező visszaolvasva: OK");
}

// Diesel labour must cost more than petrol on the same car and job.
{
    const base = { jobs: "vezermuszij", make: "Volkswagen", model: "Golf", year: "2012", vin: "nincs",
        km: "k200", vezerles_tipus: "szij", vez_vizpumpa: "nem", parts_tier: "markas" };
    const petrol = assembleQuote({ ...base, engine: "1.6 benzin" }).total;
    const diesel = assembleQuote({ ...base, engine: "1.6 TDI dízel" }).total;
    if (!(diesel > petrol)) fail("a dízel nem kerül többe, mint a benzines", { petrol, diesel });
    else log(`   dízel (${formatHuf(diesel)}) > benzin (${formatHuf(petrol)}) ugyanarra a munkára: OK`);
}

// A bigger car must cost more labour than a small one, same job, same tier.
{
    const base = { jobs: "fek", engine: "2.0 dízel", year: "2012", vin: "nincs", fek_hol: "elso",
        fek_tarcsa: "betet", parts_tier: "markas" };
    const small = assembleQuote({ ...base, make: "Suzuki", model: "Swift" }).total;
    const big = assembleQuote({ ...base, make: "BMW", model: "5-ös" }).total;
    if (!(big > small)) fail("a felső kategória nem kerül többe", { small, big });
    else log(`   BMW 5-ös (${formatHuf(big)}) > Swift (${formatHuf(small)}) ugyanarra a fékmunkára: OK`);
}

// The accuracy forks. Each one has to stay strictly dearer than its counterpart -
// these are the answers a mechanic will check first, because he knows them.
{
    const cmp = (name, base, cheapPatch, dearPatch) => {
        const cheap = assembleQuote({ ...base, ...cheapPatch }).total;
        const dear = assembleQuote({ ...base, ...dearPatch }).total;
        if (!(dear > cheap)) fail(`${name}: a drágább változat nem került többe`, { cheap, dear });
        else log(`   ${name}: ${formatHuf(cheap)} -> ${formatHuf(dear)}: OK`);
    };
    const car = { make: "Volkswagen", model: "Golf", engine: "1.4 TSI benzin", year: "2017", vin: "nincs",
        parts_tier: "markas" };
    cmp("lánc a szíjnál drágább", { ...car, jobs: "vezermuszij", km: "k200", vez_vizpumpa: "nem" },
        { vezerles_tipus: "szij" }, { vezerles_tipus: "lanc" });
    cmp("vízpumpa a vezérléssel együtt többe kerül", { ...car, jobs: "vezermuszij", km: "k200", vezerles_tipus: "szij" },
        { vez_vizpumpa: "nem" }, { vez_vizpumpa: "igen" });
    cmp("R1234yf gáz a réginél drágább (csak az évjáratból)", { ...car, jobs: "klima", klima_allapot: "gyenge" },
        { year: "2012" }, { year: "2021" });
    cmp("AGM akku a hagyományosnál drágább", { ...car, jobs: "akkumulator" },
        { akku_startstop: "nem" }, { akku_startstop: "igen" });
    cmp("elektromos kézifék munkadíja külön", { ...car, jobs: "fek", fek_hol: "hatso", fek_tarcsa: "betet" },
        { fek_kezifek: "nem" }, { fek_kezifek: "igen" });
    cmp("kettőstömegű lendkerék, ha a szerelő látta, hogy kell", { ...car, jobs: "kuplung", kuplung_valto: "manualis", kuplung_hajtas: "elso" },
        { kuplung_ktl: "nem" }, { kuplung_ktl: "igen" });
    cmp("19 colos kerék szerelése drágább", { ...car, jobs: "gumi", gumi_db: "4" },
        { gumi_meret: "m16" }, { gumi_meret: "m19" });
    cmp("nagyobb motorba több olaj megy", { ...car, jobs: "olajcsere", km: "k150", olaj_szuro: "csak_olaj" },
        { engine: "1.2 benzin" }, { engine: "2.0 TDI dízel" });
    cmp("összkerékhajtású kuplung több munka", { ...car, jobs: "kuplung", kuplung_valto: "manualis", kuplung_ktl: "nem" },
        { kuplung_hajtas: "elso" }, { kuplung_hajtas: "awd" });
}

// ONE QUOTE PER PERSON - the Facebook-group demo. The browser flag is the main
// limit; the server has to hold on its own against a second car in the same
// session, a browser that says it is used, and an address opening session
// after session. The owner key switches all of it off.
{
    process.env.ONE_QUOTE = "on";
    process.env.QUOTE_SESSIONS_PER_IP = "2";
    process.env.OWNER_KEY = "titok";
    const IP = "203.0.113.7";
    const sc = FLOW.TEST_SCENARIOS[0];

    // Walk one scenario as a given session, from a given address.
    async function walk(sessionId, extra = {}) {
        let { data } = await call({ action: "start", state: {}, sessionId, ...extra }, IP);
        const choose = scenarioChooser(sc.answers);
        for (let guard = 0; guard < 40 && data && !data.done && !data.limited; guard++) {
            if (data.form && data.form.action === "tetelek") {
                const values = {};
                for (const f of data.form.fields) values[f.key] = f.value == null ? "" : String(f.value);
                ({ data } = await call({ tetelek: values, history: [], state: data.state, sessionId, ...extra }, IP));
            } else if (data.form && data.form.action === "group") {
                const values = {};
                for (const f of data.form.fields) {
                    values[f.key] = f.type === "combo"
                        ? choose({ ...data, chips: comboOptions(f, data.form.catalog, values), __field: f.key })
                        : choose({ ...data, chips: f.options || [], __field: f.key, __typed: f.type === "text" || f.type === "textarea" });
                }
                ({ data } = await call({ group: values, history: [], state: data.state, sessionId, ...extra }, IP));
            } else {
                ({ data } = await call({ question: choose(data), history: [], state: data.state, sessionId, ...extra }, IP));
            }
        }
        return data;
    }

    const first = await walk("s-A");
    if (!first || !first.done) fail("az első ajánlat sem készült el a limittel", first && first.answer);
    else if ((first.chips || []).some((c) => /másik autó/i.test(c))) fail("a limit mellett is felkínálja az új autót");
    else log("   első ajánlat elkészül, és nem kínál új autót: OK");

    // The same quote can still be edited - that is not a second quote.
    const again = await call({ question: "Tételek módosítása", history: [], state: first.state, sessionId: "s-A" }, IP);
    const re = again.data.form && again.data.form.action === "tetelek"
        ? await call({ tetelek: Object.fromEntries(again.data.form.fields.map((f) => [f.key, String(f.value || "")])), history: [], state: again.data.state, sessionId: "s-A" }, IP)
        : null;
    if (!re || !re.data.done) fail("a saját ajánlat tételeit már nem lehet módosítani");
    else log("   a saját ajánlat tételei továbbra is módosíthatók: OK");

    // A second car in the same session is refused.
    const restart = await call({ question: "Új ajánlat másik autóra", history: [], state: first.state, sessionId: "s-A" }, IP);
    if (!restart.data.limited) fail("ugyanabban a munkamenetben új autót is engedett");
    const other = await call({ tetelek: {}, history: [], state: { ...first.state, make: "Opel", model: "Astra", tetelek: "" }, sessionId: "s-A" }, IP);
    if (!other.data.limited) fail("egy másik autó árajánlata átment ugyanabban a munkamenetben");
    else log("   ugyanabban a munkamenetben második autó -> elutasítva: OK");

    // A browser that says it is used gets the limit message, and cannot type
    // its way back into the flow from there.
    const used = await call({ action: "start", state: {}, sessionId: "s-B", used: true }, IP);
    const typed = await call({ question: "Kuplungcsere", history: [], state: {}, sessionId: "s-B", used: true }, IP);
    if (!used.data.limited || !used.data.form || used.data.form.action !== "lead") fail("a már használt böngésző nem a limit-üzenetet kapta", used.data);
    else if (!typed.data.limited) fail("a limit-üzenet alatt beírva újra elindult a folyamat");
    else log("   használt böngésző -> limit-üzenet és jelentkezési űrlap, gépelve sem indul újra: OK");

    // The address backstop: 2 sessions allowed here, the third is refused.
    const second = await walk("s-C");
    const third = await call({ action: "start", state: {}, sessionId: "s-D" }, IP);
    if (!second || !second.done) fail("a második munkamenet ugyanarról a címről nem kapott ajánlatot");
    else if (!third.data.limited) fail("a címenkénti keret fölött is engedett");
    else log("   címenként 2 munkamenet, a 3. elutasítva: OK");

    // Leaving feedback or contact details still works after the limit.
    const fb = await call({ feedback: { fb_text: "jó" }, history: [], state: {}, sessionId: "s-B", used: true }, IP);
    if (fb.data.limited) fail("a limit után a visszajelzést sem engedi");
    else log("   a limit után visszajelzés küldhető: OK");

    // The owner key bypasses everything.
    const owner = await walk("s-E", { ownerKey: "titok" });
    if (!owner || !owner.done) fail("a tulajdonosi kulccsal sem kapott ajánlatot");
    else if (!(owner.chips || []).some((c) => /másik autó/i.test(c))) fail("a tulajdonosnak nem kínál új autót");
    else log("   tulajdonosi kulccsal (?teszt=...) nincs limit: OK");

    process.env.ONE_QUOTE = "off";
}

// How many screens it actually takes. Grouping the settings, the car details
// and the job details onto one form each is what pays for the extra accuracy
// questions, so if a future edit un-groups them this number goes up and the
// test says so out loud.
//   munka, autó-űrlap, ALVÁZSZÁM, munka-űrlap, tételek = 5,
//   plus room for a conditional follow-up or a second job.
{
    const SCREEN_BUDGET = 7;
    for (const sc of FLOW.TEST_SCENARIOS) {
        const d = await run(scenarioChooser(sc.answers));
        if (!d || !d.__steps) continue;
        if (d.__steps > SCREEN_BUDGET) fail(`túl sok képernyő (${d.__steps})`, sc.name);
        else log(`   ${String(d.__steps).padStart(2)} képernyő: ${sc.name}`);
    }
}

log(`\n${failures ? `${failures} HIBA` : "MINDEN TESZT RENDBEN"}\n`);
if (quiet) console.log = quiet;
console.log(failures ? `test-flow: ${failures} hiba (futtasd --verbose kapcsolóval a részletekért)` : "test-flow: minden rendben");
process.exit(failures ? 1 : 0);
