// Small pop-up messages under the header. The container is an aria-live region.

const MAX_TOASTS = 3;

export function createToaster(el) {
  return function toast(message, duration = 1400) {
    while (el.children.length >= MAX_TOASTS) el.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    el.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      t.addEventListener('animationend', () => t.remove(), { once: true });
      setTimeout(() => t.remove(), 400); // fallback when animations are off
    }, duration);
  };
}
