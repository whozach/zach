/* Home page: profile, about, projects. */
document.title = config.name;
document.getElementById("avatar").alt = config.avatar.alt;
document.getElementById("name").textContent = config.name;
document.getElementById("bio").textContent = config.bio;
const nowLine = document.getElementById("now");
nowLine.textContent = config.now || "";
nowLine.hidden = !config.now;

document.getElementById("socials").append(...config.links.map(socialLink));

function socialLink(link) {
  if (!link.copy) {
    return el("a", { href: link.url, "aria-label": link.name, title: link.name, target: "_blank", rel: "noreferrer" }, icon(link.icon));
  }
  // Nothing to link to (a Discord username), so the icon copies it instead.
  const tip = el("span", { class: "social-tip", role: "status" }, link.label);
  const button = el("button", { type: "button", "aria-label": `${link.name} ${link.label}, copy username` }, icon(link.icon), tip);
  let timer;
  button.addEventListener("click", async () => {
    tip.textContent = await copyText(link.copy) ? `copied ${link.label}` : link.label;
    button.classList.add("show-tip");
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.classList.remove("show-tip");
      tip.textContent = link.label;
    }, 1600);
  });
  return button;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // In-app browsers often block the Clipboard API; the old way still works there.
    const area = el("textarea", { readonly: true, "aria-hidden": "true", style: "position:fixed;top:0;opacity:0" }, text);
    const focused = document.activeElement;
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    focused?.focus({ preventScroll: true });
    return copied;
  }
}

/* ---------- showcase card (the main project, under the name) ---------- */

const showcase = document.getElementById("showcase");
const showcased = config.projects.items.find((item) => item.id === config.showcase);
if (showcased) {
  showcase.href = `/projects/#${showcased.id}`;
  showcase.setAttribute("aria-label", `Main project: ${showcased.title}. ${showcased.line}`);
  showcase.append(
    // alt "": the link's aria-label already names the project. Below the fold (About), so lazy.
    picture(showcased.image, showcased.imageWebp, { class: "showcase-photo", alt: "", width: 800, height: 500, loading: "lazy", style: showcased.imageFocus && `object-position: ${showcased.imageFocus}` }),
    el("span", { class: "showcase-top" },
      el("span", { class: "showcase-label" }, "main project"),
      chips(showcased)),
    el("span", { class: "showcase-title" }, showcased.title),
    el("span", { class: "showcase-line" }, showcased.line));
  showcase.hidden = false;
}

/* ---------- experience (config.experience) ---------- */

const n = (x) => x.toLocaleString("en-US");
document.getElementById("experienceList").append(...(config.experience || []).map((job) => {
  const changes = job.changes || [];
  const add = changes.reduce((t, c) => t + c.add, 0), del = changes.reduce((t, c) => t + c.del, 0);
  const files = changes.reduce((t, c) => t + c.files, 0);
  return el("li", { class: "exp-item" },
    el("img", { class: "exp-icon", src: job.icon, alt: "", width: 44, height: 44, decoding: "async" }),
    el("div", { class: "exp-main" },
      el("div", { class: "exp-top" },
        el("span", { class: "exp-name" }, job.name),
        job.role && el("span", { class: "exp-role" }, job.role)),
      job.line && el("p", { class: "exp-line" }, job.line),
      changes.length && el("details", { class: "exp-code" },
        el("summary", { class: "exp-sum" },
          el("span", { class: "exp-add" }, `+${n(add)}`),
          el("span", { class: "exp-del" }, `\u2212${n(del)}`),
          el("span", { class: "exp-meta" }, `${n(files)} files \u00b7 ${changes.length} changes`),
          el("span", { class: "exp-hint" }, "lines of code")),
        el("ul", { class: "exp-changes" }, changes.map((c) =>
          el("li", null,
            el("span", { class: "exp-id" }, c.id),
            el("span", { class: "exp-text" }, c.text),
            el("span", { class: "exp-stat" }, `+${n(c.add)} / \u2212${n(c.del)} \u00b7 ${c.files} file${c.files === 1 ? "" : "s"}`)))))));
}));

const presence = document.getElementById("presence");
presence.href = config.links[0].url;
presence.setAttribute("aria-label", `${config.name} on ${config.links[0].name}`);
document.getElementById("presenceName").textContent = config.name;
document.getElementById("presenceSub").textContent = `${config.handle} · ${config.links[0].name}`;

