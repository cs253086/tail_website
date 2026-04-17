// --- nav scroll state + mobile toggle ---
const nav = document.getElementById('nav');
const toggle = document.querySelector('.nav__toggle');

function onScroll() {
  if (!nav) return;
  nav.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

if (toggle) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('.nav__links a').forEach(a =>
    a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    })
  );
}

// --- tabs (install section) ---
const tabs = document.querySelectorAll('.tab');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.toggle('is-active', p.dataset.panel === target);
    });
  });
});

// --- copy-to-clipboard ---
document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const pre = btn.closest('.code')?.querySelector('pre');
    if (!pre) return;
    const text = pre.innerText;
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1400);
    } catch {
      btn.textContent = 'Press ⌘+C';
      setTimeout(() => (btn.textContent = 'Copy'), 1400);
    }
  });
});

// --- feature card spotlight (cursor-follow glow) ---
document.querySelectorAll('.feature').forEach(card => {
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
});

// --- year in footer ---
const y = document.getElementById('year');
if (y) y.textContent = new Date().getFullYear();

// --- scroll reveal ---
const io = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'none';
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.feature, .usage-card, .dl-card, .section__head').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(14px)';
  el.style.transition = 'opacity .5s ease, transform .5s ease';
  io.observe(el);
});
