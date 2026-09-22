// ============================================================================
//  AUTOSZERVIZ - automata árajánlatkészítő (PROTOTÍPUS)
//
//  Everything this bot knows about the trade: the questions in order, their
//  buttons, the price model, and the facts the AI may repeat. The engine in
//  api/faq-agent.js reads only what is exported here, so rebranding a real
//  workshop is this one file plus a logo.
//
//  ---------------------------------------------------------------------------
//  THE PRICES BELOW ARE MARKET AVERAGES, NOT ANY WORKSHOP'S PRICE LIST.
//  Triangulated from the live 2026 Hungarian market (JóSzaki autószerelés and
//  vezérlés-csere ranges, published Budapest workshop price lists, autóklíma és
//  diagnosztika díjak). Every rate here is NET; the engine adds 27% ÁFA and
//  shows the customer the gross figure, because a private car owner pays gross
//  at the counter. Replace the numbers in `P` with a real shop's own rates and
//  nothing else has to change.
//  ---------------------------------------------------------------------------
//
//  ACCURACY vs SPEED - the two things that pull against each other, and how
//  this file resolves them:
//   1. Ask a question ONLY of the people it changes the price for. The chain
//      question never reaches somebody booking an oil change; the electric
//      handbrake question never reaches a 2006 car.
//   2. DERIVE whatever can be derived. Oil quantity comes from the engine size,
//      refrigerant type from the model year. Both move the price by tens of
//      thousands and neither costs the customer a tap.
//   3. Put every remaining job detail on ONE screen (see DETAIL_FIELDS), so
//      three more questions cost one more screen, not three more round trips.
//
//  PRICING PRINCIPLE - a floor, never a range. Every part price is taken at the
//  LOWER edge of its tier and every unknown is assumed the cheap way, so the
//  number the customer sees can only go UP once the wheel is off - and every
//  thing that could push it up is named next to it. A range anchors the
//  customer to its low end and the shop has to argue upward at the counter;
//  a floor can only rise from a number that was presented as a minimum.
//
//  TWO OUTCOMES, never mixed up:
//   - a KNOWN JOB (fékbetét, olajcsere, vezérműszíj...) gets a priced quote;
//   - a SYMPTOM ("furcsa zaj", "rángat", "világít a lámpa") gets NO repair
//     price at all, only the diagnostic fee and a slot. Guessing a price on an
//     undiagnosed fault is the one thing this tool must never do.
// ============================================================================
import { MAKES, TOP_MAKES, modelNames, engineNames, fuelOf, classOf, displacementOf, CLASS_MULT, CLASS_LABEL, vinLooksValid, vinYear, vinMake, SAMPLE_VIN } from "./cars.js";