const skills = document.getElementById("skills");
skills.hidden = !config.skills.length;
skills.append(...config.skills.map((skill) =>
  el("span", { class: "skill" }, skill.icon && icon(skill.icon), skill.text)));

/* ---------- projects ---------- */

document.getElementById("projectsTitle").textContent = config.projects.title;
const projectList = document.getElementById("projectList");

config.projects.items.slice(0, config.projects.featured).forEach((item) => {
  const detailsId = `details-${item.id}`;
  projectList.append(el("article", { class: "project" },
    el("button", { class: "project-toggle", type: "button", "aria-expanded": "false", "aria-controls": detailsId },
      picture(item.image, item.imageWebp, { class: "project-photo", alt: "", loading: "lazy", style: item.imageFocus && `object-position: ${item.imageFocus}` }),
      el("span", { class: "project-summary" },
        chips(item),
        el("span", { class: "project-copy" },
          el("span", { class: "project-title" }, item.title),
          el("span", { class: "project-line" }, item.line)))),
    el("div", { class: "project-details", id: detailsId },
      el("div", { class: "project-details-inner" },
        el("p", null, item.body),
        projectLinks(item)))));
});

const projects = [...document.querySelectorAll(".project")];

function setProjectOpen(project, open) {
  project.classList.toggle("is-open", open);
  project.querySelector(".project-toggle").setAttribute("aria-expanded", String(open));
}

projects.forEach((project) => {
  project.querySelector(".project-toggle").addEventListener("click", () => {
    const willOpen = !project.classList.contains("is-open");
    projects.forEach((other) => setProjectOpen(other, false));
    if (willOpen) setProjectOpen(project, true);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  projects.forEach((project) => setProjectOpen(project, false));
});

/* ---------- section dots and scroll hint ---------- */

const sections = [...document.querySelectorAll(".screen")];
const dots = [...document.querySelectorAll(".dot")];
const hint = document.getElementById("scrollHint");

function setActive(id) {
  dots.forEach((dot) => dot.classList.toggle("active", dot.dataset.dot === id));
  hint.classList.toggle("hidden", id !== "home");
}

// Number keys 1, 2 and 3 jump to the sections the dots link to.
document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const section = sections[Number(event.key) - 1];
  if (!section) return;
  event.preventDefault();
  section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
});

const observer = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (visible) setActive(visible.target.id);
}, { threshold: [0.55, 0.75] });

sections.forEach((section) => observer.observe(section));

/* ---------- rolling clock (the visitor's local time) ---------- */

const wallClock = document.getElementById("wallClock");
const hoursBox = wallClock.querySelector(".hours");
const minutesBox = wallClock.querySelector(".minutes");
const secondsBox = wallClock.querySelector(".seconds");
let lastStamp = new Date(0);
lastStamp.setHours(-1);

function rollDigit(element, number) {
  if (reducedMotion) {
    element.lastElementChild.textContent = number;
    return;
  }
  const next = element.lastElementChild.cloneNode(true);
  next.textContent = number;
  element.appendChild(next);
  element.classList.add("move");
  window.setTimeout(() => element.classList.remove("move"), 590);
  window.setTimeout(() => element.removeChild(element.firstElementChild), 590);
}

function rollPair(container, value) {
  const digits = value.padStart(2, "0").split("");
  const [tens, ones] = container.children;
  if (tens.lastElementChild.textContent !== digits[0]) rollDigit(tens, digits[0]);
  if (ones.lastElementChild.textContent !== digits[1]) rollDigit(ones, digits[1]);
}

function renderClock() {
  const now = new Date();
  if (lastStamp.getHours() !== now.getHours()) rollPair(hoursBox, String(now.getHours()));
  if (lastStamp.getMinutes() !== now.getMinutes()) rollPair(minutesBox, String(now.getMinutes()));
  if (lastStamp.getSeconds() !== now.getSeconds()) rollPair(secondsBox, String(now.getSeconds()));
  lastStamp = now;

  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const date = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value || "Local";
  const label = `${date} · ${zone}`;
  document.getElementById("when").textContent = label;
  wallClock.setAttribute("aria-label", `Your local time: ${h}:${m}:${s}, ${label}`);
}

