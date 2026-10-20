// ============================================================================
//  ÖNLEJÁTSZÓ MINTA - the workshop tool's screen, playing one job by itself.
//
//  Nothing is clickable and nothing calls a server. The script below types the
//  car in, picks the job, answers the questions, chooses the parts and builds
//  the quote line by line, then opens the finished sheet. One fixed story:
//  front brakes on an Octavia, at the sample shop's prices.
//
//  Copy rules (2026-10-07): the car is typed, never read from a VIN; the tool
//  asks what splits the parts and never diagnoses; extras are the SHOP's rule;
//  no catalogue or supplier is named. Prices are the sample shop's, net.
// ============================================================================
(() => {
  const RATE = 12000;   // the sample shop's hourly rate, net (lib/flow.js SHOP)
  const VAT = 0.27;
  const SPEED = /[?&]gyors\b/.test(location.search) ? 0.35 : 1;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const huf = (n) => Math.round(n).toLocaleString('hu-HU').replace(/ /g, ' ') + ' Ft';
  const qty = (n) => String(n).replace('.', ',');

  // ---------------------------------------------------------------- the story
  const CAR = {
    query: 'octavia 1.6 tdi',
    results: [
      { t: 'Skoda Octavia III (5E) 1.6 TDI', code: 'CLHA', m: '2013–2020 · dízel · 77 kW' },
      { t: 'Skoda Octavia III (5E) 1.6 TDI', code: 'CXXB', m: '2014–2020 · dízel · 81 kW' },
      { t: 'Skoda Octavia II (1Z) 1.6 TDI', code: 'CAYC', m: '2009–2013 · dízel · 77 kW' },
    ],
    pick: 0,
    name: 'Skoda Octavia III (5E) 1.6 TDI',
    facts: 'Dízel · 77 kW · 2013–2020 · Motorkód: <b class="mono">CLHA</b>',
  };

  const JOBS = [
    { label: 'Olajcsere', m: 'olaj, olajszűrő' },
    { label: 'Kis szerviz', m: 'olaj + szűrők' },
    { label: 'Vezérműszíj', m: 'szíjkészlet, vízpumpa' },
    { label: 'Fék elöl', m: 'betét, tárcsa', pick: true },
    { label: 'Fék hátul', m: 'betét, tárcsa' },
    { label: 'Kuplung', m: 'szett, lendkerék' },
    { label: 'Lengéscsillapító', m: 'pár, toronycsapágy' },
    { label: 'Akkumulátor', m: 'akkumulátor' },
  ];

  const CHECKS = [
    { text: 'Tárcsa is megy, vagy csak betét?', why: 'Amit az autón látott: vetemedett, peremes vagy a minimum alatt.',
      options: [{ label: 'Csak betét' }, { label: 'Tárcsa + betét', plus: 'Féktárcsa, +0,4 óra' }], pick: 1 },
    { text: 'Külön kopásjelző kell?', why: 'Van, ahol a betéttel egyben jön, van, ahol külön.',
      options: [{ label: 'Igen, külön', plus: 'Kopásjelző' }, { label: 'Nem kell' }], pick: 1 },
    { text: 'Fékfolyadék-csere is?', why: 'Kétévente esedékes. A tartály matricáján látszik, mikor volt.',
      options: [{ label: 'Igen', plus: 'Fékfolyadék, +0,5 óra' }, { label: 'Nem' }], pick: 0 },
  ];

  const DISC_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#c9cdd2" stroke="#8a9096" stroke-width="1.5"/><circle cx="20" cy="20" r="9" fill="#e9ebed" stroke="#8a9096" stroke-width="1.5"/><circle cx="20" cy="20" r="2.6" fill="#8a9096"/><g fill="#8a9096"><circle cx="20" cy="14.5" r="1.2"/><circle cx="25.2" cy="18.3" r="1.2"/><circle cx="23.2" cy="24.4" r="1.2"/><circle cx="16.8" cy="24.4" r="1.2"/><circle cx="14.8" cy="18.3" r="1.2"/></g></svg>';
  const PAD_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 14 Q20 4 35 14 L33 28 Q20 22 7 28 Z" fill="#8a9096"/><path d="M8 16 Q20 8 32 16 L31 25 Q20 20 9 25 Z" fill="#4b5057"/></svg>';

  const PARTS = [
    {
      id: 'disc', label: 'Féktárcsa', qtyLabel: '2 db', svg: DISC_SVG,
      ask: { text: 'Tárcsaátmérő?', options: [{ v: '288 mm', n: 6 }, { v: '312 mm', n: 5 }], pick: 0 },
      answered: 'Átmérő: <b>288 mm</b>',
      why: 'a műhely márkája, ezt szereli be legtöbbször',
      fits: 6,
      list: [
        { brand: 'ATE', name: 'Féktárcsa, első', specs: ['288 mm', '25 mm', 'hűtött', '5 lyuk'], price: 14500, shop: true, rec: true },
        { brand: 'TRW', name: 'Féktárcsa, első', specs: ['288 mm', '25 mm', 'hűtött', '5 lyuk'], price: 12900 },
        { brand: 'Brembo', name: 'Féktárcsa, első', specs: ['288 mm', '25 mm', 'hűtött', '5 lyuk'], price: 16800 },
      ],
      line: { key: 'disc', label: 'Féktárcsa, első (ATE)', sub: '288 mm · hűtött', qty: 2, unit: 'db', price: 14500 },
    },
    {
      id: 'pad', label: 'Fékbetét', qtyLabel: '1 készlet', svg: PAD_SVG,
      why: 'a műhely márkája, a 288 mm-es tárcsához illik',
      fits: 9,
      list: [
        { brand: 'ATE', name: 'Fékbetétkészlet, első', specs: ['288 mm-es tárcsához', 'kopásjelző nélkül'], price: 15000, shop: true, rec: true },
        { brand: 'TRW', name: 'Fékbetétkészlet, első', specs: ['288 mm-es tárcsához', 'kopásjelző nélkül'], price: 12400 },
        { brand: 'Textar', name: 'Fékbetétkészlet, első', specs: ['288 mm-es tárcsához', 'kopásjelző nélkül'], price: 16900 },
      ],
      line: { key: 'pad', label: 'Fékbetétkészlet, első (ATE)', sub: 'a 288 mm-es tárcsához', qty: 1, unit: 'klt', price: 15000 },
    },
  ];

  const EXTRAS = [
    { label: 'Fékfolyadék DOT4', m: '1 l · 3 200 Ft/l · mert kérte a cserét', on: true,
      line: { key: 'fluid', label: 'Fékfolyadék DOT4', qty: 1, unit: 'l', price: 3200 } },
    { label: 'Féktisztító spray', m: '1 db · 1 800 Ft/db · minden fékmunkához', on: true,
      line: { key: 'cleaner', label: 'Féktisztító spray', qty: 1, unit: 'db', price: 1800 } },
    { label: 'Fékpatkó-kenőpaszta', m: '1 db · 1 200 Ft/db · csak ha kéri', on: false },
  ];

  const CUSTOMER = { name: 'Nagy Péter', plate: 'PRT-482' };
  const TOTAL_STEPS = 15;

  // ------------------------------------------------------------- the machinery
  const lines = [];
  let step = 0;
  const started = Date.now();

  function progress(text) {
    step++;
    $('play-bar').style.width = Math.min(100, (step / TOTAL_STEPS) * 100) + '%';
    if (text) $('banner-text').textContent = text;
  }

  function focusOn(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 70) {
      el.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    }
  }

  async function tap(el) {
    focusOn(el);
    await sleep(500);
    el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap');
    await sleep(250);
  }

  async function type(el, text, perChar = 75) {
    el.classList.add('focus');
    const out = el.querySelector('span') || el;
    for (const ch of text) { out.textContent += ch; await sleep(perChar); }
    await sleep(250);
    el.classList.remove('focus');
  }

  function show(el) { el.hidden = false; el.classList.add('appear'); focusOn(el); }

  // The quote panel: one source of truth, re-rendered on every change.
  function setLine(line) {
    const i = lines.findIndex((l) => l.key === line.key);
    if (i >= 0) lines[i] = line; else lines.push(line);
    renderQuote(line.key);
  }

  function renderQuote(flashKey) {
    $('q-empty').hidden = true;
    $('q-body').hidden = false;
    $('lines').innerHTML = lines.map((l) => `<tr${l.key === flashKey ? ' class="flash"' : ''}>
        <td><div class="lab">${esc(l.label)}</div>${l.sub ? `<div class="sub">${esc(l.sub)}</div>` : ''}</td>
        <td class="r">${qty(l.qty)} ${esc(l.unit)}</td>
        <td class="r">${huf(l.price)}</td>
        <td class="r">${huf(l.qty * l.price)}</td></tr>`).join('');
    const t = totals();
    $('t-net').textContent = huf(t.net);
    $('t-vat').textContent = huf(t.vat);
    $('t-gross').textContent = huf(t.gross);
    $('mini-total').textContent = huf(t.gross);
    $('mini-count').textContent = `${lines.length} tétel`;
    const mini = $('mini');
    mini.hidden = false;
    mini.classList.remove('tap'); void mini.offsetWidth; mini.classList.add('tap');
  }

  function totals() {
    const net = lines.reduce((s, l) => s + Math.round(l.qty * l.price), 0);
    const vat = Math.round(net * VAT);
    return { net, vat, gross: net + vat };
  }

  const labour = (key, label, hours, sub) => ({ key, label, sub, qty: hours, unit: 'óra', price: RATE });

  // A small floating total for phones, where the quote sits below the cards.
  function addMiniBar() {
    const bar = document.createElement('div');
    bar.id = 'mini';
    bar.className = 'mini';
    bar.hidden = true;
    bar.innerHTML = '<span>Ajánlat · <span id="mini-count"></span></span><b id="mini-total"></b>';
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------------- the script
  async function play() {
    addMiniBar();
    await sleep(900);

    // 1. Car, typed in.
    progress('1. Az autó: a szerelő begépeli, a lista felkínálja.');
    await type($('car-q'), CAR.query);
    $('car-res').innerHTML = CAR.results.map((r, i) => `<div class="res appear" data-i="${i}">
        <span class="t">${esc(r.t)}</span><span class="code">${esc(r.code)}</span><span class="m">${esc(r.m)}</span></div>`).join('');
    await sleep(1100);
    const picked = $('car-res').children[CAR.pick];
    await tap(picked);
    [...$('car-res').children].forEach((el, i) => el.classList.toggle(i === CAR.pick ? 'on' : 'dim', true));
    progress();
    await sleep(700);

    // 2. The job.
    $('car-box').innerHTML = `<div class="t">${esc(CAR.name)}</div><div class="m">${CAR.facts}</div>`;
    $('jobs').innerHTML = JOBS.map((j, i) => `<div class="chip" data-i="${i}"><span class="ct">${esc(j.label)}</span><span class="m">${esc(j.m)}</span></div>`).join('');
    show($('c-job'));
    progress('2. A munka: egy koppintás.');
    await sleep(1200);
    const ji = JOBS.findIndex((j) => j.pick);
    const chip = $('jobs').children[ji];
    await tap(chip);
    chip.classList.add('on');
    chip.querySelector('.ct').insertAdjacentHTML('afterbegin', '<span class="tick">✓</span>');
    setLine(labour('work-brake', 'Munkadíj: fék elöl', 1.0, 'betétcsere · 1,0 óra × 12 000 Ft'));
    progress();
    await sleep(900);

    // 3. Questions about what he found.
    show($('c-checks'));
    progress('3. Pár kérdés arról, amit a szerelő az autón látott.');
    $('checks-count').textContent = `0/${CHECKS.length} megválaszolva`;
    for (let c = 0; c < CHECKS.length; c++) {
      const ch = CHECKS[c];
      const box = document.createElement('div');
      box.className = 'ask appear';
      box.innerHTML = `<div class="qtext">${esc(ch.text)}</div><div class="hint">${esc(ch.why)}</div>
        <div class="opts">${ch.options.map((o) => `<span class="btn opt">${esc(o.label)}${o.plus ? `<span class="m">+ ${esc(o.plus)}</span>` : ''}</span>`).join('')}</div>`;
      $('checks').appendChild(box);
      focusOn(box);
      await sleep(1300);
      const opt = box.querySelectorAll('.opt')[ch.pick];
      await tap(opt);
      opt.classList.add('on');
      opt.insertAdjacentText('afterbegin', '✓ ');
      await sleep(500);
      const o = ch.options[ch.pick];
      const done = document.createElement('div');
      done.className = 'answered appear';
      done.innerHTML = `<span class="tick">✓</span><span class="q">${esc(ch.text)}</span><b>${esc(o.label)}</b>${o.plus ? `<span class="plus">+ ${esc(o.plus)}</span>` : ''}<span class="edit">módosít</span>`;
      box.replaceWith(done);
      $('checks-count').textContent = `${c + 1}/${CHECKS.length} megválaszolva`;

      if (c === 0) setLine(labour('work-brake', 'Munkadíj: fék elöl', 1.4, 'tárcsa + betét · 1,4 óra × 12 000 Ft'));
      if (c === 2) setLine(labour('work-fluid', 'Munkadíj: fékfolyadék-csere', 0.5, '0,5 óra × 12 000 Ft'));
      progress();
      await sleep(600);
    }
    $('checks-count').classList.add('ok');

    // 4. Parts, from the shop's own brands.
    show($('parts-head'));
    progress('4. Alkatrész a műhely saját márkáiból és árlistájából.');
    for (const p of PARTS) {
      const card = document.createElement('div');
      card.className = 'card part-card appear';
      $('parts').appendChild(card);
      const head = (state) => `<div class="pc-head"><h2>${esc(p.label)} <span class="muted">· ${esc(p.qtyLabel)}</span></h2>${state}</div>`;
      const option = (a, on) => `<div class="oil part${on ? ' on' : ''}">
          <span class="thumb">${p.svg}</span>
          <span class="info"><span class="t">${esc(a.brand)} <span class="muted">${esc(a.name)}</span>${a.rec ? '<span class="badge rec-b">ajánlott</span>' : ''}${a.shop ? '<span class="badge">a műhely márkája</span>' : ''}</span>
          ${on ? '<span class="inq">✓ Az ajánlatban</span>' : ''}
          <span class="m">árlista: ${huf(a.price)}</span>
          <span class="specs">${a.specs.map((s, i) => `<span class="spec${i === 0 ? ' key' : ''}">${esc(s)}</span>`).join('')}</span></span></div>`;
      const listHtml = (onIdx) => `<div class="rec-h"><span class="tag">Ajánlott</span><span class="hint">${esc(p.why)}</span></div>
          <div class="oils">${p.list.map((a, i) => option(a, i === onIdx)).join('')}</div>`;

      if (p.ask) {
        card.innerHTML = head('<span class="state ask-s">Kérdés vár</span>') + `<div class="ask">
            <div class="qtext">${esc(p.ask.text)}</div>
            <div class="hint">Ebben különböznek az erre az autóra illő cikkek. Ha nem tudja, a régi alkatrészen látszik.</div>
            <div class="opts">${p.ask.options.map((o) => `<span class="btn opt">${esc(o.v)}<span class="m">${o.n} cikk</span></span>`).join('')}</div></div>`;
        focusOn(card);
        await sleep(1400);
        const opt = card.querySelectorAll('.opt')[p.ask.pick];
        await tap(opt);
        opt.classList.add('on');
        await sleep(500);
      }
      card.innerHTML = head('<span class="state ask-s">Válasszon</span>')
        + (p.answered ? `<div class="answers"><span class="ans">${p.answered}</span></div>` : '')
        + listHtml(-1);
      focusOn(card);
      await sleep(1500);
      const recIdx = p.list.findIndex((a) => a.rec);
      const el = card.querySelectorAll('.oil')[recIdx];
      await tap(el);
      card.querySelector('.oils').outerHTML = `<div class="oils">${p.list.map((a, i) => option(a, i === recIdx)).join('')}</div>`;
      card.querySelector('.state').outerHTML = '<span class="state ok-s">✓ Az ajánlatban</span>';
      setLine(p.line);
      progress();
      await sleep(1100);

      // Collapse to one line, the way the real tool does once it is chosen.
      const a = p.list[recIdx];
      card.innerHTML = head('<span class="state ok-s">✓ Az ajánlatban</span>') + `<div class="pc-sum">
          <span class="thumb">${p.svg}</span>
          <span class="info"><span class="t">${esc(a.brand)} <span class="muted">${esc(a.name)}</span></span>
          <span class="m"><span class="tag">Ajánlott</span> ${esc(p.why)}</span>
          <span class="specs">${a.specs.slice(0, 3).map((s) => `<span class="spec">${esc(s)}</span>`).join('')}</span></span>
          <span class="chg">Másik ▾<span class="fits">${p.fits} illik</span></span></div>`;
      card.classList.add('closed');
      await sleep(400);
    }

    // 5. The shop's own extras for a brake job.
    $('extras').innerHTML = EXTRAS.map((x) => `<div class="oil"><span class="box-ic"></span><span class="t">${esc(x.label)}</span><span class="m">${esc(x.m)}</span></div>`).join('');
    show($('c-extras'));
    progress('5. Ami ennél a műhelynél minden fékmunkához jár, magától bekerül.');
    await sleep(1100);
    const rows = $('extras').children;
    for (let i = 0; i < EXTRAS.length; i++) {
      if (!EXTRAS[i].on) continue;
      await tap(rows[i]);
      rows[i].classList.add('on');
      rows[i].querySelector('.box-ic').textContent = '✓';
      setLine(EXTRAS[i].line);
      await sleep(700);
    }
    progress();
    await sleep(600);

    // 6. Customer + finished quote.
    progress('6. Ügyfél neve, rendszám, és kész az ajánlat.');
    focusOn($('c-quote'));
    await sleep(700);
    $('cust-name').innerHTML = '<span></span><span class="caret"></span>';
    await type($('cust-name'), CUSTOMER.name, 70);
    $('cust-plate').innerHTML = '<span></span><span class="caret"></span>';
    await type($('cust-plate'), CUSTOMER.plate, 90);
    const secs = Math.round((Date.now() - started) / 1000);
    $('timer').textContent = `Kész: ${secs} mp alatt`;
    progress();
    await sleep(1400);

    await tap($('b-print'));
    openSheet();
  }

  function openSheet() {
    const today = new Date();
    const until = new Date(today.getTime() + 15 * 864e5);
    const d = (x) => x.toLocaleDateString('hu-HU');
    $('s-no').textContent = `Á-${today.getFullYear()}/0412`;
    $('s-date').textContent = d(today);
    $('s-until').textContent = d(until).replace(/\.$/, '') + '-ig';
    $('s-cust').textContent = CUSTOMER.name;
    $('s-car').innerHTML = `${esc(CAR.name)}<br>Rendszám: <b>${esc(CUSTOMER.plate)}</b>`;
    $('s-lines').innerHTML = lines.map((l) => `<tr><td>${esc(l.label)}${l.sub && l.unit !== 'óra' ? `<div class="no">${esc(l.sub)}</div>` : ''}</td>
        <td class="r">${qty(l.qty)} ${esc(l.unit)}</td><td class="r">${huf(l.price)}</td><td class="r">${huf(l.qty * l.price)}</td></tr>`).join('');
    const t = totals();
    $('s-net').textContent = huf(t.net);
    $('s-vat').textContent = huf(t.vat);
    $('s-gross').textContent = huf(t.gross);
    $('play-bar').style.width = '100%';
    $('banner-text').textContent = 'Ezt kapja az ügyfél: nyomtatva vagy PDF-ben.';
    $('mini').hidden = true;
    const end = document.querySelector('.end');
    end.hidden = true;
    $('sheet').hidden = false;
    $('sheet').scrollTop = 0;
    setTimeout(() => {
      end.hidden = false;
      end.classList.add('appear');
      end.scrollIntoView({ block: 'end', behavior: REDUCED ? 'auto' : 'smooth' });
    }, 3200 * SPEED);
  }

  $('restart').addEventListener('click', () => location.reload());
  $('replay').addEventListener('click', () => location.reload());
  play();
})();
