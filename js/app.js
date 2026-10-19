(function () {
  'use strict';

  const ISS = (window.ISSUES || []).slice().sort((a, b) => a.id - b.id);
  const SIZES = window.PHOTO_SIZES || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = s => esc(s).replace(/\n/g, '<br>');
  const pad = n => String(n).padStart(2, '0');

  const app = $('#app');
  let cur = ISS[ISS.length - 1];
  let view = 'read';
  let lbList = [];
  let lbIdx = 0;
  let pendingSec = null;
  const book = { page: 1, spread: window.innerWidth >= 900, zoom: false };
  let spy = null;

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
    const issue = ISS.find(i => i.id === +a) || ISS[ISS.length - 1];
    if (b === 'book') return { view: 'book', issue, page: Math.max(1, Math.min(issue.pageCount, +c || 1)) };
    return { view: 'read', issue };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function render() {
    const r = parseHash();
    view = r.view;
    if (r.issue) cur = r.issue;
    document.body.classList.toggle('is-book', view === 'book');
    document.body.classList.toggle('is-shelf', view === 'shelf');
    $('#segRead').setAttribute('aria-selected', view === 'read');
    $('#segBook').setAttribute('aria-selected', view === 'book');
    document.title = view === 'shelf' ? '지난 호 | 등대매거진' : `${cur.title} ${cur.no} | 등대의집`;
    buildChrome();
    if (view === 'shelf') renderShelf();
    else if (view === 'book') { book.page = r.page; renderBook(); }
    else renderRead();
    if (view !== 'read') window.scrollTo(0, 0);
    if (view === 'read' && pendingSec) { const id = pendingSec; pendingSec = null; setTimeout(() => scrollToSec(id), 30); }
    else if (view === 'read') window.scrollTo(0, 0);
    closeLayers();
  }

  function buildChrome() {
    $('#chips').innerHTML = cur.sections.map(s => `<a href="#/${cur.id}" data-sec="${s.id}">${esc(s.title)}</a>`).join('');
    $('#tocList').innerHTML = cur.sections.map(s => `<li><a href="#/${cur.id}" data-sec="${s.id}"><b>${s.no}</b><span>${esc(s.title)}</span></a></li>`).join('');
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
  function photoSrc(p) { return cur.dir + 'photos/' + p.f + '.jpg'; }
  function fig(p, sec) {
    const sz = SIZES[p.f] || [3, 2];
    const label = [sec.title, p.cap].filter(Boolean).join(' · ');
    const idx = lbList.push({ src: photoSrc(p), cap: p.desc ? `${p.cap} — ${p.desc}` : (p.cap || sec.title), sec: sec.title }) - 1;
    const cap = p.cap ? `<figcaption>${p.desc ? `<b>${esc(p.cap)}</b>${esc(p.desc)}` : esc(p.cap)}</figcaption>` : '';
    return `<figure class="ph" style="--ar:${(sz[0] / sz[1]).toFixed(3)}"><button type="button" data-lb="${idx}" aria-label="${esc(label)} 크게 보기"><img src="${photoSrc(p)}" width="${sz[0]}" height="${sz[1]}" loading="lazy" decoding="async" alt="${esc(label)}"></button>${cap}</figure>`;
  }
  const gal = (photos, sec, cls = '') => `<div class="gal ${cls}" style="--cd:${sec.cols || 3};${sec.asp ? `--asp:${sec.asp};` : ''}">${photos.map(p => fig(p, sec)).join('')}</div>`;

  function secHtml(s) {
    let h = `<section class="sec" id="sec-${s.id}" data-sec="${s.id}"><div class="wrap"><div class="sec-head"><span class="no">${s.no}</span><h3>${esc(s.title)}</h3></div>`;
    if (s.kind === 'opening') {
      h += `<div class="opening"><p class="quote">${nl(s.quote)}</p><div class="orn">◆ ◆ ◆</div><p>${nl(s.body)}</p><p>${nl(s.closing)}</p></div>`;
    } else if (s.kind === 'heart') {
      h += `<p class="lead">${esc(s.intro)}</p>`;
      h += `<div class="wish">${s.wishes.map(w => `<article><h4>${w.icon} ${esc(w.name)}</h4><ul>${w.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</div>`;
      h += `<div class="note">${s.notes.map(n => /041\)582-4495/.test(n) ? `<p>${esc(n).replace('041)582-4495', '<a href="tel:0415824495">041)582-4495</a>')}</p>` : `<p>${esc(n)}</p>`).join('')}</div>`;
      h += `<div class="illu">${s.illust.map(p => fig(p, s)).join('')}</div>`;
      h += `<div class="donors"><h4 class="dh">함께해 주신 후원자님께 감사드립니다</h4>${s.donors.map((d, i) => {
        const list = d.names.split(/\s+/).filter(Boolean);
        return `<details class="dn" id="dn-${i}" ${i === 0 ? 'open' : ''}><summary><span>${esc(d.name)}</span><i>${list.length}</i></summary><div class="names">${list.map(n => `<span>${esc(n)}</span>`).join('')}</div></details>`;
      }).join('')}</div>`;
    } else if (s.kind === 'company') {
      h += `<div class="company"><h4>${esc(s.company)}</h4><p>${esc(s.intro)}</p></div>`;
      h += gal(s.photos, s);
      const addr = s.info[0].replace(/^주소:\s*/, '').replace(/\s+/g, ' ');
      const tel = s.info[1].replace(/^전화:\s*/, '').trim();
      h += `<div class="cinfo"><a class="btn ghost" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${encodeURIComponent(addr)}">📍 ${esc(addr)}</a><a class="btn ghost" href="tel:${tel.replace(/\D/g, '')}">📞 ${esc(tel)}</a></div>`;
    } else {
      if (s.intro) h += `<p class="lead">${nl(s.intro)}</p>`;
      if (s.groups) h += s.groups.map(g => `<h4 class="sub">${esc(g.sub)}</h4>${gal(g.photos, s)}`).join('');
      else if (s.photos) h += gal(s.photos, s, s.variant === 'tiles' ? 'tiles' : (s.photos.some(p => p.desc) ? 'cards' : ''));
    }
    return h + '</div></section>';
  }

  function renderRead() {
    lbList = [];
    const toc = cur.sections.map(s => `<a href="#/${cur.id}" data-sec="${s.id}"><b>${s.no}</b><span>${esc(s.title)}</span></a>`).join('');
    const colo = cur.colophon.map(([k, v]) => {
      let val = esc(v);
      if (k === '전화') val = `<a href="tel:${v.replace(/\D/g, '')}">${val}</a>`;
      if (k === '홈페이지') val = `<a href="https://${esc(v)}" target="_blank" rel="noopener">${val}</a>`;
      if (k === '주소') val = `<a href="https://map.naver.com/p/search/${encodeURIComponent(v.replace(/^우\)\d+\s*/, ''))}" target="_blank" rel="noopener">${val}</a>`;
      return `<dt>${esc(k)}</dt><dd>${val}</dd>`;
    }).join('');
    app.innerHTML = `
      <div class="hero" style="--hero:url('${new URL(cur.dir + cur.hero, location.href).href}')">
        <div class="hero-in">
          <small>${esc(cur.no)} · ${esc(cur.season)}</small>
          <h2>${esc(cur.title)}</h2>
          <p>${esc(cur.subtitle)}</p>
          <div class="cta"><a class="btn" href="#/${cur.id}" data-sec="${cur.sections[0].id}">읽기 시작</a><a class="btn ghost" href="#/${cur.id}/book/1">책으로 보기</a></div>
        </div>
      </div>
      <div class="wrap"><nav class="toc-cards" aria-label="목차">${toc}</nav></div>
      ${cur.sections.map(secHtml).join('')}
      <footer class="colophon">
        <img class="logo" src="https://lh3.googleusercontent.com/d/18qeVrRkZh3BM0LTUcO35E-cmWcCIssJg" onerror="this.onerror=null;this.src='assets/ci.png'" alt="등대의집 CI">
        <h5>${esc(cur.title)} ${esc(cur.no)}</h5>
        <dl>${colo}</dl>
      </footer>`;
    setupSpy();
  }

  function setupSpy() {
    if (spy) spy.disconnect();
    spy = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.sec;
        $$('#chips a').forEach(a => {
          const on = a.dataset.sec === id;
          a.classList.toggle('on', on);
          if (on) { const c = $('#chips'); c.scrollTo({ left: a.offsetLeft - c.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' }); }
        });
      });
    }, { rootMargin: '-30% 0px -65% 0px' });
    $$('.sec').forEach(s => spy.observe(s));
  }

  /* ================= 책으로 보기 ================= */
  function spreads() {
    const out = [[1]];
    for (let i = 2; i <= cur.pageCount; i += 2) out.push(i + 1 <= cur.pageCount ? [i, i + 1] : [i]);
    return out;
  }
  const pageSrc = n => `${cur.dir}pages/p${pad(n)}.jpg`;
  const isSpread = () => book.spread && window.innerWidth >= 900 && !book.zoom;
  function unitOf(p) { return isSpread() ? spreads().find(s => s.includes(p)) : [p]; }

  function renderBook() {
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
          <button class="btn ghost" data-bk="zoom" id="bkZoom">크게 보기</button>
          <a class="btn ghost" href="#/${cur.id}">글로 읽기</a>
        </div>
        <div class="thumbs" id="thumbs">${Array.from({ length: cur.pageCount }, (_, i) => `<button data-bk-page="${i + 1}" aria-label="${i + 1}쪽 ${esc(cur.pageLabels[i])}"><img src="${cur.dir}thumbs/p${pad(i + 1)}.jpg" alt="" loading="lazy" width="160" height="207"></button>`).join('')}</div>
      </div>`;
    drawBook();
  }

  function drawBook() {
    const unit = unitOf(book.page);
    const two = unit.length === 2;
    book.page = unit[0];
    const st = $('#stage');
    st.className = 'stage ' + (book.zoom ? 'zoom ' : '') + (isSpread() ? 'spread' : 'single');
    st.innerHTML = `<button class="arrow l" data-bk="prev" aria-label="이전 쪽">‹</button>` +
      unit.map(n => `<div class="pg"><img src="${pageSrc(n)}" width="1224" height="1584" alt="${n}쪽 ${esc(cur.pageLabels[n - 1])} 원본 페이지"></div>`).join('') +
      `<button class="arrow r" data-bk="next" aria-label="다음 쪽">›</button>`;
    const last = unit[unit.length - 1];
    $('#bkInfo').innerHTML = `<b>${two ? `${unit[0]}–${last}` : unit[0]}</b> / ${cur.pageCount}쪽<br><small>${esc(cur.pageLabels[unit[0] - 1])}</small>`;
    $$('.arrow.l, [data-bk="prev"]').forEach(b => { b.disabled = unit[0] <= 1; });
    $$('.arrow.r, [data-bk="next"]').forEach(b => { b.disabled = last >= cur.pageCount; });
    $('#bkSpread').textContent = isSpread() ? '한 쪽 보기' : '두 쪽 보기';
    $('#bkSpread').hidden = window.innerWidth < 900;
    $('#bkZoom').textContent = book.zoom ? '맞춰 보기' : '크게 보기';
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
    app.innerHTML = `<div class="wrap shelf"><h2>지난 호 보기</h2><div class="shelf-cards">${ISS.slice().reverse().map(i =>
      `<a class="card" href="#/${i.id}"><img src="${i.dir}${i.cover}" alt="${esc(i.title)} ${esc(i.no)} 표지" width="816" height="1056"><b>${esc(i.no)}</b><span>${esc(i.season)}</span></a>`).join('')}</div></div>`;
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
  function buildIndex() {
    const idx = [];
    const add = (s, label, text, extra = {}) => { if (text) idx.push({ s, label, text: String(text).replace(/\n/g, ' '), ...extra }); };
    cur.sections.forEach(s => {
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
    return idx;
  }
  let searchIdx = null, searchFor = null;
  function runSearch(q) {
    const out = $('#qOut');
    q = q.trim();
    if (!q) { out.innerHTML = '<p class="empty">찾고 싶은 이름이나 단어를 입력해 주세요.</p>'; return; }
    if (searchFor !== cur) { searchIdx = buildIndex(); searchFor = cur; }
    const low = q.toLowerCase();
    const hits = searchIdx.filter(e => e.text.toLowerCase().includes(low)).slice(0, 40);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out.innerHTML = hits.length ? hits.map((e, i) =>
      `<a href="#/${cur.id}" data-hit="${i}"><small>${esc(e.label)}</small><span>${esc(e.text).replace(re, m => `<mark>${m}</mark>`)}</span></a>`).join('')
      : '<p class="empty">검색 결과가 없습니다.</p>';
    out._hits = hits; out._q = q;
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
    const lb = t.closest('[data-lb]');
    if (lb) { lbShow(+lb.dataset.lb); openLayer($('#lb')); return; }
    if (t.closest('[data-close]')) { closeLayers(); return; }
    const mode = t.closest('[data-mode]');
    if (mode) { go(mode.dataset.mode === 'book' ? `#/${cur.id}/book/${book.page}` : `#/${cur.id}`); return; }
    const home = t.closest('[data-go="home"]');
    if (home) { e.preventDefault(); go(view === 'read' ? `#/${cur.id}` : `#/${cur.id}`); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const bk = t.closest('[data-bk]');
    if (bk) {
      const a = bk.dataset.bk;
      if (a === 'prev') bookStep(-1);
      else if (a === 'next') bookStep(1);
      else if (a === 'spread') { book.spread = !book.spread; book.zoom = false; drawBook(); }
      else if (a === 'zoom') { book.zoom = !book.zoom; drawBook(); }
      return;
    }
    const th = t.closest('[data-bk-page]');
    if (th) { setBookPage(+th.dataset.bkPage); return; }
    const hit = t.closest('[data-hit]');
    if (hit) {
      e.preventDefault();
      const out = $('#qOut'), h = out._hits[+hit.dataset.hit], q = out._q;
      closeLayers();
      if (view !== 'read') { pendingSec = h.s.id; go(`#/${cur.id}`); } else scrollToSec(h.s.id);
      if (h.donor) setTimeout(() => highlightDonors(q), 450);
      return;
    }
    if (t.closest('#toTop')) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // 맨 위로 버튼 / 읽기 진행바
  const toTop = document.createElement('button');
  toTop.id = 'toTop'; toTop.className = 'toTop'; toTop.setAttribute('aria-label', '맨 위로');
  toTop.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>';
  document.body.appendChild(toTop);
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      $('#prog').style.width = (max > 0 ? Math.min(100, h.scrollTop / max * 100) : 0) + '%';
      toTop.classList.toggle('on', h.scrollTop > 700 && view === 'read');
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener('hashchange', render);
  window.addEventListener('resize', () => { if (view === 'book') drawBook(); });

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
      }
    };
  })();

  /* ================= 시작 ================= */
  function init() {
    startLoaderProgress();
    const t0 = Date.now();
    render();
    const heroImg = new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = cur.dir + cur.hero; });
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const cap = new Promise(res => setTimeout(res, 5000));
    Promise.race([Promise.all([heroImg, fonts]), cap]).then(() => {
      setTimeout(finishLoader, Math.max(0, 1100 - (Date.now() - t0)));
    });
  }
  if (!ISS.length) { app.innerHTML = '<p class="wrap">등록된 호수가 없습니다.</p>'; finishLoader(); }
  else init();
})();
