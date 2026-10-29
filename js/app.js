(function () {
  'use strict';

  const ISS = (window.ISSUES || []).slice().sort((a, b) => a.id - b.id);
  const SIZES = window.PHOTO_SIZES || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = s => esc(s).replace(/\n/g, '<br>');
  const pad = n => String(n).padStart(2, '0');
  ISS.forEach(i => (i.sections || []).forEach((s, k) => { s.no = pad(k + 1); }));   // 화면의 챕터 번호는 차례대로

  // 호수 종류: read(글+사진 읽기·책 보기), book(책으로 보기 전용), link(외부 사이트 연결)
  const kind = i => i.type || 'read';
  // 번호 없이 열면 보여줄 호: 웹에서 직접 볼 수 있는 호(읽기·책) 중 가장 최신. 호수 번호 순으로 정렬돼 있다.
  const LATEST = ISS.filter(i => kind(i) !== 'link').slice(-1)[0] || ISS[ISS.length - 1];

  const app = $('#app');
  let cur = LATEST;
  let view = 'read';
  let lbList = [];
  let lbIdx = 0;
  let pendingSec = null;
  const book = { page: 1, spread: window.innerWidth >= 900, zoom: false };
  let spy = null;
  let deckIdx = 0;

  /* ================= 로딩 화면 (등대의집 표준 라이프사이클) ================= */
  const MSGS = ['환경 구성 중...', '데이터 로드 중...', '일정/세부 동기화 중...', '화면 구성 중...'];
  let ldTimer, msgTimer;
  function startLoaderProgress() {
    let p = 0, m = 0;
    const bar = $('#ldBar'), msg = $('#ldMsg');
    ldTimer = setInterval(() => { p += (92 - p) * 0.07; bar.style.width = p.toFixed(1) + '%'; }, 120);
    msgTimer = setInterval(() => { m = (m + 1) % MSGS.length; msg.textContent = MSGS[m]; }, 2200);
  }
  function finishLoader() {
    clearInterval(ldTimer); clearInterval(msgTimer);
    $('#ldBar').style.width = '100%';
    const ld = $('#loader');
    setTimeout(() => {
      ld.classList.add('hide');
      $('#top').hidden = false;
      music.start();
      narr.ready();
      setTimeout(() => { ld.style.display = 'none'; }, 350);
    }, 350);
  }

  /* ================= 공통 도우미 ================= */
  function toast(t) {
    const el = $('#toast');
    el.textContent = t; el.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200);
  }
  function lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; }
  function openLayer(el) { el.classList.add('on'); el.setAttribute('aria-hidden', 'false'); lockScroll(true); }
  function closeLayers() {
    if (document.activeElement && document.activeElement.closest('.drawer, .search, .lb')) document.activeElement.blur();
    $$('.drawer.on, .search.on, .lb.on').forEach(el => { el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); });
    lockScroll(false);
  }
  const hasLayer = () => !!$('.drawer.on, .search.on, .lb.on');

  /* ================= 라우팅 ================= */
  function parseHash() {
    const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
    if (a === 'shelf') return { view: 'shelf' };
    const issue = ISS.find(i => i.id === +a && kind(i) !== 'link') || LATEST;
    if (b === 'book' || kind(issue) === 'book') return { view: 'book', issue, page: Math.max(1, Math.min(issue.pageCount, +c || 1)) };
    return { view: 'read', issue };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function render() {
    const r = parseHash();
    view = r.view;
    if (r.issue) cur = r.issue;
    document.body.classList.toggle('is-book', view === 'book');
    document.body.classList.toggle('is-shelf', view === 'shelf');
    document.body.classList.toggle('is-deck', view === 'read');
    $('#segRead').setAttribute('aria-selected', view === 'read');
    $('#segBook').setAttribute('aria-selected', view === 'book');
    $('.seg').hidden = view === 'shelf' || kind(cur) !== 'read' || !!cur.noBook;   // 읽기/책 전환은 글 데이터가 있는 호만
    document.title = view === 'shelf' ? '지난 호 | 등대매거진' : `${cur.title} ${cur.no} | 등대의집`;
    applyBgm();
    buildChrome();
    if (view === 'read') narr.setIssue(cur); else narr.leave();
    if (view === 'shelf') renderShelf();
    else if (view === 'book') { book.page = r.page; renderBook(); }
    else renderRead();
    if (view !== 'read') window.scrollTo(0, 0);
    if (view === 'read' && pendingSec) { const id = pendingSec; pendingSec = null; setTimeout(() => scrollToSec(id), 30); }
    else if (view === 'read') window.scrollTo(0, 0);
    closeLayers();
  }

  function buildChrome() {
    if (kind(cur) === 'read') {
      $('#tocList').innerHTML = cur.sections.map(s => `<li><a href="#/${cur.id}" data-sec="${s.id}"><b>${s.no}</b><span>${esc(s.title)}</span></a></li>`).join('');
    } else {
      // 책으로만 보는 호: 목차 대신 호수 이동 목록
      $('#tocList').innerHTML = ISS.slice().reverse().map(i => kind(i) === 'link'
        ? `<li><a href="${esc(i.url)}" target="_blank" rel="noopener"><b>${i.id}</b><span>${esc(i.season)} ↗</span></a></li>`
        : `<li><a href="#/${i.id}"${i.id === cur.id ? ' aria-current="page"' : ''}><b>${i.id}</b><span>${esc(i.season)}</span></a></li>`).join('');
    }
  }

  function scrollToSec(id) {
    const el = document.getElementById('sec-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function goSection(id) {
    if (view === 'read') { closeLayers(); scrollToSec(id); }
    else if (view === 'book') {
      const s = cur.sections.find(x => x.id === id);
      closeLayers(); setBookPage(s.pages[0]);
    } else { pendingSec = id; go(`#/${cur.id}`); }
  }

  /* ================= 읽기 모드 ================= */
  const vq = () => (cur.ver ? '?v=' + cur.ver : '');   // 이미지를 바꾼 호는 ver을 올려 캐시를 피한다
  function photoSrc(p) { return cur.dir + 'photos/' + p.f + '.jpg' + vq(); }
  function fig(p, sec) {
    const sz = SIZES[p.f] || [3, 2];
    const label = [sec.title, p.cap].filter(Boolean).join(' · ');
    const idx = lbList.push({ src: photoSrc(p), cap: p.desc ? `${p.cap} — ${p.desc}` : (p.cap || sec.title), sec: sec.title }) - 1;
    const cap = p.cap ? `<figcaption>${p.desc ? `<b>${esc(p.cap)}</b>${esc(p.desc)}` : esc(p.cap)}</figcaption>` : '';
    return `<figure class="ph" style="--ar:${(sz[0] / sz[1]).toFixed(3)}"><button type="button" data-lb="${idx}" aria-label="${esc(label)} 크게 보기"><img src="${photoSrc(p)}" width="${sz[0]}" height="${sz[1]}" loading="lazy" decoding="async" alt="${esc(label)}"></button>${cap}</figure>`;
  }
  /* 읽기 모드는 챕터 한 개가 화면 한 장(deck). 사진은 화면 안에서 옆으로 넘긴다. */
  const photoList = s => (s.groups ? s.groups.flatMap(g => g.photos) : s.photos) || [];
  function dkCard(p, sec) {
    const sz = SIZES[p.f] || [3, 2];
    const ar = Math.max(0.72, Math.min(1.8, sz[0] / sz[1]));
    const label = [sec.title, p.cap].filter(Boolean).join(' · ');
    const idx = lbList.push({ src: photoSrc(p), cap: p.desc ? `${p.cap} — ${p.desc}` : (p.cap || sec.title), sec: sec.title }) - 1;
    const cap = p.cap ? `<span class="cap">${p.desc ? `<b>${esc(p.cap)}</b>${esc(p.desc)}` : esc(p.cap)}</span>` : '';
    return `<button type="button" class="dk-ph" data-lb="${idx}" style="--ar:${ar.toFixed(3)}" aria-label="${esc(label)} 크게 보기"><img src="${photoSrc(p)}" width="${sz[0]}" height="${sz[1]}" loading="lazy" decoding="async" alt="${esc(label)}">${cap}</button>`;
  }
  function dkStrip(s) {
    const items = s.groups
      ? s.groups.map(g => g.photos.map(p => dkCard(p, s)).join('')).join('')
      : (s.photos || []).map(p => dkCard(p, s)).join('');
    const many = (s.groups ? s.groups.reduce((c, g) => c + g.photos.length, 0) : (s.photos || []).length) > 1;
    return `<div class="dk-gal rv"><div class="dk-strip">${items}</div>${many ? '<button type="button" class="dk-arw l" data-arw="-1" aria-label="이전 사진">‹</button><button type="button" class="dk-arw r" data-arw="1" aria-label="다음 사진">›</button><span class="dk-count" aria-hidden="true"></span>' : ''}</div>`;
  }
  const dkHead = (s, n, intro = s.intro, cls = '') =>
    `<div class="dk-head rv"><span class="no">${esc(s.no)}<i> / ${pad(n)}</i></span><h3>${esc(s.title)}</h3>${intro ? `<p${cls ? ` class="${cls}"` : ''}>${nl(intro)}</p>` : ''}</div>`;
  // 챕터 배경: 대표 사진을 흑백으로(CSS) 깔고, 아래 사진 카드는 컬러로 둔다
  const dkBg = p => `<img class="dk-bg" src="${photoSrc(p)}" alt="" loading="lazy" decoding="async">`;
  const dkOpen = s => `<section class="dk-slide" id="sec-${s.id}" data-sec="${s.id}">`;

  function slideHtml(s, n) {
    const first = photoList(s)[0];
    if (s.kind === 'opening') {
      return `<section class="dk-slide dk-open" id="sec-${s.id}" data-sec="${s.id}"><div class="dk-in">${dkHead(s, n, '')}<div class="dk-quote rv"><p class="q">${nl(s.quote)}</p><div class="orn">◆ ◆ ◆</div><p>${nl(s.body)}</p><p>${nl(s.closing)}</p></div></div></section>`;
    }
    if (s.kind === 'heart') {
      const wishes = s.wishes || [], notes = s.notes || [], illust = s.illust || [], donors = s.donors || [];
      let b = '';
      if (wishes.length) b += `<div class="wish">${wishes.map(w => `<article><h4>${w.icon} ${esc(w.name)}</h4><ul>${w.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</div>`;
      if (notes.length) b += `<div class="note">${notes.map(t => /041\)582-4495/.test(t) ? `<p>${esc(t).replace('041)582-4495', '<a href="tel:0415824495">041)582-4495</a>')}</p>` : `<p>${esc(t)}</p>`).join('')}</div>`;
      if (illust.length) b += `<div class="illu">${illust.map(p => fig(p, s)).join('')}</div>`;
      if (donors.length) b += `<div class="donors"><h4 class="dh">함께해 주신 후원자님께 감사드립니다</h4>${donors.map((d, i) => {
        const list = d.names.split(/\s+/).filter(Boolean);
        return `<details class="dn" id="dn-${i}" ${i === 0 ? 'open' : ''}><summary><span>${esc(d.name)}</span><i>${list.length}</i></summary><div class="names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div></details>`;
      }).join('')}</div>`;
      return `<section class="dk-slide dk-light" id="sec-${s.id}" data-sec="${s.id}"><div class="dk-in">${dkHead(s, n, s.intro, wishes.length ? '' : 'help')}${b ? `<div class="dk-scroll rv">${b}</div>` : ''}</div></section>`;
    }
    if (s.kind === 'company' && s.pending) {
      return `<section class="dk-slide dk-light" id="sec-${s.id}" data-sec="${s.id}"><div class="dk-in">${dkHead(s, n, s.intro || '준비 중입니다.', 'help')}</div></section>`;
    }
    if (s.kind === 'company') {
      const addr = s.info[0].replace(/^주소:\s*/, '').replace(/\s+/g, ' ');
      const tel = s.info[1].replace(/^전화:\s*/, '').trim();
      return `<section class="dk-slide dk-company" id="sec-${s.id}" data-sec="${s.id}">${dkBg(first)}<div class="dk-in"><div><div class="dk-head rv"><span class="no">${esc(s.no)}<i> / ${pad(n)}</i></span><h3>${esc(s.title)}</h3></div><div class="dk-co rv"><h4>${esc(s.company)}</h4><p>${esc(s.intro)}</p></div></div>${dkStrip(s)}<div class="dk-cinfo rv"><a class="btn ghost" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${encodeURIComponent(addr)}">📍 ${esc(addr)}</a><a class="btn ghost" href="tel:${tel.replace(/\D/g, '')}">📞 ${esc(tel)}</a></div></div></section>`;
    }
    if (!first) return `<section class="dk-slide dk-light" id="sec-${s.id}" data-sec="${s.id}"><div class="dk-in">${dkHead(s, n)}</div></section>`;
    return `${dkOpen(s)}${dkBg(first)}<div class="dk-in">${dkHead(s, n)}${dkStrip(s)}</div></section>`;
  }

  function renderRead() {
    lbList = [];
    const n = cur.sections.length;
    const colo = cur.colophon.map(([k, v]) => {
      let val = esc(v);
      if (k === '전화') val = `<a href="tel:${v.replace(/\D/g, '')}">${val}</a>`;
      if (k === '홈페이지') val = `<a href="https://${esc(v)}" target="_blank" rel="noopener">${val}</a>`;
      if (k === '주소') val = `<a href="https://map.naver.com/p/search/${encodeURIComponent(v.replace(/^우\)\d+\s*/, ''))}" target="_blank" rel="noopener">${val}</a>`;
      return `<dt>${esc(k)}</dt><dd>${val}</dd>`;
    }).join('');
    const cover = `<section class="dk-slide dk-cover" id="sec-cover" data-sec="cover"><img class="dk-bg" src="${cur.dir}${cur.hero}" alt="" decoding="async"><div class="dk-in"><div class="dk-head rv"><span class="no">${esc(cur.no)} · ${esc(cur.season)}</span><h3>${esc(cur.title)}</h3><p>${esc(cur.subtitle)}</p><div class="cta"><a class="btn" href="#/${cur.id}" data-sec="${cur.sections[0].id}">읽기 시작</a>${cur.noBook ? '' : `<a class="btn ghost" href="#/${cur.id}/book/1">책으로 보기</a>`}</div></div><div class="dk-hint rv" aria-hidden="true">아래로 넘겨 보세요<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></div></div></section>`;
    const end = `<section class="dk-slide dk-light dk-end" id="sec-end" data-sec="end"><div class="dk-in"><div class="rv"><img class="logo" src="https://lh3.googleusercontent.com/d/18qeVrRkZh3BM0LTUcO35E-cmWcCIssJg" onerror="this.onerror=null;this.src='assets/ci.png'" alt="등대의집 CI"><h5>${esc(cur.title)} ${esc(cur.no)}</h5><dl>${colo}</dl><div class="cta">${cur.noBook ? '' : `<a class="btn ghost" href="#/${cur.id}/book/1">책으로 보기</a>`}<a class="btn ghost" href="#/shelf">지난 호 보기</a></div></div></div></section>`;
    const dots = [['cover', '표지']].concat(cur.sections.map(s => [s.id, s.title]), [['end', '판권']])
      .map(([id, t]) => `<a href="#/${cur.id}" data-sec="${id}" data-t="${esc(t)}" aria-label="${esc(t)}"></a>`).join('');
    app.innerHTML = `<div class="deck" id="deck" tabindex="0" aria-label="${esc(cur.title)} ${esc(cur.no)}">${cover}${cur.sections.map(s => slideHtml(s, n)).join('')}${end}</div><nav class="dk-dots" aria-label="챕터 이동">${dots}</nav>`;
    setupSpy();
  }

  function setupSpy() {
    if (spy) spy.disconnect();
    const deck = $('#deck'), slides = $$('.dk-slide', deck), dots = $$('.dk-dots a');
    $('#prog').style.width = '0';
    spy = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      narr.enter(e.target.dataset.sec);
      $$('.dk-gal', e.target).forEach(g => { if (g._pad) { g._pad(); g._upd(); } });
      deckIdx = slides.indexOf(e.target);
      dots.forEach((a, i) => a.classList.toggle('on', i === deckIdx));
    }), { root: deck, threshold: 0.55 });
    slides.forEach(s => spy.observe(s));
    setupStrips();
    deck.addEventListener('scroll', () => {
      const max = deck.scrollHeight - deck.clientHeight;
      $('#prog').style.width = (max > 0 ? Math.min(100, deck.scrollTop / max * 100) : 0) + '%';
    }, { passive: true });
    deck.focus({ preventScroll: true });
  }

  // 사진 줄: 넘기면 사진이 정확히 가운데에 멈추고, 가운데 사진만 밝고 크게 보인다(좌우는 어두운 막 + 약간 작게).
  // 스크롤 중에는 가운데 사진이 바뀔 때만 클래스를 바꾼다(그림 읽기·필터 없음, 다운로드 추가 없음).
  function setupStrips() {
    $$('.dk-gal').forEach(g => {
      const strip = $('.dk-strip', g), items = Array.from(strip.children);
      const photos = items.filter(c => c.classList.contains('dk-ph'));
      const cnt = $('.dk-count', g), prev = $('.dk-arw.l', g), next = $('.dk-arw.r', g);
      let cur = -1, raf = 0;
      // 첫·마지막 사진도 가운데에 올 수 있도록 양끝 여백을 둔다
      g._pad = () => {
        const f = items[0], l = items[items.length - 1];
        strip.style.paddingLeft = Math.max(0, (strip.clientWidth - f.offsetWidth) / 2) + 'px';
        strip.style.paddingRight = Math.max(0, (strip.clientWidth - l.offsetWidth) / 2) + 'px';
      };
      const upd = g._upd = () => {
        raf = 0;
        const r = strip.getBoundingClientRect(), mid = r.left + r.width / 2;
        let best = 0, bd = Infinity;
        items.forEach((c, i) => { const b = c.getBoundingClientRect(), d = Math.abs(b.left + b.width / 2 - mid); if (d < bd) { bd = d; best = i; } });
        if (best === cur) return;
        if (items[cur]) items[cur].classList.remove('cur');
        items[best].classList.add('cur'); cur = best;
        const ph = photos.indexOf(items[best]) >= 0 ? items[best] : items.slice(best).find(c => photos.includes(c));
        if (cnt) cnt.textContent = `${Math.max(0, photos.indexOf(ph)) + 1} / ${photos.length}`;
        if (prev) prev.disabled = best === 0;
        if (next) next.disabled = best === items.length - 1;
      };
      g._go = d => {
        const t = items[Math.max(0, Math.min(items.length - 1, cur + d))];
        strip.scrollTo({ left: t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' });
      };
      strip.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
      g._pad(); upd();
      // 마우스로 끌어서 넘기기 (터치는 기본 스와이프). 놓으면 가장 가까운 사진이 가운데로 붙는다.
      let down = null;
      strip.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        down = { x: e.clientX, sl: strip.scrollLeft, moved: false };
      });
      window.addEventListener('pointermove', e => {
        if (!down || !g.isConnected) return;
        const dx = e.clientX - down.x;
        if (!down.moved && Math.abs(dx) > 6) { down.moved = true; strip.style.scrollSnapType = 'none'; strip.style.scrollBehavior = 'auto'; strip.classList.add('drag'); }
        if (down.moved) strip.scrollLeft = down.sl - dx;
      });
      window.addEventListener('pointerup', () => {
        if (!down) return;
        if (down.moved) { dragged = true; setTimeout(() => { dragged = false; }, 0); }
        down = null; strip.style.scrollSnapType = ''; strip.style.scrollBehavior = ''; strip.classList.remove('drag');
      });
    });
  }
  let dragged = false;
  document.addEventListener('click', e => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  // 키보드로 챕터 이동. 마음 더하기처럼 화면 안에서 스크롤되는 챕터는 안쪽을 끝까지 본 뒤 넘어간다.
  function deckStep(d) {
    const slides = $$('.dk-slide');
    const sc = slides[deckIdx] && $('.dk-scroll', slides[deckIdx]);
    if (sc && sc.scrollHeight > sc.clientHeight + 2) {
      const room = d > 0 ? sc.scrollHeight - sc.clientHeight - sc.scrollTop : sc.scrollTop;
      if (room > 2) { sc.scrollBy({ top: d * sc.clientHeight * 0.8, behavior: 'smooth' }); return; }
    }
    const t = slides[Math.max(0, Math.min(slides.length - 1, deckIdx + d))];
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================= 책으로 보기 ================= */
  function spreads() {
    const out = [[1]];
    for (let i = 2; i <= cur.pageCount; i += 2) out.push(i + 1 <= cur.pageCount ? [i, i + 1] : [i]);
    return out;
  }
  const pageSrc = n => `${cur.dir}pages/p${pad(n)}.jpg${vq()}`;
  const lab = n => (cur.pageLabels && cur.pageLabels[n - 1]) || '';
  const isLand = () => cur.pageW > cur.pageH;      // 가로형(슬라이드) 호는 한 쪽씩만 보여줌
  const isSpread = () => book.spread && window.innerWidth >= 900 && !book.zoom && !isLand();
  function unitOf(p) { return isSpread() ? spreads().find(s => s.includes(p)) : [p]; }

  function thumbHtml(i) {
    const n = cur.pageCount, w = isLand() ? 112 : 70;
    if (cur.thumbSprite) {   // 썸네일 한 장(스프라이트)에서 잘라 쓴다
      const pos = n > 1 ? (i / (n - 1) * 100).toFixed(3) : 0;
      return `<span class="th" style="width:${w}px;aspect-ratio:${cur.thumbW} / ${cur.thumbH};background:url('${cur.dir}${cur.thumbSprite}') ${pos}% 0 / ${n * 100}% 100%"></span>`;
    }
    return `<img src="${cur.dir}thumbs/p${pad(i + 1)}.jpg${vq()}" alt="" loading="lazy" width="160" height="207">`;
  }

  function renderBook() {
    const links = kind(cur) === 'read' ? `<a class="btn ghost" href="#/${cur.id}">글로 읽기</a>` :
      `${cur.original ? `<a class="btn ghost" href="${esc(cur.original)}" target="_blank" rel="noopener">원본 열기 ↗</a>` : ''}<a class="btn ghost" href="#/shelf">지난 호 목록</a>`;
    app.innerHTML = `
      <div class="book">
        <div class="stage" id="stage"></div>
        <div class="bar">
          <button class="btn ghost" data-bk="prev">‹ 이전</button>
          <div class="info" id="bkInfo"></div>
          <button class="btn ghost" data-bk="next">다음 ›</button>
        </div>
        <div class="bar">
          <button class="btn ghost" data-bk="spread" id="bkSpread">두 쪽 보기</button>
          ${links}
        </div>
        <div class="thumbs" id="thumbs">${Array.from({ length: cur.pageCount }, (_, i) => `<button data-bk-page="${i + 1}" aria-label="${i + 1}쪽 ${esc(lab(i + 1))}">${thumbHtml(i)}</button>`).join('')}</div>
      </div>`;
    drawBook();
  }

  function drawBook() {
    const unit = unitOf(book.page);
    const two = unit.length === 2;
    book.page = unit[0];
    const st = $('#stage');
    st.className = 'stage ' + (book.zoom ? 'zoom ' : '') + (isSpread() ? 'spread' : 'single') + (isLand() ? ' land' : '');
    const iw = cur.pageW || 1224, ih = cur.pageH || 1584;
    st.innerHTML = `<button class="arrow l" data-bk="prev" aria-label="이전 쪽">‹</button>` +
      unit.map(n => `<div class="pg"><img src="${pageSrc(n)}" width="${iw}" height="${ih}" alt="${n}쪽 ${esc(lab(n))} 원본 페이지"></div>`).join('') +
      `<button class="arrow r" data-bk="next" aria-label="다음 쪽">›</button>`;
    const last = unit[unit.length - 1];
    $('#bkInfo').innerHTML = `<b>${two ? `${unit[0]}–${last}` : unit[0]}</b> / ${cur.pageCount}쪽${lab(unit[0]) ? `<br><small>${esc(lab(unit[0]))}</small>` : ''}`;
    $$('.arrow.l, [data-bk="prev"]').forEach(b => { b.disabled = unit[0] <= 1; });
    $$('.arrow.r, [data-bk="next"]').forEach(b => { b.disabled = last >= cur.pageCount; });
    $('#bkSpread').textContent = isSpread() ? '한 쪽 보기' : '두 쪽 보기';
    $('#bkSpread').hidden = window.innerWidth < 900 || isLand();
    $$('#thumbs button').forEach(b => {
      const on = unit.includes(+b.dataset.bkPage);
      b.classList.toggle('on', on);
      if (on) { const t = $('#thumbs'); t.scrollTo({ left: b.offsetLeft - t.clientWidth / 2 + b.clientWidth / 2, behavior: 'smooth' }); }
    });
    history.replaceState(null, '', `#/${cur.id}/book/${book.page}`);
    [unit[0] - 1, last + 1].forEach(n => { if (n >= 1 && n <= cur.pageCount) new Image().src = pageSrc(n); });
  }

  function setBookPage(p) { book.page = Math.max(1, Math.min(cur.pageCount, p)); view === 'book' ? drawBook() : go(`#/${cur.id}/book/${book.page}`); }
  function bookStep(dir) {
    const unit = unitOf(book.page);
    setBookPage(dir > 0 ? unit[unit.length - 1] + 1 : unit[0] - 1);
  }

  /* ================= 서가 ================= */
  function renderShelf() {
    const how = i => kind(i) === 'link' ? `${esc(i.badge || '외부 사이트')} ↗` : kind(i) === 'book' ? '책으로 보기' : '읽기 · 책으로 보기';
    app.innerHTML = `<div class="wrap shelf"><h2>지난 호 보기</h2><div class="shelf-cards">${ISS.slice().reverse().map(i => {
      const ext = kind(i) === 'link' ? ` href="${esc(i.url)}" target="_blank" rel="noopener"` : ` href="#/${i.id}"`;
      return `<a class="card"${ext}><img src="${i.dir}${i.cover}" alt="${esc(i.title)} ${esc(i.no)} 표지" width="816" height="1056" loading="lazy"><b>${esc(i.no)}</b><span>${esc(i.season)}</span><em>${how(i)}</em></a>`;
    }).join('')}</div></div>`;
  }

  /* ================= 라이트박스 ================= */
  function lbShow(i) {
    lbIdx = (i + lbList.length) % lbList.length;
    const it = lbList[lbIdx];
    $('#lbImg').src = it.src; $('#lbImg').alt = it.cap;
    $('#lbCap').textContent = `${it.sec}${it.cap && it.cap !== it.sec ? ' · ' + it.cap : ''}  (${lbIdx + 1}/${lbList.length})`;
    [lbIdx - 1, lbIdx + 1].forEach(n => { const j = lbList[(n + lbList.length) % lbList.length]; if (j) new Image().src = j.src; });
  }

  /* ================= 검색 ================= */
  // 모든 호수를 한 번에 검색: 읽기 호는 꼭지·캡션·후원자 이름 단위, 책 호는 쪽 단위
  function buildIndex() {
    const idx = [];
    ISS.slice().reverse().forEach(iss => {   // 최신 호가 먼저 나오게
      const tag = `제${iss.id}호`;
      if (kind(iss) === 'book') {
        (iss.texts || []).forEach((t, i) => { if (t) idx.push({ issue: iss, page: i + 1, label: `${tag} · ${i + 1}쪽`, text: t }); });
        return;
      }
      if (kind(iss) !== 'read') return;
      const add = (s, label, text, extra = {}) => { if (text) idx.push({ issue: iss, s, label: `${tag} · ${label}`, text: String(text).replace(/\n/g, ' '), ...extra }); };
      iss.sections.forEach(s => {
        add(s, s.title, s.title + ' ' + (s.intro || ''));
        add(s, s.title, [s.quote, s.body, s.closing].filter(Boolean).join(' '));
        (s.groups || []).forEach(g => { add(s, s.title, g.sub); (g.photos || []).forEach(p => add(s, s.title, p.cap)); });
        (s.photos || []).forEach(p => add(s, s.title, [p.cap, p.desc].filter(Boolean).join(' — ')));
        (s.wishes || []).forEach(w => add(s, '필요 물품 · ' + w.name, w.items.join(', ')));
        (s.notes || []).forEach(n => add(s, s.title, n));
        (s.info || []).forEach(n => add(s, s.title, n));
        if (s.company) add(s, s.title, s.company + ' ' + s.intro);
        (s.donors || []).forEach(d => d.names.split(/\s+/).filter(Boolean).forEach(n => add(s, '후원자 · ' + d.name, n, { donor: n })));
      });
    });
    return idx;
  }
  // 공백을 무시하고 찾는다(PDF 글은 이름 사이에 공백이 끼는 경우가 있음). 찾은 범위를 원문 기준으로 돌려준다.
  function locate(text, q) {
    const map = [];
    let s = '';
    for (let i = 0; i < text.length; i++) { if (!/\s/.test(text[i])) { map.push(i); s += text[i].toLowerCase(); } }
    const k = s.indexOf(q);
    return k < 0 ? null : { a: map[k], b: map[k + q.length - 1] + 1 };
  }
  // 긴 글은 찾은 말 앞뒤만 잘라 보여주고, 찾은 말은 표시한다
  function snippetHtml(text, m) {
    const from = text.length <= 90 ? 0 : Math.max(0, m.a - 34);
    const to = text.length <= 90 ? text.length : Math.min(text.length, m.b + 48);
    return (from ? '…' : '') + esc(text.slice(from, m.a)) + '<mark>' + esc(text.slice(m.a, m.b)) + '</mark>' + esc(text.slice(m.b, to)) + (to < text.length ? '…' : '');
  }
  let searchIdx = null;
  function runSearch(q) {
    const out = $('#qOut');
    q = q.trim();
    if (!q) { out.innerHTML = '<p class="empty">찾고 싶은 이름이나 단어를 입력해 주세요.<br><small>모든 호수에서 한 번에 찾아줍니다.</small></p>'; return; }
    if (!searchIdx) searchIdx = buildIndex();
    const key = q.replace(/\s+/g, '').toLowerCase();
    const all = [];
    searchIdx.forEach(e => { const m = locate(e.text, key); if (m) all.push({ e, m }); });
    const hits = all.slice(0, 60);
    out.innerHTML = hits.length
      ? `<p class="count">${all.length}건${all.length > hits.length ? ` 중 ${hits.length}건 표시` : ''}</p>` + hits.map(({ e, m }, i) =>
        `<a href="#/${e.issue.id}" data-hit="${i}"><small>${esc(e.label)}</small><span>${snippetHtml(e.text, m)}</span></a>`).join('')
      : '<p class="empty">검색 결과가 없습니다.</p>';
    out._hits = hits.map(h => h.e); out._q = q;
  }
  function highlightDonors(q) {
    $$('.names span.hit').forEach(n => n.classList.remove('hit'));
    if (!q) return;
    const low = q.toLowerCase();
    let first = null;
    $$('.names span').forEach(n => {
      if (n.textContent.toLowerCase().includes(low)) {
        n.classList.add('hit'); n.closest('details').open = true; first = first || n;
      }
    });
    if (first) setTimeout(() => first.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  /* ================= 이벤트 ================= */
  document.addEventListener('click', e => {
    const t = e.target;
    const sec = t.closest('[data-sec]');
    if (sec && sec.tagName === 'A') { e.preventDefault(); goSection(sec.dataset.sec); return; }
    const arw = t.closest('[data-arw]');
    if (arw) { arw.parentElement._go(+arw.dataset.arw); return; }
    const lb = t.closest('[data-lb]');
    if (lb) { lbShow(+lb.dataset.lb); openLayer($('#lb')); return; }
    if (t.closest('[data-close]')) { closeLayers(); return; }
    const mode = t.closest('[data-mode]');
    if (mode) { go(mode.dataset.mode === 'book' ? `#/${cur.id}/book/${book.page}` : `#/${cur.id}`); return; }
    const home = t.closest('[data-go="home"]');
    if (home) { e.preventDefault(); go(`#/${LATEST.id}`); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const bk = t.closest('[data-bk]');
    if (bk) {
      const a = bk.dataset.bk;
      if (a === 'prev') bookStep(-1);
      else if (a === 'next') bookStep(1);
      else if (a === 'spread') { book.spread = !book.spread; drawBook(); }
      return;
    }
    const th = t.closest('[data-bk-page]');
    if (th) { setBookPage(+th.dataset.bkPage); return; }
    const hit = t.closest('[data-hit]');
    if (hit) {
      e.preventDefault();
      const out = $('#qOut'), h = out._hits[+hit.dataset.hit], q = out._q;
      closeLayers();
      if (h.page) { go(`#/${h.issue.id}/book/${h.page}`); return; }
      if (view !== 'read' || h.issue.id !== cur.id) { pendingSec = h.s.id; go(`#/${h.issue.id}`); } else scrollToSec(h.s.id);
      if (h.donor) setTimeout(() => highlightDonors(q), 600);
      return;
    }
  });

  $('#btnToc').addEventListener('click', () => openLayer($('#drawer')));
  $('#btnSearch').addEventListener('click', () => { openLayer($('#search')); const q = $('#q'); runSearch(q.value); setTimeout(() => q.focus(), 60); });
  $('#q').addEventListener('input', e => runSearch(e.target.value));
  $('#btnShare').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + `#/${cur.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: `${cur.title} ${cur.no}`, text: cur.subtitle, url }); return; }
      await navigator.clipboard.writeText(url); toast('링크를 복사했어요');
    } catch (err) { if (err && err.name !== 'AbortError') toast(url); }
  });
  $('.lb-prev').addEventListener('click', () => lbShow(lbIdx - 1));
  $('.lb-next').addEventListener('click', () => lbShow(lbIdx + 1));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLayers(); return; }
    if ($('#lb').classList.contains('on')) {
      if (e.key === 'ArrowLeft') lbShow(lbIdx - 1);
      if (e.key === 'ArrowRight') lbShow(lbIdx + 1);
      return;
    }
    if (view === 'read' && !hasLayer() && (document.activeElement === document.body || document.activeElement.closest('#deck, .dk-dots'))) {
      const d = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
      if (d) { e.preventDefault(); deckStep(d); }
    }
    if (view === 'book' && !hasLayer() && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      if (e.key === 'ArrowLeft') bookStep(-1);
      if (e.key === 'ArrowRight') bookStep(1);
    }
  });

  // 좌우 쓸어넘기기 (라이트박스, 책 보기)
  let tx = 0, ty = 0;
  document.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ($('#lb').classList.contains('on')) lbShow(lbIdx + (dx < 0 ? 1 : -1));
    else if (view === 'book' && !book.zoom && e.target.closest('#stage')) bookStep(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('hashchange', render);
  window.addEventListener('resize', () => { if (view === 'book') drawBook(); else if (view === 'read') $$('.dk-gal').forEach(g => { if (g._pad) { g._pad(); g._upd(); } }); });

  /* ================= 호별 배경음악 ================= */
  // 호 폴더의 mp3(issue.bgm)를 쓰고, 곡이 없는 지난 호는 가장 최신 호의 곡을 쓴다. 재생 중이면 곡만 바꿔 이어서 튼다.
  function applyBgm() {
    const au = $('#bgm'), pick = (cur && cur.bgm) ? cur : (LATEST && LATEST.bgm ? LATEST : null);
    if (!au || !pick) return;
    const src = pick.dir + pick.bgm + (pick.ver ? '?v=' + pick.ver : '');
    if (au.getAttribute('src') === src) return;
    const was = !au.paused;
    au.setAttribute('src', src);
    if (was) au.play().catch(() => {});
  }
  applyBgm();

  /* ================= 배경음악 ================= */
  // 브라우저는 소리 자동재생을 막는다. 열자마자 시도하고, 막히면 첫 터치/키 입력에서 시작한다.
  const music = (() => {
    const au = $('#bgm'), btn = $('#btnMusic'), KEY = 'lh-bgm-off', VOL = 0.45;
    let wanted = true, resumeOnShow = false, fadeT;
    try { wanted = localStorage.getItem(KEY) !== '1'; } catch (e) { /* 저장 불가 환경 */ }
    const save = off => { try { localStorage.setItem(KEY, off ? '1' : '0'); } catch (e) { /* 무시 */ } };
    const paint = () => {
      const on = !au.paused;
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? '배경음악 끄기' : '배경음악 켜기';
    };
    function fade(to) {
      clearInterval(fadeT);
      fadeT = setInterval(() => {
        const d = to - au.volume;
        if (Math.abs(d) < 0.03) { au.volume = to; clearInterval(fadeT); return; }
        au.volume = Math.max(0, Math.min(1, au.volume + Math.sign(d) * 0.03));
      }, 80);
    }
    async function play() {
      if (!wanted) return false;
      try { au.volume = 0; await au.play(); fade(VOL); paint(); return true; } catch (e) { paint(); return false; }
    }
    function armGesture() {
      const evs = ['pointerdown', 'keydown', 'touchend'];
      const h = e => {
        if (e.target.closest && e.target.closest('#btnMusic')) return;
        evs.forEach(t => document.removeEventListener(t, h, true));
        play();
      };
      evs.forEach(t => document.addEventListener(t, h, true));
    }
    btn.addEventListener('click', () => {
      if (!au.paused) { wanted = false; save(true); fade(0); setTimeout(() => { au.pause(); paint(); }, 400); }
      else { wanted = true; save(false); play(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !au.paused) { resumeOnShow = true; au.pause(); paint(); }
      else if (!document.hidden && resumeOnShow) { resumeOnShow = false; play(); }
    });
    return {
      start() {
        paint();
        if (!wanted) return;
        play().then(ok => { if (!ok) { armGesture(); toast('화면을 터치하면 배경음악이 시작돼요 ♪'); } });
      },
      duck(on) { if (!au.paused) fade(on ? 0.12 : VOL); }   // 나레이션이 나오는 동안 배경음악을 작게
    };
  })();

  /* ================= 나레이션 ================= */
  // 호 폴더의 voice/index.json({챕터id: mp3})이 있는 호만. 읽기 모드에서 챕터가 자리 잡으면 그 챕터 mp3를 읽어 준다.
  // 챕터를 넘기면 바로 끊고, 재생 중에는 배경음악을 낮춘다. 켜기/끄기는 기억한다.
  const narr = (() => {
    const au = new Audio(), btn = $('#btnNar'), KEY = 'lh-nar-off';
    const lists = {};   // 호 id → 목록(없으면 null)
    let on = true, idx = null, want = null, timer = 0, ready = false, armed = false;
    try { on = localStorage.getItem(KEY) !== '1'; } catch (e) { /* 저장 불가 환경 */ }
    au.preload = 'none';
    const paint = () => {
      btn.hidden = !idx || view !== 'read';
      btn.classList.toggle('off', !on);
      btn.classList.toggle('playing', on && !au.paused);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? '나레이션 끄기' : '나레이션 켜기';
    };
    const stop = () => { clearTimeout(timer); au.pause(); music.duck(false); paint(); };
    function play(id) {
      if (!on || !idx || !ready || view !== 'read' || !id) return;
      const f = idx[id];
      if (!f) { stop(); return; }
      au.src = cur.dir + 'voice/' + f + (cur.ver ? '?v=' + cur.ver : '');
      au.play().then(() => { music.duck(true); paint(); }).catch(() => { paint(); arm(); });
    }
    // 브라우저가 소리를 막으면 첫 터치·키 입력에서 지금 챕터 나레이션을 시작한다
    function arm() {
      if (armed) return;
      armed = true;
      if (!$('#toast.on')) toast('화면을 터치하면 나레이션이 시작돼요 ♪');
      const evs = ['pointerdown', 'keydown', 'touchend'];
      const h = e => {
        if (e.target.closest && e.target.closest('#btnNar')) return;
        evs.forEach(n => document.removeEventListener(n, h, true));
        armed = false;
        play(want);
      };
      evs.forEach(n => document.addEventListener(n, h, true));
    }
    au.addEventListener('ended', () => { music.duck(false); paint(); });
    au.addEventListener('pause', paint);
    btn.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem(KEY, on ? '0' : '1'); } catch (e) { /* 무시 */ }
      if (on) play(want); else stop();
      paint();
      toast(on ? '나레이션을 켰어요' : '나레이션을 껐어요');
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    return {
      async setIssue(issue) {
        if (!(issue.id in lists)) {
          lists[issue.id] = null;
          try {
            const r = await fetch(issue.dir + 'voice/index.json' + (issue.ver ? '?v=' + issue.ver : ''));
            if (r.ok) lists[issue.id] = await r.json();
          } catch (e) { /* 나레이션 없는 호 */ }
        }
        if (cur.id !== issue.id) return;
        idx = lists[issue.id];
        paint();
        if (want) play(want);
      },
      enter(id) { want = id; stop(); timer = setTimeout(() => play(id), 450); },   // 챕터가 자리 잡은 뒤 재생
      ready() { ready = true; if (want) play(want); },
      leave() { want = null; stop(); }
    };
  })();

  /* ================= 시작 ================= */
  function init() {
    startLoaderProgress();
    const t0 = Date.now();
    render();
    const heroImg = new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = cur.dir + (cur.hero || cur.cover); });
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const cap = new Promise(res => setTimeout(res, 5000));
    Promise.race([Promise.all([heroImg, fonts]), cap]).then(() => {
      setTimeout(finishLoader, Math.max(0, 1100 - (Date.now() - t0)));
    });
  }
  if (!ISS.length) { app.innerHTML = '<p class="wrap">등록된 호수가 없습니다.</p>'; finishLoader(); }
  else init();
})();
