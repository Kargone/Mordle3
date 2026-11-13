// Shared animation helpers.

const reduceQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

export const reducedMotion = () => Boolean(reduceQuery?.matches);

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Restart a CSS animation class even if it's already applied. */
export function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow
  el.classList.add(cls);
  const done = (e) => {
    if (e.target !== el) return; // ignore bubbling from children (e.g. tile pops inside a shaking row)
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

/** Burst of little dots from the center of an element (win celebration). */
export function sparks(el, colors, count = 7) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.background = colors[i % colors.length];
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    const angle = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 30;
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 12}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}
