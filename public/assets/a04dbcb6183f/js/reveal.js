// Scroll reveals and header shadow. The page is complete without this script:
// elements are only hidden once this script has marked the page as animated, and
// readers who ask for reduced motion never get the class.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SELECTORS = [
  '.card', '.robot-card', '.robot-row', '.robot-block', '.robots-link', '.quick-head',
  '.idx > li', '.doc > h2', '.doc > p', '.doc > pre', '.doc > table', '.robot-facts',
  '.robot-needs', '.robot-steps li', '.store-banner', '.src', '.ans > p', '.ans > pre',
].join(', ');

if (!reduced && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('motion');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  document.querySelectorAll(SELECTORS).forEach((el, index) => {
    el.classList.add('reveal');
    el.style.setProperty('--delay', `${(index % 4) * 70}ms`);
    observer.observe(el);
  });
}

const header = document.querySelector('.hdr');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

document.addEventListener('click', (event) => {
  document.querySelectorAll('.hdr-menu[open]').forEach((menu) => {
    if (!menu.contains(event.target)) {
      menu.removeAttribute('open');
    }
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.hdr-menu[open]').forEach((menu) => {
      menu.removeAttribute('open');
    });
  }
});
