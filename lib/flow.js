// ============================================================================
//  AUTOSZERVIZ - árajánlat-készítő A SZERELŐNEK (prototípus)
//
//  WHO IS ON THE OTHER END OF THE SCREEN.
//  Not the customer. The workshop owner, sitting at his own computer, AFTER he
//  has had the car on the lift and knows what the job is. That single fact
//  decides everything else in this file:
//
//   - Nothing is assumed. The earlier, customer-facing build had to guess at a
//     dual-mass flywheel or an AGM battery, because a car owner genuinely does
//     not know. This one does not guess about anything, because the person
//     answering has already looked. Every "Nem tudom" option is gone.
//   - Nothing is a floor. The old output was "X Ft-tól" plus a list of what
//     might push it up, because a price given before anyone saw the car cannot
//     honestly be more than a starting point. This one is a FINAL, itemised
//     quote - the number he hands the customer.
//   - The shop never configures anything. Every client gets this file built
//     for them: their hourly rates, VAT status and name go in SHOP below, their
//     prices in `A` and `N`. What the mechanic CAN do is adjust a single quote
//     - more hours on this car, a different part price - on the tételek screen,
//     because that is using the tool, not setting it up.
//
//  WHY THE LINES ARE EDITABLE, AND WHY THAT IS THE PRODUCT.
//  A workshop's real quote is labour + parts. Labour comes from a normaidő
//  table (Autodata, Mitchell, MOTOR), parts from a supplier catalogue keyed by
//  part number (TecDoc and the like). Both are licensed commercial data, and
//  this prototype has neither. So it does the honest thing: it proposes a
//  normaidő and a part price, and lets the mechanic type over them. He is the
//  one standing next to the car - his number beats the table's number every
//  time, and the tool's job is to do the arithmetic and the paperwork, not to
//  tell him his trade.
//
//  That is also exactly the seam where the live version plugs in: the proposal
//  side gets replaced by real licensed data, and the edit screen stays as the
//  override it already is.
//
//  ---------------------------------------------------------------------------
//  THIS BUILD IS A SAMPLE SHOP. The numbers are 2026 Hungarian market
//  averages, not any real workshop's. A client build replaces SHOP, `A` and
//  `N` with that workshop's own figures; nothing else changes.
//  Amounts are NET; ÁFA is added at the end unless the shop is alanyi adómentes.
//  ---------------------------------------------------------------------------
// ============================================================================
import { MAKES, TOP_MAKES, modelNames, engineNames, fuelOf, classOf, displacementOf, CLASS_MULT, CLASS_LABEL, vinLooksValid, vinYear, vinMake, SAMPLE_VIN } from "./cars.js";

export const BOT = {
    id: "autoszerviz-szerelo",
    service: "autójavítás és szerviz",
    // The prototype has no real workshop behind it. The phone number is Milán's,
    // because someone in the group will ring it and should reach a person.
    phone: "+36 70 250 1739",
    // Where finished quotes and mechanics feedback go. Set LEAD_EMAIL_TO in the
    // environment - it is deliberately not hardcoded, because this repo is public.
    email: "",
    maker: "Landscale Agency",
    city: "Budapest",
};

export const SAMPLE_NOTICE =
    "Ez egy minta szerviz, piaci átlagárakkal. A tiédbe a te óradíjad, a te árlistád és a te munkáid kerülnek - azt én építem be, neked nem kell semmit beállítanod.";

// ---------------------------------------------------------------------------
//  THE SHOP. One block per client, filled in when the tool is built for them.
// ---------------------------------------------------------------------------
export const SHOP = {
    name: "Minta Autószerviz",
    // Net Ft per hour, by the kind of work - the way a real price list splits it.
    rates: {
        altalanos: 12000,     // általános szerelés
        diagnosztika: 14000,  // műszeres diagnosztika
        futomu: 13000,        // futóműpad
        gumi: 8000,           // gumis munka
    },
    // 0 for an alanyi adómentes workshop.
    vat: 0.27,
};

const P = {
    // Consumables, cleaner, thread lock, brake fluid drips: a share of labour.
    // Overridable like any other line once the quote is on screen.
    aproanyag_szazalek: 0.08,
    aproanyag_min: 2000,
    // Parts scale with the car too, but less steeply than labour does.
    alkatresz_szorzo: { kis: 0.85, kozep: 1, felso: 1.5, terepjaro: 1.2 },
};

// Suggested NET part prices for a middle-class reference car, by tier - what
// the shop would put on the invoice, not what it pays the supplier. The
// mechanic types over any of them on the tételek screen.
//
// ANCHORED to real Hungarian webshop listings, checked 2026-09. Those are GROSS
// retail prices, so each figure here is the listing divided by 1.27 and rounded
// to the cheap side of its band:
//   - vezérműszíj készlet VÍZPUMPÁVAL, márkás: INA 530 0171 31 28 050 Ft,
//     GATES 5623XS 41 660 Ft, INA 530 0091 31 47 936 Ft.
//   - kuplung szett, márkás: SACHS 3000 950 072 75 945 Ft, SACHS 2290 602 004
//     126 010 Ft. Kit WITH dual-mass flywheel: LuK 600 0271 00 267 238 Ft.
//   - féktárcsa: TRW első tárcsa Opel Astra G 14 490 Ft/db, azaz ~29 000 Ft/pár.
//   - akkumulátor, Bosch: 26 211 - 59 719 Ft a tartomány, az AGM a felső vége.
const A = {
    olaj_liter:       { utangyartott: 1800,  markas: 2600,  gyari: 3800 },  // motorolaj, Ft/liter
    olajszuro:        { utangyartott: 1800,  markas: 3000,  gyari: 5200 },
    szuro_keszlet:    { utangyartott: 6000,  markas: 9000,  gyari: 14000 }, // levegő + pollen + üzemanyag
    fekbetet:         { utangyartott: 9000,  markas: 15000, gyari: 26000 }, // tengelyenként
    fektarcsa:        { utangyartott: 14000, markas: 23000, gyari: 40000 }, // tengelyenként, pár
    vezermuszij_keszlet: { utangyartott: 13000, markas: 22000, gyari: 38000 },
    vezermulanc_keszlet: { utangyartott: 32000, markas: 55000, gyari: 95000 },
    vizpumpa:         { utangyartott: 7000,  markas: 11000, gyari: 20000 },
    kuplung_szett:    { utangyartott: 45000, markas: 70000, gyari: 120000 },
    ktl_lendkerek:    { utangyartott: 95000, markas: 140000, gyari: 230000 },
    kipufogo_dob:     { utangyartott: 18000, markas: 30000, gyari: 55000 },
    katalizator:      { utangyartott: 60000, markas: 110000, gyari: 210000 },
    akkumulator:      { utangyartott: 17000, markas: 25000, gyari: 38000 },
    akkumulator_agm:  { utangyartott: 34000, markas: 45000, gyari: 65000 },  // start-stop (AGM/EFB)
    klimagaz_r134a:   { utangyartott: 9000,  markas: 9000,  gyari: 9000 },   // 500 g-ig
    klimagaz_yf:      { utangyartott: 31000, markas: 31000, gyari: 31000 },  // R1234yf, 500 g-ig
};