export const BOT = {
    id: "autoszerviz-minta",
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

// This is a demo running on sample prices, and it says so above the chat as
// well as inside the quote. Without that line one wrong number reads as "ez
// baromság" instead of "ez minta adat".
export const SAMPLE_NOTICE =
    "Minta árakkal fut, nem egy konkrét szerviz katalógusából. Éles verzióban a szerviz saját alkatrészárai és óradíja alapján számol.";

// ---------------------------------------------------------------------------
//  PRICES - net Ft. EDIT HERE ONLY.
// ---------------------------------------------------------------------------
const P = {
    // Hourly rates differ by the kind of work, the way a real workshop's price
    // list does: diagnostics ties up the tester and the man, wheel work does not.
    oradij: {
        altalanos: 12000,     // általános szerelés
        diagnosztika: 14000,  // műszeres diagnosztika
        futomu: 13000,        // futóműpad
        gumi: 8000,           // gumis munka
    },
    // Fixed fee for reading and interpreting the fault, deducted from the repair
    // if the car is repaired here. Market: 8 000 - 15 000 Ft gross.
    diagnosztika_dij: 10000,
    // Consumables, cleaner, thread lock, brake fluid drips: a share of labour.
    aproanyag_szazalek: 0.08,
    aproanyag_min: 2000,
    // Labour multipliers by car class live in cars.js. Parts scale too, but less.
    alkatresz_szorzo: { kis: 0.85, kozep: 1, felso: 1.5, terepjaro: 1.2 },
};

// Part price FLOORS (net Ft) for a middle-class reference car, by tier.
// utangyartott = a no-name aftermarket box; markas = Bosch, TRW, Febi, SKF,
// Valeo; gyari = the dealer's own part. The floor of each tier is used, and the
// exclusions say what a bigger or rarer part would cost.
//
// ANCHORED to real Hungarian webshop listings, checked 2026-09. Those are GROSS
// retail prices, so each figure here is the listing divided by 1.27 and rounded
// to the cheap side of its band (this is a floor, not an average):
//   - vezérműszíj készlet VÍZPUMPÁVAL, márkás: INA 530 0171 31 28 050 Ft,
//     GATES 5623XS 41 660 Ft, INA 530 0091 31 47 936 Ft. The kit below plus the
//     pump below lands at ~42 000 Ft gross, mid-band.
//   - kuplung szett, márkás: SACHS 3000 950 072 75 945 Ft, SACHS 2290 602 004
//     126 010 Ft. Kit WITH dual-mass flywheel: LuK 600 0271 00 267 238 Ft - the
//     kit + KTL lines below add up to ~267 000 Ft gross, which is that part.
//   - féktárcsa: TRW első tárcsa Opel Astra G 14 490 Ft/db, azaz ~29 000 Ft/pár.
//   - akkumulátor, Bosch: 26 211 - 59 719 Ft a tartomány, az AGM a felső vége.
const A = {
    olaj_liter:       { utangyartott: 1800,  markas: 2600,  gyari: 3800 },  // motorolaj, Ft/liter
    olajszuro:        { utangyartott: 1800,  markas: 3000,  gyari: 5200 },
    szuro_keszlet:    { utangyartott: 6000,  markas: 9000,  gyari: 14000 }, // levegő + pollen + üzemanyag
    fekbetet:         { utangyartott: 9000,  markas: 15000, gyari: 26000 }, // tengelyenként
    fektarcsa:        { utangyartott: 14000, markas: 23000, gyari: 40000 }, // tengelyenként, pár
    vezermuszij_keszlet: { utangyartott: 13000, markas: 22000, gyari: 38000 }, // szíj, feszítő, görgők (pumpa nélkül)
    vezermulanc_keszlet: { utangyartott: 32000, markas: 55000, gyari: 95000 }, // lánc, feszítő, sínek
    vizpumpa:         { utangyartott: 7000,  markas: 11000, gyari: 20000 },  // a vezérlés-készlettel együtt rendelve
    kuplung_szett:    { utangyartott: 45000, markas: 70000, gyari: 120000 },
    ktl_lendkerek:    { utangyartott: 95000, markas: 140000, gyari: 230000 }, // kettőstömegű, csak ha kell
    kipufogo_dob:     { utangyartott: 18000, markas: 30000, gyari: 55000 },
    katalizator:      { utangyartott: 60000, markas: 110000, gyari: 210000 },
    akkumulator:      { utangyartott: 17000, markas: 25000, gyari: 38000 },
    akkumulator_agm:  { utangyartott: 34000, markas: 45000, gyari: 65000 },  // start-stop (AGM/EFB)
    klimagaz_r134a:   { utangyartott: 9000,  markas: 9000,  gyari: 9000 },   // 500 g-ig
    klimagaz_yf:      { utangyartott: 31000, markas: 31000, gyari: 31000 },  // R1234yf, 500 g-ig
};

// Normaidő (hours) for a middle-class reference car. Multiplied by the car's
// class factor from cars.js. Petrol and diesel differ where the work genuinely
// differs; where it does not, both columns are the same number.
const N = {
    olajcsere:   { benzin: 0.5, dizel: 0.6 },
    fek_tengely: { benzin: 1.0, dizel: 1.0 },      // betétcsere, tengelyenként
    fek_tarcsa_extra: { benzin: 0.4, dizel: 0.4 }, // tárcsa is, tengelyenként
    fek_ekezifek_extra: { benzin: 0.4, dizel: 0.4 }, // elektromos kézifék visszaállítása teszterrel
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
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------
const opt = (label, value, extra) => ({ label, value, ...extra });
const NT = (extra) => opt("Nem tudom", "nem_tudom", extra);
export const list = (sel, field) => String(sel[field] || "").split(",").filter(Boolean);
const hasJob = (sel, j) => list(sel, "jobs").includes(j);
const num = (n) => String(Math.round(n * 10) / 10).replace(".", ",");

function optionOf(field, sel) {
    const f = FIELDS[field];
    if (!f) return null;
    const opts = typeof f.options === "function" ? f.options(sel) : f.options;
    return (opts || []).find((o) => o.value === sel[field]) || null;
}
const labelOf = (field, sel) => (optionOf(field, sel) || {}).label || "";

// The car, as the customer gave it. Free-typed makes and models are kept
// verbatim, so an Alfa Romeo the catalogue has never heard of still reads back
// correctly on the owner's card.
const PLACEHOLDER = new Set(["nem_tudom", "__egyeb", "nincs"]);
export function carLine(sel) {
    // The year buttons are bands, and their stored value is the band's middle
    // year. Reading "2012" back to somebody who clicked "2010-2014" is a small
    // lie they will spot, so a banded answer is echoed as its band.
    const year = labelOf("year", sel) || String(sel.year || "");
    const bits = [sel.make, sel.model, year, sel.engine]
        .map((x) => String(x || "").trim())
        .filter((x) => x && !PLACEHOLDER.has(x) && x !== "Nem tudom");
    return bits.join(" ") || "ismeretlen autó";
}
const fuel = (sel) => fuelOf(sel.engine);
const klass = (sel) => classOf(sel.make, sel.model);
const labourK = (sel) => CLASS_MULT[klass(sel)] ?? 1;
const partsK = (sel) => P.alkatresz_szorzo[klass(sel)] ?? 1;
const tier = (sel) => (["utangyartott", "markas", "gyari"].includes(sel.parts_tier) ? sel.parts_tier : "utangyartott");
const hours = (key, sel) => (N[key] ? N[key][fuel(sel)] ?? N[key].benzin : 0) * labourK(sel);
const part = (key, sel) => (A[key] ? A[key][tier(sel)] : 0) * partsK(sel);

// Model year as a number, from the band the customer clicked or a typed year.
// 0 means "we were not told", and everything downstream treats that as the
// CHEAPER assumption, never the dearer one.
const yearOf = (sel) => {
    const n = parseInt(String(sel.year || ""), 10);
    return Number.isFinite(n) && n > 1970 ? n : 0;
};

// --- Derived facts: accuracy that costs the customer no taps ----------------

// How much oil the engine actually takes. Asking a car owner for this produces
// rubbish, but the engine size is already on screen and it is a good predictor.
// Diesels hold a little more. Unknown engine -> the smallest sensible figure,
// because an unknown must never inflate the floor.
function oilLitres(sel) {
    const d = displacementOf(sel.engine, klass(sel));
    const base = d < 1.4 ? 4 : d < 2.1 ? 4.5 : d < 3.1 ? 6 : 7.5;
    return fuel(sel) === "dizel" ? base + 0.5 : base;
}

// Which refrigerant the car takes. Everything type-approved from 2017 on uses
// R1234yf, which costs several times what R134a does - a real difference a
// customer cannot be expected to know. Unknown year -> the cheaper gas plus a
// line in the exclusions, so the floor stays a floor.
const usesNewGas = (sel) => yearOf(sel) >= 2017;

// An electric parking brake has to be wound back with a tester, which is real
// extra time on a REAR brake job. No car from before about 2010 has one, so the
// question is only ever put to somebody it could apply to.
const mayHaveEpb = (sel) => yearOf(sel) >= 2010;

export const TIER_LABEL = {
    utangyartott: "utángyártott",
    markas: "márkás utángyártott (Bosch, TRW, Febi)",
    gyari: "gyári (OEM)",
};

// ---------------------------------------------------------------------------
//  THE JOBS THE SAMPLE SHOP TAKES ON
//  `rate` picks the hourly rate, `fields` are the job's own follow-up questions,
//  `km` marks the jobs where the odometer actually changes the advice given.
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
    tunet:       { label: "Valami baja van, nem tudom mi", rate: "diagnosztika", parts: false, symptom: true, fields: ["tunet_leiras"] },
    egyeb:       { label: "Más, ami nincs a listában", rate: null, parts: false, blocked: true, fields: [] },
};

const jobsOf = (sel) => list(sel, "jobs").filter((j) => JOBS[j]);
const pricedJobs = (sel) => jobsOf(sel).filter((j) => !JOBS[j].symptom && !JOBS[j].blocked);
const needsKm = (sel) => jobsOf(sel).some((j) => JOBS[j].km) || hasJob(sel, "tunet");
const needsTier = (sel) => pricedJobs(sel).some((j) => JOBS[j].parts);

// Follow-up questions that only become relevant once an earlier answer is in,
// so they cannot sit on the one-screen detail form with the rest. Each one is
// asked of exactly the people whose price it moves, and nobody else.
const CONDITIONAL = {
    fek_kezifek: (sel) => hasJob(sel, "fek") && ["hatso", "mindketto"].includes(sel.fek_hol) && mayHaveEpb(sel),
};

// Every job detail that can be asked right now, in job order. The engine puts
// all of these on ONE form: three extra questions then cost one extra screen
// rather than three extra round trips, which is what lets the flow get MORE
// accurate without getting slower.
export function detailFields(sel) {
    const out = [];
    for (const j of jobsOf(sel)) {
        for (const f of JOBS[j].fields || []) {
            if (!out.includes(f) && !CONDITIONAL[f]) out.push(f);
        }
    }
    return out;
}

// Questions that travel together on one screen. The engine renders a group as a
// short form as soon as more than one of its fields is still open, and falls
// back to a normal chat question for the last straggler - a form with a single
// row on it is just a clumsy button.
//
// The order inside a group is the order in fieldOrder(); grouping changes how
// the questions are PRESENTED, never which ones get asked.
export const GROUPS = [
    {
        key: "car",
        title: "Milyen autó?",
        why: "Kezdd el írni a márkát, a többit felkínálja. Ha nincs a listában, írd be nyugodtan.",
        submit: "Mehet tovább",
        // The alvázszám is deliberately NOT here. It was, for one version, and
        // that was a mistake: it is the single field that most improves what the
        // workshop can order, and as an optional blank row it was the easiest
        // thing on the screen to skip. It gets its own screen and its own reason.
        fields: (sel) => ["make", "model", "engine", "year", ...(needsKm(sel) ? ["km"] : [])],
    },
    {
        key: "detail",
        title: "A munkáról",
        why: "Ezek mozgatják az árat. Ha valamit nem tudsz, válaszd a „Nem tudom”-ot - olyankor a szerviz az olcsóbb változattal számol.",
        submit: "Mehet, jöhet az ár",
        // The parts tier rides along here rather than on a screen of its own:
        // it is the biggest single lever on the price, but it is still one
        // dropdown, and a job that needs no parts never sees it.
        fields: (sel) => [...detailFields(sel), ...(needsTier(sel) ? ["parts_tier"] : [])],
    },
];
function conditionalFields(sel) {
    return Object.keys(CONDITIONAL).filter((f) => CONDITIONAL[f](sel));
}

// A job the shop does not take on stops the conversation for that job. We do
// NOT collect the enquiry: there is no shop behind this prototype to pass it to,
// and a lead nobody will ever call is worse than an honest no.
export function blocked(sel) {
    if (!hasJob(sel, "egyeb")) return null;
    return "Ezt a munkát ez a szerviz nem vállalja, ezért árat sem adok rá - nem szeretnék olyat ígérni, amit nem tudunk megcsinálni.\n\nHa a fentiek közül valamelyik mégis kell, válaszd ki, és megcsinálom rá az árajánlatot.";
}

// ---------------------------------------------------------------------------
//  QUESTIONS
// ---------------------------------------------------------------------------
const KM_BANDS = [
    opt("100 000 km alatt", "k100", { km: 80000 }),
    opt("100–150 000 km", "k150", { km: 100000 }),
    opt("150–200 000 km", "k200", { km: 150000 }),
    opt("200–300 000 km", "k300", { km: 200000 }),
    opt("300 000 km felett", "k300p", { km: 300000 }),
    NT({ km: 0 }),
];

export const FIELDS = {
    jobs: {
        type: "multi",
        short: "Munka",
        q: "Mit kellene megcsinálni az autón?",
        hint: "Több dolgot is kiválaszthatsz. Ha nem tudod, mi a baj, azt is jelöld be.",
        options: Object.entries(JOBS).map(([v, j]) => opt(j.label, v)),
        none: ["egyeb"],
        values: Object.keys(JOBS),
    },

    make: {
        short: "Márka",
        q: "Márka",
        placeholder: "pl. Mercedes",
        hint: null,
        options: TOP_MAKES.map((n) => opt(n, n)).concat([opt("Egyéb márka (beírom)", "__egyeb")]),
        values: MAKES.map((mk) => mk.name).concat(["__egyeb"]),
        free: true, // a typed make is accepted as-is
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
        // The engine is the question customers never volunteer and the one the
        // normaidő actually depends on. It is asked explicitly, but the box
        // fills itself from the model, so the answer is a tap on something real
        // rather than a guess at what to type - which is what it used to be.
        q: "Motor",
        placeholder: "pl. 2.0 CDI dízel",
        hint: "Ez mozgatja a legtöbbet a munkadíjon. A forgalmiban is benne van.",
        options: (sel) => {
            const eng = engineNames(sel.make, sel.model);
            return (eng.length ? eng : ["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.6 benzin", "2.0 benzin", "1.5 dízel", "1.6 dízel", "1.9 dízel", "2.0 dízel"])
                .map((n) => opt(n, n))
                .concat([NT()]);
        },
        values: [...new Set(MAKES.flatMap((mk) => mk.models.flatMap((md) => md.engines)))]
            .concat(["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.6 benzin", "2.0 benzin", "1.5 dízel", "1.6 dízel", "1.9 dízel", "2.0 dízel", "nem_tudom"]),
        free: true,
    },

    year: {
        type: "year",
        short: "Évjárat",
        q: "Évjárat",
        hint: "Ebből jön ki, milyen klímagáz van benne és lehet-e elektromos kézifék.",
        options: [
            opt("2020 vagy újabb", "2021"), opt("2015–2019", "2017"), opt("2010–2014", "2012"),
            opt("2005–2009", "2007"), opt("2005 előtti", "2002"), NT(),
        ],
        values: ["2021", "2017", "2012", "2007", "2002", "nem_tudom"],
    },

    vin: {
        type: "vin",
        short: "Alvázszám",
        q: "Megvan az alvázszám?",
        // The reason is given in one line, because an unexplained VIN request
        // reads as data harvesting and people drop out.
        hint: "Az alvázszámból pontosan látom, melyik alkatrész megy bele, mert egy típushoz több változat is van. Ha nincs kéznél, attól még megy tovább.",
        options: [
            opt("Nincs kéznél", "nincs"),
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

    // --- Job-specific follow-ups (these share one screen) ---
    olaj_szuro: {
        short: "Szűrők",
        q: "A szűrőket is cseréljük?",
        hint: "Az olajszűrő mindig benne van; a kérdés a levegő-, pollen- és üzemanyagszűrő.",
        options: [opt("Csak az olajszűrő", "csak_olaj"), opt("Minden szűrőt cseréljünk", "mind"), NT()],
    },
    fek_hol: {
        short: "Melyik fék",
        q: "Melyik tengelyen?",
        options: [opt("Első", "elso"), opt("Hátsó", "hatso"), opt("Mind a kettő", "mindketto"), NT()],
    },
    fek_tarcsa: {
        short: "Tárcsa is",
        q: "Tárcsát is cserélünk, vagy csak betétet?",
        options: [opt("Csak betét", "betet"), opt("Betét és tárcsa", "betet_tarcsa"), NT()],
    },
    fek_kezifek: {
        short: "Elektromos kézifék",
        q: "Elektromos kézifék van benne?",
        // Only ever asked on a rear brake job, on a car new enough to have one.
        hint: "Ha gombbal húzod be a kéziféket és nem karral, akkor elektromos. Ilyenkor teszterrel kell visszaállítani a munkához.",
        options: [opt("Igen, gombos", "igen"), opt("Nem, karos kézifék", "nem"), NT()],
    },
    vezerles_tipus: {
        short: "Szíj vagy lánc",
        q: "Vezérműszíj vagy vezérműlánc van benne?",
        // The single biggest fork in this job: a chain is a different part set
        // and roughly half again the labour. Quoting a belt price for a chain
        // engine is the fastest way to lose a mechanic's trust.
        hint: "Ha nem tudod, hagyd „Nem tudom”-on: a szíjas, olcsóbb változattal számolok, és a becslés megírja, mi a helyzet lánccal.",
        options: [opt("Szíj", "szij"), opt("Lánc", "lanc"), NT()],
    },
    vez_vizpumpa: {
        short: "Vízpumpa",
        q: "A vízpumpát cseréljük vele együtt?",
        options: [opt("Igen, menjen vele", "igen"), opt("Nem, csak a vezérlés", "nem"), NT()],
    },
    kuplung_valto: {
        short: "Váltó",
        q: "Manuális vagy automata a váltó?",
        options: [opt("Manuális", "manualis"), opt("Automata", "automata"), NT()],
    },
    kuplung_ktl: {
        short: "Kettőstömegű lendkerék",
        q: "Kettőstömegű lendkerék van benne?",
        hint: "Ha nem tudod, nyugodtan válaszd a „Nem tudom”-ot - a legtöbben nem tudják.",
        options: [opt("Igen", "igen"), opt("Nem", "nem"), NT()],
    },
    kuplung_hajtas: {
        short: "Hajtás",
        q: "Első- vagy összkerékhajtás?",
        hint: "Összkerékhajtásnál a kardánt és a hátsó differenciálművet is bontani kell a váltó kivételéhez.",
        options: [opt("Elsőkerék", "elso"), opt("Összkerék (4x4, quattro, xDrive)", "awd"), NT()],
    },
    kipufogo_resz: {
        short: "Kipufogó része",
        q: "A kipufogó melyik része?",
        options: [opt("Hátsó dob", "hatso"), opt("Középső dob", "kozep"), opt("Katalizátor / részecskeszűrő", "kat"), NT()],
    },
    akku_startstop: {
        short: "Start-stop",
        q: "Van benne start-stop rendszer?",
        // AGM batteries cost roughly double, so this one tap is worth tens of
        // thousands of forints on the estimate.
        hint: "Ha a motor magától leáll a piros lámpánál, akkor van. Ilyenkor AGM akkumulátor kell, ami drágább.",
        options: [opt("Igen, leáll a lámpánál", "igen"), opt("Nincs", "nem"), NT()],
    },
    klima_allapot: {
        short: "Klíma állapota",
        q: "Hűt egyáltalán a klíma?",
        hint: "Ha egyáltalán nem hűt, az nem biztos, hogy töltés kérdése.",
        options: [opt("Hűt, csak gyengébben", "gyenge"), opt("Egyáltalán nem hűt", "nem_hut"), opt("Jó, csak karbantartás kell", "karban"), NT()],
    },
    gumi_db: {
        short: "Kerekek",
        q: "Hány kerékről van szó?",
        options: [opt("4 kerék", "4"), opt("2 kerék", "2"), NT()],
    },
    gumi_meret: {
        short: "Keréktárcsa",
        q: "Mekkora a keréktárcsa?",
        hint: "A nagyobb, alacsony falú gumit nehezebb felhúzni, ezért drágább a szerelése.",
        options: [opt("16 coll vagy kisebb", "m16"), opt("17–18 coll", "m18"), opt("19 coll vagy nagyobb", "m19"), NT()],
    },
    tunet_leiras: {
        type: "text",
        short: "Tünet",
        q: "Írd le a saját szavaiddal, mit csinál az autó.",
        hint: "Mikor jelentkezik, milyen hangot ad, mit látsz a műszerfalon. Erre árat nem adok, csak ez alapján tudjuk, mivel kezdjük a vizsgálatot.",
        options: [],
        free: true,
    },

    parts_tier: {
        short: "Alkatrész",
        q: "Milyen alkatrészt tegyünk bele?",
        hint: "Ez mozgatja a legtöbbet az áron. Az árajánlat mindig a választott kategória legolcsóbb változatával számol.",
        options: [
            opt("Utángyártott - a legolcsóbb", "utangyartott"),
            opt("Márkás utángyártott (Bosch, TRW, Febi)", "markas"),
            opt("Gyári (OEM)", "gyari"),
            opt("Nem tudom, mondjátok meg ti", "nem_tudom"),
        ],
        values: ["utangyartott", "markas", "gyari", "nem_tudom"],
    },
};

// The whole catalogue, flattened for the browser: { "Opel": { "Astra": [...] } }.
// About 20 KB, sent once with the car form, which buys instant type-ahead with
// no round trip per keystroke.
export const CATALOG = Object.fromEntries(
    MAKES.map((mk) => [mk.name, Object.fromEntries(mk.models.map((md) => [md.name, md.engines]))])
);

export function fieldOrder(sel) {
    const base = ["jobs"];
    const jobs = jobsOf(sel);
    if (!jobs.length) return base;
    if (jobs.includes("egyeb")) return base; // blocked(); nothing further is asked
    base.push("make", "model", "engine", "year");
    if (needsKm(sel)) base.push("km");
    base.push("vin");
    base.push(...detailFields(sel));
    base.push(...conditionalFields(sel));
    if (needsTier(sel)) base.push("parts_tier");
    return base;
}

export function title(sel) {
    const jobs = jobsOf(sel);
    if (!jobs.length) return "Autószerviz";
    if (jobs.length === 1) return JOBS[jobs[0]].label;
    return jobs.map((j) => JOBS[j].label).join(" + ");
}

// ---------------------------------------------------------------------------
//  ONE expertise moment per conversation, and it has to be TRUE.
//  This is the line that makes a mechanic nod instead of scroll, so it is
//  picked by priority and said exactly once.
// ---------------------------------------------------------------------------
export function expertiseNote(sel) {
    if (hasJob(sel, "vezermuszij") && sel.vezerles_tipus !== "lanc" && sel.vez_vizpumpa !== "igen") {
        return "A vízpumpát ilyenkor érdemes vele cserélni, mert ugyanaz a munkadíj. Külön, később még egyszer ennyi lenne.";
    }
    if (hasJob(sel, "vezermuszij") && sel.vezerles_tipus === "lanc") {
        return "Láncos vezérlésnél a feszítőt és a sínt is cserélni kell, mert a megnyúlt lánc azokat koptatja el először.";
    }
    if (hasJob(sel, "kuplung")) {
        return "Kuplungnál a kettőstömegű lendkereket is meg kell nézni, mert ha kopott, külön visszajönni rá dupla munka.";
    }
    if (hasJob(sel, "fek")) {
        return "A tárcsa vastagságát is megmérjük, mert kopott tárcsán az új betét hamar tönkremegy.";
    }
    if (hasJob(sel, "olajcsere")) {
        return "Olajcserénél az olajszűrő mindig megy vele; a levegő- és pollenszűrőt elég minden második alkalommal cserélni.";
    }
    if (hasJob(sel, "klima")) {
        return "Töltés előtt nyomáspróbát csinálunk, mert ha szivárog, a friss gáz pár hét alatt újra elmegy.";
    }
    return null;
}

// ---------------------------------------------------------------------------
//  QUOTE
//  Returns NET amounts plus `workings`: the arithmetic behind every line, shown
//  to the tester in the prototype's own panel. A mechanic wants to audit the
//  number, and letting him is what stops this looking like a black box.
// ---------------------------------------------------------------------------
export function buildQuote(sel, { money, itemMoney = money }) {
    const jobs = jobsOf(sel);
    const priced = pricedJobs(sel);
    const symptom = hasJob(sel, "tunet");
    const items = [];
    const workings = [];
    const ex = [];
    const flags = [];
    const t = tier(sel);
    const cls = klass(sel);
    const kmVal = (optionOf("km", sel) || {}).km || 0;

    const addLabour = (label, h, rateKey) => {
        const rate = P.oradij[rateKey] || P.oradij.altalanos;
        const amount = h * rate;
        items.push({ label: `${label} - munkadíj (${num(h)} óra × ${money(rate)}/óra)`, amount });
        workings.push(`${label}: ${num(h)} normaóra × ${money(rate)}/óra = ${itemMoney(amount)}`);
        return amount;
    };
    const addPart = (label, key, qty = 1) => {
        const amount = part(key, sel) * qty;
        if (amount <= 0) return 0;
        items.push({ label: `${label} (${TIER_LABEL[t]})`, amount });
        workings.push(`${label}: ${TIER_LABEL[t]} alapár${qty > 1 ? ` × ${num(qty)}` : ""}, ${CLASS_LABEL[cls]} szorzóval (×${P.alkatresz_szorzo[cls]}) = ${itemMoney(amount)}`);
        return amount;
    };

    let labourTotal = 0;

    if (jobs.length && priced.length) {
        workings.push(`Autó: ${carLine(sel)} - ${CLASS_LABEL[cls]}, munkadíj-szorzó ×${CLASS_MULT[cls]}, ${fuel(sel)} motor`);
    }

    for (const j of priced) {
        const J = JOBS[j];
        if (j === "olajcsere") {
            labourTotal += addLabour(J.label, hours("olajcsere", sel), J.rate);
            const litres = oilLitres(sel);
            const oil = A.olaj_liter[t] * partsK(sel) * litres;
            items.push({ label: `Motorolaj, ${num(litres)} liter (${TIER_LABEL[t]})`, amount: oil });
            workings.push(`Motorolaj: ${num(litres)} liter (a ${displacementOf(sel.engine, cls)} literes motorhoz számolva) × ${money(A.olaj_liter[t] * partsK(sel))}/liter = ${itemMoney(oil)}`);
            addPart("Olajszűrő", "olajszuro");
            if (sel.olaj_szuro === "mind") addPart("Levegő-, pollen- és üzemanyagszűrő", "szuro_keszlet");
            ex.push(`A becslés **${num(litres)} liter olajjal** számol, a motor mérete alapján. Ha a gyári előírás ennél több, literenként ${money(A.olaj_liter[t] * partsK(sel))}.`);
            if (sel.olaj_szuro !== "mind") ex.push(`Levegő-, pollen- és üzemanyagszűrő, ha mégis kell: ${money(A.szuro_keszlet[t] * partsK(sel))}-tól.`);
        } else if (j === "fek") {
            const axles = sel.fek_hol === "mindketto" ? 2 : 1;
            const withDisc = sel.fek_tarcsa === "betet_tarcsa";
            const epb = sel.fek_kezifek === "igen";
            let h = hours("fek_tengely", sel) * axles;
            if (withDisc) h += hours("fek_tarcsa_extra", sel) * axles;
            if (epb) h += hours("fek_ekezifek_extra", sel);
            // The line names what is actually being done, not the menu category:
            // "Fék (betét, tárcsa)" above a quote with no disc in it reads as a
            // missing line rather than as a heading.
            const where = sel.fek_hol === "mindketto" ? "mindkét tengely"
                : sel.fek_hol === "hatso" ? "hátsó tengely"
                : sel.fek_hol === "elso" ? "első tengely" : "egy tengely";
            labourTotal += addLabour(`${withDisc ? "Fékbetét és féktárcsa csere" : "Fékbetét csere"}, ${where}${epb ? ", elektromos kézifékkel" : ""}`, h, J.rate);
            addPart(`Fékbetét${axles === 2 ? " (2 tengely)" : ""}`, "fekbetet", axles);
            if (withDisc) addPart(`Féktárcsa${axles === 2 ? " (2 tengely)" : ""}`, "fektarcsa", axles);
            if (!withDisc) {
                ex.push(`Ha a tárcsa a mérésnél a kopáshatár alatt van, a tárcsapár ${money(A.fektarcsa[t] * partsK(sel))}-tól, plusz ${num(hours("fek_tarcsa_extra", sel))} óra munka.`);
            }
            if (!epb && CONDITIONAL.fek_kezifek(sel)) {
                ex.push(`Ha mégis elektromos a kézifék, a teszteres visszaállítás ${num(hours("fek_ekezifek_extra", sel))} óra munkadíj.`);
            }
            ex.push("Beszorult féknyereg vagy letört vezetőcsap a helyszínen derül ki, javítása külön tétel.");
        } else if (j === "vezermuszij") {
            const chain = sel.vezerles_tipus === "lanc";
            const pump = sel.vez_vizpumpa === "igen";
            let h = hours(chain ? "vezermulanc" : "vezermuszij", sel);
            if (pump) h += hours("vizpumpa_extra", sel);
            labourTotal += addLabour(
                (chain ? "Vezérműlánc csere" : "Vezérműszíj csere") + (pump ? " vízpumpával" : ""), h, J.rate);
            if (chain) addPart("Vezérműlánc készlet (lánc, feszítő, sínek)", "vezermulanc_keszlet");
            else addPart("Vezérműszíj készlet (szíj, feszítő, görgők)", "vezermuszij_keszlet");
            if (pump) addPart("Vízpumpa", "vizpumpa");
            else ex.push(`Vízpumpa, ha mégis vele megy: ${money(A.vizpumpa[t] * partsK(sel))} alkatrész, a munkadíj ugyanennyi marad.`);
            if (!chain && sel.vezerles_tipus !== "szij") {
                // The floor assumes the cheaper belt, so the dearer chain has to
                // be named, not quietly left out.
                ex.push(`A becslés **szíjas vezérléssel** számol. Ha lánc van benne, az alkatrész ${money(A.vezermulanc_keszlet[t] * partsK(sel))}-tól, a munka pedig ${num(hours("vezermulanc", sel))} óra.`);
            }
            ex.push("Hűtőfolyadék, ha a vízpumpa is cserélődik, valamint a szétszedésnél kiderülő kopott görgő vagy feszítő.");
            if (kmVal >= 200000) flags.push(`${num(kmVal / 1000)} ezer kilométernél a vízpumpa és a hosszbordás szíj is elhasználódott, ezt a szerelő a szétszedésnél megnézi.`);
        } else if (j === "kuplung") {
            const auto = sel.kuplung_valto === "automata";
            const awd = sel.kuplung_hajtas === "awd";
            let h = hours("kuplung", sel);
            if (auto) h += hours("kuplung_automata_extra", sel);
            if (awd) h += hours("kuplung_awd_extra", sel);
            labourTotal += addLabour(J.label + (auto ? " (automata)" : "") + (awd ? ", összkerékhajtás" : ""), h, J.rate);
            addPart("Kuplungszett (tárcsa, szerkezet, kinyomó)", "kuplung_szett");
            if (sel.kuplung_ktl === "igen") addPart("Kettőstömegű lendkerék", "ktl_lendkerek");
            else ex.push(`Ha a kettőstömegű lendkerék kopott, cseréje ${money(A.ktl_lendkerek[t] * partsK(sel))}-tól. Ez a szétszerelés után derül ki.`);
            ex.push("Beszorult féltengely, szivárgó szimering vagy kopott váltóbak a kiszereléskor derül ki.");
        } else if (j === "kipufogo") {
            const kat = sel.kipufogo_resz === "kat";
            labourTotal += addLabour(J.label, hours(kat ? "katalizator" : "kipufogo", sel), J.rate);
            addPart(kat ? "Katalizátor / részecskeszűrő" : "Kipufogódob", kat ? "katalizator" : "kipufogo_dob");
            ex.push("Leszakadt bilincs, rozsdás csőcsonk vagy letört tanulmánycsavar pótlása külön tétel.");
        } else if (j === "akkumulator") {
            const agm = sel.akku_startstop === "igen";
            labourTotal += addLabour(J.label + (agm ? " (AGM, start-stop)" : ""), hours("akkumulator", sel), J.rate);
            addPart(agm ? "AGM akkumulátor (start-stop rendszerhez)" : "Akkumulátor", agm ? "akkumulator_agm" : "akkumulator");
            if (agm) ex.push("Start-stop rendszernél az új akkumulátort be kell jelenteni az autó elektronikájának, ez benne van a munkadíjban.");
            else ex.push(`A becslés egy átlagos, 60-70 Ah-s akkumulátorral számol. Ha mégis start-stop rendszer van benne, AGM akku kell: ${money(A.akkumulator_agm[t] * partsK(sel))}-tól.`);
        } else if (j === "klima") {
            labourTotal += addLabour("Klímatöltés, fertőtlenítés", hours("klima", sel), J.rate);
            const yf = usesNewGas(sel);
            addPart(yf ? "Klímagáz (R1234yf, 500 g-ig)" : "Klímagáz (R134a, 500 g-ig)", yf ? "klimagaz_yf" : "klimagaz_r134a");
            if (yf) {
                workings.push(`Klímagáz: a ${yearOf(sel)} körüli évjárat miatt R1234yf, ennek az ára a régi gáz többszöröse`);
                ex.push("500 gramm fölött a gáz grammonként számolódik.");
            } else {
                ex.push(`Az újabb, nagyjából **2017 utáni** autókban R1234yf gáz van, az alkatrészár ennek ${money(A.klimagaz_yf[t] * partsK(sel))} körül van. A becslés a régi, olcsóbb gázzal számol.`);
            }
            if (sel.klima_allapot === "nem_hut") {
                flags.push("Ha egyáltalán nem hűt, az általában szivárgás vagy kompresszorhiba, nem töltés kérdése. Ilyenkor először nyomáspróba és keresés kell, ez a becslés csak a töltésre vonatkozik.");
            }
        } else if (j === "vizsga") {
            labourTotal += addLabour("Vizsga előtti átvizsgálás, beállítás", hours("vizsga", sel), J.rate);
            ex.push("A műszaki vizsga hatósági díja nincs ebben az összegben, azt a vizsgaállomás szedi be.");
            ex.push("Ha az átvizsgáláson hiba derül ki, annak a javítása külön árajánlat.");
        } else if (j === "futomu") {
            labourTotal += addLabour("Futómű-beállítás (számítógépes)", hours("futomu", sel), J.rate);
            ex.push("Ha a beállítás közben kopott gömbfej vagy szilent derül ki, a beállítás csak a csere után van értelme.");
        } else if (j === "gumi") {
            const wheels = sel.gumi_db === "2" ? 0.5 : 1;
            const sizeK = sel.gumi_meret === "m19" ? 1.5 : sel.gumi_meret === "m18" ? 1.25 : 1;
            labourTotal += addLabour(
                `Gumiszerelés, centírozás (${sel.gumi_db === "2" ? "2" : "4"} kerék${sizeK > 1 ? `, ${labelOf("gumi_meret", sel).toLowerCase()}` : ""})`,
                hours("gumi", sel) * wheels * sizeK, J.rate);
            ex.push("A gumiabroncs ára nincs benne, csak a szerelés és a centírozás. Szelepcsere kerekenként külön.");
        }
    }

    // --- consumables ---------------------------------------------------------
    if (labourTotal > 0) {
        const apro = Math.max(P.aproanyag_min, labourTotal * P.aproanyag_szazalek);
        items.push({ label: "Apróanyag, folyadék, kenőanyag", amount: apro });
        workings.push(`Apróanyag: a munkadíj ${Math.round(P.aproanyag_szazalek * 100)}%-a, de legalább ${money(P.aproanyag_min)} = ${itemMoney(apro)}`);
    }

    // --- the symptom path ----------------------------------------------------
    if (symptom) {
        items.push({ label: "Műszeres diagnosztika (hibakeresés)", amount: P.diagnosztika_dij });
        workings.push(`Diagnosztika: fix ${itemMoney(P.diagnosztika_dij)} - szándékosan a ${money(P.oradij.diagnosztika)}/órás műszeres óradíj alatt, és a javítás árából levonjuk`);
        flags.push("A leírt tünetre szándékosan nem adok javítási árat. Ezt meg kell nézni, anélkül csak tippelnénk.");
        ex.push("A hibakeresés után a javításra külön, tételes árajánlatot kapsz, és te döntesz.");
        ex.push("A diagnosztika díját levonjuk a javítás árából, ha nálunk javíttatod meg.");
    }

    // --- honest notes about what the quote assumed ---------------------------
    // Without a VIN this is a price for a TYPE of car, not for this car. That is
    // the single biggest limit on the number, so it is said as a flag, in bold,
    // not buried as the fourth bullet of an exclusions list.
    if (!vinLooksValid(sel.vin)) {
        flags.push("Alvázszám nélkül ez a **típusra** szól, nem erre a konkrét autóra. Egy motorhoz több alkatrészváltozat is tartozik (más féktárcsa-átmérő, más szíjkészlet), és azt csak az alvázszám dönti el. A szerviz ezt még egyeztetni fogja, mielőtt bármit megrendel.");
    } else {
        ex.push("A pontos alkatrészváltozatot a szerviz az alvázszámból nézi ki, és a megrendelés előtt visszaigazolja.");
    }
    if (sel.parts_tier === "nem_tudom") {
        ex.push("Alkatrész-kategória nélkül a legolcsóbb, utángyártott árral számoltam. Márkás alkatrésszel jellemzően 40-70 százalékkal több.");
    }
    if (sel.engine === "nem_tudom" || !sel.engine) {
        ex.push("Motor nélkül a rövidebb, benzines normaidővel és a kisebb olajmennyiséggel számoltam. Dízelnél mindkettő több.");
    }
    if (!yearOf(sel)) {
        ex.push("Évjárat nélkül átlagos alkatrészárral számoltam; régebbi autónál beszorult, rozsdás kötőelemek jönnek hozzá.");
    }

    return {
        title: title(sel),
        items,
        workings,
        diagnosticOnly: symptom && priced.length === 0,
        includes: priced.length
            ? "a munkadíjat, a felsorolt alkatrészeket és az apróanyagot tartalmazza, a választott alkatrész-kategória legolcsóbb változatával számolva"
            : "a műszeres hibakeresést tartalmazza",
        exclusions: ex,
        flags,
        expertise: expertiseNote(sel),
    };
}

// ---------------------------------------------------------------------------
//  VIN helpers re-exported so the engine can use them without a second import
// ---------------------------------------------------------------------------
export { vinLooksValid, vinYear, vinMake, SAMPLE_VIN, fuelOf, classOf };

// What the bot says back about a VIN it just accepted. Reading the year and the
// make out of it is the moment the customer realises the thing actually looked
// at what it was given - but only where it can do that honestly:
//  - the prototype's sample VIN belongs to no real car, so it claims nothing;
//  - a VIN whose make disagrees with the make the customer typed is FLAGGED,
//    not overruled. A VIN typed on a phone has a typo in it more often than it
//    does not, and quietly announcing the wrong car is worse than asking.
export function vinNote(vin, sel = {}) {
    if (!vinLooksValid(vin)) return null;
    const v = String(vin).replace(/[\s-]/g, "").toUpperCase();
    if (v === SAMPLE_VIN) {
        return "Megvan - ez a **minta alvázszám**, élesben a sajátodat írnád be. A szerviz ebből látja, melyik alkatrészváltozat megy az autóba.";
    }
    const y = vinYear(v);
    const mk = vinMake(v);
    const told = String(sel.make || "").trim();
    if (mk && told && told !== "__egyeb" && mk.toLowerCase() !== told.toLowerCase()) {
        return `Megvan az alvázszám. Ez viszont egy **${mk}** alvázszáma, te meg **${told}**-t írtál - a szerviz ezt egyezteti, nehogy rossz alkatrész érkezzen.`;
    }
    const bits = [];
    if (mk) bits.push(`**${mk}**`);
    if (y) bits.push(`**${y}-es** évjárat`);
    if (!bits.length) return "Megvan az alvázszám, ebből a szerviz pontosan látja, melyik változat kell.";
    return `Megvan: ${bits.join(", ")}. Ebből a szerviz pontosan látja, melyik változat kell.`;
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
            engine: "1.2 benzin", year: "2010–2014", vin: "Nincs kéznél", km: "150–200 000 km",
            olaj_szuro: "Csak az olajszűrő", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 14000, max: 60000,
    },
    {
        name: "Olajcsere, VW Passat 2.0 TDI (nagyobb motor, több olaj), márkás",
        answers: {
            jobs: ["Olajcsere, szűrőcsere"], make: "Volkswagen", model: "Passat",
            engine: "2.0 TDI dízel", year: "2015–2019", vin: "Nincs kéznél", km: "100–150 000 km",
            olaj_szuro: "Minden szűrőt cseréljünk", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 30000, max: 110000,
    },
    {
        name: "Fékbetét első tengely, Opel Astra 1.7 CDTI, utángyártott",
        answers: {
            jobs: ["Fék (betét, tárcsa)"], make: "Opel", model: "Astra",
            engine: "1.7 CDTI dízel", year: "2010–2014", vin: "Nincs kéznél",
            fek_hol: "Első", fek_tarcsa: "Csak betét", parts_tier: "Utángyártott - a legolcsóbb",
        },
        min: 15000, max: 60000,
    },
    {
        name: "Hátsó fék elektromos kézifékkel, Škoda Superb 2.0 TDI, márkás",
        answers: {
            jobs: ["Fék (betét, tárcsa)"], make: "Škoda", model: "Superb",
            engine: "2.0 TDI dízel", year: "2015–2019", vin: "Nincs kéznél",
            fek_hol: "Hátsó", fek_tarcsa: "Betét és tárcsa", fek_kezifek: "Igen, gombos",
            parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 60000, max: 250000,
    },
    {
        name: "Vezérműszíj + vízpumpa, VW Passat 2.0 TDI, márkás",
        answers: {
            jobs: ["Vezérlés csere (szíj vagy lánc)"], make: "Volkswagen", model: "Passat",
            engine: "2.0 TDI dízel", year: "2010–2014", vin: "Nincs kéznél", km: "200–300 000 km",
            vezerles_tipus: "Szíj", vez_vizpumpa: "Igen, menjen vele", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 90000, max: 260000,
    },
    {
        name: "VezérműLÁNC, VW Golf 1.4 TSI, márkás - a szíjnál lényegesen több",
        answers: {
            jobs: ["Vezérlés csere (szíj vagy lánc)"], make: "Volkswagen", model: "Golf",
            engine: "1.4 TSI benzin", year: "2010–2014", vin: "Nincs kéznél", km: "150–200 000 km",
            vezerles_tipus: "Lánc", vez_vizpumpa: "Nem, csak a vezérlés", parts_tier: "Márkás utángyártott (Bosch, TRW, Febi)",
        },
        min: 100000, max: 450000,
    },
    {
        name: "Kuplung, Ford Focus 1.6 TDCi, kettőstömegű nélkül, utángyártott",
        answers: {
            jobs: ["Kuplungcsere"], make: "Ford", model: "Focus",
            engine: "1.6 TDCi dízel", year: "2005–2009", vin: "Nincs kéznél",
            kuplung_valto: "Manuális", kuplung_ktl: "Nem", kuplung_hajtas: "Elsőkerék",
            parts_tier: "Utángyártott - a legolcsóbb",
        },
        min: 90000, max: 300000,
    },
    {
        name: "Klímatöltés régi gázzal, Škoda Octavia 1.6 TDI, 2010–2014",
        answers: {
            jobs: ["Klíma (töltés, fertőtlenítés)"], make: "Škoda", model: "Octavia",
            engine: "1.6 TDI dízel", year: "2010–2014", vin: "Nincs kéznél",
            klima_allapot: "Hűt, csak gyengébben", parts_tier: "Utángyártott - a legolcsóbb",
        },
        min: 15000, max: 45000,
    },
    {
        name: "Klímatöltés ÚJ gázzal (2020+), Toyota Corolla hibrid - az évjáratból derül ki",
        answers: {
            jobs: ["Klíma (töltés, fertőtlenítés)"], make: "Toyota", model: "Corolla",
            engine: "1.8 hibrid", year: "2020 vagy újabb", vin: "Nincs kéznél",
            klima_allapot: "Hűt, csak gyengébben", parts_tier: "Utángyártott - a legolcsóbb",
        },
        min: 40000, max: 110000,
    },
    {
        name: "Tünet: furcsa zaj - NEM adhat javítási árat, csak diagnosztikát",
        answers: {
            jobs: ["Valami baja van, nem tudom mi"], make: "BMW", model: "3-as",
            engine: "320d dízel", year: "2010–2014", vin: "Nincs kéznél", km: "200–300 000 km",
            tunet_leiras: "Fékezésnél csikorog és rángat a kormány.",
        },
        min: 10000, max: 20000, diagnosticOnly: true,
    },
    {
        name: "Két munka egyszerre: olajcsere + fék, BMW 5-ös (felső kategória)",
        answers: {
            jobs: ["Olajcsere, szűrőcsere", "Fék (betét, tárcsa)"],
            make: "BMW", model: "5-ös", engine: "520d dízel", year: "2015–2019", vin: "Nincs kéznél",
            km: "100–150 000 km", olaj_szuro: "Minden szűrőt cseréljünk", fek_hol: "Mind a kettő",
            fek_tarcsa: "Betét és tárcsa", fek_kezifek: "Igen, gombos", parts_tier: "Gyári (OEM)",
        },
        min: 200000, max: 900000,
    },
];

// ---------------------------------------------------------------------------
//  WHAT THE AI MAY SAY. It runs the conversation, it never prices anything.
// ---------------------------------------------------------------------------
export const KNOWLEDGE = `- Ez egy PROTOTÍPUS, minta árakkal. Nem egy konkrét szerviz katalógusából dolgozik: ${SAMPLE_NOTICE}
- A szerviz ezeket vállalja: ${Object.values(JOBS).filter((j) => !j.blocked && !j.symptom).map((j) => j.label).join(", ")}.
- Amit nem vállal, arra nem ad árat és nem is veszi fel az igényt.
- Tünetre (furcsa zaj, rángat, füstöl, világít a lámpa) SOHA nem mondunk javítási árat, csak műszeres diagnosztikát ajánlunk, annak a díjával.
- A diagnosztika díját levonjuk a javítás árából, ha a javítás is itt készül.
- Az árajánlat alapár ("-tól"), nem fix ár: a munkadíj normaidő szerint, az alkatrész a választott kategória legolcsóbb árával. Amit nem tartalmaz, azt a becslés tételesen felsorolja.
- A megadott összegek bruttó árak, az ÁFA benne van.
- Az olaj mennyiségét a motor méretéből, a klímagáz fajtáját az évjáratból számoljuk ki - ezeket nem kell az ügyfélnek tudnia.
- Az alvázszám azért kell, mert egy típushoz több alkatrészváltozat is tartozik. Enélkül is megy a folyamat, csak a szerviz a rendszám vagy az alvázszám alapján erősíti meg.
- A rendszámot azért kérjük, mert a szervizek rendszám szerint tartják nyilván az autót.
- Végleges árat mindig a szerviz erősít meg, miután látta az autót.`;
