// Flow tests - run with `node test-flow.mjs`. No API keys needed: every path
// here is one the backend answers without the model (button clicks), and with
// no RESEND_API_KEY nothing is mailed anywhere.
//
//  1. A random walk through EVERY branch of the flow, clicking random buttons,
//     then submitting the contact form. Every step must offer buttons (or be a
//     free-text question); every finished quote must be a positive, whole,
//     itemised floor whose lines add up to the total.
//  2. The fixed scenarios from lib/flow.js, printed with their price and
//     checked against loose 2026 market envelopes, so a rate edit that drifts
//     off-market is visible at a glance.
//  3. The guards that matter most for this trade:
//     - a SYMPTOM never gets a repair price, only the diagnostic fee;
//     - a job the shop does not do is refused and no lead is taken;
//     - a tampered state is cleaned before it can reach the price model;
//     - a bad contact form bounces instead of producing a quote.
import handler, { sanitizeState, projectOrder, formatHuf } from "./api/faq-agent.js";
import * as FLOW from "./lib/flow.js";

delete process.env.RESEND_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

const quiet = process.argv.includes("--verbose") ? null : console.log;
// The engine logs every finished quote and warns loudly when there is no
// RESEND_API_KEY (there never is, here), so a quiet run silences all three
// channels - otherwise the scenario table is buried in e-mail bodies.
if (quiet) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const log = (...a) => (quiet || console.log)(...a);

let failures = 0;
const fail = (msg, ctx) => { failures++; log("  FAIL:", msg, ctx ? JSON.stringify(ctx).slice(0, 700) : ""); };

let ipSeq = 0;
async function call(body) {
    let out = null;
    const req = { method: "POST", body, headers: { "x-forwarded-for": `10.0.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}` }, socket: {} };
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

const CONTACT = { name: "Teszt Elek", email: "teszt@gmail.com", plate: "AB-CD-123", when_pref: "Hétköznap délután" };
const rnd = (n) => Math.floor(Math.random() * n);
const MULTI_SEP = " · ";

// Free-text answers for the questions that have no buttons.
const TYPED = {
    tunet_leiras: "Fékezésnél csikorog, és néha rángat a kormány 80 felett.",
};

async function run(choose, contact = CONTACT) {
    const history = [];
    let { data } = await call({ action: "start", state: {} });
    let guard = 0;
    let steps = 0; // how many screens the customer had to get through
    for (;;) {
        if (++guard > 60) { fail("a folyamat nem ért véget", data.state); return null; }
        if (data.done) { data.__steps = steps; return data; }
        steps++;
        // The one-screen job-detail form: fill every select from the same chooser
        // the chat questions use, and post it in one go.
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
                // A typed row (the VIN) uses its own sample, or is left blank -
                // both are valid, and blank is what most people will do.
                else if (f.type === "text") values[f.key] = rnd(2) ? (f.sample || "") : "";
                else values[f.key] = choose({ ...data, chips: f.options, multi: false, __field: f.key });
            }
            history.push({ role: "assistant", content: data.answer },
                { role: "user", content: Object.values(values).join(" · ") });
            ({ data } = await call({ group: values, history, state: data.state }));
            if (data.formErrors) { fail("a csoportos űrlap visszapattant", data.formErrors); return null; }
            continue;
        }
        if (data.form) break; // the contact form
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
    const beforeContact = data; // the response that carried the contact form
    const r = await call({ contact, history, state: data.state });
    if (r.data) {
        r.data.__steps = steps; // the contact form was counted on its own pass
        r.data.__beforeContact = beforeContact;
    }
    return r.data;
}

