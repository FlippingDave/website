/* FlippingDave — shared page behaviour (home + referrals) */
(function () {
  'use strict';

  const VERSION = '2.0.0';
  const BUILD   = '2026-11-17';

  /* ─────────────── SHARED STATE ─────────────── */
  let droppingIn = true;
  let exploding = false;
  let qrMode = false;
  let shaking = false;

  const socialsNav = document.querySelector('.socials');
  const allBtns = Array.from(document.querySelectorAll('.soc-btn'));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  /* ─────────────── TRACKING ───────────────
     Page views + every button click → /api/track → Cloudflare Analytics Engine */
  function track(type, name) {
    const body = JSON.stringify({
      type, name: String(name || '').slice(0, 96),
      path: location.pathname,
      ref: document.referrer || '',
      w: innerWidth,
    });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/track', body)) {
        fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }
  track('view', location.pathname);

  // Capture phase: runs before any handler can stopPropagation()
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-track], .soc-btn, .share-item, .qr-toggle');
    if (!el || el.closest('.cr-panel')) return;
    let name = el.dataset.track || el.getAttribute('title') || el.textContent.trim() || 'unknown';
    if (qrMode && el.classList.contains('soc-btn')) name += ' (QR)';
    track('click', name);
  }, true);

  /* ─────────────── DROP-IN ANIMATION ─────────────── */
  const handleEl = document.querySelector('.handle');
  const DROP_STAGGER = 90;

  handleEl.classList.add('drop-hidden');
  allBtns.forEach(btn => btn.classList.add('drop-hidden'));

  requestAnimationFrame(() => { requestAnimationFrame(() => {
    setTimeout(() => {
      handleEl.classList.remove('drop-hidden');
      handleEl.classList.add('revealed');
    }, 150);

    allBtns.forEach((btn, i) => {
      setTimeout(() => {
        btn.classList.remove('drop-hidden');
        btn.classList.add('dropped');
      }, 500 + i * DROP_STAGGER);
    });

    const totalDropTime = 500 + allBtns.length * DROP_STAGGER + 600;
    setTimeout(() => {
      handleEl.classList.remove('revealed');
      allBtns.forEach(btn => btn.classList.remove('dropped'));
      droppingIn = false;
      runLightShow();
    }, totalDropTime);
  }); });

  /* ─────────────── LIGHT SHOW ─────────────── */
  const STEP = 1500;
  const HOLD = 1800;
  function runLightShow() {
    const btns = allBtns.slice();
    for (let i = btns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [btns[i], btns[j]] = [btns[j], btns[i]];
    }
    btns.forEach((btn, i) => {
      setTimeout(() => {
        btn.classList.add('lit');
        setTimeout(() => btn.classList.remove('lit'), HOLD);
      }, i * STEP);
    });
    setTimeout(runLightShow, btns.length * STEP);
  }

  /* ─────────────── MODAL (site QR / Wi-Fi) ─────────────── */
  function qrInto(box, text, logoNode) {
    const canvas = document.createElement('canvas');
    if (typeof QrCreator !== 'undefined') {
      QrCreator.render({ text, radius: 0.3, ecLevel: 'H', size: 520, fill: '#1a2a3a', background: '#fff' }, canvas);
    }
    box.appendChild(canvas);
    if (logoNode) {
      const logo = document.createElement('div');
      logo.className = 'qr-logo';
      logo.appendChild(logoNode);
      box.appendChild(logo);
    }
  }

  function openModal({ title, qr, logo, rows = [], note }) {
    const ov = document.createElement('div');
    ov.className = 'fd-overlay';
    ov.innerHTML = `<div class="fd-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <h2></h2><div class="fd-qr-box"></div><div class="fd-rows"></div>
      ${note ? '<p class="fd-note"></p>' : ''}
      <button class="fd-close" type="button">Close</button></div>`;
    ov.querySelector('h2').textContent = title;
    if (note) ov.querySelector('.fd-note').textContent = note;
    qrInto(ov.querySelector('.fd-qr-box'), qr, logo);
    const rowsEl = ov.querySelector('.fd-rows');
    rows.forEach(([label, value, copy = true]) => {
      const r = document.createElement('div');
      r.className = 'fd-row';
      r.innerHTML = '<span></span><b></b><button type="button">Copy</button>';
      r.children[0].textContent = label;
      r.children[1].textContent = value;
      if (!copy) r.children[2].remove();
      else r.children[2].addEventListener('click', () => {
        navigator.clipboard.writeText(value).then(() => {
          r.children[2].textContent = '✓';
          setTimeout(() => { r.children[2].textContent = 'Copy'; }, 1200);
        }).catch(() => {});
      });
      rowsEl.appendChild(r);
    });
    if (!rows.length) rowsEl.remove();
    const close = () => { ov.classList.remove('open'); setTimeout(() => ov.remove(), 200); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.fd-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('open'));
  }

  function iconOf(btn) {
    const icon = btn && btn.querySelector(':scope > svg, :scope > .x-logo, :scope > img.logo');
    return icon ? icon.cloneNode(true) : null;
  }

  /* ─────────────── SHARE ─────────────── */
  const shareBtn  = document.getElementById('share-btn');
  const shareMenu = document.getElementById('share-menu');
  if (shareBtn && shareMenu) {
    const copyLabel = document.getElementById('copy-label');
    const url = location.origin + location.pathname;
    const text = document.body.dataset.shareText || 'Check out FlippingDave!';
    document.getElementById('share-x').href  = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    document.getElementById('share-fb').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    document.getElementById('share-wa').href = `https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + url)}`;
    shareBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (qrMode) return;
      shareMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => shareMenu.classList.remove('open'));
    shareMenu.addEventListener('click', e => e.stopPropagation());
    document.getElementById('copy-link-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        copyLabel.textContent = '✓ Copied!';
        setTimeout(() => { copyLabel.textContent = 'Copy link'; }, 1500);
      });
    });
    const qrItem = document.getElementById('share-qr');
    if (qrItem) qrItem.addEventListener('click', () => {
      shareMenu.classList.remove('open');
      const avatar = document.createElement('img');
      avatar.src = document.querySelector('.avatar-bg')?.src || '';
      avatar.alt = '';
      avatar.style.cssText = 'width:86%;height:86%;border-radius:50%;object-fit:cover';
      openModal({ title: 'Scan to open this page', qr: url, logo: avatar, rows: [['Link', url.replace(/^https?:\/\//, '')]] });
    });
  }

  /* ─────────────── WI-FI ─────────────── */
  const wifiBtn = document.getElementById('wifi-btn');
  if (wifiBtn) {
    wifiBtn.addEventListener('click', e => {
      if (qrMode || shaking || droppingIn) return;
      e.preventDefault();
      const d = wifiBtn.dataset;
      openModal({
        title: 'Join my hotspot',
        qr: wifiBtn.dataset.qr,
        logo: iconOf(wifiBtn),
        rows: [['Network', d.ssid], ['Password', d.pass], ['Security', d.enc, false]],
        note: 'Point your phone camera at the code to join.',
      });
    });
  }

  /* ─────────────── EXPLODE ON CLICK ─────────────── */
  socialsNav.addEventListener('click', e => {
    const clicked = e.target.closest('.soc-btn');
    if (!clicked || exploding || shaking || droppingIn || qrMode) return;
    const href = clicked.getAttribute('href');
    if (!href) return;

    exploding = true;
    e.preventDefault();

    allBtns.forEach(b => { b.style.transform = ''; b.style.translate = ''; });

    const cr = clicked.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    const ghosts = [];

    allBtns.forEach(btn => {
      if (btn === clicked) return;
      const r = btn.getBoundingClientRect();
      const bx = r.left + r.width / 2, by = r.top + r.height / 2;
      const angle = Math.atan2(by - cy, bx - cx) + (Math.random() - 0.5) * 0.5;
      const dist  = 650 + Math.random() * 350;
      const dx    = Math.cos(angle) * dist;
      const dy    = Math.sin(angle) * dist;
      const rot   = (Math.random() - 0.5) * 130;
      const stagger = Math.random() * 55;

      const ghost = btn.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:9990;box-sizing:border-box;transition:none;opacity:1;`;
      document.body.appendChild(ghost);
      btn.style.visibility = 'hidden';
      ghosts.push({ ghost, btn });

      setTimeout(() => {
        ghost.style.transition = 'transform 0.55s cubic-bezier(0.15,0,0.65,0.85), opacity 0.35s ease 0.15s';
        ghost.style.transform  = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(0.1)`;
        ghost.style.opacity    = '0';
      }, stagger);
    });

    const isInsta = clicked.classList.contains('insta');
    const glowColor = isInsta ? 'rgba(214,36,159,.7)' : (clicked.style.getPropertyValue('--bs').trim() || 'rgba(26,108,245,.6)');
    clicked.style.transition = 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s ease';
    clicked.style.transform  = 'scale(1.18)';
    clicked.style.boxShadow  = `0 0 0 4px #fff, 0 0 32px 10px ${glowColor}`;

    const isExternal = clicked.getAttribute('target') === '_blank';
    setTimeout(() => {
      if (isExternal) window.open(href, '_blank', 'noopener,noreferrer');
      else location.href = href;
      clicked.style.transform  = '';
      clicked.style.boxShadow  = '';
      clicked.style.transition = '';
      setTimeout(() => {
        ghosts.forEach(({ ghost, btn }) => { ghost.remove(); btn.style.visibility = ''; });
        exploding = false;
      }, 300);
    }, 650);
  });

  // Coming back via the browser's back button restores a frozen page — un-hide everything
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    document.querySelectorAll('body > .soc-btn').forEach(g => g.remove());
    allBtns.forEach(b => { b.style.visibility = ''; b.style.transform = ''; b.style.boxShadow = ''; b.style.transition = ''; });
    exploding = false;
  });

  /* ─────────────── QR CODES ─────────────── */
  const qrToggle = document.getElementById('qr-toggle');

  if (typeof QrCreator !== 'undefined') {
    document.querySelectorAll('.soc-btn[href], .soc-btn[data-qr]').forEach(btn => {
      const overlay = document.createElement('div');
      overlay.className = 'qr-overlay';
      const canvas = document.createElement('canvas');
      const text = btn.dataset.qr || btn.href;
      QrCreator.render({ text, radius: 0.3, ecLevel: 'H', size: 220, fill: '#1a2a3a', background: '#fff' }, canvas);
      overlay.appendChild(canvas);
      const icon = iconOf(btn);
      if (icon) {
        const logo = document.createElement('div');
        logo.className = 'qr-logo';
        logo.appendChild(icon);
        overlay.appendChild(logo);
      }
      btn.appendChild(overlay);
    });
  }

  function unfocusQR() {
    socialsNav.classList.remove('qr-focused');
    socialsNav.querySelectorAll('.qr-active').forEach(b => b.classList.remove('qr-active'));
  }

  if (qrToggle) qrToggle.addEventListener('click', e => {
    e.stopPropagation();
    qrMode = !qrMode;
    socialsNav.classList.toggle('qr-mode', qrMode);
    qrToggle.classList.toggle('active', qrMode);
    if (!qrMode) unfocusQR();
  });

  // Long-press individual button → show just that QR
  let lpTimer = null;
  socialsNav.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.soc-btn');
    if (!btn || qrMode) return;
    lpTimer = setTimeout(() => {
      const overlay = btn.querySelector('.qr-overlay');
      if (!overlay) return;
      overlay.style.opacity = '1';
      function hide() { overlay.style.opacity = ''; }
      btn.addEventListener('pointerup', hide, { once: true });
      btn.addEventListener('pointercancel', hide, { once: true });
    }, 600);
  });
  socialsNav.addEventListener('pointerup', () => clearTimeout(lpTimer));
  socialsNav.addEventListener('pointercancel', () => clearTimeout(lpTimer));

  // QR focus — tap a button in QR mode to enlarge it in the centre of the grid
  socialsNav.addEventListener('click', e => {
    if (!qrMode) return;
    const btn = e.target.closest('.soc-btn');

    if (socialsNav.classList.contains('qr-focused')) {
      unfocusQR();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();

    // Move it to the middle of the grid and cap the scale so it always fits on screen
    const br = btn.getBoundingClientRect();
    const nr = socialsNav.getBoundingClientRect();
    const dx = (nr.left + nr.width / 2) - (br.left + br.width / 2);
    const dy = (nr.top + nr.height / 2) - (br.top + br.height / 2);
    const scale = Math.max(1, Math.min(1.9, (vpW() - 32) / br.width));
    btn.style.setProperty('--qx', dx.toFixed(1) + 'px');
    btn.style.setProperty('--qy', dy.toFixed(1) + 'px');
    btn.style.setProperty('--qs', scale.toFixed(3));
    socialsNav.classList.add('qr-focused');
    btn.classList.add('qr-active');
  });

  function vpW() { return document.documentElement.clientWidth || innerWidth || 800; }

  /* ─────────────── ANT (+10%) ─────────────── */
  const ant = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ant.id = 'ant';
  ant.setAttribute('viewBox', '0 0 22 13');
  ant.innerHTML = `
    <g stroke="#2c1508" stroke-width="0.8" stroke-linecap="round" fill="none">
      <g id="lp0"><polyline points="7.8,5.0 6.5,3.2 5.0,1.8"/><polyline points="7.8,8.0 6.5,9.8 5.0,11.2"/></g>
      <g id="lp1"><polyline points="9.5,5.0 8.0,3.2 6.8,1.8"/><polyline points="9.5,8.0 8.0,9.8 6.8,11.2"/></g>
      <g id="lp2"><polyline points="10.8,5.0 10.0,3.2 8.8,1.8"/><polyline points="10.8,8.0 10.0,9.8 8.8,11.2"/></g>
    </g>
    <ellipse cx="16.5" cy="6.5" rx="5" ry="4" fill="#2c1508"/>
    <ellipse cx="9.5" cy="6.5" rx="2.3" ry="1.8" fill="#2c1508"/>
    <ellipse cx="4" cy="6.5" rx="3" ry="2.3" fill="#2c1508"/>
    <line x1="2.8" y1="4.8" x2="1.2" y2="2.2" stroke="#2c1508" stroke-width="0.9" stroke-linecap="round"/>
    <line x1="4.5" y1="4.5" x2="3.2" y2="1.8" stroke="#2c1508" stroke-width="0.9" stroke-linecap="round"/>
    <circle cx="1.2" cy="2.2" r="0.7" fill="#2c1508"/>
    <circle cx="3.2" cy="1.8" r="0.7" fill="#2c1508"/>
    <circle cx="3" cy="6" r="0.55" fill="#5a2a0a"/>`;
  document.documentElement.appendChild(ant); /* outside body — guarantees viewport containing block */
  const lp0 = ant.querySelector('#lp0'), lp1 = ant.querySelector('#lp1'), lp2 = ant.querySelector('#lp2');

  let antW = 0, antH = 0;
  function cacheAntSize() {
    const r = ant.getBoundingClientRect();
    antW = r.width  || 10;  /* fallback: 2.75mm @96dpi ≈ 10px */
    antH = r.height || 6.2; /* fallback: 1.65mm @96dpi ≈ 6px  */
  }
  cacheAntSize();

  let vw = innerWidth  || document.documentElement.clientWidth  || 800;
  let vh = innerHeight || document.documentElement.clientHeight || 600;
  addEventListener('resize', () => { vw = innerWidth; vh = innerHeight; cacheAntSize(); });

  let ax = vw * (.2 + Math.random() * .6);
  let ay = vh * (.2 + Math.random() * .6);
  let angle = Math.random() * Math.PI * 2;
  let baseSpeed = 0.35, speed = baseSpeed;
  let legPhase = 0, pauseLeft = 0, turnTimer = 0, fleeFrames = 0;

  function placeAnt(px, py, ang, skew) {
    const tx = px - antW / 2, ty = py - antH / 2;
    ant.style.transform = `translate(${tx}px,${ty}px) rotate(${ang * 180 / Math.PI + 180}deg) skewY(${skew}deg)`;
  }

  function antTick() {
    if (fleeFrames > 0) { fleeFrames--; speed = 3; } else speed = baseSpeed;

    if (pauseLeft > 0 && fleeFrames === 0) {
      pauseLeft--;
      placeAnt(ax, ay, angle + Math.sin(Date.now() / 75) * 0.03, 0);
      requestAnimationFrame(antTick); return;
    }
    if (fleeFrames === 0 && Math.random() < .004) {
      pauseLeft = 45 + Math.floor(Math.random() * 90);
      requestAnimationFrame(antTick); return;
    }

    angle += (Math.random() - .5) * .08;
    if (--turnTimer <= 0) { angle += (Math.random() - .5) * 1.1; turnTimer = 90 + Math.floor(Math.random() * 130); }

    ax += Math.cos(angle) * speed;
    ay += Math.sin(angle) * speed;
    const pad = 24;
    if (ax < pad)        { angle = Math.PI - angle; ax = pad; }
    if (ax > vw - pad)   { angle = Math.PI - angle; ax = vw - pad; }
    if (ay < pad)        { angle = -angle; ay = pad; }
    if (ay > vh - pad)   { angle = -angle; ay = vh - pad; }

    legPhase += .38;
    const dir = Math.cos(angle) >= 0 ? -1 : 1;
    const sw = Math.sin(legPhase) * 10 * dir;
    lp0.setAttribute('transform', `rotate(${sw} 7.8 6.5)`);
    lp1.setAttribute('transform', `rotate(${-sw} 9.5 6.5)`);
    lp2.setAttribute('transform', `rotate(${sw} 10.8 6.5)`);
    placeAnt(ax, ay, angle, Math.sin(legPhase) * 2);
    requestAnimationFrame(antTick);
  }
  antTick();

  ant.addEventListener('click', () => { fleeFrames = 140; track('click', 'Ant'); launchFireworks(); });

  /* ─────────────── FIREWORKS ─────────────── */
  function launchFireworks() {
    const cvs = document.createElement('canvas');
    cvs.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99995;';
    cvs.width = innerWidth; cvs.height = innerHeight;
    document.body.appendChild(cvs);
    const ctx = cvs.getContext('2d');
    const C = ['#1a6cf5','#ff5e00','#ffd000','#00ccff','#ff0080','#7c3aed','#25D366','#ffffff','#ff4444','#ffaa00'];

    class Rocket {
      constructor() {
        this.x = innerWidth * (.1 + Math.random() * .8); this.y = innerHeight + 5;
        this.vy = -(9 + Math.random() * 5); this.vx = (Math.random() - .5) * 1.5;
        this.color = C[Math.floor(Math.random() * C.length)];
        this.trail = []; this.done = false;
      }
      update(sparks) {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 12) this.trail.shift();
        this.x += this.vx; this.y += this.vy; this.vy += .18;
        if (this.vy >= 0 && !this.done) {
          this.done = true;
          const n = 70 + Math.floor(Math.random() * 50);
          for (let i = 0; i < n; i++) sparks.push(new Spark(this.x, this.y, this.color));
          const c2 = C[Math.floor(Math.random() * C.length)];
          for (let i = 0; i < 30; i++) sparks.push(new Spark(this.x, this.y, c2, .4));
        }
        return !this.done;
      }
      draw() {
        for (let i = 0; i < this.trail.length; i++) {
          ctx.globalAlpha = (i / this.trail.length) * .6;
          ctx.fillStyle = this.color;
          ctx.beginPath(); ctx.arc(this.trail[i].x, this.trail[i].y, 2.5, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI*2); ctx.fill();
      }
    }

    class Spark {
      constructor(x, y, color, sm = 1) {
        this.x = x; this.y = y;
        const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 6) * sm;
        this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
        this.color = Math.random() < .25 ? C[Math.floor(Math.random() * C.length)] : color;
        this.life = 1; this.decay = .013 + Math.random() * .012;
        this.size = 1.5 + Math.random() * 3; this.tail = [];
      }
      update() {
        this.tail.push({ x: this.x, y: this.y });
        if (this.tail.length > 5) this.tail.shift();
        this.x += this.vx; this.y += this.vy; this.vy += .1; this.vx *= .98;
        this.life -= this.decay; return this.life > 0;
      }
      draw() {
        for (let i = 0; i < this.tail.length; i++) {
          ctx.globalAlpha = (i / this.tail.length) * this.life * .5;
          ctx.fillStyle = this.color;
          ctx.beginPath(); ctx.arc(this.tail[i].x, this.tail[i].y, this.size * .6, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = this.life; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI*2); ctx.fill();
      }
    }

    const rockets = [], sparks = [];
    [0,250,500,750,1000,1300,1600,1900,2200,2500,2800,3100,3400,3700].forEach(d => setTimeout(() => rockets.push(new Rocket()), d));
    const start = performance.now();
    (function loop() {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      for (let i = rockets.length-1; i >= 0; i--) { if (!rockets[i].update(sparks)) rockets.splice(i,1); else rockets[i].draw(); }
      for (let i = sparks.length-1;  i >= 0; i--) { if (!sparks[i].update())        sparks.splice(i,1);  else sparks[i].draw(); }
      ctx.globalAlpha = 1;
      if (performance.now() - start < 5500 || rockets.length || sparks.length) requestAnimationFrame(loop);
      else cvs.remove();
    })();
  }

  /* ─────────────── 432 Hz TONE ───────────────
     Browsers block sound until the visitor interacts, so it starts on the first tap/click/key. */
  const Tone = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, gain = null;
    let vol = parseFloat(store.get('fd-vol', '0.2'));
    let on  = store.get('fd-sound', '1') === '1';
    if (!(vol >= 0 && vol <= 1)) vol = 0.2;
    const level = () => (on ? vol * vol * 0.35 : 0);   // squared curve → gentle at the low end

    function ensure() {
      if (!AC) return false;
      if (ctx) return true;
      try {
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 432;
        osc.connect(gain);
        osc.start();
        return true;
      } catch { ctx = null; return false; }
    }
    function apply(fade = 0.4) {
      if (!ctx) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(level(), t + fade);
    }
    function kick() {
      if (!on || !ensure()) return;
      if (ctx.state !== 'running') ctx.resume().then(() => apply(2.5)).catch(() => {});
      else apply(2.5);
    }
    // Try straight away (works where autoplay is allowed), then on first interaction
    kick();
    ['pointerdown', 'keydown', 'touchend'].forEach(ev =>
      addEventListener(ev, function first() {
        kick();
        if (ctx && ctx.state === 'running') ['pointerdown', 'keydown', 'touchend'].forEach(x => removeEventListener(x, first, true));
      }, true));
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (on) ctx.resume().catch(() => {});
    });

    return {
      get vol() { return vol; },
      get on() { return on; },
      setVol(v) { vol = v; store.set('fd-vol', String(v)); if (v > 0 && !on) { on = true; store.set('fd-sound', '1'); } kick(); apply(0.15); },
      toggle() { on = !on; store.set('fd-sound', on ? '1' : '0'); if (on) kick(); apply(0.3); return on; },
    };
  })();

  /* ─────────────── CONTROL ROOM (hidden button) ─────────────── */
  const secret = document.createElement('button');
  secret.id = 'secret-btn';
  secret.type = 'button';
  secret.setAttribute('aria-label', 'Control room');
  document.body.appendChild(secret);
  secret.addEventListener('click', e => { e.stopPropagation(); track('click', 'Control room'); openControlRoom(); });

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString();

  function openControlRoom() {
    if (document.querySelector('.cr-panel')) return;
    const panel = document.createElement('div');
    panel.className = 'cr-panel';
    panel.innerHTML = `
      <div class="cr-card" role="dialog" aria-modal="true" aria-label="Control room">
        <div class="cr-head"><h2>🎛️ Control room</h2><button class="cr-x" type="button" aria-label="Close">×</button></div>

        <section class="cr-sec">
          <h3>Sound · 432 Hz</h3>
          <div class="cr-vol">
            <button class="cr-btn" type="button" data-act="mute"></button>
            <input type="range" min="0" max="100" step="1" aria-label="Volume">
            <output></output>
          </div>
        </section>

        <section class="cr-sec">
          <h3>Visitors</h3>
          <div class="cr-ranges">
            <button class="cr-btn" type="button" data-days="1">24 h</button>
            <button class="cr-btn" type="button" data-days="7">7 days</button>
            <button class="cr-btn" type="button" data-days="30">30 days</button>
            <button class="cr-btn" type="button" data-days="90">90 days</button>
          </div>
          <div class="cr-stats"><p class="cr-muted" style="margin-top:.7rem">Loading…</p></div>
        </section>

        <div class="cr-ver">FlippingDave v${VERSION} · built ${BUILD}</div>
      </div>`;
    document.body.appendChild(panel);

    const close = () => { panel.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    panel.addEventListener('click', e => { if (e.target === panel) close(); });
    panel.querySelector('.cr-x').addEventListener('click', close);

    // Sound controls
    const muteBtn = panel.querySelector('[data-act=mute]');
    const range = panel.querySelector('input[type=range]');
    const out = panel.querySelector('output');
    const paint = () => {
      muteBtn.textContent = Tone.on ? '🔊 On' : '🔇 Off';
      muteBtn.classList.toggle('on', Tone.on);
      range.value = Math.round(Tone.vol * 100);
      out.textContent = range.value;
    };
    paint();
    muteBtn.addEventListener('click', () => { Tone.toggle(); paint(); });
    range.addEventListener('input', () => { Tone.setVol(range.value / 100); paint(); });

    // Stats
    const statsEl = panel.querySelector('.cr-stats');
    const rangeBtns = panel.querySelectorAll('[data-days]');
    const load = days => {
      store.set('fd-days', days);
      rangeBtns.forEach(b => b.classList.toggle('on', b.dataset.days === String(days)));
      statsEl.innerHTML = '<p class="cr-muted" style="margin-top:.7rem">Loading…</p>';
      loadStats(days, statsEl);
    };
    rangeBtns.forEach(b => b.addEventListener('click', () => load(b.dataset.days)));
    load(store.get('fd-days', '7'));
  }

  async function loadStats(days, el) {
    const headers = {};
    const key = store.get('fd-stats-key', '');
    if (key) headers['X-Stats-Key'] = key;
    let res, data;
    try {
      res = await fetch(`/api/stats?days=${encodeURIComponent(days)}`, { headers, cache: 'no-store' });
      data = await res.json();
    } catch {
      el.innerHTML = '<p class="cr-muted" style="margin-top:.7rem">Stats aren’t available here (the stats API only runs on the live Cloudflare site).</p>';
      return;
    }
    if (res.status === 401) {
      el.innerHTML = `<p class="cr-muted" style="margin-top:.7rem">Enter the stats key:</p>
        <div class="cr-vol" style="margin-top:.4rem"><input type="password" class="cr-key" style="flex:1;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;font:inherit">
        <button class="cr-btn on" type="button">Unlock</button></div>`;
      el.querySelector('.cr-btn').addEventListener('click', () => {
        store.set('fd-stats-key', el.querySelector('.cr-key').value.trim());
        loadStats(days, el);
      });
      return;
    }
    if (!data || data.error) {
      el.innerHTML = `<p class="cr-muted" style="margin-top:.7rem">${esc(data && data.error || 'Could not load stats.')}</p>`;
      return;
    }

    const t = data.totals || {};
    const list = (title, rows) => `
      <section class="cr-sec"><h3>${esc(title)}</h3>
        ${rows && rows.length
          ? `<ul class="cr-list">${rows.map(r => `<li><span>${esc(r.k || '(none)')}</span><span>${fmt(r.n)}</span></li>`).join('')}</ul>`
          : '<p class="cr-muted">Nothing yet.</p>'}
      </section>`;
    const daily = data.daily || [];
    const max = Math.max(1, ...daily.map(d => +d.n || 0));
    const recent = (data.recent || []).map(r => ({
      k: `${new Date(r.t.replace(' ', 'T') + 'Z').toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${r.type === 'view' ? 'viewed ' + r.path : r.name} · ${[r.city, r.country].filter(Boolean).join(', ')}`,
      n: r.device,
    }));

    el.innerHTML = `
      <div class="cr-tiles">
        <div class="cr-tile"><b>${fmt(t.views)}</b><span>Page views</span></div>
        <div class="cr-tile"><b>${fmt(t.visitors)}</b><span>Visitors</span></div>
        <div class="cr-tile"><b>${fmt(t.clicks)}</b><span>Clicks</span></div>
      </div>
      ${daily.length ? `<div class="cr-bars" title="Page views per day">${daily.map(d => `<div style="height:${(100 * d.n / max).toFixed(1)}%" title="${esc(d.day)}: ${fmt(d.n)}"></div>`).join('')}</div>` : ''}
      ${list('Button clicks', data.buttons)}
      ${list('Pages', data.pages)}
      ${list('Countries', data.countries)}
      ${list('Referrers', data.referrers)}
      ${list('Devices', data.devices)}
      ${list('Latest activity', recent)}`;
  }

  /* ─────────────── MOBILE TILT + SHAKE ─────────────── */
  if ('ontouchstart' in window) {
    const socialsWrap = document.querySelector('.socials-wrap');
    let tiltTarget = 0, tiltCurrent = 0;
    let lastMag = 9.8;
    const EDGE = 8;                 // px to keep clear of the screen edge
    let roomL = 0, roomR = 0, lastMeasure = 0;

    // How far the grid can slide each way before anything touches the screen edge.
    // Measures what's actually visible (including an enlarged QR), minus the current tilt.
    function measureRoom() {
      let minL = Infinity, maxR = -Infinity;
      allBtns.forEach(b => {
        if (getComputedStyle(b).opacity === '0') return;
        const r = b.getBoundingClientRect();
        if (!r.width) return;
        minL = Math.min(minL, r.left - tiltCurrent);
        maxR = Math.max(maxR, r.right - tiltCurrent);
      });
      if (minL === Infinity) { roomL = roomR = 0; return; }
      // lit buttons scale to 1.08 — leave room for that too
      const grow = allBtns[0] ? allBtns[0].offsetWidth * 0.04 : 0;
      roomL = Math.max(0, minL - EDGE - grow);
      roomR = Math.max(0, vpW() - EDGE - grow - maxR);
    }

    function startMotion() {
      window.addEventListener('deviceorientation', e => {
        if (e.gamma == null) return;
        tiltTarget = Math.max(-30, Math.min(30, e.gamma)) * 1.2;
      });

      window.addEventListener('devicemotion', e => {
        if (shaking) return;
        const a = e.accelerationIncludingGravity;
        if (!a) return;
        const mag = Math.sqrt((a.x||0)*(a.x||0) + (a.y||0)*(a.y||0) + (a.z||0)*(a.z||0));
        const delta = Math.abs(mag - lastMag);
        lastMag = mag;
        if (delta > 18) triggerPile();
      });

      (function tiltLoop(now) {
        if (!now || now - lastMeasure > 200) { measureRoom(); lastMeasure = now || 0; }
        const target = Math.max(-roomL, Math.min(roomR, tiltTarget));
        tiltCurrent += (target - tiltCurrent) * 0.12;
        if (socialsWrap) socialsWrap.style.transform = `translateX(${tiltCurrent.toFixed(2)}px)`;
        requestAnimationFrame(tiltLoop);
      })();
    }

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      document.addEventListener('touchstart', function ask() {
        DeviceOrientationEvent.requestPermission()
          .then(r => { if (r === 'granted') startMotion(); })
          .catch(() => {});
        document.removeEventListener('touchstart', ask);
      }, { once: true });
    } else {
      startMotion();
    }

    function triggerPile() {
      if (document.querySelector('.cr-panel, .fd-overlay')) return;
      shaking = true;
      track('click', 'Shake');
      const btns = allBtns;
      const particles = [];
      const floor = window.innerHeight - 14;

      btns.forEach(btn => {
        const r = btn.getBoundingClientRect();
        const ghost = btn.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:9990;box-sizing:border-box;`;
        document.body.appendChild(ghost);
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        particles.push({
          el: ghost,
          x: r.left, y: r.top, w: r.width, h: r.height,
          ox: r.left, oy: r.top,
          vx: (Math.random() - 0.5) * 2.5,
          vy: -(Math.random() * 1),
          rot: 0, vrot: (Math.random() - 0.5) * 4
        });
      });

      const g = 0.275;
      let rafId, done = false;

      (function loop() {
        let anyMoving = false;
        particles.forEach(p => {
          p.vy += g;
          p.x += p.vx; p.y += p.vy;
          p.rot += p.vrot;
          // keep the pile on screen too
          if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * 0.5; }
          if (p.x + p.w > vpW()) { p.x = vpW() - p.w; p.vx = -Math.abs(p.vx) * 0.5; }
          if (p.y + p.h >= floor) {
            p.y = floor - p.h;
            p.vy *= -0.10;
            p.vx *= 0.70;
            p.vrot *= 0.50;
          }
          if (Math.abs(p.vy) > 0.1 || Math.abs(p.vx) > 0.1 || p.y + p.h < floor - 1) anyMoving = true;
          p.el.style.transform = `translate(${(p.x-p.ox).toFixed(1)}px,${(p.y-p.oy).toFixed(1)}px) rotate(${p.rot.toFixed(1)}deg)`;
        });
        if (!done && anyMoving) rafId = requestAnimationFrame(loop);
      })();

      setTimeout(() => {
        let resetting = false;
        function doReset(e) {
          if (resetting) return;
          resetting = true;
          e.preventDefault();
          done = true;
          if (rafId) cancelAnimationFrame(rafId);
          particles.forEach((p, i) => {
            setTimeout(() => {
              p.el.style.transition = 'transform 0.75s cubic-bezier(0.33, 0, 0.66, 1)';
              p.el.style.transform = 'translate(0px,0px) rotate(0deg)';
            }, i * 35);
          });
          const dur = particles.length * 35 + 750;
          setTimeout(() => {
            btns.forEach(btn => {
              btn.style.transition = 'opacity 0.3s';
              btn.style.opacity = '';
              btn.style.pointerEvents = '';
            });
          }, dur - 200);
          setTimeout(() => {
            particles.forEach(p => p.el.remove());
            btns.forEach(btn => { btn.style.transition = ''; });
            shaking = false;
          }, dur + 150);
          document.removeEventListener('click', doReset);
          document.removeEventListener('touchstart', doReset);
        }
        document.addEventListener('click', doReset);
        document.addEventListener('touchstart', doReset);
      }, 800);
    }
  }

  /* ─────────────── MOUSE CURSOR + TAIL ─────────────── */
  if (!matchMedia('(pointer: fine)').matches) return;

  const mc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mc.id = 'mouse-cursor';
  mc.setAttribute('viewBox', '-10 0 40 21');
  mc.setAttribute('width', '40'); mc.setAttribute('height', '21');
  mc.innerHTML = `
    <path d="M2 11 Q-2 7 -6 10 Q-9 14.5 -7 17" fill="none" stroke="#c8a8a0" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="11" cy="11" rx="9"   ry="6.5" fill="#8a7468"/>
    <circle  cx="22" cy="11.5" r="6.5" fill="#8a7468"/>
    <ellipse cx="19.5" cy="4.5" rx="3.2" ry="2.8" fill="#aa8e87"/>
    <ellipse cx="19.5" cy="4.5" rx="2"   ry="1.7" fill="#e8b8c0"/>
    <ellipse cx="25"   cy="4"   rx="3"   ry="2.6" fill="#aa8e87"/>
    <ellipse cx="25"   cy="4"   rx="1.8" ry="1.6" fill="#e8b8c0"/>
    <circle  cx="23"   cy="10.5" r="2"   fill="#0d0805"/>
    <circle  cx="22.3" cy="9.8"  r="0.7" fill="#ffffff"/>`;
  document.body.appendChild(mc);
  const NOSE_X = 38.5, NOSE_Y = 11.5;

  const TAIL = 65;
  const tailDots = [];
  for (let i = 0; i < TAIL; i++) {
    const d = document.createElement('div');
    d.className = 'tail-dot';
    const frac = 1 - i / TAIL;
    d.style.opacity = (frac * 0.55).toFixed(3);
    const sz = Math.max(1.5, frac * 6).toFixed(1);
    d.style.width = d.style.height = sz + 'px';
    document.body.appendChild(d);
    tailDots.push(d);
  }

  const positions = Array.from({ length: TAIL }, () => ({ x: -300, y: -300 }));
  let mx = -300, my = -300;
  let lastMx = -300, lastMy = -300;
  let targetAngle = 0, smoothAngle = 0;

  document.addEventListener('mousemove', e => {
    const dx = e.clientX - lastMx, dy = e.clientY - lastMy;
    if (Math.abs(dx) + Math.abs(dy) > 1.5) targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    lastMx = mx = e.clientX; lastMy = my = e.clientY;
  });

  /* Magnetic buttons — uses `translate` so it stacks with the 3D press transform */
  document.addEventListener('mousemove', e => {
    if (qrMode || exploding) return;
    allBtns.forEach(el => {
      const r  = el.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      el.style.translate = dist < 90 ? `${(dx*.28*(1-dist/90)).toFixed(1)}px ${(dy*.28*(1-dist/90)).toFixed(1)}px` : '';
    });
  });

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d >  180) d -= 360;
    while (d < -180) d += 360;
    return a + d * t;
  }

  (function rafLoop() {
    smoothAngle = lerpAngle(smoothAngle, targetAngle, 0.1);
    mc.style.left            = (mx - NOSE_X) + 'px';
    mc.style.top             = (my - NOSE_Y) + 'px';
    mc.style.transformOrigin = NOSE_X + 'px ' + NOSE_Y + 'px';
    mc.style.transform       = `rotate(${smoothAngle}deg)`;
    positions.unshift({ x: mx, y: my });
    positions.length = TAIL;
    const SKIP = 6;
    tailDots.forEach((d, i) => { const p = positions[Math.min(i + SKIP, positions.length - 1)]; d.style.left = p.x + 'px'; d.style.top = p.y + 'px'; });
    requestAnimationFrame(rafLoop);
  })();

})();
