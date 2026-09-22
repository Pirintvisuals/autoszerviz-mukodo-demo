# Automata árajánlatkészítő autószervizeknek - működő prototípus

Egy chat, ami végigkérdezi az autóst, és a végén **tételes javítási becslést** ad
(alkatrész + munkadíj), vagy - ha a baj csak tünet - **nem ad árat**, hanem
diagnosztikát ajánl. A szerviz megkapja a kész ajánlatot és az ügyfél adatait.

Ez a build **szerelőknek készült, hogy kipróbálják és megpróbálják eltörni.**
Nincs regisztráció és nincs e-mail-kapu; a lényeg a tesztelés, nem a lead-gyűjtés.

> A NM Bau és a Banacraft botok testvére. A motor a Banacraft-vonal leánya
> (backend vezeti a beszélgetést, az AI csak a beírt szöveget értelmezi), a
> szakmai tartalom viszont teljesen új.

---

## Hogyan működik

```
public/widget.js   ──POST──►  api/faq-agent.js  ──►  lib/flow.js   = kérdések + ár
   (chat UI)                        │                lib/cars.js   = autókatalógus
                                    ├──►  Gemini / OpenAI   = CSAK a beírt szöveg értelmezése
                                    └──►  Resend            = e-mail a tulajdonosnak
```

**A backend vezeti a beszélgetést.** Ő dönti el, mi a következő kérdés, ő
fogalmazza meg, ő rakja ki a gombjait, és ő képezi le a választ egy értékre.
Egy gombnyomás soha nem kerül egy modellhívásba, ezért a bot azonnal válaszol,
és nem tud kicsúszni a saját gombjaival a szinkronból.

**Az AI csak akkor kap szót**, ha az ügyfél olyat ír, amit a backend nem tud
leképezni: saját kérdés, vagy saját szavakkal megfogalmazott válasz. Fix JSON
alakban felel (`{"valasz": "...", "ertek": ...}`), és amit "ertek"-ként ad
vissza, azt a backend ellenőrzi a kérdés saját opciólistáján.

**Az árat a kód számolja**, determinisztikusan, a `lib/flow.js`-ből. A modell
soha nem számol, ezért nem tud árat kitalálni.

### Két kimenet, sosem összekeverve

| Amit az ügyfél mond | Amit kap |
|---|---|
| **Konkrét munka** (fékbetét, olajcsere, vezérműszíj, kuplung…) | tételes becslés: alkatrész + munkadíj (óra × óradíj külön kiírva) + apróanyag |
| **Tünet** (furcsa zaj, rángat, világít a lámpa, "nem tudom mi a baj") | **semmilyen javítási ár.** Csak a diagnosztika díja, és időpont. |

Ha valaki egyszerre kér konkrét munkát ÉS leír egy tünetet, a konkrét munka
árazva lesz, a tünet mellé pedig odakerül a diagnosztika - külön tételként.

### Pontosabb kérdések, kevesebb képernyő

A kettő látszólag egymás ellen dolgozik, ezért három szabály oldja fel:

1. **Csak attól kérdezzük, akinek számít.** A „szíj vagy lánc” kérdés sosem jut
   el egy olajcseréig; az elektromos kézifék kérdés sosem jut el egy 2006-os
   autóhoz; a start-stop kérdés csak akkumulátorcserénél jön elő.
2. **Amit ki lehet számolni, azt nem kérdezzük meg.** Az olaj mennyisége a motor
   méretéből jön (egy 2.0 TDI 5 litert visz, egy 1.2-es négyet), a klímagáz
   fajtája az évjáratból (2017 felett R1234yf, aminek az ára a régi gáz
   többszöröse). Mindkettő tízezrekkel mozgatja az árat, és egy kattintásba sem
   kerül.
3. **Egy képernyő, több kérdés.** Az autó adatai (évjárat, alvázszám, km) egy
   űrlapon vannak, a munka részletei egy másikon, az alkatrész-kategóriával
   együtt. Így három plusz kérdés egy plusz képernyő, nem három plusz kör.