// What a type-ahead box would offer, given what the other boxes hold. Mirrors
// comboOptions() in the widget, so the tests exercise the same narrowing the
// customer sees: brand -> that brand's models -> that model's engines.
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
// caller is filling one row of the one-screen detail form rather than answering
// the chat question the state points at.
function randomChoice(data) {
    const field = data.__field || asking(data);
    if (field && TYPED[field]) return TYPED[field];
    const chips = data.chips || [];
    if (!chips.length) {
        fail("gomb nélküli kérdés, és nincs rá beírt válasz sem", { field, answer: data.answer });
        return null;
    }
    if (data.multi) {
        // Never pick the out-of-scope option in the random walk; it is a
        // deliberate dead end and gets its own test below.
        const usable = chips.filter((c) => !/nincs a listában/i.test(c));
        const n = 1 + rnd(Math.min(2, usable.length));
        const picked = [];
        while (picked.length < n) {
            const c = usable[rnd(usable.length)];
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
    if (!(total > 0) || total % 1000 !== 0) fail("a végösszeg nem pozitív, ezres összeg", { ctx, total });

    const bubbles = String(d.answer || "").split("[[SPLIT]]");
    const priceBubble = bubbles[0];
    const amounts = [...priceBubble.matchAll(/^• .* - \*\*([\d\s ]+)Ft\*\*$/gm)]
        .map((m) => Number(m[1].replace(/\D/g, "")));
    if (!amounts.length) fail("nincsenek tételsorok", { ctx, priceBubble });
    const sum = amounts.reduce((s, n) => s + n, 0);
    if (sum !== total) fail("a tételek nem adják ki a végösszeget", { ctx, sum, total });

    // A floor, not a range: a priced job says "-tól", a diagnosis says a fee.
    if (d.lead.diagnosticOnly) {
        if (/-tól/.test(priceBubble)) fail("a diagnosztikai árnál nem lehet '-tól'", { ctx });
        if (!/nem adok javítási árat/.test(priceBubble)) fail("a diagnosztikai bubble nem mondja ki, hogy nincs javítási ár", { ctx });
    } else {
        if (!new RegExp(`\\*\\*[\\d\\s\\u00a0]+Ft-tól\\*\\*`).test(priceBubble)) fail("hiányzik a '... Ft-tól' sor", { ctx, priceBubble });
        if (!/Tájékoztató ár/.test(priceBubble)) fail("hiányzik a 'Tájékoztató ár' címke", { ctx });
    }
    // The customer's bubbles carry the price and nothing else: the workshop's
    // card and the demo panels live under a divider, so that a tester can see
    // where the quote stops.
    if (/Ezt kapná meg a szerviz/.test(d.answer)) fail("a tulajdonosi kártya az ügyfél buborékjai közé került", { ctx });
    if (!d.demo || !/Ezt kapná meg a szerviz/.test(d.demo.owner || "")) fail("hiányzik a tulajdonosi kártya", { ctx });
    if (!d.demo.divider) fail("hiányzik az elválasztó", { ctx });
    if (!d.demo.workings || !d.demo.workings.lines.length) fail("hiányzik a 'Miből jött ki' panel", { ctx });
    if (!d.demo.live || !d.demo.live.lines.length) fail("hiányzik az 'élesben' kártya", { ctx });
    if (!d.scope || !d.scope.lines.length) fail("hiányzik a 'mi van az árban' panel", { ctx });
    // The price bubble must stay short. Itemised lines are the POINT, so they
    // do not count - this guards against the small print creeping back in above
    // the fold, which is what made the old ending a wall.
    const prose = priceBubble.split("\n").filter((l) => l.trim() && !/^• /.test(l));
    if (prose.length > 8) fail(`túl sok szöveg az ár-buborékban (${prose.length} sor)`, { ctx, prose });
    if (!d.form || d.form.action !== "feedback") fail("hiányzik a visszajelzés űrlap", { ctx });
    // A price must never appear before the customer has given their details.
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
for (const sc of FLOW.TEST_SCENARIOS) {
    const answers = sc.answers;
    const d = await run((data) => {
        const field = data.__field || asking(data);
        if (!field) return null;
        const a = answers[field];
        if (a == null) {
            // A question the scenario does not mention: take the first button.
            return (data.chips || [])[0] || TYPED[field] || "nem tudom";
        }
        return Array.isArray(a) ? a.join(MULTI_SEP) : a;
    });
    const ok = checkQuote(d, sc.name);
    if (!ok) continue;
    const total = d.lead.total;
    const flag = total < sc.min ? " <-- TÚL OLCSÓ" : total > sc.max ? " <-- TÚL DRÁGA" : "";
    if (flag) failures++;
    log(`   ${formatHuf(total).padStart(12)}${d.lead.diagnosticOnly ? "  (diagnosztika)" : "-tól"}  ${sc.name}${flag}`);
    if (sc.diagnosticOnly && !d.lead.diagnosticOnly) fail("tünetre árat adott", sc.name);
}

// ---------------------------------------------------------------------------
log("\n3. ŐRÖK");

// A symptom on its own must never produce a repair price.
{
    const d = await run((data) => {
        const field = asking(data);
        if (field === "jobs") return "Valami baja van, nem tudom mi";
        if (field && TYPED[field]) return TYPED[field];
        return (data.chips || [])[0];
    });
    if (d && !d.lead.diagnosticOnly) fail("a tünet-ág javítási árat adott");
    else log("   tünet -> csak diagnosztika, javítási ár nélkül: OK");
}

// A job the shop does not take on: refused, and no lead is collected.
{
    let { data } = await call({ action: "start", state: {} });
    const history = [];
    data = (await call({ question: "Árat szeretnék kérni", history, state: data.state })).data;
    data = (await call({ question: "Más, ami nincs a listában", history, state: data.state })).data;
    if (!/nem vállalja/.test(data.answer || "")) fail("a nem vállalt munkát nem utasította vissza", data.answer);
    else if (data.form) fail("a nem vállalt munkára mégis elkérte az elérhetőséget");
    else log("   nem vállalt munka -> visszautasítva, adatgyűjtés nélkül: OK");
}

// A tampered state cannot smuggle a value into the price model.
{
    const dirty = sanitizeState({
        jobs: "kuplung,__hack", parts_tier: "ingyen", vin: "NEM-EGY-VIN",
        year: "3000", make: "<script>", km: "k999", name: "A\nB",
    });
    if (dirty.parts_tier) fail("érvénytelen alkatrész-kategória átment", dirty);
    if (dirty.vin) fail("érvénytelen alvázszám átment", dirty);
    if (dirty.year) fail("lehetetlen évjárat átment", dirty);
    if (dirty.km) fail("érvénytelen km átment", dirty);
    if (dirty.make) fail("HTML-t tartalmazó márka átment", dirty);
    if (String(dirty.jobs).includes("__hack")) fail("ismeretlen munka átment", dirty);
    if (!String(dirty.jobs).includes("kuplung")) fail("az érvényes munka kiesett", dirty);
    if (/\n/.test(dirty.name || "")) fail("a névben maradt sortörés", dirty);
    log("   meghamisított állapot megtisztítva: OK");
}

// The contact details are asked for, but NEVER before the price and never
// including a phone number. Two mechanics in the first Facebook thread quit at
// the old pre-price form, and the phone field was the part they named.
{
    let phoneAsked = false;
    const d = await run((data) => {
        // Check the FIELD KEYS only, not the reassuring "why" copy that says
        // out loud we do not ask for a phone number - that text legitimately
        // contains the word "telefon".
        const f = data.form;
        if (f && f.action !== "lead" && (f.fields || []).some((x) => x.key === "phone")) phoneAsked = true;
        return randomChoice(data);
    });
    const before = d && d.__beforeContact;
    if (before && ((before.form && before.form.fields) || []).some((x) => x.key === "phone")) phoneAsked = true;
    if (phoneAsked) fail("telefonszámot kért");
    else log("   telefonszámot soha nem kér: OK");
    // The very response that carries the contact form must already carry the
    // price: the number is never held hostage behind the details.
    if (!before || !/Ft-tól|Diagnosztika/.test(before.answer || "")) {
        fail("az elérhetőséget az ár előtt kérte", before && before.answer);
    } else log("   az ár előbb jön, mint az elérhetőség: OK");
    if (!d || !d.done) fail("nem jutott el a végéig", d);
    else if (!/Ügyfél: \*\*/.test(d.demo.owner)) fail("a megadott név nem került rá a szerviz kártyájára");
    else log("   a megadott név megjelenik a szerviz kártyáján: OK");

    // And there is a way to run a second car.
    if (!(d.chips || []).some((c) => /másik autó/i.test(c))) fail("nincs mód új autóra árat kérni");
    else log("   az ár után indítható új kérdés: OK");
}

// A valid VIN is read back with its year, which is the moment the thing proves
// it actually looked at what it was given.
{
    const y = FLOW.vinYear(FLOW.SAMPLE_VIN);
    if (!y) fail("a minta alvázszámból nem jött ki évjárat");
    // The sample VIN must NOT be announced as a real car, and a VIN whose make
    // contradicts what the customer typed must be flagged, not overruled.
    else if (!/minta alvázszám/.test(FLOW.vinNote(FLOW.SAMPLE_VIN, { make: "Volkswagen" }))) fail("a minta alvázszámot valódiként olvasta vissza");
    else if (!/egyezteti/.test(FLOW.vinNote("WVWZZZ1KZ8W123456", { make: "Opel" }))) fail("az eltérő márkájú alvázszámot nem jelezte");
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
    const base = { jobs: "vezermuszij", make: "Volkswagen", model: "Golf", year: "2012", vin: "nincs", km: "k200", vez_vizpumpa: "nem", parts_tier: "markas" };
    const { assembleQuote } = await import("./api/faq-agent.js");
    const petrol = assembleQuote({ ...base, engine: "1.6 benzin" }).total;
    const diesel = assembleQuote({ ...base, engine: "1.6 TDI dízel" }).total;
    if (!(diesel > petrol)) fail("a dízel nem kerül többe, mint a benzines", { petrol, diesel });
    else log(`   dízel (${formatHuf(diesel)}) > benzin (${formatHuf(petrol)}) ugyanarra a munkára: OK`);
}

// A bigger car must cost more labour than a small one, same job, same tier.
{
    const { assembleQuote } = await import("./api/faq-agent.js");
    const base = { jobs: "fek", engine: "2.0 dízel", year: "2012", vin: "nincs", fek_hol: "elso", fek_tarcsa: "betet", parts_tier: "markas" };
    const small = assembleQuote({ ...base, make: "Suzuki", model: "Swift" }).total;
    const big = assembleQuote({ ...base, make: "BMW", model: "5-ös" }).total;
    if (!(big > small)) fail("a felső kategória nem kerül többe", { small, big });
    else log(`   BMW 5-ös (${formatHuf(big)}) > Swift (${formatHuf(small)}) ugyanarra a fékmunkára: OK`);
}

// The accuracy forks that were added specifically because a mechanic would
// check them. Each one has to stay strictly dearer than its cheap counterpart.
{
    const { assembleQuote } = await import("./api/faq-agent.js");
    const cmp = (name, base, cheapPatch, dearPatch) => {
        const cheap = assembleQuote({ ...base, ...cheapPatch }).total;
        const dear = assembleQuote({ ...base, ...dearPatch }).total;
        if (!(dear > cheap)) fail(`${name}: a drágább változat nem került többe`, { cheap, dear });
        else log(`   ${name}: ${formatHuf(cheap)} -> ${formatHuf(dear)}: OK`);
    };
    const car = { make: "Volkswagen", model: "Golf", engine: "1.4 TSI benzin", year: "2017", vin: "nincs", parts_tier: "markas" };
    cmp("lánc a szíjnál drágább", { ...car, jobs: "vezermuszij", km: "k200", vez_vizpumpa: "nem" },
        { vezerles_tipus: "szij" }, { vezerles_tipus: "lanc" });
    cmp("R1234yf gáz a réginél drágább (csak az évjáratból)", { ...car, jobs: "klima", klima_allapot: "gyenge" },
        { year: "2012" }, { year: "2021" });
    cmp("AGM akku a hagyományosnál drágább", { ...car, jobs: "akkumulator" },
        { akku_startstop: "nem" }, { akku_startstop: "igen" });
    cmp("elektromos kézifék munkadíja külön", { ...car, jobs: "fek", fek_hol: "hatso", fek_tarcsa: "betet" },
        { fek_kezifek: "nem" }, { fek_kezifek: "igen" });
    cmp("19 colos kerék szerelése drágább", { ...car, jobs: "gumi", gumi_db: "4" },
        { gumi_meret: "m16" }, { gumi_meret: "m19" });
    cmp("nagyobb motorba több olaj megy", { ...car, jobs: "olajcsere", km: "k150", olaj_szuro: "csak_olaj" },
        { engine: "1.2 benzin" }, { engine: "2.0 TDI dízel" });
    cmp("összkerékhajtású kuplung több munka", { ...car, jobs: "kuplung", kuplung_valto: "manualis", kuplung_ktl: "nem" },
        { kuplung_hajtas: "elso" }, { kuplung_hajtas: "awd" });

    // How many screens it actually takes. Grouping the car details and the job
    // details onto one form each is what pays for the extra accuracy questions,
    // so if a future edit un-groups them this number goes up and the test says
    // so out loud.
    // munka, márka, típus, motor, ALVÁZSZÁM, autó-űrlap, munka-űrlap,
    // elérhetőség = 8, plus one for a conditional follow-up or a second job.
    // The budget is here to catch a future edit that un-groups the forms, not to
    // forbid a deliberate screen: the alvázszám got its own back on purpose,
    // because it is the field that decides which part the shop can order.
    const SCREEN_BUDGET = 9;
    for (const sc of FLOW.TEST_SCENARIOS) {
        const d = await run((data) => {
            const field = data.__field || asking(data);
            if (!field) return null;
            const a = sc.answers[field];
            if (a == null) return (data.chips || [])[0] || TYPED[field] || "nem tudom";
            return Array.isArray(a) ? a.join(MULTI_SEP) : a;
        });
        if (!d || !d.__steps) continue;
        if (d.__steps > SCREEN_BUDGET) fail(`túl sok képernyő (${d.__steps})`, sc.name);
        else log(`   ${String(d.__steps).padStart(2)} képernyő: ${sc.name}`);
    }

    // A "nem tudom" must land on the TYPICAL case, not the cheapest one. A
    // quote built from the cheapest answer to every unknown is a best case that
    // never happens, and the customer meets the real number at the counter -
    // which is the single worst outcome this tool can produce.
    {
        const base = { make: "Volkswagen", model: "Passat", engine: "2.0 TDI dízel", year: "2012", vin: "nincs" };
        // Parts tier: unknown must price as the middle tier, not the cheapest.
        const job = { ...base, jobs: "fek", fek_hol: "elso", fek_tarcsa: "betet" };
        const cheapest = assembleQuote({ ...job, parts_tier: "utangyartott" }).total;
        const middle = assembleQuote({ ...job, parts_tier: "markas" }).total;
        const unknown = assembleQuote({ ...job, parts_tier: "nem_tudom" }).total;
        if (unknown === cheapest) fail("a 'nem tudom' alkatrész-kategória a legolcsóbbal számolt", { unknown, cheapest });
        else if (unknown !== middle) fail("a 'nem tudom' nem a középső kategóriával számolt", { unknown, middle });
        else log(`   ismeretlen alkatrész-kategória -> középső (${formatHuf(unknown)}), nem a legolcsóbb (${formatHuf(cheapest)}): OK`);

        // Dual-mass flywheel: unknown on a modern diesel must assume it IS there.
        const clutch = { ...base, jobs: "kuplung", kuplung_valto: "manualis", kuplung_hajtas: "elso", parts_tier: "markas" };
        const noKtl = assembleQuote({ ...clutch, kuplung_ktl: "nem" }).total;
        const unknownKtl = assembleQuote({ ...clutch, kuplung_ktl: "nem_tudom" }).total;
        if (unknownKtl <= noKtl) fail("modern dízelnél a 'nem tudom' elhagyta a kettőstömegű lendkereket", { unknownKtl, noKtl });
        else log(`   ismeretlen lendkerék 2005+ dízelnél -> beleszámol (${formatHuf(unknownKtl)} vs ${formatHuf(noKtl)}): OK`);
        // ...but on an old petrol it must NOT invent one.
        const oldPetrol = assembleQuote({ ...clutch, engine: "1.6 benzin", year: "2002", kuplung_ktl: "nem_tudom" }).total;
        const oldPetrolNo = assembleQuote({ ...clutch, engine: "1.6 benzin", year: "2002", kuplung_ktl: "nem" }).total;
        if (oldPetrol !== oldPetrolNo) fail("régi benzinesnél kitalált egy kettőstömegű lendkereket", { oldPetrol, oldPetrolNo });
        else log("   régi benzinesnél nem talál ki lendkereket: OK");

        // Every assumption the model makes has to be written down for the
        // customer - an invisible assumption is what blows up at the counter.
        const q = assembleQuote({ ...clutch, kuplung_ktl: "nem_tudom", parts_tier: "nem_tudom" });
        if (q.assumed.length < 2) fail("nem írta le, mit feltételezett", q.assumed);
        else log(`   a feltételezéseket kiírja (${q.assumed.length} db): OK`);
    }
}

log(`\n${failures ? `${failures} HIBA` : "MINDEN TESZT RENDBEN"}\n`);
if (quiet) console.log = quiet;
console.log(failures ? `test-flow: ${failures} hiba (futtasd --verbose kapcsolóval a részletekért)` : "test-flow: minden rendben");
process.exit(failures ? 1 : 0);
