/* Shared by the home page and /projects/: a tiny element builder and the icons. */
const config = window.BOO_CONFIG;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    node.setAttribute(key, value === true ? "" : value);
  });
  kids.flat().forEach((kid) => {
    if (kid == null || kid === false) return;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  });
  return node;
}

const icons = {
  github: '<path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.04 10.04 0 0 0 22 12.26C22 6.58 17.52 2 12 2z"/>',
  discord: '<path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>',
  globe: '<path fill="currentColor" d="M12 2.2A9.8 9.8 0 1 0 21.8 12 9.8 9.8 0 0 0 12 2.2zm6.9 6.2h-3a15.6 15.6 0 0 0-1.4-3.6 8 8 0 0 1 4.4 3.6zM12 4.1c.7.9 1.5 2.3 2 4.3H10c.5-2 1.3-3.4 2-4.3zM4.6 13.6a8 8 0 0 1 0-3.2h3.3a17 17 0 0 0 0 3.2H4.6zm.5 2h3a15.6 15.6 0 0 0 1.4 3.6 8 8 0 0 1-4.4-3.6zm3-7.2h-3a8 8 0 0 1 4.4-3.6A15.6 15.6 0 0 0 8.1 8.4zM12 19.9c-.7-.9-1.5-2.3-2-4.3h4c-.5 2-1.3 3.4-2 4.3zm2.5-6.3h-5a15.2 15.2 0 0 1 0-3.2h5a15.2 15.2 0 0 1 0 3.2zm.6 6.9a15.6 15.6 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.6-5.3a17 17 0 0 0 0-3.2h3.3a8 8 0 0 1 0 3.2h-3.3z"/>',
  x: '<path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.25 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z"/>',
  back: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>'
};

function icon(name) {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || ""}</svg>`;
  return wrap.firstChild;
}

function chips(item) {
  return el("span", { class: "chips" }, item.chips.map((chip) => el("span", { class: "chip" }, chip)));
}

function projectLinks(item, extraClass) {
  return el("div", { class: `project-links${extraClass ? ` ${extraClass}` : ""}` },
    item.links.map((link) => el("a", { href: link.url, target: "_blank", rel: "noreferrer" }, link.label)));
}
