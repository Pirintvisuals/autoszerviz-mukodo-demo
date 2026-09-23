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
        m("Agila", "kis", ["1.0 benzin", "1.2 benzin", "1.3 CDTI dízel"]),
        m("Corsa", "kis", ["1.0 benzin", "1.2 benzin", "1.4 benzin", "1.0 Turbo benzin", "1.2 Turbo benzin", "1.3 CDTI dízel", "1.5 dízel", "elektromos"]),
        m("Astra", "kozep", ["1.0 Turbo benzin", "1.2 benzin", "1.2 Turbo benzin", "1.4 benzin", "1.4 Turbo benzin", "1.6 benzin", "1.6 Turbo benzin", "1.8 benzin", "1.3 CDTI dízel", "1.5 dízel", "1.6 CDTI dízel", "1.7 CDTI dízel", "1.9 CDTI dízel", "2.0 CDTI dízel"]),
        m("Vectra", "kozep", ["1.6 benzin", "1.8 benzin", "2.2 benzin", "1.9 CDTI dízel", "2.2 DTI dízel"]),
        m("Insignia", "felso", ["1.4 Turbo benzin", "1.5 Turbo benzin", "1.6 Turbo benzin", "1.8 benzin", "2.0 Turbo benzin", "1.6 CDTI dízel", "2.0 CDTI dízel"]),
        m("Zafira", "kozep", ["1.4 Turbo benzin", "1.6 benzin", "1.8 benzin", "2.2 benzin", "1.6 CDTI dízel", "1.7 CDTI dízel", "1.9 CDTI dízel", "2.0 CDTI dízel"]),
        m("Meriva", "kis", ["1.4 benzin", "1.4 Turbo benzin", "1.6 benzin", "1.3 CDTI dízel", "1.6 CDTI dízel", "1.7 CDTI dízel"]),
        m("Mokka", "terepjaro", ["1.2 Turbo benzin", "1.4 Turbo benzin", "1.6 benzin", "1.6 CDTI dízel", "1.7 CDTI dízel", "elektromos"]),
        m("Crossland", "terepjaro", ["1.2 benzin", "1.2 Turbo benzin", "1.5 dízel", "1.6 dízel"]),
        m("Grandland", "terepjaro", ["1.2 Turbo benzin", "1.6 Turbo benzin", "1.5 dízel", "1.6 hibrid"]),
        m("Combo", "kozep", ["1.4 benzin", "1.2 Turbo benzin", "1.3 CDTI dízel", "1.5 dízel", "1.6 CDTI dízel"]),
        m("Vivaro", "felso", ["1.6 CDTI dízel", "1.5 dízel", "2.0 CDTI dízel", "2.0 dízel"]),
        m("Movano", "felso", ["2.2 dízel", "2.3 CDTI dízel", "2.5 CDTI dízel"]),
    ]},
    { name: "Volkswagen", class: "kozep", models: [
        m("up!", "kis", ["1.0 benzin", "1.0 TSI benzin", "elektromos"]),
        m("Fox", "kis", ["1.2 benzin", "1.4 benzin", "1.4 TDI dízel"]),
        m("Polo", "kis", ["1.0 benzin", "1.0 TSI benzin", "1.2 benzin", "1.2 TSI benzin", "1.4 benzin", "1.2 TDI dízel", "1.4 TDI dízel", "1.6 TDI dízel", "1.9 TDI dízel"]),
        m("Golf", "kozep", ["1.0 TSI benzin", "1.2 TSI benzin", "1.4 benzin", "1.4 TSI benzin", "1.5 TSI benzin", "1.6 benzin", "2.0 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "1.4 GTE hibrid", "elektromos"]),
        m("Golf Plus", "kozep", ["1.2 TSI benzin", "1.4 benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Jetta", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Passat", "kozep", ["1.4 TSI benzin", "1.5 TSI benzin", "1.6 benzin", "1.8 TSI benzin", "2.0 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "1.4 GTE hibrid"]),
        m("Arteon", "felso", ["1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel", "1.4 hibrid"]),
        m("Touran", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.5 TSI benzin", "1.6 benzin", "2.0 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Sharan", "felso", ["1.4 TSI benzin", "1.8 benzin", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("T-Cross", "terepjaro", ["1.0 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel"]),
        m("T-Roc", "terepjaro", ["1.0 TSI benzin", "1.5 TSI benzin", "2.0 TSI benzin", "1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Tiguan", "terepjaro", ["1.4 TSI benzin", "1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel", "1.4 hibrid"]),
        m("Touareg", "terepjaro", ["3.6 benzin", "2.5 TDI dízel", "3.0 TDI dízel"]),
        m("Caddy", "kozep", ["1.0 TSI benzin", "1.2 TSI benzin", "1.4 benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Transporter", "felso", ["1.9 TDI dízel", "2.0 TDI dízel", "2.5 TDI dízel", "2.0 benzin"]),
        m("Crafter", "felso", ["2.0 TDI dízel", "2.5 TDI dízel"]),
        m("ID.3", "kozep", ["elektromos"]),
        m("ID.4", "terepjaro", ["elektromos"]),
    ]},
    { name: "Škoda", class: "kozep", models: [
        m("Citigo", "kis", ["1.0 benzin", "elektromos"]),
        m("Fabia", "kis", ["1.0 benzin", "1.0 TSI benzin", "1.2 benzin", "1.2 TSI benzin", "1.4 benzin", "1.2 TDI dízel", "1.4 TDI dízel", "1.6 TDI dízel", "1.9 TDI dízel"]),
        m("Scala", "kozep", ["1.0 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel"]),
        m("Rapid", "kozep", ["1.0 TSI benzin", "1.2 TSI benzin", "1.4 TSI benzin", "1.6 TDI dízel"]),
        m("Octavia", "kozep", ["1.0 TSI benzin", "1.2 TSI benzin", "1.4 benzin", "1.4 TSI benzin", "1.5 TSI benzin", "1.6 benzin", "1.8 TSI benzin", "2.0 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "1.4 iV hibrid"]),
        m("Superb", "felso", ["1.4 TSI benzin", "1.5 TSI benzin", "1.8 TSI benzin", "2.0 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "1.4 iV hibrid"]),
        m("Roomster", "kis", ["1.2 TSI benzin", "1.4 benzin", "1.6 benzin", "1.2 TDI dízel", "1.6 TDI dízel", "1.9 TDI dízel"]),
        m("Yeti", "terepjaro", ["1.2 TSI benzin", "1.4 TSI benzin", "1.8 TSI benzin", "1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Kamiq", "terepjaro", ["1.0 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel"]),
        m("Karoq", "terepjaro", ["1.0 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Kodiaq", "terepjaro", ["1.4 TSI benzin", "1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel"]),
        m("Enyaq", "terepjaro", ["elektromos"]),
    ]},
    { name: "Ford", class: "kozep", models: [
        m("Ka", "kis", ["1.2 benzin", "1.3 benzin", "1.3 TDCi dízel"]),
        m("Fiesta", "kis", ["1.0 EcoBoost benzin", "1.1 benzin", "1.25 benzin", "1.4 benzin", "1.6 benzin", "1.4 TDCi dízel", "1.5 TDCi dízel", "1.6 TDCi dízel"]),
        m("Fusion", "kis", ["1.4 benzin", "1.6 benzin", "1.4 TDCi dízel", "1.6 TDCi dízel"]),
        m("B-Max", "kis", ["1.0 EcoBoost benzin", "1.4 benzin", "1.6 benzin", "1.5 TDCi dízel", "1.6 TDCi dízel"]),
        m("Focus", "kozep", ["1.0 EcoBoost benzin", "1.4 benzin", "1.5 EcoBoost benzin", "1.6 benzin", "1.8 benzin", "2.0 benzin", "1.5 TDCi dízel", "1.5 EcoBlue dízel", "1.6 TDCi dízel", "1.8 TDCi dízel", "2.0 TDCi dízel", "2.0 EcoBlue dízel"]),
        m("C-Max", "kozep", ["1.0 EcoBoost benzin", "1.6 benzin", "1.8 benzin", "1.5 TDCi dízel", "1.6 TDCi dízel", "2.0 TDCi dízel"]),
        m("S-Max", "felso", ["1.5 EcoBoost benzin", "2.0 benzin", "2.0 TDCi dízel", "2.0 EcoBlue dízel"]),
        m("Galaxy", "felso", ["2.0 benzin", "1.9 TDI dízel", "2.0 TDCi dízel", "2.0 EcoBlue dízel"]),
        m("Mondeo", "felso", ["1.5 EcoBoost benzin", "2.0 benzin", "2.5 benzin", "1.8 TDCi dízel", "1.6 TDCi dízel", "2.0 TDCi dízel", "2.0 hibrid"]),
        m("EcoSport", "terepjaro", ["1.0 EcoBoost benzin", "1.5 benzin", "1.5 TDCi dízel"]),
        m("Puma", "terepjaro", ["1.0 EcoBoost benzin", "1.5 EcoBlue dízel"]),
        m("Kuga", "terepjaro", ["1.5 EcoBoost benzin", "1.6 EcoBoost benzin", "1.5 TDCi dízel", "2.0 TDCi dízel", "2.0 EcoBlue dízel", "2.5 hibrid"]),
        m("Transit Connect", "kozep", ["1.0 EcoBoost benzin", "1.5 TDCi dízel", "1.8 TDCi dízel"]),
        m("Transit Custom", "felso", ["2.0 EcoBlue dízel", "2.2 TDCi dízel"]),
        m("Transit", "felso", ["2.0 TDCi dízel", "2.0 EcoBlue dízel", "2.2 TDCi dízel", "2.4 TDCi dízel"]),
        m("Ranger", "terepjaro", ["2.0 EcoBlue dízel", "2.2 TDCi dízel", "2.5 TDCi dízel", "3.2 TDCi dízel"]),
    ]},
    { name: "Renault", class: "kozep", models: [
        m("Twingo", "kis", ["1.0 SCe benzin", "1.2 benzin", "0.9 TCe benzin", "elektromos"]),
        m("Clio", "kis", ["0.9 TCe benzin", "1.0 TCe benzin", "1.2 benzin", "1.2 TCe benzin", "1.3 TCe benzin", "1.4 benzin", "1.6 benzin", "1.5 dCi dízel", "1.6 E-Tech hibrid"]),
        m("Captur", "terepjaro", ["0.9 TCe benzin", "1.0 TCe benzin", "1.2 TCe benzin", "1.3 TCe benzin", "1.5 dCi dízel", "1.6 E-Tech hibrid"]),
        m("Mégane", "kozep", ["1.2 TCe benzin", "1.3 TCe benzin", "1.4 benzin", "1.4 TCe benzin", "1.6 benzin", "2.0 benzin", "1.5 dCi dízel", "1.6 dCi dízel", "1.9 dCi dízel", "1.6 E-Tech hibrid"]),
        m("Scénic", "kozep", ["1.2 TCe benzin", "1.3 TCe benzin", "1.4 TCe benzin", "1.6 benzin", "2.0 benzin", "1.5 dCi dízel", "1.6 dCi dízel", "1.9 dCi dízel"]),
        m("Laguna", "felso", ["1.6 benzin", "2.0 benzin", "1.5 dCi dízel", "1.9 dCi dízel", "2.0 dCi dízel"]),
        m("Talisman", "felso", ["1.3 TCe benzin", "1.6 TCe benzin", "1.6 dCi dízel", "1.7 dCi dízel", "2.0 dCi dízel"]),
        m("Kadjar", "terepjaro", ["1.2 TCe benzin", "1.3 TCe benzin", "1.5 dCi dízel", "1.6 dCi dízel"]),
        m("Koleos", "terepjaro", ["2.5 benzin", "1.7 dCi dízel", "2.0 dCi dízel"]),
        m("Arkana", "terepjaro", ["1.3 TCe benzin", "1.6 E-Tech hibrid"]),
        m("Kangoo", "kozep", ["1.2 TCe benzin", "1.4 benzin", "1.6 benzin", "1.5 dCi dízel", "elektromos"]),
        m("Trafic", "felso", ["1.6 dCi dízel", "1.9 dCi dízel", "2.0 dCi dízel", "2.5 dCi dízel"]),
        m("Master", "felso", ["2.3 dCi dízel", "2.5 dCi dízel"]),
        m("Zoe", "kis", ["elektromos"]),
    ]},
    { name: "Suzuki", class: "kis", models: [
        m("Alto", "kis", ["1.0 benzin"]),
        m("Wagon R+", "kis", ["1.0 benzin", "1.2 benzin", "1.3 benzin"]),
        m("Swift", "kis", ["1.0 BoosterJet benzin", "1.2 benzin", "1.3 benzin", "1.4 BoosterJet benzin", "1.5 benzin", "1.6 benzin", "1.3 DDiS dízel", "1.2 hibrid"]),
        m("Ignis", "kis", ["1.2 benzin", "1.3 benzin", "1.2 hibrid"]),
        m("Baleno", "kis", ["1.0 BoosterJet benzin", "1.2 benzin"]),
        m("Splash", "kis", ["1.0 benzin", "1.2 benzin", "1.3 DDiS dízel"]),
        m("Liana", "kozep", ["1.3 benzin", "1.6 benzin", "1.4 DDiS dízel"]),
        m("SX4", "kis", ["1.5 benzin", "1.6 benzin", "1.6 DDiS dízel", "1.9 DDiS dízel", "2.0 DDiS dízel"]),
        m("SX4 S-Cross", "terepjaro", ["1.0 BoosterJet benzin", "1.4 BoosterJet benzin", "1.6 benzin", "1.6 DDiS dízel", "1.4 hibrid", "1.5 hibrid"]),
        m("Vitara", "terepjaro", ["1.0 BoosterJet benzin", "1.4 BoosterJet benzin", "1.6 benzin", "1.6 DDiS dízel", "1.4 hibrid", "1.5 hibrid"]),
        m("Grand Vitara", "terepjaro", ["1.6 benzin", "2.0 benzin", "2.4 benzin", "1.9 DDiS dízel"]),
        m("Jimny", "terepjaro", ["1.3 benzin", "1.5 benzin"]),
    ]},
    { name: "Toyota", class: "kozep", models: [
        m("Aygo", "kis", ["1.0 benzin"]),
        m("Yaris", "kis", ["1.0 benzin", "1.33 benzin", "1.3 benzin", "1.5 benzin", "1.4 D-4D dízel", "1.5 hibrid"]),
        m("Yaris Cross", "terepjaro", ["1.5 benzin", "1.5 hibrid"]),
        m("Corolla", "kozep", ["1.2 Turbo benzin", "1.33 benzin", "1.4 benzin", "1.6 benzin", "1.8 benzin", "1.4 D-4D dízel", "2.0 D-4D dízel", "1.8 hibrid", "2.0 hibrid"]),
        m("Auris", "kozep", ["1.2 Turbo benzin", "1.33 benzin", "1.4 benzin", "1.6 benzin", "1.4 D-4D dízel", "2.0 D-4D dízel", "1.8 hibrid"]),
        m("Verso", "kozep", ["1.6 benzin", "1.8 benzin", "1.6 D-4D dízel", "2.0 D-4D dízel", "2.2 D-4D dízel"]),
        m("Avensis", "felso", ["1.6 benzin", "1.8 benzin", "2.0 benzin", "1.6 D-4D dízel", "2.0 D-4D dízel", "2.2 D-4D dízel"]),
        m("Prius", "kozep", ["1.5 hibrid", "1.8 hibrid"]),
        m("C-HR", "terepjaro", ["1.2 Turbo benzin", "1.8 hibrid", "2.0 hibrid"]),
        m("RAV4", "terepjaro", ["2.0 benzin", "2.0 D-4D dízel", "2.2 D-4D dízel", "2.5 hibrid"]),
        m("Land Cruiser", "terepjaro", ["2.8 D-4D dízel", "3.0 D-4D dízel", "4.0 benzin"]),
        m("Hilux", "terepjaro", ["2.4 D-4D dízel", "2.5 D-4D dízel", "2.8 D-4D dízel", "3.0 D-4D dízel"]),
        m("Proace", "felso", ["1.5 D-4D dízel", "1.6 D-4D dízel", "2.0 D-4D dízel"]),
    ]},
    { name: "BMW", class: "felso", models: [
        m("1-es", "kozep", ["116i benzin", "118i benzin", "120i benzin", "125i benzin", "116d dízel", "118d dízel", "120d dízel", "123d dízel"]),
        m("2-es Active Tourer", "kozep", ["216i benzin", "218i benzin", "216d dízel", "218d dízel", "225xe hibrid"]),
        m("3-as", "kozep", ["316i benzin", "318i benzin", "320i benzin", "325i benzin", "330i benzin", "316d dízel", "318d dízel", "320d dízel", "325d dízel", "330d dízel", "335d dízel", "330e hibrid"]),
        m("4-es", "felso", ["420i benzin", "428i benzin", "430i benzin", "420d dízel", "430d dízel", "435d dízel"]),
        m("5-ös", "felso", ["520i benzin", "523i benzin", "525i benzin", "528i benzin", "530i benzin", "520d dízel", "525d dízel", "530d dízel", "535d dízel", "530e hibrid"]),
        m("7-es", "felso", ["740i benzin", "750i benzin", "730d dízel", "740d dízel"]),
        m("X1", "terepjaro", ["18i benzin", "20i benzin", "16d dízel", "18d dízel", "20d dízel", "25e hibrid"]),
        m("X3", "terepjaro", ["20i benzin", "28i benzin", "30i benzin", "18d dízel", "20d dízel", "30d dízel", "35d dízel", "30e hibrid"]),
        m("X5", "terepjaro", ["35i benzin", "40i benzin", "30d dízel", "40d dízel", "45e hibrid"]),
        m("i3", "kis", ["elektromos"]),
    ]},
    { name: "Audi", class: "felso", models: [
        m("A1", "kis", ["1.0 TFSI benzin", "1.2 TFSI benzin", "1.4 TFSI benzin", "1.6 TDI dízel"]),
        m("A2", "kis", ["1.4 benzin", "1.6 FSI benzin", "1.4 TDI dízel"]),
        m("A3", "kozep", ["1.0 TFSI benzin", "1.2 TFSI benzin", "1.4 TFSI benzin", "1.5 TFSI benzin", "1.6 benzin", "1.8 TFSI benzin", "2.0 TFSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel", "1.4 e-tron hibrid"]),
        m("A4", "felso", ["1.4 TFSI benzin", "1.8 benzin", "1.8 TFSI benzin", "2.0 benzin", "2.0 TFSI benzin", "1.9 TDI dízel", "2.0 TDI dízel", "2.5 TDI dízel", "2.7 TDI dízel", "3.0 TDI dízel"]),
        m("A5", "felso", ["1.8 TFSI benzin", "2.0 TFSI benzin", "2.0 TDI dízel", "2.7 TDI dízel", "3.0 TDI dízel"]),
        m("A6", "felso", ["2.0 TFSI benzin", "2.4 benzin", "2.8 FSI benzin", "2.0 TDI dízel", "2.5 TDI dízel", "2.7 TDI dízel", "3.0 TDI dízel"]),
        m("A8", "felso", ["4.2 benzin", "3.0 TDI dízel", "4.2 TDI dízel"]),
        m("Q2", "terepjaro", ["1.0 TFSI benzin", "1.4 TFSI benzin", "1.5 TFSI benzin", "1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Q3", "terepjaro", ["1.4 TFSI benzin", "1.5 TFSI benzin", "2.0 TFSI benzin", "2.0 TDI dízel"]),
        m("Q5", "terepjaro", ["2.0 TFSI benzin", "2.0 TDI dízel", "3.0 TDI dízel", "2.0 TFSI hibrid"]),
        m("Q7", "terepjaro", ["3.0 TFSI benzin", "3.0 TDI dízel", "4.2 TDI dízel"]),
        m("e-tron", "terepjaro", ["elektromos"]),
    ]},
    { name: "Mercedes-Benz", class: "felso", models: [
        m("A-osztály", "kozep", ["A140 benzin", "A160 benzin", "A170 benzin", "A180 benzin", "A200 benzin", "A160 CDI dízel", "A180 CDI dízel", "A200 CDI dízel", "A250e hibrid"]),
        m("B-osztály", "kozep", ["B150 benzin", "B170 benzin", "B180 benzin", "B200 benzin", "B180 CDI dízel", "B200 CDI dízel"]),
        m("C-osztály", "felso", ["C180 benzin", "C200 benzin", "C230 benzin", "C250 benzin", "C180 CDI dízel", "C200 CDI dízel", "C220 CDI dízel", "C250 CDI dízel", "C320 CDI dízel", "C300e hibrid"]),
        m("CLA", "kozep", ["CLA180 benzin", "CLA200 benzin", "CLA200 CDI dízel", "CLA220 CDI dízel"]),
        m("E-osztály", "felso", ["E200 benzin", "E250 benzin", "E200 CDI dízel", "E220 CDI dízel", "E250 CDI dízel", "E320 CDI dízel", "E350 CDI dízel", "E300e hibrid"]),
        m("S-osztály", "felso", ["S350 benzin", "S500 benzin", "S320 CDI dízel", "S350 CDI dízel"]),
        m("GLA", "terepjaro", ["GLA180 benzin", "GLA200 benzin", "GLA200 CDI dízel", "GLA220 CDI dízel"]),
        m("GLC", "terepjaro", ["GLC200 benzin", "GLC250 benzin", "GLC220 d dízel", "GLC250 d dízel", "GLC300e hibrid"]),
        m("ML / GLE", "terepjaro", ["ML350 benzin", "ML250 CDI dízel", "ML320 CDI dízel", "ML350 CDI dízel", "GLE350 d dízel"]),
        m("Citan", "kozep", ["108 CDI dízel", "109 CDI dízel", "111 CDI dízel"]),
        m("Vito", "felso", ["109 CDI dízel", "111 CDI dízel", "113 CDI dízel", "114 CDI dízel", "116 CDI dízel", "119 CDI dízel"]),
        m("Sprinter", "felso", ["211 CDI dízel", "213 CDI dízel", "216 CDI dízel", "311 CDI dízel", "313 CDI dízel", "316 CDI dízel", "319 CDI dízel"]),
    ]},
    { name: "Peugeot", class: "kozep", models: [
        m("106", "kis", ["1.0 benzin", "1.1 benzin", "1.4 benzin", "1.5 D dízel"]),
        m("107 / 108", "kis", ["1.0 benzin", "1.2 PureTech benzin"]),
        m("206", "kis", ["1.1 benzin", "1.4 benzin", "1.6 benzin", "1.4 HDi dízel", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("207", "kis", ["1.4 benzin", "1.6 benzin", "1.6 THP benzin", "1.4 HDi dízel", "1.6 HDi dízel"]),
        m("208", "kis", ["1.0 benzin", "1.2 PureTech benzin", "1.6 benzin", "1.4 HDi dízel", "1.6 HDi dízel", "1.5 BlueHDi dízel", "elektromos"]),
        m("2008", "terepjaro", ["1.2 PureTech benzin", "1.6 benzin", "1.6 HDi dízel", "1.5 BlueHDi dízel", "elektromos"]),
        m("307", "kozep", ["1.4 benzin", "1.6 benzin", "2.0 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("308", "kozep", ["1.2 PureTech benzin", "1.4 benzin", "1.6 benzin", "1.6 THP benzin", "1.6 HDi dízel", "1.5 BlueHDi dízel", "2.0 HDi dízel", "1.6 hibrid"]),
        m("3008", "terepjaro", ["1.2 PureTech benzin", "1.6 THP benzin", "1.6 HDi dízel", "1.5 BlueHDi dízel", "2.0 HDi dízel", "1.6 hibrid"]),
        m("407", "felso", ["1.8 benzin", "2.0 benzin", "2.2 benzin", "1.6 HDi dízel", "2.0 HDi dízel", "2.7 HDi dízel"]),
        m("508", "felso", ["1.6 THP benzin", "1.6 HDi dízel", "2.0 HDi dízel", "2.2 HDi dízel", "1.5 BlueHDi dízel", "1.6 hibrid"]),
        m("5008", "terepjaro", ["1.2 PureTech benzin", "1.6 THP benzin", "1.6 HDi dízel", "1.5 BlueHDi dízel", "2.0 HDi dízel"]),
        m("Partner", "kozep", ["1.4 benzin", "1.6 benzin", "1.6 HDi dízel", "2.0 HDi dízel", "1.5 BlueHDi dízel", "elektromos"]),
        m("Expert", "felso", ["1.6 HDi dízel", "2.0 HDi dízel", "1.5 BlueHDi dízel"]),
        m("Boxer", "felso", ["2.2 HDi dízel", "2.0 BlueHDi dízel", "3.0 HDi dízel"]),
    ]},
    { name: "Citroën", class: "kozep", models: [
        m("C1", "kis", ["1.0 benzin", "1.2 PureTech benzin"]),
        m("C2", "kis", ["1.1 benzin", "1.4 benzin", "1.4 HDi dízel"]),
        m("C3", "kis", ["1.1 benzin", "1.2 PureTech benzin", "1.4 benzin", "1.6 benzin", "1.4 HDi dízel", "1.6 HDi dízel", "1.5 BlueHDi dízel"]),
        m("C3 Picasso", "kozep", ["1.4 benzin", "1.6 benzin", "1.6 HDi dízel"]),
        m("Xsara", "kozep", ["1.4 benzin", "1.6 benzin", "1.9 D dízel", "2.0 HDi dízel"]),
        m("Xsara Picasso", "kozep", ["1.6 benzin", "1.8 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("C4", "kozep", ["1.2 PureTech benzin", "1.4 benzin", "1.6 benzin", "2.0 benzin", "1.6 HDi dízel", "1.5 BlueHDi dízel", "2.0 HDi dízel", "elektromos"]),
        m("C4 Picasso", "kozep", ["1.6 THP benzin", "1.8 benzin", "2.0 benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("C5", "felso", ["1.8 benzin", "2.0 benzin", "1.6 HDi dízel", "2.0 HDi dízel", "2.2 HDi dízel", "2.7 HDi dízel"]),
        m("C5 Aircross", "terepjaro", ["1.2 PureTech benzin", "1.5 BlueHDi dízel", "2.0 BlueHDi dízel", "1.6 hibrid"]),
        m("Berlingo", "kozep", ["1.2 PureTech benzin", "1.4 benzin", "1.6 benzin", "1.6 HDi dízel", "2.0 HDi dízel", "1.5 BlueHDi dízel", "elektromos"]),
        m("Jumpy", "felso", ["1.6 HDi dízel", "2.0 HDi dízel", "1.5 BlueHDi dízel"]),
        m("Jumper", "felso", ["2.2 HDi dízel", "2.0 BlueHDi dízel", "3.0 HDi dízel"]),
    ]},
    { name: "DS", class: "kozep", models: [
        m("DS3", "kis", ["1.2 PureTech benzin", "1.6 THP benzin", "1.6 HDi dízel", "elektromos"]),
        m("DS4", "kozep", ["1.6 THP benzin", "1.6 HDi dízel", "2.0 HDi dízel"]),
        m("DS7", "terepjaro", ["1.6 PureTech benzin", "2.0 BlueHDi dízel", "1.6 hibrid"]),
    ]},
    { name: "Fiat", class: "kis", models: [
        m("Seicento", "kis", ["0.9 benzin", "1.1 benzin"]),
        m("Panda", "kis", ["0.9 TwinAir benzin", "1.1 benzin", "1.2 benzin", "1.3 MultiJet dízel", "1.0 hibrid"]),
        m("500", "kis", ["0.9 TwinAir benzin", "1.2 benzin", "1.4 benzin", "1.3 MultiJet dízel", "1.0 hibrid", "elektromos"]),
        m("500L", "kozep", ["0.9 TwinAir benzin", "1.4 benzin", "1.3 MultiJet dízel", "1.6 MultiJet dízel"]),
        m("500X", "terepjaro", ["1.0 FireFly benzin", "1.4 MultiAir benzin", "1.6 benzin", "1.3 MultiJet dízel", "1.6 MultiJet dízel", "2.0 MultiJet dízel"]),
        m("Punto / Grande Punto", "kis", ["1.2 benzin", "1.4 benzin", "1.4 T-Jet benzin", "1.3 MultiJet dízel", "1.9 JTD dízel"]),
        m("Stilo", "kozep", ["1.2 benzin", "1.4 benzin", "1.6 benzin", "1.9 JTD dízel"]),
        m("Bravo", "kozep", ["1.4 benzin", "1.4 T-Jet benzin", "1.6 MultiJet dízel", "1.9 JTD dízel"]),
        m("Tipo", "kozep", ["1.4 benzin", "1.6 benzin", "1.3 MultiJet dízel", "1.6 MultiJet dízel"]),
        m("Qubo / Fiorino", "kis", ["1.4 benzin", "1.3 MultiJet dízel"]),
        m("Doblo", "kozep", ["1.4 benzin", "1.3 MultiJet dízel", "1.6 MultiJet dízel", "1.9 JTD dízel", "2.0 MultiJet dízel"]),
        m("Ducato", "felso", ["2.0 JTD dízel", "2.2 JTD dízel", "2.3 JTD dízel", "2.8 JTD dízel", "3.0 JTD dízel"]),
    ]},
    { name: "Seat", class: "kozep", models: [
        m("Mii", "kis", ["1.0 benzin", "elektromos"]),
        m("Ibiza", "kis", ["1.0 TSI benzin", "1.2 benzin", "1.2 TSI benzin", "1.4 benzin", "1.6 benzin", "1.2 TDI dízel", "1.4 TDI dízel", "1.6 TDI dízel", "1.9 TDI dízel"]),
        m("Cordoba", "kis", ["1.4 benzin", "1.6 benzin", "1.9 TDI dízel"]),
        m("Arona", "terepjaro", ["1.0 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel"]),
        m("León", "kozep", ["1.0 TSI benzin", "1.2 TSI benzin", "1.4 TSI benzin", "1.5 TSI benzin", "1.6 benzin", "1.8 TSI benzin", "2.0 TSI benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Altea", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel", "2.0 TDI dízel"]),
        m("Toledo", "kozep", ["1.2 TSI benzin", "1.4 TSI benzin", "1.6 benzin", "1.6 TDI dízel", "1.9 TDI dízel"]),
        m("Ateca", "terepjaro", ["1.0 TSI benzin", "1.4 TSI benzin", "1.5 TSI benzin", "1.6 TDI dízel", "2.0 TDI dízel"]),
        m("Tarraco", "terepjaro", ["1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel"]),
        m("Alhambra", "felso", ["1.4 TSI benzin", "1.8 benzin", "1.9 TDI dízel", "2.0 TDI dízel"]),
    ]},
    { name: "Hyundai", class: "kozep", models: [
        m("i10", "kis", ["1.0 benzin", "1.1 benzin", "1.2 benzin"]),
        m("Getz", "kis", ["1.1 benzin", "1.3 benzin", "1.4 benzin", "1.5 CRDi dízel"]),
        m("Accent", "kis", ["1.3 benzin", "1.4 benzin", "1.5 benzin", "1.5 CRDi dízel"]),
        m("i20", "kis", ["1.0 T-GDi benzin", "1.2 benzin", "1.25 benzin", "1.4 benzin", "1.1 CRDi dízel", "1.4 CRDi dízel"]),
        m("ix20", "kis", ["1.4 benzin", "1.6 benzin", "1.4 CRDi dízel"]),
        m("i30", "kozep", ["1.0 T-GDi benzin", "1.4 benzin", "1.4 T-GDi benzin", "1.5 T-GDi benzin", "1.6 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel", "2.0 CRDi dízel"]),
        m("Elantra", "kozep", ["1.6 benzin", "2.0 benzin", "1.6 CRDi dízel"]),
        m("ix35", "terepjaro", ["1.6 benzin", "2.0 benzin", "1.7 CRDi dízel", "2.0 CRDi dízel"]),
        m("Tucson", "terepjaro", ["1.6 benzin", "1.6 T-GDi benzin", "2.0 benzin", "1.6 CRDi dízel", "1.7 CRDi dízel", "2.0 CRDi dízel", "1.6 hibrid"]),
        m("Kona", "terepjaro", ["1.0 T-GDi benzin", "1.6 T-GDi benzin", "1.6 CRDi dízel", "1.6 hibrid", "elektromos"]),
        m("Santa Fe", "terepjaro", ["2.4 benzin", "2.7 benzin", "2.2 CRDi dízel", "1.6 hibrid"]),
        m("H-1", "felso", ["2.5 CRDi dízel"]),
    ]},
    { name: "Kia", class: "kozep", models: [
        m("Picanto", "kis", ["1.0 benzin", "1.1 benzin", "1.2 benzin"]),
        m("Rio", "kis", ["1.0 T-GDi benzin", "1.2 benzin", "1.25 benzin", "1.4 benzin", "1.1 CRDi dízel", "1.4 CRDi dízel"]),
        m("Stonic", "terepjaro", ["1.0 T-GDi benzin", "1.2 benzin", "1.4 benzin", "1.6 CRDi dízel"]),
        m("Venga", "kis", ["1.4 benzin", "1.6 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel"]),
        m("Ceed", "kozep", ["1.0 T-GDi benzin", "1.4 benzin", "1.4 T-GDi benzin", "1.5 T-GDi benzin", "1.6 benzin", "1.4 CRDi dízel", "1.6 CRDi dízel", "2.0 CRDi dízel", "1.6 hibrid"]),
        m("Carens", "kozep", ["1.6 benzin", "2.0 benzin", "1.7 CRDi dízel", "2.0 CRDi dízel"]),
        m("Soul", "kozep", ["1.6 benzin", "1.6 CRDi dízel", "elektromos"]),
        m("Niro", "terepjaro", ["1.6 hibrid", "elektromos"]),
        m("Sportage", "terepjaro", ["1.6 benzin", "1.6 T-GDi benzin", "2.0 benzin", "1.6 CRDi dízel", "1.7 CRDi dízel", "2.0 CRDi dízel", "1.6 hibrid"]),
        m("Sorento", "terepjaro", ["2.4 benzin", "2.2 CRDi dízel", "2.5 CRDi dízel", "1.6 hibrid"]),
        m("Optima", "felso", ["2.0 benzin", "1.7 CRDi dízel", "2.0 hibrid"]),
    ]},
    { name: "Honda", class: "kozep", models: [
        m("Jazz", "kis", ["1.2 benzin", "1.3 benzin", "1.4 benzin", "1.5 hibrid"]),
        m("Civic", "kozep", ["1.0 VTEC Turbo benzin", "1.4 benzin", "1.5 VTEC Turbo benzin", "1.6 benzin", "1.8 benzin", "1.6 i-DTEC dízel", "2.2 i-CTDi dízel", "2.2 i-DTEC dízel", "2.0 hibrid"]),
        m("FR-V", "kozep", ["1.8 benzin", "2.2 i-CTDi dízel"]),
        m("HR-V", "terepjaro", ["1.5 benzin", "1.6 i-DTEC dízel", "1.5 hibrid"]),
        m("Accord", "felso", ["2.0 benzin", "2.4 benzin", "2.2 i-CTDi dízel", "2.2 i-DTEC dízel"]),
        m("CR-V", "terepjaro", ["2.0 benzin", "2.4 benzin", "1.6 i-DTEC dízel", "2.2 i-CTDi dízel", "2.2 i-DTEC dízel", "2.0 hibrid"]),
    ]},
    { name: "Nissan", class: "kozep", models: [
        m("Micra", "kis", ["0.9 IG-T benzin", "1.0 benzin", "1.2 benzin", "1.4 benzin", "1.5 dCi dízel"]),
        m("Note", "kis", ["1.2 benzin", "1.4 benzin", "1.6 benzin", "1.5 dCi dízel"]),
        m("Almera", "kozep", ["1.5 benzin", "1.8 benzin", "2.2 dCi dízel"]),
        m("Primera", "kozep", ["1.6 benzin", "1.8 benzin", "2.0 benzin", "1.9 dCi dízel", "2.2 dCi dízel"]),
        m("Juke", "terepjaro", ["1.0 DIG-T benzin", "1.2 DIG-T benzin", "1.6 benzin", "1.5 dCi dízel", "1.6 hibrid"]),
        m("Qashqai", "terepjaro", ["1.2 DIG-T benzin", "1.3 DIG-T benzin", "1.6 benzin", "2.0 benzin", "1.5 dCi dízel", "1.6 dCi dízel", "1.7 dCi dízel", "2.0 dCi dízel", "1.5 e-Power hibrid"]),
        m("X-Trail", "terepjaro", ["2.0 benzin", "2.5 benzin", "1.6 dCi dízel", "1.7 dCi dízel", "2.0 dCi dízel", "2.2 dCi dízel"]),
        m("Pathfinder", "terepjaro", ["2.5 dCi dízel", "3.0 dCi dízel"]),
        m("Navara", "terepjaro", ["2.3 dCi dízel", "2.5 dCi dízel", "3.0 dCi dízel"]),
        m("NV200", "kozep", ["1.6 benzin", "1.5 dCi dízel", "elektromos"]),
        m("Leaf", "kozep", ["elektromos"]),
    ]},
    { name: "Mazda", class: "kozep", models: [
        m("2", "kis", ["1.25 benzin", "1.3 benzin", "1.5 benzin", "1.4 CD dízel", "1.5 hibrid"]),
        m("3", "kozep", ["1.4 benzin", "1.5 benzin", "1.6 benzin", "2.0 benzin", "1.5 dízel", "1.6 CiTD dízel", "1.8 dízel", "2.2 CiTD dízel"]),
        m("5", "kozep", ["1.8 benzin", "2.0 benzin", "1.6 CiTD dízel", "2.0 CiTD dízel"]),
        m("6", "felso", ["1.8 benzin", "2.0 benzin", "2.5 benzin", "2.0 CiTD dízel", "2.2 CiTD dízel"]),
        m("Premacy", "kozep", ["1.8 benzin", "2.0 DiTD dízel"]),
        m("CX-3", "terepjaro", ["2.0 benzin", "1.5 dízel", "1.8 dízel"]),
        m("CX-30", "terepjaro", ["2.0 benzin", "1.8 dízel"]),
        m("CX-5", "terepjaro", ["2.0 benzin", "2.5 benzin", "2.2 CiTD dízel"]),
        m("MX-5", "kis", ["1.5 benzin", "1.6 benzin", "1.8 benzin", "2.0 benzin"]),
    ]},
    { name: "Dacia", class: "kis", models: [
        m("Spring", "kis", ["elektromos"]),
        m("Sandero", "kis", ["0.9 TCe benzin", "1.0 benzin", "1.0 TCe benzin", "1.2 benzin", "1.4 benzin", "1.5 dCi dízel"]),
        m("Logan", "kis", ["0.9 TCe benzin", "1.0 TCe benzin", "1.2 benzin", "1.4 benzin", "1.6 benzin", "1.5 dCi dízel"]),
        m("Duster", "terepjaro", ["1.0 TCe benzin", "1.2 TCe benzin", "1.3 TCe benzin", "1.6 benzin", "1.5 dCi dízel"]),
        m("Lodgy", "kozep", ["1.2 TCe benzin", "1.6 benzin", "1.5 dCi dízel"]),
        m("Dokker", "kozep", ["1.2 TCe benzin", "1.6 benzin", "1.5 dCi dízel"]),
        m("Jogger", "kozep", ["1.0 TCe benzin", "1.6 hibrid"]),
    ]},
    { name: "Volvo", class: "felso", models: [
        m("C30", "kozep", ["1.6 benzin", "2.0 benzin", "1.6 D dízel", "2.0 D dízel"]),
        m("S40", "kozep", ["1.6 benzin", "1.8 benzin", "2.0 benzin", "1.6 D dízel", "2.0 D dízel"]),
        m("V40", "kozep", ["1.5 T3 benzin", "1.6 benzin", "2.0 T4 benzin", "1.6 D2 dízel", "2.0 D2 dízel", "2.0 D3 dízel", "2.0 D4 dízel"]),
        m("V50", "kozep", ["1.8 benzin", "2.0 benzin", "1.6 D dízel", "2.0 D dízel"]),
        m("S60 / V60", "felso", ["1.6 T3 benzin", "2.0 T4 benzin", "2.0 T5 benzin", "1.6 D2 dízel", "2.0 D3 dízel", "2.0 D4 dízel", "2.4 D5 dízel", "2.0 T8 hibrid"]),
        m("V70", "felso", ["2.0 benzin", "2.5 T benzin", "2.0 D dízel", "2.4 D dízel", "2.4 D5 dízel"]),
        m("S80", "felso", ["2.0 benzin", "2.0 D3 dízel", "2.4 D5 dízel"]),
        m("XC40", "terepjaro", ["1.5 T3 benzin", "2.0 T4 benzin", "2.0 D3 dízel", "2.0 D4 dízel", "1.5 T5 hibrid", "elektromos"]),
        m("XC60", "terepjaro", ["2.0 benzin", "2.0 T5 benzin", "2.0 D dízel", "2.0 D4 dízel", "2.4 D5 dízel", "2.0 T8 hibrid"]),
        m("XC70", "terepjaro", ["2.0 D4 dízel", "2.4 D5 dízel"]),
        m("XC90", "terepjaro", ["3.2 benzin", "2.0 D5 dízel", "2.4 D5 dízel", "2.0 T8 hibrid"]),
    ]},
    { name: "Mitsubishi", class: "kozep", models: [
        m("Space Star", "kis", ["1.0 benzin", "1.2 benzin"]),
        m("Colt", "kis", ["1.1 benzin", "1.3 benzin", "1.5 benzin", "1.5 DI-D dízel"]),
        m("Lancer", "kozep", ["1.5 benzin", "1.6 benzin", "1.8 benzin", "2.0 benzin", "1.8 DI-D dízel", "2.0 DI-D dízel"]),
        m("ASX", "terepjaro", ["1.6 benzin", "2.0 benzin", "1.6 DI-D dízel", "1.8 DI-D dízel", "2.2 DI-D dízel"]),
        m("Outlander", "terepjaro", ["2.0 benzin", "2.4 benzin", "2.0 DI-D dízel", "2.2 DI-D dízel", "2.0 hibrid", "2.4 hibrid"]),
        m("Pajero", "terepjaro", ["3.8 benzin", "3.2 DI-D dízel"]),
        m("L200", "terepjaro", ["2.4 DI-D dízel", "2.5 DI-D dízel"]),
    ]},
    { name: "Alfa Romeo", class: "felso", models: [
        m("MiTo", "kis", ["1.4 benzin", "1.4 TB benzin", "1.3 JTDm dízel", "1.6 JTDm dízel"]),
        m("147", "kozep", ["1.6 benzin", "2.0 benzin", "1.9 JTD dízel"]),
        m("156", "kozep", ["1.8 benzin", "2.0 benzin", "1.9 JTD dízel", "2.4 JTD dízel"]),
        m("159", "felso", ["1.75 TBi benzin", "1.8 TBi benzin", "2.2 benzin", "1.9 JTD dízel", "2.0 JTD dízel", "2.4 JTD dízel"]),
        m("Giulietta", "kozep", ["1.4 TB benzin", "1.75 TBi benzin", "1.6 JTDm dízel", "2.0 JTDm dízel"]),
        m("Giulia", "felso", ["2.0 benzin", "2.2 JTDm dízel"]),
        m("Stelvio", "terepjaro", ["2.0 benzin", "2.2 JTDm dízel"]),
    ]},
    { name: "Chevrolet", class: "kis", models: [
        m("Spark", "kis", ["1.0 benzin", "1.2 benzin"]),
        m("Kalos", "kis", ["1.2 benzin", "1.4 benzin"]),
        m("Aveo", "kis", ["1.2 benzin", "1.4 benzin", "1.3 CDTI dízel"]),
        m("Lacetti", "kozep", ["1.4 benzin", "1.6 benzin", "1.8 benzin", "2.0 CDTI dízel"]),
        m("Cruze", "kozep", ["1.4 Turbo benzin", "1.6 benzin", "1.8 benzin", "1.7 CDTI dízel", "2.0 CDTI dízel"]),
        m("Orlando", "kozep", ["1.8 benzin", "2.0 CDTI dízel"]),
        m("Epica", "felso", ["2.0 benzin", "2.0 CDTI dízel"]),
        m("Trax", "terepjaro", ["1.4 Turbo benzin", "1.7 CDTI dízel"]),
        m("Captiva", "terepjaro", ["2.4 benzin", "2.0 CDTI dízel", "2.2 CDTI dízel"]),
    ]},
    { name: "Mini", class: "kozep", models: [
        m("One", "kis", ["1.2 benzin", "1.4 benzin", "1.5 benzin", "1.6 benzin", "1.6 D dízel"]),
        m("Cooper", "kis", ["1.5 benzin", "1.6 benzin", "1.6 Turbo benzin", "2.0 benzin", "1.5 D dízel", "1.6 D dízel", "2.0 D dízel", "elektromos"]),
        m("Clubman", "kozep", ["1.5 benzin", "1.6 benzin", "2.0 benzin", "1.6 D dízel", "2.0 D dízel"]),
        m("Countryman", "terepjaro", ["1.5 benzin", "1.6 benzin", "2.0 benzin", "1.6 D dízel", "2.0 D dízel", "1.5 hibrid"]),
    ]},
    { name: "Land Rover", class: "terepjaro", models: [
        m("Freelander", "terepjaro", ["1.8 benzin", "2.0 benzin", "2.0 TD4 dízel", "2.2 TD4 dízel"]),
        m("Discovery Sport", "terepjaro", ["2.0 Si4 benzin", "2.0 TD4 dízel", "2.2 TD4 dízel"]),
        m("Discovery", "terepjaro", ["2.0 benzin", "2.0 SD4 dízel", "2.7 TDV6 dízel", "3.0 TDV6 dízel"]),
        m("Defender", "terepjaro", ["2.0 benzin", "2.2 TD4 dízel", "2.4 TD4 dízel", "3.0 dízel"]),
        m("Range Rover Evoque", "terepjaro", ["2.0 benzin", "2.0 Si4 benzin", "2.0 TD4 dízel", "2.2 eD4 dízel", "1.5 hibrid"]),
        m("Range Rover Sport", "terepjaro", ["5.0 benzin", "3.0 TDV6 dízel", "3.0 SDV6 dízel", "3.6 TDV8 dízel"]),
        m("Range Rover", "felso", ["5.0 benzin", "3.0 TDV6 dízel", "4.4 TDV8 dízel"]),
    ]},
    { name: "Jaguar", class: "felso", models: [
        m("X-Type", "felso", ["2.5 benzin", "3.0 benzin", "2.0 D dízel", "2.2 D dízel"]),
        m("XE", "felso", ["2.0 benzin", "2.0 D dízel"]),
        m("XF", "felso", ["2.0 benzin", "2.2 D dízel", "2.7 D dízel", "3.0 D dízel"]),
        m("F-Pace", "terepjaro", ["2.0 benzin", "2.0 D dízel", "3.0 D dízel"]),
        m("E-Pace", "terepjaro", ["2.0 benzin", "2.0 D dízel"]),
    ]},
    { name: "Jeep", class: "terepjaro", models: [
        m("Renegade", "terepjaro", ["1.0 benzin", "1.4 benzin", "1.6 MultiJet dízel", "2.0 MultiJet dízel", "1.3 hibrid"]),
        m("Compass", "terepjaro", ["1.4 benzin", "2.4 benzin", "1.6 MultiJet dízel", "2.0 CRD dízel", "1.3 hibrid"]),
        m("Cherokee", "terepjaro", ["3.7 benzin", "2.0 CRD dízel", "2.2 MultiJet dízel", "2.8 CRD dízel"]),
        m("Grand Cherokee", "terepjaro", ["3.6 benzin", "3.0 CRD dízel"]),
        m("Wrangler", "terepjaro", ["2.0 benzin", "3.6 benzin", "2.8 CRD dízel"]),
    ]},
    { name: "Lexus", class: "felso", models: [
        m("CT", "kozep", ["200h hibrid"]),
        m("UX", "terepjaro", ["250h hibrid", "elektromos"]),
        m("IS", "felso", ["2.0 benzin", "2.5 benzin", "2.2 D dízel", "300h hibrid"]),
        m("NX", "terepjaro", ["2.0 Turbo benzin", "300h hibrid", "350h hibrid"]),
        m("RX", "terepjaro", ["2.0 Turbo benzin", "3.5 benzin", "450h hibrid"]),
    ]},
    { name: "Porsche", class: "felso", models: [
        m("911", "felso", ["3.0 benzin", "3.6 benzin", "3.8 benzin"]),
        m("Boxster / Cayman", "felso", ["2.0 Turbo benzin", "2.7 benzin", "3.4 benzin"]),
        m("Macan", "terepjaro", ["2.0 benzin", "3.0 benzin", "3.0 TDI dízel"]),
        m("Cayenne", "terepjaro", ["3.0 benzin", "3.6 benzin", "4.8 benzin", "3.0 TDI dízel", "3.0 hibrid"]),
        m("Panamera", "felso", ["3.6 benzin", "3.0 TDI dízel", "2.9 hibrid"]),
        m("Taycan", "felso", ["elektromos"]),
    ]},
    { name: "Smart", class: "kis", models: [
        m("Fortwo", "kis", ["0.9 benzin", "1.0 benzin", "0.8 CDI dízel", "elektromos"]),
        m("Forfour", "kis", ["0.9 benzin", "1.0 benzin", "1.1 benzin", "1.5 CDI dízel", "elektromos"]),
    ]},
    { name: "Subaru", class: "terepjaro", models: [
        m("Impreza", "kozep", ["1.5 benzin", "1.6 benzin", "2.0 benzin", "2.0 D dízel"]),
        m("XV", "terepjaro", ["1.6 benzin", "2.0 benzin", "2.0 D dízel", "2.0 hibrid"]),
        m("Legacy", "felso", ["2.0 benzin", "2.5 benzin", "2.0 D dízel"]),
        m("Forester", "terepjaro", ["2.0 benzin", "2.5 benzin", "2.0 D dízel", "2.0 hibrid"]),
        m("Outback", "terepjaro", ["2.5 benzin", "3.6 benzin", "2.0 D dízel"]),
    ]},
    { name: "SsangYong", class: "terepjaro", models: [
        m("Tivoli", "terepjaro", ["1.5 benzin", "1.6 benzin", "1.6 e-XDi dízel"]),
        m("Korando", "terepjaro", ["1.5 benzin", "2.0 e-XDi dízel", "2.2 e-XDi dízel"]),
        m("Kyron", "terepjaro", ["2.0 XDi dízel"]),
        m("Rexton", "terepjaro", ["2.0 benzin", "2.2 e-XDi dízel", "2.7 XDi dízel"]),
    ]},
    { name: "Saab", class: "felso", models: [
        m("9-3", "felso", ["1.8 benzin", "2.0 Turbo benzin", "1.9 TiD dízel", "1.9 TTiD dízel"]),
        m("9-5", "felso", ["2.0 Turbo benzin", "2.3 Turbo benzin", "1.9 TiD dízel"]),
    ]},
    { name: "Lancia", class: "kozep", models: [
        m("Ypsilon", "kis", ["0.9 TwinAir benzin", "1.2 benzin", "1.4 benzin", "1.3 JTD dízel", "1.0 hibrid"]),
        m("Musa", "kozep", ["1.4 benzin", "1.3 JTD dízel"]),
        m("Delta", "kozep", ["1.4 benzin", "1.4 T-Jet benzin", "1.6 JTD dízel"]),
    ]},
    { name: "Daewoo", class: "kis", models: [
        m("Matiz", "kis", ["0.8 benzin", "1.0 benzin"]),
        m("Kalos", "kis", ["1.2 benzin", "1.4 benzin"]),
        m("Lanos", "kis", ["1.4 benzin", "1.5 benzin", "1.6 benzin"]),
        m("Nubira", "kozep", ["1.6 benzin", "2.0 benzin"]),
        m("Tacuma", "kozep", ["1.6 benzin", "2.0 benzin"]),
    ]},
    { name: "Rover", class: "kozep", models: [
        m("25", "kis", ["1.4 benzin", "1.6 benzin", "2.0 D dízel"]),
        m("45", "kozep", ["1.4 benzin", "1.6 benzin", "2.0 D dízel"]),
        m("75", "felso", ["1.8 benzin", "2.5 benzin", "2.0 CDT dízel"]),
    ]},
    { name: "Lada", class: "kis", models: [
        m("2107", "kis", ["1.5 benzin"]),
        m("Samara", "kis", ["1.3 benzin", "1.5 benzin"]),
        m("Niva", "terepjaro", ["1.7 benzin"]),
    ]},
    { name: "Cupra", class: "kozep", models: [
        m("Born", "kozep", ["elektromos"]),
        m("Leon", "kozep", ["1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel", "1.4 hibrid"]),
        m("Formentor", "terepjaro", ["1.5 TSI benzin", "2.0 TSI benzin", "2.0 TDI dízel", "1.4 hibrid"]),
        m("Ateca", "terepjaro", ["2.0 TSI benzin"]),
    ]},
    { name: "MG", class: "kozep", models: [
        m("MG4", "kozep", ["elektromos"]),
        m("ZS", "terepjaro", ["1.0 benzin", "1.5 benzin", "elektromos"]),
        m("HS", "terepjaro", ["1.5 benzin", "1.5 hibrid"]),
    ]},
    { name: "BYD", class: "kozep", models: [
        m("Dolphin", "kozep", ["elektromos"]),
        m("Atto 3", "terepjaro", ["elektromos"]),
        m("Seal", "felso", ["elektromos"]),
    ]},
    { name: "Tesla", class: "felso", models: [
        m("Model 3", "felso", ["elektromos"]),
        m("Model Y", "terepjaro", ["elektromos"]),
        m("Model S", "felso", ["elektromos"]),
        m("Model X", "terepjaro", ["elektromos"]),
    ]},
    { name: "Infiniti", class: "felso", models: [
        m("Q30", "kozep", ["1.6 benzin", "1.5 dízel", "2.2 dízel"]),
        m("Q50", "felso", ["2.0 benzin", "2.2 dízel", "3.5 hibrid"]),
        m("QX70", "terepjaro", ["3.7 benzin", "3.0 dízel"]),
    ]},
    { name: "Chrysler", class: "felso", models: [
        m("PT Cruiser", "kozep", ["1.6 benzin", "2.0 benzin", "2.4 benzin", "2.2 CRD dízel"]),
        m("Voyager", "felso", ["2.4 benzin", "3.3 benzin", "2.5 CRD dízel", "2.8 CRD dízel"]),
        m("300C", "felso", ["3.5 benzin", "3.0 CRD dízel"]),
    ]},
    { name: "Dodge", class: "kozep", models: [
        m("Caliber", "kozep", ["1.8 benzin", "2.0 benzin", "2.0 CRD dízel"]),
        m("Journey", "terepjaro", ["2.4 benzin", "2.0 CRD dízel"]),
        m("Nitro", "terepjaro", ["3.7 benzin", "2.8 CRD dízel"]),
    ]},
    { name: "Iveco", class: "felso", models: [
        m("Daily", "felso", ["2.3 dízel", "3.0 dízel"]),
    ]},
    { name: "Isuzu", class: "terepjaro", models: [
        m("D-Max", "terepjaro", ["1.9 dízel", "2.5 dízel", "3.0 dízel"]),
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
    const badge = e.match(/\b[A-Za-z]{0,3}(\d)(\d)0\s*[a-zA-Z]?\b/);
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
