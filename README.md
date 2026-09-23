# Árajánlat-készítő szerelőknek - működő prototípus

**A szerelőnek készült, nem az ügyfélnek.** Az használja, aki már látta az
autót, tudja mi a munka, és most az ajánlat összerakása van hátra: normaidő,
alkatrész, apróanyag, ÁFA, és egy papír, amit az ügyfél megkap.

## Miért fordult meg

Az első változat az autós ügyfélnek adott hozzávetőleges, „X Ft-tól" árat a
szerviz weboldalán. A szerelői csoportokból egyöntetűen az jött vissza, hogy
ennek nincs értéke: árat akkor lehet mondani, ha valaki megnézte a kocsit, és
egy előre kiadott becslést az ügyfél később számon kér. Ez a változat ezért ott
kezdi, ahol a szerelő tudása kezdődik - az autó már a hídon volt.

## Hogyan működik

**A szerviznek semmit nem kell beállítania.** Minden ügyfélnek én építem meg a
saját változatát: óradíjak, ÁFA-státusz, szervizneve (`SHOP` a
`lib/flow.js`-ben), árlista és normaidők (`A`, `N`), munkák listája. Ez a
build egy **minta szerviz**, piaci átlagárakkal.

1. **Munka és autó.** Márka / típus / motor gépelve kiegészül, alvázszám
   opcionális (ráírja az ajánlatra).
2. **A munka részletei, egy képernyőn.** Szíj vagy lánc, kettőstömegű,
   start-stop... **„Nem tudom" válasz sehol nincs**, mert a szerelő látta az
   autót - egy tipp az ő saját számlájára kerülne.
3. **A tételek.** Minden sorra ott a szerviz saját normaideje és ára, és ha
   ennél az autónál más kell, a szerelő **bármelyiket átírja**, vagy **saját
   sort vesz fel** (beszorult csavar, vizsgadíj, gumi ára). Ez használat, nem
   beállítás: egyetlen ajánlatra vonatkozik. Csak az átírt szám számít; a le
   nem nyúlt sorok követik a számolást (pl. az apróanyag a megemelt
   óraszámmal együtt nő).
4. **Kész ajánlat.** Tételes, nettó + ÁFA = bruttó (alanyi adómentes buildnél
   ÁFA nélkül). Nem „-tól", nem tájékoztató - ez a végleges szám. Alatta egy
   **kimásolható, sima szöveges ajánlat** az ügyfélnek, másolás gombbal.

Utána: „Tételek módosítása" vagy „Új ajánlat másik autóra".

**Az árat mindig a kód számolja, sosem az AI.** Az AI csak akkor kap szót, ha a
szerelő olyat ír, amit a backend nem tud gombhoz rendelni.

## Egy szerviznek építeni

`lib/flow.js`: a `SHOP` blokkba a szerviz neve, óradíjai és ÁFA-kulcsa
(alanyi adómentesnél `vat: 0`), az `A`-ba az árlistája, az `N`-be a
normaidők, amikkel dolgozik, a `JOBS`-ba a munkái. Ha van beszállítói
hozzáférése (cikkszám szerinti ár), az alkatrészár onnan jöhet. A tételek
szerkesztése minden buildben megmarad, mert a szerelő a saját autójánál többet
tud, mint bármelyik táblázat.

## Az árak

`lib/flow.js`: `DEFAULT_RATES` (óradíjak), `N` (normaidők, középkategóriás
autóra, a `lib/cars.js` kategória-szorzójával), `A` (alkatrészárak
kategóriánként, 2026-os magyar webshop-listákhoz igazítva). Minden érték nettó.
A `TEST_SCENARIOS` laza piaci sávokkal ellenőrzi, hogy egy átírt szám ne
szaladjon el nagyságrendekkel.

## E-mail

`EMAIL_QUOTES=on` esetén minden kiadott ajánlat másolata a `LEAD_EMAIL_TO`
címre megy (alapból ki van kapcsolva). A szerelői visszajelzés és a „kérek egy
sajátot" jelentkezés mindig megy; utóbbi IP-nként naponta egyszer
(`RL_LEAD_PER_DAY`).

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
| `lib/flow.js` | kérdések, gombok, alapértelmezett normaidők és alkatrészárak, felülírások |
| `lib/cars.js` | autókatalógus (márka → típus → motor), kategória-szorzó, alvázszám-dekóder |
| `api/faq-agent.js` | a motor: beszélgetés, tételek-szerkesztő, ÁFA, ügyfél-ajánlat, e-mail |
| `public/index.html` | a landoló oldal |
| `public/widget.js` | a chat, ami magától kinyílik |
| `test-flow.mjs` | véletlen végigjárás + rögzített forgatókönyvek + őrök |

Készítette: **Landscale Agency**