// Normaidő (hours) for a middle-class reference car, multiplied by the car's
// class factor from cars.js. A PROPOSAL: the mechanic overrides it per job on
// the tételek screen, which is where his own experience of this car goes in.
const N = {
    olajcsere:   { benzin: 0.5, dizel: 0.6 },
    fek_tengely: { benzin: 1.0, dizel: 1.0 },
    fek_tarcsa_extra: { benzin: 0.4, dizel: 0.4 },
    fek_ekezifek_extra: { benzin: 0.4, dizel: 0.4 },
    vezermuszij: { benzin: 3.0, dizel: 4.0 },
    vezermulanc: { benzin: 5.0, dizel: 6.5 },
    vizpumpa_extra: { benzin: 0.5, dizel: 0.5 },
    kuplung:     { benzin: 4.5, dizel: 5.5 },
    kuplung_automata_extra: { benzin: 1.5, dizel: 1.5 },
    kuplung_awd_extra: { benzin: 1.5, dizel: 1.5 },
    kipufogo:    { benzin: 1.0, dizel: 1.0 },
    katalizator: { benzin: 1.5, dizel: 1.5 },
    akkumulator: { benzin: 0.3, dizel: 0.3 },
    klima:       { benzin: 0.7, dizel: 0.7 },
    vizsga:      { benzin: 1.0, dizel: 1.0 },
    futomu:      { benzin: 1.0, dizel: 1.0 },
    gumi:        { benzin: 0.6, dizel: 0.6 },
    diagnosztika: { benzin: 1.0, dizel: 1.0 },
    egyeb:       { benzin: 1.0, dizel: 1.0 },
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------
const opt = (label, value, extra) => ({ label, value, ...extra });
export const list = (sel, field) => String(sel[field] || "").split(",").filter(Boolean);
const hasJob = (sel, j) => list(sel, "jobs").includes(j);
const num = (n) => String(Math.round(n * 100) / 100).replace(".", ",");

function optionOf(field, sel) {
    const f = FIELDS[field];
    if (!f) return null;
    const opts = typeof f.options === "function" ? f.options(sel) : f.options;
    return (opts || []).find((o) => o.value === sel[field]) || null;
}
const labelOf = (field, sel) => (optionOf(field, sel) || {}).label || "";

const PLACEHOLDER = new Set(["__egyeb", "nincs"]);
export function carLine(sel) {
    const year = labelOf("year", sel) || String(sel.year || "");
    const bits = [sel.make, sel.model, year, sel.engine]
        .map((x) => String(x || "").trim())
        .filter((x) => x && !PLACEHOLDER.has(x));
    return bits.join(" ") || "ismeretlen autó";
}
const fuel = (sel) => fuelOf(sel.engine);
const klass = (sel) => classOf(sel.make, sel.model);
const labourK = (sel) => CLASS_MULT[klass(sel)] ?? 1;
const partsK = (sel) => P.alkatresz_szorzo[klass(sel)] ?? 1;
// The tier is always answered now - the mechanic knows what he is fitting -
// but the fallback stays mid-tier rather than cheapest, so a state that somehow
// arrives without it does not quietly produce the lowest possible number.
const tier = (sel) => (["utangyartott", "markas", "gyari"].includes(sel.parts_tier) ? sel.parts_tier : "markas");
const hours = (key, sel) => (N[key] ? N[key][fuel(sel)] ?? N[key].benzin : 0) * labourK(sel);
const part = (key, sel) => (A[key] ? A[key][tier(sel)] : 0) * partsK(sel);

const yearOf = (sel) => {
    const n = parseInt(String(sel.year || ""), 10);
    return Number.isFinite(n) && n > 1970 ? n : 0;
};

// How much oil the engine takes, from its displacement. Still derived rather
// than asked: it is arithmetic off a number already on screen, and the mechanic
// can change the price per litre on the tételek screen like any other figure.
function oilLitres(sel) {
    const d = displacementOf(sel.engine, klass(sel));
    const base = d < 1.4 ? 4 : d < 2.1 ? 4.5 : d < 3.1 ? 6 : 7.5;
    return fuel(sel) === "dizel" ? base + 0.5 : base;
}

// Everything type-approved from 2017 on uses R1234yf, which costs several times
// what R134a does. Derived from the model year the mechanic already gave.
const usesNewGas = (sel) => yearOf(sel) >= 2017;

// An electric parking brake is real extra time on a REAR brake job. Only put to
// somebody working on a car new enough to have one.
const mayHaveEpb = (sel) => yearOf(sel) >= 2010;

export const TIER_LABEL = {
    utangyartott: "utángyártott",
    markas: "márkás utángyártott (Bosch, TRW, Febi)",
    gyari: "gyári (OEM)",
};

// ---------------------------------------------------------------------------
//  THE JOBS
//  Two differences from the customer-facing build, both because a mechanic is
//  answering: a symptom is now a BILLABLE diagnostic line rather than a refusal
//  to quote, and "egyéb" is no longer a dead end - he names the work and prices
//  it himself, which is what an open-ended trade actually needs.
// ---------------------------------------------------------------------------
export const JOBS = {
    olajcsere:   { label: "Olajcsere, szűrőcsere", rate: "altalanos", parts: true, km: true, fields: ["olaj_szuro"] },
    fek:         { label: "Fék (betét, tárcsa)", rate: "altalanos", parts: true, fields: ["fek_hol", "fek_tarcsa"] },
    vezermuszij: { label: "Vezérlés csere (szíj vagy lánc)", rate: "altalanos", parts: true, km: true, fields: ["vezerles_tipus", "vez_vizpumpa"] },
    kuplung:     { label: "Kuplungcsere", rate: "altalanos", parts: true, fields: ["kuplung_valto", "kuplung_ktl", "kuplung_hajtas"] },
    kipufogo:    { label: "Kipufogó", rate: "altalanos", parts: true, fields: ["kipufogo_resz"] },
    akkumulator: { label: "Akkumulátorcsere", rate: "altalanos", parts: true, fields: ["akku_startstop"] },
    klima:       { label: "Klíma (töltés, fertőtlenítés)", rate: "altalanos", parts: true, fields: ["klima_allapot"] },
    vizsga:      { label: "Műszaki vizsga előkészítés", rate: "altalanos", parts: false, km: true, fields: [] },
    futomu:      { label: "Futómű-beállítás", rate: "futomu", parts: false, fields: [] },
    gumi:        { label: "Gumiszerelés, centírozás", rate: "gumi", parts: false, fields: ["gumi_db", "gumi_meret"] },
    diagnosztika: { label: "Diagnosztika, hibakeresés", rate: "diagnosztika", parts: false, fields: [] },
    egyeb:       { label: "Egyéb munka (én írom be)", rate: "altalanos", parts: false, fields: ["egyeb_munka"] },
};

const jobsOf = (sel) => list(sel, "jobs").filter((j) => JOBS[j]);
const needsKm = (sel) => jobsOf(sel).some((j) => JOBS[j].km);
const needsTier = (sel) => jobsOf(sel).some((j) => JOBS[j].parts);

// Follow-ups that only become relevant once an earlier answer is in.
const CONDITIONAL = {
    fek_kezifek: (sel) => hasJob(sel, "fek") && ["hatso", "mindketto"].includes(sel.fek_hol) && mayHaveEpb(sel),
};

export function detailFields(sel) {
    const out = [];
    for (const j of jobsOf(sel)) {
        for (const f of JOBS[j].fields || []) {
            if (!out.includes(f) && !CONDITIONAL[f]) out.push(f);
        }
    }
    return out;
}

// Questions that travel together on one screen.
export const GROUPS = [
    {
        key: "car",
        title: "Milyen autó?",
        why: "Kezdd el írni a márkát, a többit felkínálja. Ha nincs a listában, írd be nyugodtan.",
        submit: "Mehet tovább",
        fields: (sel) => ["make", "model", "engine", "year", ...(needsKm(sel) ? ["km"] : [])],
    },
    {
        key: "detail",
        title: "A munkáról",
        why: "Láttad az autót, szóval ezekre tudod a választ - ezért nincs is „nem tudom” válasz. Ebből jön ki a normaidő és az alkatrészkészlet.",
        submit: "Mehet, jöhetnek a tételek",
        fields: (sel) => [...detailFields(sel), ...(needsTier(sel) ? ["parts_tier"] : [])],
    },
];
function conditionalFields(sel) {
    return Object.keys(CONDITIONAL).filter((f) => CONDITIONAL[f](sel));
}

// Nothing is blocked any more. The customer-facing build refused jobs the shop
// does not take on; here the shop IS the user, so an unlisted job is just a
// line he names and prices himself.
export function blocked() {
    return null;
}

// ---------------------------------------------------------------------------
//  QUESTIONS
//  Note what is NOT here: a "Nem tudom" option. The person answering has had
//  the car on the lift, so every one of these has a real answer, and offering
//  him an escape hatch would only put a guess into his own invoice.
// ---------------------------------------------------------------------------
const KM_BANDS = [
    opt("100 000 km alatt", "k100", { km: 80000 }),
    opt("100–150 000 km", "k150", { km: 100000 }),
    opt("150–200 000 km", "k200", { km: 150000 }),
    opt("200–300 000 km", "k300", { km: 200000 }),
    opt("300 000 km felett", "k300p", { km: 300000 }),
];

export const FIELDS = {
    // --- The job ------------------------------------------------------------
    jobs: {
        type: "multi",
        short: "Munka",
        q: "Mit csinálsz az autón?",
        hint: "Több is lehet. Amit nem találsz a listában, az az „Egyéb munka”.",
        options: Object.entries(JOBS).map(([v, j]) => opt(j.label, v)),
        values: Object.keys(JOBS),
    },

    make: {
        short: "Márka",
        q: "Márka",
        placeholder: "pl. Mercedes",
        hint: null,
        options: TOP_MAKES.map((n) => opt(n, n)).concat([opt("Egyéb márka (beírom)", "__egyeb")]),
        values: MAKES.map((mk) => mk.name).concat(["__egyeb"]),
        free: true,
    },

    model: {
        short: "Típus",
        q: "Típus",
        placeholder: "pl. C-osztály",
        hint: null,
        options: (sel) => {
            const names = modelNames(sel.make);
            return (names.length ? names : []).map((n) => opt(n, n)).concat([opt("Egyéb típus (beírom)", "__egyeb")]);
        },
        values: [...new Set(MAKES.flatMap((mk) => mk.models.map((md) => md.name)))].concat(["__egyeb"]),
        free: true,
    },

    engine: {
        short: "Motor",
        q: "Motor",
        placeholder: "pl. 2.0 CDI dízel",
        hint: "Ez mozgatja a normaidőt és az olajmennyiséget.",
        options: (sel) => {
            const eng = engineNames(sel.make, sel.model);
            return (eng.length ? eng : ["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.6 benzin", "2.0 benzin", "1.5 dízel", "1.6 dízel", "1.9 dízel", "2.0 dízel"])
                .map((n) => opt(n, n));
        },
        values: [...new Set(MAKES.flatMap((mk) => mk.models.flatMap((md) => md.engines)))]
            .concat(["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.6 benzin", "2.0 benzin", "1.5 dízel", "1.6 dízel", "1.9 dízel", "2.0 dízel"]),
        free: true,
    },

    year: {
        type: "year",
        short: "Évjárat",
        q: "Évjárat",
        hint: "Elég a sáv - ebből jön a klímagáz fajtája és az elektromos kézifék.",
        options: [
            opt("2020 vagy újabb", "2021"), opt("2015–2019", "2017"), opt("2010–2014", "2012"),
            opt("2005–2009", "2007"), opt("2005 előtti", "2002"),
        ],
        values: ["2021", "2017", "2012", "2007", "2002"],
        free: true,
    },

    vin: {
        type: "vin",
        short: "Alvázszám",
        q: "Alvázszám",
        hint: "Rákerül az ajánlatra, hogy a rendelésnél ne kelljen újra kikeresni. Üresen is hagyhatod.",
        options: [
            opt("Most nem írom be", "nincs"),
            opt("Beírok egy mintát (prototípus)", "__minta"),
        ],
        values: ["nincs", "__minta"],
        free: true,
    },

    km: {
        short: "Kilométeróra",
        q: "Kilométeróra",
        options: KM_BANDS,
        values: KM_BANDS.map((o) => o.value),
    },

    // --- Job details. No "Nem tudom" anywhere: he has seen the car. ---------
    olaj_szuro: {
        short: "Szűrők",
        q: "Melyik szűrők mennek bele?",
        options: [opt("Minden szűrő (levegő, pollen, üzemanyag)", "mind"), opt("Csak az olajszűrő", "csak_olaj")],
    },
    fek_hol: {
        short: "Melyik fék",
        q: "Melyik tengelyen?",
        options: [opt("Első", "elso"), opt("Hátsó", "hatso"), opt("Mind a kettő", "mindketto")],
    },
    fek_tarcsa: {
        short: "Tárcsa is",
        q: "Tárcsa is megy, vagy csak betét?",
        options: [opt("Csak betét", "betet"), opt("Betét és tárcsa", "betet_tarcsa")],
    },
    fek_kezifek: {
        short: "Elektromos kézifék",
        q: "Elektromos kézifék van benne?",
        hint: "Teszteres visszaállítás, plusz munkaidő a hátsó féken.",
        options: [opt("Igen", "igen"), opt("Nem", "nem")],
    },
    vezerles_tipus: {
        short: "Szíj vagy lánc",
        q: "Vezérműszíj vagy vezérműlánc?",
        options: [opt("Szíj", "szij"), opt("Lánc", "lanc")],
    },
    vez_vizpumpa: {
        short: "Vízpumpa",
        q: "Vízpumpa megy vele?",
        options: [opt("Igen", "igen"), opt("Nem", "nem")],
    },
    kuplung_valto: {
        short: "Váltó",
        q: "Manuális vagy automata váltó?",
        options: [opt("Manuális", "manualis"), opt("Automata", "automata")],
    },
    kuplung_ktl: {
        short: "Kettőstömegű lendkerék",
        q: "Kettőstömegű lendkerék megy bele?",
        options: [opt("Igen", "igen"), opt("Nem", "nem")],
    },
    kuplung_hajtas: {
        short: "Hajtás",
        q: "Első- vagy összkerékhajtás?",
        options: [opt("Elsőkerék", "elso"), opt("Összkerék (4x4, quattro, xDrive)", "awd")],
    },
    kipufogo_resz: {
        short: "Kipufogó része",
        q: "A kipufogó melyik része?",
        options: [opt("Hátsó dob", "hatso"), opt("Középső dob", "kozep"), opt("Katalizátor / részecskeszűrő", "kat")],
    },
    akku_startstop: {
        short: "Start-stop",
        q: "Start-stop rendszer van benne?",
        hint: "Ilyenkor AGM akkumulátor kell.",
        options: [opt("Igen, AGM kell", "igen"), opt("Nincs", "nem")],
    },
    klima_allapot: {
        short: "Klíma állapota",
        q: "Mit találtál a klímán?",
        options: [opt("Csak fogyott, tölthető", "gyenge"), opt("Szivárog, előbb javítás kell", "nem_hut"), opt("Jó, csak karbantartás", "karban")],
    },
    gumi_db: {
        short: "Kerekek",
        q: "Hány kerék?",
        options: [opt("4 kerék", "4"), opt("2 kerék", "2")],
    },
    gumi_meret: {
        short: "Keréktárcsa",
        q: "Mekkora keréktárcsa?",
        options: [opt("16 coll vagy kisebb", "m16"), opt("17–18 coll", "m18"), opt("19 coll vagy nagyobb", "m19")],
    },
    egyeb_munka: {
        type: "text",
        short: "Egyéb munka",
        q: "Mi az a munka?",
        hint: "Ahogy az ügyfél ajánlatán szerepeljen. Az óraszámot és az alkatrészt a tételeknél adod meg.",
        placeholder: "pl. Bal első lengőkar csere",
        options: [],
        free: true,
    },

    parts_tier: {
        short: "Alkatrész",
        q: "Milyen alkatrészt építesz be?",
        hint: "Ebből jön az alkatrészárak alapértelmezése - a tételeknél mindet átírhatod.",
        options: [
            opt("Utángyártott", "utangyartott"),
            opt("Márkás utángyártott (Bosch, TRW, Febi)", "markas"),
            opt("Gyári (OEM)", "gyari"),
        ],
        values: ["utangyartott", "markas", "gyari"],
    },

    // --- The edit screen. Not a question: the engine renders the priced lines
    // as a form, and this key holds whatever came back. ---------------------
    tetelek: {
        type: "tetelek",
        short: "Tételek",
        q: "A tételek",
        options: [],
        values: [],
    },
};

export const CATALOG = Object.fromEntries(
    MAKES.map((mk) => [mk.name, Object.fromEntries(mk.models.map((md) => [md.name, md.engines]))])
);

// The tételek screen is always last: it can only be built once every question
// that decides WHICH lines exist has been answered.
export function fieldOrder(sel) {
    const base = ["jobs"];
    const jobs = jobsOf(sel);
    if (!jobs.length) return base;
    base.push("make", "model", "engine", "year");
    if (needsKm(sel)) base.push("km");
    base.push("vin");
    base.push(...detailFields(sel));
    base.push(...conditionalFields(sel));
    if (needsTier(sel)) base.push("parts_tier");
    base.push("tetelek");
    return base;
}

export function title(sel) {
    const jobs = jobsOf(sel);
    if (!jobs.length) return "Autószerviz";
    const name = (j) => (j === "egyeb" && sel.egyeb_munka ? String(sel.egyeb_munka) : JOBS[j].label);
    if (jobs.length === 1) return name(jobs[0]);
    return jobs.map(name).join(" + ");
}

// ---------------------------------------------------------------------------
//  The one note per quote - and for a mechanic it is NOT an explanation of his
//  own trade. It is the line that most often gets left off an invoice: work
//  that is already open, already paid for in labour, and billable now or at
//  double the cost later. A shop owner reads that as money, not as a lecture.
// ---------------------------------------------------------------------------
export function billingNote(sel) {
    if (hasJob(sel, "vezermuszij") && sel.vez_vizpumpa !== "igen") {
        return "A vízpumpa most ugyanazzal a munkadíjjal menne - külön alkalommal az egész bontás újra kijön. Érdemes ráírni opcióként.";
    }
    if (hasJob(sel, "vezermuszij") && sel.vez_vizpumpa === "igen") {
        return "Hűtőfolyadék és a hosszbordás szíj: ezek szoktak lemaradni a vezérlés melletti számláról.";
    }
    if (hasJob(sel, "kuplung") && sel.kuplung_ktl !== "igen") {
        return "Ha bontás közben mégis kopott a kettőstömegű, vedd fel külön sorként - utólag beírni mindig rosszabb.";
    }
    if (hasJob(sel, "fek") && sel.fek_tarcsa !== "betet_tarcsa") {
        return "Fékfolyadék és a tárcsa vastagságmérése: ha a tárcsa a határon van, jobb most opcióként ráírni.";
    }
    if (hasJob(sel, "olajcsere")) {
        return "Olajcserénél a fáradt olaj kezelési díja és az alátétgyűrű az, ami a leggyakrabban lemarad.";
    }
    if (hasJob(sel, "klima")) {
        return "Nyomáspróba és a szárítószűrő: töltésnél ezt szokták nem kiszámlázni.";
    }
    return null;
}

// ---------------------------------------------------------------------------
//  OVERRIDES - what the mechanic typed over the proposal.
//  Stored in state as one JSON string, because every other state value is a
//  string and this keeps the sanitiser simple. Shape:
//    { ora: { "<itemKey>": <hours> }, ar: { "<itemKey>": <net Ft> },
//      extra: [ { label, amount } ] }
// ---------------------------------------------------------------------------
const MAX_EXTRA = 12;
export function parseOverrides(raw) {
    const empty = { ora: {}, ar: {}, extra: [] };
    if (!raw) return empty;
    let o = raw;
    if (typeof raw === "string") {
        try { o = JSON.parse(raw); } catch (e) { return empty; }
    }
    if (!o || typeof o !== "object") return empty;
    const numOr = (v, max) => {
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
    };
    const out = { ora: {}, ar: {}, extra: [] };
    for (const k of Object.keys(o.ora || {}).slice(0, 60)) {
        const n = numOr(o.ora[k], 200);
        if (n != null) out.ora[String(k).slice(0, 60)] = n;
    }
    for (const k of Object.keys(o.ar || {}).slice(0, 60)) {
        const n = numOr(o.ar[k], 20000000);
        if (n != null) out.ar[String(k).slice(0, 60)] = n;
    }
    if (Array.isArray(o.extra)) {
        for (const e of o.extra.slice(0, MAX_EXTRA)) {
            if (!e || typeof e !== "object") continue;
            const label = String(e.label == null ? "" : e.label).replace(/[\r\n]+/g, " ").trim().slice(0, 120);
            const amount = numOr(e.amount, 20000000);
            if (label && amount != null && amount > 0) out.extra.push({ label, amount });
        }
    }
    return out;
}
export const serializeOverrides = (ov) => JSON.stringify(ov || { ora: {}, ar: {}, extra: [] });

// ---------------------------------------------------------------------------
//  QUOTE
//  Returns NET amounts. Every line carries a stable `key`, so the edit screen
//  can address it and the mechanic's own figure can replace the proposal.
//  `kind` is what the edit screen renders: a labour line is edited in hours, a
//  part line in forints.
// ---------------------------------------------------------------------------
export function buildQuote(sel, { money, itemMoney } = {}) {
    const fmt = money || ((n) => `${Math.round(n)} Ft`);
    const ifmt = itemMoney || fmt;
    const jobs = jobsOf(sel);
    const ov = parseOverrides(sel.tetelek);
    const R = SHOP.rates;
    const items = [];
    const workings = [];
    const notes = [];
    const t = tier(sel);
    const cls = klass(sel);

    const addLabour = (key, label, proposedHours, rateKey) => {
        const rate = R[rateKey] || R.altalanos;
        const proposed = Math.round(proposedHours * 100) / 100;
        const h = ov.ora[key] != null ? ov.ora[key] : proposed;
        const edited = ov.ora[key] != null && Math.abs(ov.ora[key] - proposed) > 0.001;
        const amount = h * rate;
        items.push({ key, kind: "munka", label, amount, hours: h, proposedHours: proposed, rate, rateKey, edited });
        workings.push(`${label}: ${num(h)} óra × ${fmt(rate)}/óra = ${ifmt(amount)}${edited ? " (a te óraszámoddal)" : ""}`);
        return amount;
    };
    const addPart = (key, label, priceKey, qty = 1, unitBase) => {
        const base = unitBase != null ? unitBase : part(priceKey, sel);
        if (base <= 0 && ov.ar[key] == null) return 0;
        const proposed = Math.round(base);
        const unit = ov.ar[key] != null ? ov.ar[key] : proposed;
        const edited = ov.ar[key] != null && Math.abs(ov.ar[key] - proposed) > 0.5;
        const amount = unit * qty;
        items.push({ key, kind: "alkatresz", label, amount, unit, proposedUnit: proposed, qty, edited });
        workings.push(`${label}: ${qty > 1 ? `${num(qty)} × ` : ""}${fmt(unit)}${edited ? " (a te árad)" : ` (${TIER_LABEL[t]}, ${CLASS_LABEL[cls]} szorzóval)`} = ${ifmt(amount)}`);
        return amount;
    };

    let labourTotal = 0;

    if (jobs.length) {
        workings.push(`Autó: ${carLine(sel)} - ${CLASS_LABEL[cls]}, normaidő-szorzó ×${CLASS_MULT[cls]}, ${fuel(sel)} motor`);
    }

    for (const j of jobs) {
        const J = JOBS[j];
        if (j === "olajcsere") {
            labourTotal += addLabour("ora:olajcsere", J.label, hours("olajcsere", sel), J.rate);
            const litres = oilLitres(sel);
            addPart("ar:olaj", `Motorolaj, ${num(litres)} liter`, null, litres, A.olaj_liter[t] * partsK(sel));
            addPart("ar:olajszuro", "Olajszűrő", "olajszuro");
            if (sel.olaj_szuro !== "csak_olaj") addPart("ar:szuro_keszlet", "Levegő-, pollen- és üzemanyagszűrő", "szuro_keszlet");
        } else if (j === "fek") {
            const axles = sel.fek_hol === "mindketto" ? 2 : 1;
            const withDisc = sel.fek_tarcsa === "betet_tarcsa";
            const epb = sel.fek_kezifek === "igen";
            let h = hours("fek_tengely", sel) * axles;
            if (withDisc) h += hours("fek_tarcsa_extra", sel) * axles;
            if (epb) h += hours("fek_ekezifek_extra", sel);
            const where = sel.fek_hol === "mindketto" ? "mindkét tengely"
                : sel.fek_hol === "hatso" ? "hátsó tengely" : "első tengely";
            labourTotal += addLabour("ora:fek",
                `${withDisc ? "Fékbetét és féktárcsa csere" : "Fékbetét csere"}, ${where}${epb ? ", elektromos kézifékkel" : ""}`, h, J.rate);
            addPart("ar:fekbetet", `Fékbetét${axles === 2 ? " (2 tengely)" : ""}`, "fekbetet", axles);
            if (withDisc) addPart("ar:fektarcsa", `Féktárcsa${axles === 2 ? " (2 tengely)" : ""}`, "fektarcsa", axles);
        } else if (j === "vezermuszij") {
            const chain = sel.vezerles_tipus === "lanc";
            const pump = sel.vez_vizpumpa === "igen";
            let h = hours(chain ? "vezermulanc" : "vezermuszij", sel);
            if (pump) h += hours("vizpumpa_extra", sel);
            labourTotal += addLabour("ora:vezerles",
                (chain ? "Vezérműlánc csere" : "Vezérműszíj csere") + (pump ? " vízpumpával" : ""), h, J.rate);
            if (chain) addPart("ar:vezermulanc", "Vezérműlánc készlet (lánc, feszítő, sínek)", "vezermulanc_keszlet");
            else addPart("ar:vezermuszij", "Vezérműszíj készlet (szíj, feszítő, görgők)", "vezermuszij_keszlet");
            if (pump) addPart("ar:vizpumpa", "Vízpumpa", "vizpumpa");
        } else if (j === "kuplung") {
            const auto = sel.kuplung_valto === "automata";
            const awd = sel.kuplung_hajtas === "awd";
            let h = hours("kuplung", sel);
            if (auto) h += hours("kuplung_automata_extra", sel);
            if (awd) h += hours("kuplung_awd_extra", sel);
            labourTotal += addLabour("ora:kuplung", J.label + (auto ? " (automata)" : "") + (awd ? ", összkerékhajtás" : ""), h, J.rate);
            addPart("ar:kuplung", "Kuplungszett (tárcsa, szerkezet, kinyomó)", "kuplung_szett");
            if (sel.kuplung_ktl === "igen") addPart("ar:ktl", "Kettőstömegű lendkerék", "ktl_lendkerek");
        } else if (j === "kipufogo") {
            const kat = sel.kipufogo_resz === "kat";
            labourTotal += addLabour("ora:kipufogo", J.label, hours(kat ? "katalizator" : "kipufogo", sel), J.rate);
            addPart("ar:kipufogo", kat ? "Katalizátor / részecskeszűrő" : "Kipufogódob", kat ? "katalizator" : "kipufogo_dob");
        } else if (j === "akkumulator") {
            const agm = sel.akku_startstop === "igen";
            labourTotal += addLabour("ora:akku", J.label + (agm ? " (AGM, start-stop)" : ""), hours("akkumulator", sel), J.rate);
            addPart("ar:akku", agm ? "AGM akkumulátor (start-stop)" : "Akkumulátor", agm ? "akkumulator_agm" : "akkumulator");
            if (agm) notes.push("Az AGM akkut be kell jelenteni az autó elektronikájának - ha ezt külön számlázod, vedd fel új tételként.");
        } else if (j === "klima") {
            labourTotal += addLabour("ora:klima", "Klímatöltés, fertőtlenítés", hours("klima", sel), J.rate);
            const yf = usesNewGas(sel);
            addPart("ar:klimagaz", yf ? "Klímagáz (R1234yf, 500 g-ig)" : "Klímagáz (R134a, 500 g-ig)", yf ? "klimagaz_yf" : "klimagaz_r134a");
            if (yf) workings.push(`Klímagáz: a ${yearOf(sel)}-es évjárat miatt R1234yf`);
            if (sel.klima_allapot === "nem_hut") {
                notes.push("Szivárgó rendszernél a töltés önmagában nem megoldás - a keresést és a javítást külön tételként érdemes ráírni.");
            }
        } else if (j === "vizsga") {
            labourTotal += addLabour("ora:vizsga", "Vizsga előtti átvizsgálás, beállítás", hours("vizsga", sel), J.rate);
            notes.push("A vizsga hatósági díja nincs benne - ha te fizeted meg és továbbszámlázod, vedd fel új tételként.");
        } else if (j === "futomu") {
            labourTotal += addLabour("ora:futomu", "Futómű-beállítás (számítógépes)", hours("futomu", sel), J.rate);
        } else if (j === "gumi") {
            const wheels = sel.gumi_db === "2" ? 0.5 : 1;
            const size = ["m16", "m18", "m19"].includes(sel.gumi_meret) ? sel.gumi_meret : "m18";
            const sizeK = size === "m19" ? 1.5 : size === "m18" ? 1.25 : 1;
            labourTotal += addLabour("ora:gumi",
                `Gumiszerelés, centírozás (${sel.gumi_db === "2" ? "2" : "4"} kerék)`, hours("gumi", sel) * wheels * sizeK, J.rate);
            notes.push("A gumiabroncs ára és a szelepcsere nincs benne - külön tételként vedd fel, ha te adod.");
        } else if (j === "diagnosztika") {
            labourTotal += addLabour("ora:diagnosztika", "Műszeres diagnosztika, hibakeresés", hours("diagnosztika", sel), J.rate);
        } else if (j === "egyeb") {
            const label = String(sel.egyeb_munka || "Egyéb munka").slice(0, 120);
            labourTotal += addLabour("ora:egyeb", label, hours("egyeb", sel), J.rate);
            notes.push("Az egyéb munkánál az óraszám alapértelmezése 1 óra - írd át, és az alkatrészt vedd fel új tételként.");
        }
    }

    // --- consumables, itself an editable line --------------------------------
    if (labourTotal > 0) {
        const base = Math.max(P.aproanyag_min, labourTotal * P.aproanyag_szazalek);
        const key = "ar:aproanyag";
        const proposed = Math.round(base);
        const amount = ov.ar[key] != null ? ov.ar[key] : proposed;
        items.push({
            key, kind: "alkatresz", label: "Apróanyag, folyadék, kenőanyag",
            amount, unit: amount, proposedUnit: proposed, qty: 1,
            edited: ov.ar[key] != null && Math.abs(ov.ar[key] - proposed) > 0.5,
        });
        workings.push(`Apróanyag: a munkadíj ${Math.round(P.aproanyag_szazalek * 100)}%-a, de legalább ${fmt(P.aproanyag_min)} = ${ifmt(amount)}`);
    }

    // --- whatever he added by hand -------------------------------------------
    ov.extra.forEach((e, i) => {
        items.push({ key: `extra:${i}`, kind: "extra", label: e.label, amount: e.amount, unit: e.amount, qty: 1, edited: true });
        workings.push(`${e.label}: saját tétel = ${ifmt(e.amount)}`);
    });

    return {
        title: title(sel),
        items,
        workings,
        notes,
        billing: billingNote(sel),
        tier: t,
    };
}

// ---------------------------------------------------------------------------
//  VIN helpers re-exported so the engine can use them without a second import
// ---------------------------------------------------------------------------
export { vinLooksValid, vinYear, vinMake, SAMPLE_VIN, fuelOf, classOf };

export function vinNote(vin, sel = {}) {
    if (!vinLooksValid(vin)) return null;
    const v = String(vin).replace(/[\s-]/g, "").toUpperCase();
    if (v === SAMPLE_VIN) {
        return "Megvan - ez a **minta alvázszám**, élesben az autóét írnád be. Rákerül az ajánlatra.";
    }
    const y = vinYear(v);
    const mk = vinMake(v);
    const told = String(sel.make || "").trim();
    if (mk && told && told !== "__egyeb" && mk.toLowerCase() !== told.toLowerCase()) {
        return `Megvan az alvázszám. Ez viszont egy **${mk}** alvázszáma, a márkához meg **${told}** van beírva - nézd meg, nehogy rossz alkatrész menjen a rendelésbe.`;
    }
    const bits = [];
    if (mk) bits.push(`**${mk}**`);
    if (y) bits.push(`**${y}-es** évjárat`);
    if (!bits.length) return "Megvan az alvázszám, rákerül az ajánlatra.";
    return `Megvan: ${bits.join(", ")}. Rákerül az ajánlatra.`;
}

// ---------------------------------------------------------------------------
//  SANITY SCENARIOS - test-flow.mjs clicks these through and prints the price.
//  min/max are loose 2026 Hungarian market envelopes in GROSS Ft, there to catch
//  a rate edit that drifts off by an order of magnitude - not to pin a number.
// ---------------------------------------------------------------------------
export const TEST_SCENARIOS = [
    {
        name: "Olajcsere, Suzuki Swift 1.2 benzin, márkás",
        answers: {
            jobs: ["Olajcsere, szűrőcsere"], make: "Suzuki", model: "Swift",
            engine: "1.2 benzin", year: "2010–2014", vin: "Most nem írom be", km: "150–200 000 km",
            olaj_szuro: "Csak az olajszűrő", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 14000, max: 60000,
    },
    {
        name: "Olajcsere, VW Passat 2.0 TDI (nagyobb motor, több olaj), márkás",
        answers: {
            jobs: ["Olajcsere, szűrőcsere"], make: "Volkswagen", model: "Passat",
            engine: "2.0 TDI dízel", year: "2015–2019", vin: "Most nem írom be", km: "100–150 000 km",
            olaj_szuro: "Minden szűrő (levegő, pollen, üzemanyag)", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 30000, max: 120000,
    },
    {
        name: "Fékbetét első tengely, Opel Astra 1.7 CDTI, utángyártott",
        answers: {
            jobs: ["Fék (betét, tárcsa)"], make: "Opel", model: "Astra",
            engine: "1.7 CDTI dízel", year: "2010–2014", vin: "Most nem írom be",
            fek_hol: "Első", fek_tarcsa: "Csak betét", parts_tier: "Utángyártott",
        },
        min: 15000, max: 70000,
    },
    {
        name: "Hátsó fék elektromos kézifékkel, Škoda Superb 2.0 TDI, márkás",
        answers: {
            jobs: ["Fék (betét, tárcsa)"], make: "Škoda", model: "Superb",
            engine: "2.0 TDI dízel", year: "2015–2019", vin: "Most nem írom be",
            fek_hol: "Hátsó", fek_tarcsa: "Betét és tárcsa", fek_kezifek: "Igen",
            parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 60000, max: 250000,
    },
    {
        name: "Vezérműszíj + vízpumpa, VW Passat 2.0 TDI, márkás",
        answers: {
            jobs: ["Vezérlés csere (szíj vagy lánc)"], make: "Volkswagen", model: "Passat",
            engine: "2.0 TDI dízel", year: "2010–2014", vin: "Most nem írom be", km: "200–300 000 km",
            vezerles_tipus: "Szíj", vez_vizpumpa: "Igen", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 90000, max: 280000,
    },
    {
        name: "VezérműLÁNC, VW Golf 1.4 TSI, márkás - a szíjnál lényegesen több",
        answers: {
            jobs: ["Vezérlés csere (szíj vagy lánc)"], make: "Volkswagen", model: "Golf",
            engine: "1.4 TSI benzin", year: "2010–2014", vin: "Most nem írom be", km: "150–200 000 km",
            vezerles_tipus: "Lánc", vez_vizpumpa: "Nem", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 100000, max: 450000,
    },
    {
        name: "Kuplung kettőstömegű NÉLKÜL, Ford Focus 1.6 TDCi, utángyártott",
        answers: {
            jobs: ["Kuplungcsere"], make: "Ford", model: "Focus",
            engine: "1.6 TDCi dízel", year: "2005–2009", vin: "Most nem írom be",
            kuplung_valto: "Manuális", kuplung_ktl: "Nem", kuplung_hajtas: "Elsőkerék",
            parts_tier: "Utángyártott",
        },
        min: 90000, max: 300000,
    },
    {
        name: "Kuplung kettőstömegŰVEL - a szerelő látta, hogy kell",
        answers: {
            jobs: ["Kuplungcsere"], make: "Volkswagen", model: "Passat",
            engine: "2.0 TDI dízel", year: "2015–2019", vin: "Most nem írom be",
            kuplung_valto: "Manuális", kuplung_ktl: "Igen", kuplung_hajtas: "Elsőkerék",
            parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 200000, max: 600000,
    },
    {
        name: "Klímatöltés régi gázzal, Škoda Octavia 1.6 TDI, 2010–2014",
        answers: {
            jobs: ["Klíma (töltés, fertőtlenítés)"], make: "Škoda", model: "Octavia",
            engine: "1.6 TDI dízel", year: "2010–2014", vin: "Most nem írom be",
            klima_allapot: "Csak fogyott, tölthető", parts_tier: "Utángyártott",
        },
        min: 15000, max: 50000,
    },
    {
        name: "Klímatöltés ÚJ gázzal (2020+), Toyota Corolla hibrid",
        answers: {
            jobs: ["Klíma (töltés, fertőtlenítés)"], make: "Toyota", model: "Corolla",
            engine: "1.8 hibrid", year: "2020 vagy újabb", vin: "Most nem írom be",
            klima_allapot: "Csak fogyott, tölthető", parts_tier: "Utángyártott",
        },
        min: 40000, max: 120000,
    },
    {
        name: "Diagnosztika önálló munkaként - most már számlázható tétel",
        answers: {
            jobs: ["Diagnosztika, hibakeresés"], make: "BMW", model: "3-as",
            engine: "320d dízel", year: "2010–2014", vin: "Most nem írom be",
        },
        min: 12000, max: 60000,
    },
    {
        name: "Egyéb munka, amit a szerelő maga nevez el",
        answers: {
            jobs: ["Egyéb munka (én írom be)"], make: "Opel", model: "Astra",
            engine: "1.6 benzin", year: "2010–2014", vin: "Most nem írom be",
            egyeb_munka: "Bal első lengőkar csere",
        },
        min: 10000, max: 60000,
    },
    {
        name: "Két munka egyszerre: olajcsere + fék, BMW 5-ös (felső kategória)",
        answers: {
            jobs: ["Olajcsere, szűrőcsere", "Fék (betét, tárcsa)"],
            make: "BMW", model: "5-ös", engine: "520d dízel", year: "2015–2019", vin: "Most nem írom be",
            km: "100–150 000 km", olaj_szuro: "Minden szűrő (levegő, pollen, üzemanyag)", fek_hol: "Mind a kettő",
            fek_tarcsa: "Betét és tárcsa", fek_kezifek: "Igen", parts_tier: "Gyári (OEM)",
        },
        min: 200000, max: 900000,
    },
];

// ---------------------------------------------------------------------------
//  WHAT THE AI MAY SAY. It runs the conversation, it never prices anything.
// ---------------------------------------------------------------------------
export const KNOWLEDGE = `- Ez egy PROTOTÍPUS, és a SZERELŐNEK készült, nem az ügyfélnek: az használja, aki már látta az autót és most árat ad rá.
- ${SAMPLE_NOTICE}
- A szerviznek semmit nem kell beállítania: minden szerviznek Milán építi meg a saját változatát, a saját óradíjaival, árlistájával és munkáival. Ez itt egy minta szerviz, piaci átlagárakkal.
- A normaidő és az alkatrészár JAVASLAT. A tételek képernyőn minden sor óraszáma és ára átírható, és új sor is felvehető.
- Mivel a szerelő már látta az autót, nincs "nem tudom" válasz: minden kérdésre tudja a pontos választ.
- A kész ajánlat VÉGLEGES, tételes összeg, nem "-tól" ár.
- Az összeg nettó + ÁFA bontásban jelenik meg; alanyi adómentes szerviznél nincs ÁFA.
- Az árat mindig a rendszer számolja ki, sosem az AI.
- Élesben a normaidő licencelt adatbázisból (Autodata, Mitchell, MOTOR), az alkatrészár pedig a szerviz saját beszállítói katalógusából jönne - ebben a prototípusban ezek alapértelmezések, amiket a szerelő felülír.`;