4. **Nincs udvariassági kérdés.** Az első kérdés az, ami számít: *mit kellene
   megcsinálni az autón*. A "miben segíthetek?" nyitány egy képernyőbe és egy
   koppintásba került, és semmit nem mondott a rendszernek: mindhárom válasz
   után ugyanaz a folyamat jött.

Eredmény: egy olajcsere **8 képernyő** a köszönéstől az árig, egy kuplung
kettőstömegűvel és összkerékhajtással **9** - miközben 11-14 adatot gyűjt be.
A `test-flow.mjs` meg is méri, és elhasal, ha egy jövőbeli módosítás ezt elrontja.

A leggyorsabb út viszont az, ha valaki egy mondatban ír be mindent: a
„Passat 2.0 TDI, 2012-es, vezérműszíj kellene” egyszerre négy kérdést válaszol
meg, és a bot visszamondja, mit olvasott ki belőle. Ehhez kell az AI-kulcs.

### Ár: alapár, nem sáv

Minden alkatrészár a választott kategória **legolcsóbb** változatával számol,
minden bizonytalanság a **olcsóbb** irányba van feltételezve, és a becslés
`X Ft-tól` alakban jelenik meg, mellette **felsorolva, mi jöhet még hozzá**
(kopott tárcsa, kettőstömegű lendkerék, beszorult csavar, R1234yf gáz…).

Ez tudatos: egy sáv az alsó széléhez horgonyozza az ügyfelet, és a szerviznek
kell felfelé érvelnie a pultnál. Egy alapár csak felfelé mozdulhat egy olyan
számról, amit az ügyfél eleve minimumként hallott.

---

## Amit egy szerelő azonnal keresni fog

- **„Miből jött ki ez az ár?”** - minden ajánlat alatt egy lenyitható panel:
  normaidő, óradíj, alkatrészár, kategória-szorzó. Ez az, ami miatt nem
  fekete doboz. Az éles verzióban ez a panel nem jelenik meg az ügyfélnek.
- **Motor szerinti normaidő** - a dízel vezérlés hosszabb munka, mint a benzines,
  és a rendszer ezt tudja (`lib/cars.js` olvassa ki a motorfeliratból).
- **Kategória-szorzó** - egy BMW 5-ös fékmunkája több, mint egy Swifté. A
  szorzó modellre van kötve, nem márkára, ezért egy 1-es BMW középkategória.
- **Alvázszám-visszaolvasás** - valódi alvázszámból kiolvassa az évjáratot és a
  gyártót. Ha az alvázszám **más márkát** ad, mint amit az ügyfél mondott, azt
  **jelzi**, nem írja felül: egy telefonon bepötyögött alvázszámban gyakrabban
  van elütés, mint nincs.
- **Szíj vagy lánc** - külön kérdés, külön alkatrész és másfélszeres munkaidő.
  Ha valaki nem tudja, a szíjas, olcsóbb változattal számol, és a becslés megírja,
  mi a helyzet lánccal.
- **Elektromos kézifék, start-stop akku, összkerékhajtás, keréktárcsa-méret** -
  mind külön kérdés, mind csak azoknak, akiknél számít.
- **Egy szakmai megjegyzés beszélgetésenként**, és mindig igaz: vízpumpa a
  vezérléssel, kettőstömegű lendkerék a kuplungnál, tárcsavastagság a fékbetétnél.

---

## A prototípus-specifikus részek

- A chat FÖLÖTT, nem apróbetűben: *„Minta árakkal fut, nem egy konkrét szerviz
  katalógusából.”* Enélkül egyetlen rossz szám „ez baromság”-ként olvasódik,
  nem „ez minta adat”-ként.
- **Minta gomb** az alvázszámhoz és a rendszámhoz: a kanapén ülő szerelőnek
  nincs kéznél egyik sem, és nem is akarja beírni a sajátját.
- A név, telefon, e-mail viszont valódi mező: ha valaki kitölti, **megérkezik**.
  Az űrlap fölött ott áll, hogy ez minta, és hogy hívni senki nem fog.
- Az ajánlat után a képernyőn megjelenik a **tulajdonosi kártya** („ezt kapná
  meg a szerviz”), mert az ár önmagában sosem magyarázza el a termék másik felét.
