// ============================================================================
//  CAR CATALOGUE - make, model, engine, and the size class that moves labour.
//
//  WHY THIS EXISTS: a customer volunteers "Opel Astra" and nothing else. The
//  engine is what decides the normaidő (a 1.9 TDI vezérműszíj is not a 1.4
//  benzin vezérműszíj), and asking a layman to type an engine code produces
//  rubbish. So the bot asks make -> model -> engine, and each answer FILTERS the
//  next one's buttons: by the time we get to the engine there are four or five
//  options, all real for that car, and it is one tap.
//
//  The list is deliberately the Hungarian used-car parc, not a world catalogue:
//  the twenty-odd makes that actually roll into a Hungarian workshop. Anything
//  not here is still accepted as free text ("Egyéb") - the flow never blocks on
//  a car it has not heard of, it just loses the engine filter.
//
//  CLASS drives the labour multiplier. It is not snobbery: a timing belt on a
//  longitudinal premium engine genuinely takes longer than on a Swift, and
//  every mechanic prices it that way. Model-level class beats make-level class,
//  so a BMW 1-es is "kozep" while the 5-ös is "felso".
// ============================================================================

// Labour multipliers by class. Applied to the normaidő, never to the part price
// (the part price comes from its own tier range).
export const CLASS_MULT = {
    kis: 0.85,    // Swift, Fabia, Panda - small, simple, easy access
    kozep: 1,     // Astra, Golf, Focus - the reference car
    felso: 1.3,   // 5-ös BMW, E-osztály, A6 - tight bays, more to remove
    terepjaro: 1.25, // SUV / 4x4 - height, underbody trays, AWD in the way
};
export const CLASS_LABEL = {
    kis: "kisautó", kozep: "középkategória", felso: "felső kategória", terepjaro: "SUV / terepjáró",
};

const m = (name, cls, engines) => ({ name, class: cls, engines });