renderClock();
setInterval(renderClock, 100);

/* ---------- damascus background (WebGL) ---------- */

const damascusCanvas = document.getElementById("damascus");
const gl = damascusCanvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "low-power"
});

if (!gl) {
  document.documentElement.classList.add("no-gl");
} else {
  const vertSrc = `
    attribute vec2 a;
    void main() { gl_Position = vec4(a, 0.0, 1.0); }
  `;
  const fragSrc = `
    precision mediump float;
    uniform vec2 uRes;
    uniform float uDpr;
    uniform float uScroll;
    uniform float uVh;
    uniform float uTime;

    vec3 ramp(float t) {
      vec3 c0 = vec3(0.02745);
      vec3 c1 = vec3(0.13333);
      vec3 c2 = vec3(0.22745);
      vec3 c3 = vec3(0.38039);
      if (t < 0.42) return mix(c0, c1, t / 0.42);
      if (t < 0.72) return mix(c1, c2, (t - 0.42) / 0.30);
      return mix(c2, c3, clamp((t - 0.72) / 0.28, 0.0, 1.0));
    }

    vec3 ground(float y) {
      if (y < uVh) return vec3(0.02745);
      return ramp(clamp((y - uVh) / (uVh * 2.0), 0.0, 1.0));
    }

    mat2 rot(float a) {
      float c = cos(a);
      float s = sin(a);
      return mat2(c, -s, s, c);
    }

    float damascus(vec2 p, float t) {
      float fold = 0.0;
      p *= 1.15;
      for (int i = 0; i < 5; i++) {
        p = rot(0.55 + t * 0.04) * p;
        p += vec2(
          sin(p.y * 1.65 + t + float(i) * 0.7),
          cos(p.x * 1.25 - t * 0.85)
        ) * 0.48;
        fold += sin(p.x * 2.2 + float(i) * 1.3);
        p *= 1.32;
      }
      return fold;
    }

    void main() {
      float x = gl_FragCoord.x / uDpr;
      float y = (uRes.y - gl_FragCoord.y) / uDpr + uScroll;
      float fold = damascus(vec2(x, y) * 0.0054, uTime);
      float wave = sin(fold * 1.55);
      float grain = cos(fold * 3.1 + uTime);
      vec3 color = ground(y + wave * 12.0 + grain * 3.0);
      float line = smoothstep(0.55, 0.98, wave);
      color += line * 0.012 + wave * 0.004 + grain * 0.002;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vert = compile(gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl.FRAGMENT_SHADER, fragSrc);
  const program = vert && frag ? gl.createProgram() : null;
  if (program) {
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
  }

  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    document.documentElement.classList.add("no-gl");
    damascusCanvas.remove();
  } else {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uDpr = gl.getUniformLocation(program, "uDpr");
    const uScroll = gl.getUniformLocation(program, "uScroll");
    const uVh = gl.getUniformLocation(program, "uVh");
    const uTime = gl.getUniformLocation(program, "uTime");
    const band = document.createElement("div");
    band.style.cssText = "position:absolute;width:0;height:100svh;pointer-events:none;visibility:hidden";
    document.body.appendChild(band);

    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(damascusCanvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(damascusCanvas.clientHeight * dpr));
      if (damascusCanvas.width !== w || damascusCanvas.height !== h) {
        damascusCanvas.width = w;
        damascusCanvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    function frame(now) {
      resize();
      const vh = band.getBoundingClientRect().height || window.innerHeight;
      gl.uniform2f(uRes, damascusCanvas.width, damascusCanvas.height);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1f(uScroll, window.scrollY || document.documentElement.scrollTop || 0);
      gl.uniform1f(uVh, vh);
      gl.uniform1f(uTime, reducedMotion ? 0 : now * 0.00009);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reducedMotion) requestAnimationFrame(frame);
    }

    window.addEventListener("resize", resize);
    if (reducedMotion) {
      // Still background: draw once, then only when scrolling or resizing changes it.
      let queued = false;
      const redraw = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame((now) => { queued = false; frame(now); });
      };
      window.addEventListener("scroll", redraw, { passive: true });
      window.addEventListener("resize", redraw);
    }
    requestAnimationFrame(frame);
  }
}