- **„Mit tudna ez élesben?”** - az ár alatt, nyitva, tételesen: mit nem tud most
  a minta (alvázszám-alapú alkatrészkeresés, a szerviz saját normaidői, a saját
  óradíja és beszállítói kedvezménye), és mit tudna egy konkrét szervizzel. Ez a
  blokk válaszol az egyetlen kérdésre, ami egy szerelőben felmerül a minta ár
  láttán: *"és az én áraimmal hogyan menne?"*
- **Visszajelzés-űrlap** minden beszélgetés végén, a legfontosabb mezővel:
  *„Mennyiért csinálnád meg nálad ezt a munkát?”*

---

## Az árak

**A `lib/flow.js`-ben lévő minden szám a 2026-os magyar piac átlaga, nem egy
létező szerviz árlistája.** Budapesti, márkafüggetlen szerviz szintjére van
kalibrálva.

- **Munkadíj és összárak:** 2026-os JóSzaki autószerelés- és vezérléscsere-sávok,
  publikált budapesti szervizárlisták, autóklíma- és diagnosztikadíjak.
- **Alkatrészárak:** valódi magyar webshop-listaárak (bruttó), 1,27-tel visszaosztva
  és a sáv olcsóbb végére kerekítve, mert ez alapár, nem átlag. Konkrétan:
  vezérműszíj készlet vízpumpával márkásan 28 050 - 47 936 Ft (INA, GATES);
  kuplung szett SACHS 75 945 Ft, kettőstömegűvel együtt LuK 267 238 Ft;
  TRW első féktárcsa Opel Astra G 14 490 Ft/db; Bosch akkumulátor 26 211 - 59 719 Ft,
  ahol az AGM a felső vége. A pontos hivatkozások a `lib/flow.js` `A` objektuma
  fölötti kommentben vannak.

Minden érték **nettó**; a motor rakja rá a 27% ÁFÁ-t, és az ügyfél **bruttó**
árat lát, mert a pultnál azt fizeti.

| Forgatókönyv | A rendszer ára | Piaci sáv (bruttó) |
|---|---|---|
| Olajcsere, Swift 1.2, márkás alkatrész | ~23 000 Ft-tól | 15 000 - 60 000 |
| Olajcsere minden szűrővel, Passat 2.0 TDI, márkás | ~44 000 Ft-tól | 30 000 - 110 000 |
| Fékbetét első tengely, Astra 1.7 CDTI, utángyártott | ~29 000 Ft-tól | 18 000 - 45 000 |
| Hátsó fék tárcsával, elektromos kézifékkel, Superb | ~112 000 Ft-tól | 60 000 - 250 000 |
| Vezérmű**szíj** + vízpumpa, Passat 2.0 TDI, márkás | ~116 000 Ft-tól | ~130 000 |
| Vezérmű**lánc**, Golf 1.4 TSI, márkás | ~152 000 Ft-tól | 45 000 - 450 000 |
| Kuplung, Focus 1.6 TDCi, KTL nélkül, utángyártott | ~148 000 Ft-tól | 78 000 - 275 000 |
| Klímatöltés régi gázzal, Octavia 1.6 TDI (2012) | ~25 000 Ft-tól | 20 000 - 30 000 |
| Klímatöltés R1234yf gázzal, Corolla (2021) | ~53 000 Ft-tól | 40 000 - 110 000 |
| Diagnosztika (tünet) | 13 000 Ft | 8 000 - 15 000 |

A teszt azt is őrzi, hogy a drágább változat mindig drágább maradjon (lánc a
szíjnál, AGM akku a hagyományosnál, összkerék az elsőkeréknél), és hogy a
**„Nem tudom” mindig az olcsóbb változattal** számoljon - különben az alapár
nem alapár.

`node test-flow.mjs` végigkattintja ezeket és kiírja az árukat. Ha egy jövőbeli
árszerkesztés kimozdul a piaci borítékból, a teszt nem nulla kóddal áll le.

### Egy valódi szerviz áraira átállítani

1. `lib/flow.js` → a `P` objektum (óradíjak, diagnosztika díj, apróanyag) és az
   `A` objektum (alkatrészárak kategóriánként), plusz az `N` (normaidők).