export const MAKES = [
    { name: "Opel", class: "kozep", models: [
        m("Corsa", "kis", ["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.3 CDTI dízel"]),
        m("Astra", "kozep", ["1.4 benzin", "1.4 Turbo benzin", "1.6 benzin", "1.6 CDTI dízel", "1.7 CDTI dízel", "2.0 CDTI dízel"]),
        m("Insignia", "felso", ["1.6 Turbo benzin", "2.0 Turbo benzin", "2.0 CDTI dízel"]),
        m("Zafira", "kozep", ["1.6 benzin", "1.8 benzin", "1.7 CDTI dízel", "2.0 CDTI dízel"]),
        m("Meriva", "kis", ["1.4 benzin", "1.4 Turbo benzin", "1.3 CDTI dízel", "1.7 CDTI dízel"]),
        m("Mokka", "terepjaro", ["1.4 Turbo benzin", "1.6 CDTI dízel"]),
    ]},
    { name: "Volkswagen", class: "kozep", models: [
        m("Polo", "kis", ["1.0 benzin", "1.2 TSI benzin", "1.4 benzin", "1.4 TDI dízel", "1.6 TDI dízel"]),
        m("Golf", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "2.0 TSI benzin"]),
        m("Passat", "kozep", ["1.4 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "2.0 TSI benzin"]),
        m("Touran", "kozep", ["1.4 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Tiguan", "terepjaro", ["1.4 TSI benzin", "2.0 TDI dízel", "2.0 TSI benzin"]),
        m("Caddy", "kozep", ["1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Transporter", "felso", ["2.0 TDI dízel", "2.5 TDI dízel"]),
    ]},
    { name: "Škoda", class: "kozep", models: [
        m("Fabia", "kis", ["1.0 benzin", "1.2 TSI benzin", "1.4 benzin", "1.4 TDI dízel", "1.6 TDI dízel"]),
        m("Octavia", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Superb", "felso", ["1.8 TSI benzin", "2.0 TDI dízel"]),
        m("Roomster", "kis", ["1.2 TSI benzin", "1.4 benzin", "1.6 TDI dízel"]),
        m("Yeti", "terepjaro", ["1.2 TSI benzin", "2.0 TDI dízel"]),
        m("Rapid", "kozep", ["1.2 TSI benzin", "1.6 TDI dízel"]),
    ]},
    { name: "Ford", class: "kozep", models: [
        m("Fiesta", "kis", ["1.0 EcoBoost benzin", "1.25 benzin", "1.4 benzin", "1.4 TDCi dízel", "1.6 TDCi dízel"]),
        m("Focus", "kozep", ["1.0 EcoBoost benzin", "1.4 benzin", "1.6 benzin", "1.6 TDCi dízel", "1.8 TDCi dízel", "2.0 TDCi dízel"]),
        m("Mondeo", "felso", ["1.6 TDCi dízel", "2.0 TDCi dízel", "2.0 benzin"]),
        m("C-Max", "kozep", ["1.6 benzin", "1.6 TDCi dízel", "2.0 TDCi dízel"]),
        m("Transit", "felso", ["2.0 TDCi dízel", "2.2 TDCi dízel"]),
        m("Kuga", "terepjaro", ["1.5 EcoBoost benzin", "2.0 TDCi dízel"]),
    ]},
    { name: "Renault", class: "kozep", models: [
        m("Clio", "kis", ["1.2 benzin", "1.2 TCe benzin", "1.5 dCi dízel"]),
        m("Mégane", "kozep", ["1.4 TCe benzin", "1.6 benzin", "1.5 dCi dízel", "1.9 dCi dízel"]),
        m("Scénic", "kozep", ["1.4 TCe benzin", "1.6 benzin", "1.5 dCi dízel", "1.9 dCi dízel"]),
        m("Laguna", "felso", ["1.5 dCi dízel", "2.0 dCi dízel"]),
        m("Kangoo", "kozep", ["1.5 dCi dízel", "1.6 benzin"]),
        m("Trafic", "felso", ["1.6 dCi dízel", "2.0 dCi dízel"]),
    ]},
    { name: "Suzuki", class: "kis", models: [
        m("Swift", "kis", ["1.0 BoosterJet benzin", "1.2 benzin", "1.3 benzin", "1.3 DDiS dízel"]),
        m("Ignis", "kis", ["1.2 benzin", "1.3 benzin"]),
        m("SX4", "kis", ["1.6 benzin", "1.9 DDiS dízel", "1.6 DDiS dízel"]),
        m("Vitara", "terepjaro", ["1.6 benzin", "1.4 BoosterJet benzin", "1.6 DDiS dízel"]),
        m("Splash", "kis", ["1.0 benzin", "1.2 benzin", "1.3 DDiS dízel"]),
    ]},
    { name: "Toyota", class: "kozep", models: [
        m("Yaris", "kis", ["1.0 benzin", "1.3 benzin", "1.4 D-4D dízel", "1.5 hibrid"]),
        m("Corolla", "kozep", ["1.4 benzin", "1.6 benzin", "1.4 D-4D dízel", "2.0 D-4D dízel", "1.8 hibrid"]),
        m("Auris", "kozep", ["1.33 benzin", "1.6 benzin", "1.4 D-4D dízel", "1.8 hibrid"]),
        m("Avensis", "felso", ["1.8 benzin", "2.0 D-4D dízel", "2.2 D-4D dízel"]),
        m("RAV4", "terepjaro", ["2.0 benzin", "2.0 D-4D dízel", "2.5 hibrid"]),
    ]},
    { name: "BMW", class: "felso", models: [
        m("1-es", "kozep", ["116i benzin", "118i benzin", "116d dízel", "118d dízel", "120d dízel"]),
        m("3-as", "kozep", ["316i benzin", "320i benzin", "318d dízel", "320d dízel", "330d dízel"]),
        m("5-ös", "felso", ["520i benzin", "520d dízel", "530d dízel"]),
        m("X1", "terepjaro", ["18i benzin", "18d dízel", "20d dízel"]),
        m("X3", "terepjaro", ["20i benzin", "20d dízel", "30d dízel"]),
    ]},
    { name: "Audi", class: "felso", models: [
        m("A3", "kozep", ["1.4 TFSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("A4", "felso", ["1.8 TFSI benzin", "2.0 TFSI benzin", "1.9 TDI dízel", "2.0 TDI dízel", "3.0 TDI dízel"]),
        m("A6", "felso", ["2.0 TFSI benzin", "2.0 TDI dízel", "3.0 TDI dízel"]),
        m("Q3", "terepjaro", ["1.4 TFSI benzin", "2.0 TDI dízel"]),
        m("Q5", "terepjaro", ["2.0 TFSI benzin", "2.0 TDI dízel", "3.0 TDI dízel"]),
    ]},
    { name: "Mercedes-Benz", class: "felso", models: [
        m("A-osztály", "kozep", ["A160 benzin", "A180 benzin", "A180 CDI dízel", "A200 CDI dízel"]),
        m("C-osztály", "felso", ["C180 benzin", "C200 benzin", "C200 CDI dízel", "C220 CDI dízel"]),
        m("E-osztály", "felso", ["E200 benzin", "E200 CDI dízel", "E220 CDI dízel", "E320 CDI dízel"]),
        m("Vito", "felso", ["109 CDI dízel", "111 CDI dízel", "113 CDI dízel"]),
        m("Sprinter", "felso", ["211 CDI dízel", "311 CDI dízel", "313 CDI dízel"]),
    ]},
    { name: "Peugeot", class: "kozep", models: [
        m("206", "kis", ["1.1 benzin", "1.4 benzin", "1.4 HDi dízel", "1.6 HDi dízel"]),
        m("207", "kis", ["1.4 benzin", "1.6 benzin", "1.4 HDi dízel", "1.6 HDi dízel"]),
        m("308", "kozep", ["1.2 PureTech benzin", "1.6 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("407", "felso", ["1.8 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("Partner", "kozep", ["1.6 benzin", "1.6 HDi dízel"]),
    ]},
    { name: "Citroën", class: "kozep", models: [
        m("C3", "kis", ["1.1 benzin", "1.4 benzin", "1.4 HDi dízel", "1.6 HDi dízel"]),
        m("C4", "kozep", ["1.4 benzin", "1.6 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("C5", "felso", ["1.8 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("Berlingo", "kozep", ["1.6 benzin", "1.6 HDi dízel"]),
        m("Xsara Picasso", "kozep", ["1.6 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
    ]},
    { name: "Fiat", class: "kis", models: [
        m("Punto", "kis", ["1.2 benzin", "1.4 benzin", "1.3 JTD dízel"]),
        m("Panda", "kis", ["1.1 benzin", "1.2 benzin", "1.3 JTD dízel"]),
        m("Bravo", "kozep", ["1.4 benzin", "1.6 JTD dízel", "1.9 JTD dízel"]),
        m("Doblo", "kozep", ["1.4 benzin", "1.3 JTD dízel", "1.6 JTD dízel"]),
        m("Ducato", "felso", ["2.0 JTD dízel", "2.3 JTD dízel"]),
    ]},
    { name: "Seat", class: "kozep", models: [
        m("Ibiza", "kis", ["1.2 TSI benzin", "1.4 benzin", "1.4 TDI dízel", "1.6 TDI dízel"]),
        m("León", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Altea", "kozep", ["1.6 benzin", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Toledo", "kozep", ["1.2 TSI benzin", "1.6 TDI dízel"]),
    ]},
    { name: "Hyundai", class: "kozep", models: [
        m("i20", "kis", ["1.2 benzin", "1.4 benzin", "1.1 CRDi dízel", "1.4 CRDi dízel"]),
        m("i30", "kozep", ["1.4 benzin", "1.6 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel"]),
        m("ix35", "terepjaro", ["1.6 benzin", "1.7 CRDi dízel", "2.0 CRDi dízel"]),
        m("Tucson", "terepjaro", ["1.6 benzin", "1.7 CRDi dízel", "2.0 CRDi dízel"]),
        m("Getz", "kis", ["1.1 benzin", "1.4 benzin", "1.5 CRDi dízel"]),
    ]},
    { name: "Kia", class: "kozep", models: [
        m("Ceed", "kozep", ["1.4 benzin", "1.6 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel"]),
        m("Rio", "kis", ["1.2 benzin", "1.4 benzin", "1.1 CRDi dízel", "1.4 CRDi dízel"]),
        m("Sportage", "terepjaro", ["1.6 benzin", "1.7 CRDi dízel", "2.0 CRDi dízel"]),
        m("Picanto", "kis", ["1.0 benzin", "1.2 benzin"]),
        m("Venga", "kis", ["1.4 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel"]),
    ]},
    { name: "Honda", class: "kozep", models: [
        m("Civic", "kozep", ["1.4 benzin", "1.8 benzin", "2.2 i-CTDi dízel", "1.6 i-DTEC dízel"]),
        m("Accord", "felso", ["2.0 benzin", "2.2 i-CTDi dízel"]),
        m("CR-V", "terepjaro", ["2.0 benzin", "2.2 i-CTDi dízel"]),
        m("Jazz", "kis", ["1.2 benzin", "1.4 benzin"]),
    ]},
    { name: "Nissan", class: "kozep", models: [
        m("Qashqai", "terepjaro", ["1.2 DIG-T benzin", "1.6 benzin", "1.5 dCi dízel", "1.6 dCi dízel"]),
        m("Micra", "kis", ["1.0 benzin", "1.2 benzin", "1.5 dCi dízel"]),
        m("Juke", "terepjaro", ["1.6 benzin", "1.5 dCi dízel"]),
        m("X-Trail", "terepjaro", ["2.0 benzin", "1.6 dCi dízel", "2.0 dCi dízel"]),
    ]},
    { name: "Mazda", class: "kozep", models: [
        m("3", "kozep", ["1.6 benzin", "2.0 benzin", "1.6 CiTD dízel", "2.2 CiTD dízel"]),
        m("6", "felso", ["2.0 benzin", "2.0 CiTD dízel", "2.2 CiTD dízel"]),
        m("CX-5", "terepjaro", ["2.0 benzin", "2.2 CiTD dízel"]),
        m("2", "kis", ["1.3 benzin", "1.5 benzin"]),
    ]},
    { name: "Dacia", class: "kis", models: [
        m("Duster", "terepjaro", ["1.6 benzin", "1.2 TCe benzin", "1.5 dCi dízel"]),
        m("Sandero", "kis", ["1.0 benzin", "1.2 benzin", "1.5 dCi dízel"]),
        m("Logan", "kis", ["1.2 benzin", "1.4 benzin", "1.5 dCi dízel"]),
        m("Dokker", "kozep", ["1.6 benzin", "1.5 dCi dízel"]),
    ]},
    { name: "Volvo", class: "felso", models: [
        m("V40", "kozep", ["1.6 benzin", "1.6 D2 dízel", "2.0 D3 dízel"]),
        m("V50", "kozep", ["1.8 benzin", "1.6 D dízel", "2.0 D dízel"]),
        m("V70", "felso", ["2.0 benzin", "2.0 D dízel", "2.4 D5 dízel"]),
        m("XC60", "terepjaro", ["2.0 benzin", "2.0 D dízel", "2.4 D5 dízel"]),
    ]},
    { name: "Mitsubishi", class: "kozep", models: [
        m("Lancer", "kozep", ["1.6 benzin", "2.0 benzin", "2.0 DI-D dízel"]),
        m("Outlander", "terepjaro", ["2.0 benzin", "2.2 DI-D dízel"]),
        m("ASX", "terepjaro", ["1.6 benzin", "1.8 DI-D dízel"]),
        m("Colt", "kis", ["1.1 benzin", "1.3 benzin", "1.5 DI-D dízel"]),
    ]},
];

// The makes offered as buttons, in Hungarian-parc order. The rest are reachable
// by typing (the model reads the free text and matches it here).
export const TOP_MAKES = ["Opel", "Volkswagen", "Škoda", "Ford", "Suzuki", "Renault", "Toyota", "BMW", "Audi", "Mercedes-Benz", "Peugeot", "Citroën"];

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function findMake(name) {
    const n = strip(name);
    if (!n) return null;
    return MAKES.find((mk) => strip(mk.name) === n)
        || MAKES.find((mk) => strip(mk.name).startsWith(n) || n.startsWith(strip(mk.name)))
        || null;
}
export function findModel(makeName, modelName) {
    const mk = findMake(makeName);
    if (!mk) return null;
    const n = strip(modelName);
    if (!n) return null;
    return mk.models.find((md) => strip(md.name) === n)
        || mk.models.find((md) => strip(md.name).startsWith(n) || n.startsWith(strip(md.name)))
        || null;
}
export const modelNames = (makeName) => (findMake(makeName)?.models || []).map((md) => md.name);
export const engineNames = (makeName, modelName) => findModel(makeName, modelName)?.engines || [];

// Petrol or diesel, read off the engine label. Everything unknown is treated as
// petrol, which is the SHORTER normaidő - so an unknown engine never inflates
// the quote. Hybrids follow their petrol side for the jobs we price.
export function fuelOf(engine) {
    const e = strip(engine);
    if (!e) return "benzin";
    if (/(dizel|diesel|tdi|cdti|hdi|dci|crdi|jtd|tdci|ctdi|dtec|ddis|d-4d|d4d|di-d|citd|cdi|\bd[0-9]\b|\bd5\b|\btd\b)/.test(e)) return "dizel";
    return "benzin";
}

// Engine size in litres, read off the label. This is what decides how much oil
// the car takes, which is a real chunk of an oil-change bill and something no
// customer can be asked for directly.
//  - "1.6 TDI", "2.0 benzin", "1,4 TSI"  -> the number in front
//  - "320d", "C220 CDI", "520i"          -> German saloon badges, where the last
//    two digits are roughly the displacement in decilitres (320 -> 2.0)
//  - anything unrecognised                -> the class's typical size, which is
//    on the SMALL side on purpose: an unknown must never inflate the floor.
const CLASS_LITRES = { kis: 1.2, kozep: 1.6, felso: 2, terepjaro: 1.8 };
export function displacementOf(engine, cls = "kozep") {
    const e = String(engine || "").trim();
    const dec = e.match(/(\d)[.,](\d)/);
    if (dec) {
        const n = parseFloat(`${dec[1]}.${dec[2]}`);
        if (n >= 0.6 && n <= 8) return n;
    }
    const badge = e.match(/\b[A-Za-z]?(\d)(\d)0\s*[a-zA-Z]?\b/);
    if (badge) {
        // Capped at 4 litres on purpose: it makes "A160" (a 1.6) fall through to
        // the class default instead of being read as a 6-litre engine, and no
        // car in this catalogue is bigger than that anyway.
        const n = parseFloat(`${badge[2]}.0`) || 0;
        if (n >= 1 && n <= 4) return n;
    }
    return CLASS_LITRES[cls] ?? 1.6;
}

// Size class for the labour multiplier: the model's own class if we know the
// model, else the make's, else middle-of-the-road.
export function classOf(makeName, modelName) {
    const md = findModel(makeName, modelName);
    if (md && md.class) return md.class;
    const mk = findMake(makeName);
    if (mk && mk.class) return mk.class;
    return "kozep";
}

// ---------------------------------------------------------------------------
//  VIN
//  17 characters, no I, O or Q (they would be read as 1 and 0). Position 10 is
//  the model year and position 1-3 the manufacturer, so a valid VIN tells us
//  the year without asking - which is exactly the moment the customer realises
//  this thing knows what it is looking at.
// ---------------------------------------------------------------------------
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
export const vinLooksValid = (v) => VIN_RE.test(String(v || "").replace(/[\s-]/g, ""));

// The model year at position 10 is a NORTH AMERICAN regulatory requirement
// (49 CFR 565), not a worldwide one. The German and Japanese makers follow it
// globally, so it reads correctly on a Golf or a Corolla sold in Hungary. The
// French and Italian makers largely do NOT: on a Renault, Peugeot, Citroën,
// Fiat or Dacia built for Europe, position 10 is part of the manufacturer's own
// descriptor and decoding it as a year produces a confident, wrong answer.
//
// So the year is only claimed for manufacturers whose WMI is on the trusted
// list below. For everything else vinYear returns null and the bot simply does
// not mention the year - which is the whole point: a mechanic forgives "nem
// tudom", and never forgives a wrong number stated with confidence.
const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
const YEAR_TRUSTED_WMI = new Set([
    "W0L", "W0V", "VXK",                      // Opel
    "WVW", "WV1", "WV2",                      // Volkswagen
    "TMB", "VSS",                             // Škoda, Seat
    "WAU", "WAP", "TRU",                      // Audi
    "WBA", "WBS", "WBY",                      // BMW
    "WDB", "WDD", "WDC", "WDF",               // Mercedes-Benz
    "WF0", "WF1",                             // Ford
    "JT1", "SB1", "VNK",                      // Toyota
    "JHM", "SHH",                             // Honda
    "JN1", "SJN",                             // Nissan
    "JMZ", "JMB",                             // Mazda, Mitsubishi
    "TSM", "JSA",                             // Suzuki
    "TMA", "KMH", "KNA", "U5Y", "KNE",        // Hyundai, Kia
    "YV1",                                    // Volvo
]);
export function vinYear(vin, now = new Date()) {
    const v = String(vin || "").replace(/[\s-]/g, "").toUpperCase();
    if (!vinLooksValid(v)) return null;
    if (!YEAR_TRUSTED_WMI.has(v.slice(0, 3))) return null;
    const i = YEAR_CODES.indexOf(v[9]);
    if (i < 0) return null;
    const thisYear = now.getFullYear();
    let year = 1980 + i;
    while (year + 30 <= thisYear + 1) year += 30;
    return year;
}

// World Manufacturer Identifier -> make, for the common European prefixes. Only
// used to say the make back to the customer; it never overrides what they told
// us, because a VIN typed on a phone has a typo in it more often than not.
const WMI = {
    W0L: "Opel", W0V: "Opel", VXK: "Opel", WVW: "Volkswagen", WV1: "Volkswagen", WV2: "Volkswagen",
    TMB: "Škoda", WAU: "Audi", WAP: "Audi", TRU: "Audi", WBA: "BMW", WBS: "BMW", WBY: "BMW",
    WDB: "Mercedes-Benz", WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", WDF: "Mercedes-Benz",
    WF0: "Ford", WF1: "Ford", VF1: "Renault", VF3: "Peugeot", VF7: "Citroën", VF6: "Renault",
    ZFA: "Fiat", VSS: "Seat", TMA: "Hyundai", KMH: "Hyundai", KNA: "Kia", U5Y: "Kia", KNE: "Kia",
    JMZ: "Mazda", JHM: "Honda", SHH: "Honda", JN1: "Nissan", SJN: "Nissan", JT1: "Toyota",
    SB1: "Toyota", VNK: "Toyota", TSM: "Suzuki", JSA: "Suzuki", YV1: "Volvo", UU1: "Dacia",
    JMB: "Mitsubishi", VF8: "Mitsubishi",
};
export function vinMake(vin) {
    const v = String(vin || "").replace(/[\s-]/g, "").toUpperCase();
    if (!vinLooksValid(v)) return null;
    return WMI[v.slice(0, 3)] || null;
}

// A realistic sample VIN for the prototype's "nem írom be" button. It is a real
// WMI (Opel) with a valid year code and otherwise invented digits, so it decodes
// correctly and belongs to no actual car.
export const SAMPLE_VIN = "W0L0AHL4885072341";
