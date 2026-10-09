(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Nav gets a hairline once the page scrolls
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Fade sections in as they enter the viewport
  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-in'));
  }

  // Seven-segment counter: counts up to 99, then back down, only while visible
  const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abfgcd'];
  document.querySelectorAll('[data-seg]').forEach(plate => {
    const digits = plate.querySelectorAll('.seg');
    const up = plate.querySelector('[data-dir="up"]');
    const down = plate.querySelector('[data-dir="down"]');
    let n = 0, step = 1, timer = null;
    const draw = () => {
      const s = String(n).padStart(2, '0');
      digits.forEach((d, i) => d.querySelectorAll('i').forEach(seg => seg.classList.toggle('on', DIGITS[+s[i]].includes(seg.className.replace(' on', '')))));
      plate.querySelectorAll('.dp').forEach(dp => dp.classList.toggle('on', step > 0));
      if (up) up.classList.toggle('is-on', step > 0);
      if (down) down.classList.toggle('is-on', step < 0);
    };
    const tick = () => { n += step; if (n >= 99 || n <= 0) step = -step; draw(); };
    if (reduceMotion || !('IntersectionObserver' in window)) { n = 88; draw(); return; }
    draw();
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) timer = setInterval(tick, 420);
      if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
    }).observe(plate);
  });

  // Footer stripe: the word in 8-bit ASCII, copper for 1 and graphite for 0
  document.querySelectorAll('[data-bits]').forEach(el => {
    const bits = [...el.dataset.bits].map(ch => ch.charCodeAt(0).toString(2).padStart(8, '0')).join('');
    el.innerHTML = [...bits].map(b => `<i class="${b === '1' ? 'on' : ''}"></i>`).join('');
    el.setAttribute('title', `${el.dataset.bits} in binary`);
  });

  // Project filters
  const chips = document.querySelector('[data-chips]');
  if (chips) {
    const projects = document.querySelectorAll('[data-lang]');
    chips.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const f = chip.dataset.filter;
      chips.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('is-active', c === chip);
        c.setAttribute('aria-pressed', String(c === chip));
      });
      projects.forEach(p => {
        p.hidden = f !== 'all' && !p.dataset.lang.split(' ').includes(f);
        if (!p.hidden) p.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('is-in'));
      });
    });
  }

  // Lightbox for screenshots
  const lb = document.querySelector('.lightbox');
  if (lb) {
    const img = lb.querySelector('img');
    const cap = lb.querySelector('.lightbox__cap');
    let opener = null;
    const close = () => {
      lb.classList.remove('is-open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (opener) opener.focus();
    };
    document.querySelectorAll('[data-full]').forEach(btn => btn.addEventListener('click', () => {
      opener = btn;
      img.src = btn.dataset.full;
      img.alt = btn.querySelector('img')?.alt || '';
      cap.textContent = btn.dataset.cap || '';
      lb.classList.add('is-open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      lb.querySelector('.lightbox__close').focus();
    }));
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.lightbox__close') || e.target.closest('.lightbox__stage')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lb.classList.contains('is-open')) close(); });
  }

  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
})();