2. `JOBS` → amit a szerviz tényleg vállal. Ami nincs benne, arra a bot **nem ad
   árat** és nem is veszi fel az igényt.
3. `node test-flow.mjs`.

Más nem kell hozzá. A `lib/cars.js` és az `api/faq-agent.js` szervizfüggetlen.

---

## Amit ez NEM tud, és miért

Egy chatből nem jön ki pontos árajánlat - se ebből, se másból. A végszámlát
három dolog dönti el: a pontos alkatrészváltozat, hogy mi derül ki még, amikor
a kerék lejön, és a szerviz saját órabére és beszerzési ára. A középső egyszerűen
nem tudható, amíg az autó nincs emelőn.

Ezért nem "árajánlat" a kimenet, hanem **alapár + nevesített kizárások**: az a
szám, amit a szerviz telefonon is kimondana, és amit utána nem kell visszaszívnia.

**Az alvázszámról külön.** A bot elkéri, és valódi alvázszámból kiolvassa a
gyártót és - ahol ez megbízható - az évjáratot. Az alkatrészt NEM tudja belőle
kikeresni, mert a 4-9. karakter jelentését minden gyártó maga definiálja, és nem
publikálja. Katalógus kell hozzá. A szervizeknek viszont már van: a beszállítói
rendszerük (Unix, Inter Cars, Trost) alvázszámból kiadja a pontos alkatrészt a
saját árukkal. Az alvázszám itt tehát nem a kalkulátornak kell, hanem a
szerviznek, hogy ne kelljen visszatelefonálnia az ügyfélnek.

> Az évjárat kiolvasása csak azoknál a gyártóknál megy, akik követik az
> észak-amerikai szabályt (VW-csoport, BMW, Mercedes, Ford, japánok, koreaiak).
> A francia és olasz márkáknál a 10. karakter nem évjárat, ezért ott a bot
> inkább nem mond évet. Egy magabiztosan kimondott rossz évszám többet árt,
> mint egy "nem tudom".

## Futtatás és telepítés

```bash
npm install
node server.js      # http://localhost:8896
npm test            # a folyamat- és ártesztek
```

Kulcsok: másold a `.env.example`-t `.env.local`-ra. **Ez a projekt a saját
kulcsait használja, nem oszt meg semmit a többi bottal.**

- `GEMINI_API_KEY` - csak a beírt szöveg értelmezéséhez kell. Nélküle a
  gombokkal végig lehet menni; a beírt mondatokra "válassz a gombok közül"
  választ ad. Ingyenes kulcs: <https://aistudio.google.com/apikey>
- `RESEND_API_KEY` - ide mennek a kész ajánlatok és a szerelői visszajelzések.
  Verifikált domain nélkül a Resend teszt-feladója csak a Resend-fiók saját
  címére tud küldeni, ami itt pont jó. Kulcs: <https://resend.com/api-keys>
- `LEAD_EMAIL_TO` - ide érkezik minden.

Vercelre: push, majd ugyanezek a nevek a Project → Settings → Environment
Variables alatt. Az `api/faq-agent.js` a serverless végpont, a `public/` a
statikus rész.

### Működik egyáltalán az e-mail?

```
https://<app>.vercel.app/api/faq-agent?selftest=1
```

Kiküld egy minta ajánlatot a `LEAD_EMAIL_TO` címre, és visszaadja JSON-ban,
hogy mely környezeti változók vannak beállítva és mit válaszolt a Resend.
A URL-ből SOHA nem tud más címre küldeni.

---

## Fájlok

| fájl | mi ez |
|---|---|
| `lib/flow.js` | **a szerviz**: kérdések, gombok, normaidők, alkatrészárak, kizárások |
| `lib/cars.js` | autókatalógus (márka → típus → motor), kategória-szorzó, alvázszám-dekóder |
| `api/faq-agent.js` | a motor: beszélgetés, ÁFA, ajánlat, tulajdonosi kártya, e-mail |
| `public/index.html` | a landoló oldal a minta-figyelmeztetéssel |
| `public/widget.js` | a chat, ami magától kinyílik |
| `test-flow.mjs` | véletlen végigjárás + rögzített forgatókönyvek + őrök |

Készítette: **Landscale Agency**
