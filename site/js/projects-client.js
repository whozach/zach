/* Crypto Client project entry only: screenshot previews and the feature list.
   Runs after app.js (home) or projects.js (/projects/). Each category is a
   <details>/<summary>, so opening one needs no JS; this file only builds the markup. */
(() => {
  const item = config.projects.items.find((entry) => entry.id === "cryptoclient");
  if (!item || !item.features) return;

  const STATUS = { in: "In the client", soon: "Coming soon" };

  function previews() {
    const shots = item.screenshots || [];
    if (!shots.length) return null;
    return el("div", { class: "cc-shots" }, shots.map((shot, i) => shot.src
      ? el("figure", { class: "cc-shot" },
          el("img", { src: shot.src, alt: shot.alt || `${item.title} screenshot ${i + 1}`, width: 800, height: 500, loading: "lazy" }))
      : el("figure", { class: "cc-shot is-preview", role: "img", "aria-label": `Preview ${i + 1}, real screenshot coming` },
          el("span", { class: "cc-shot-frame", "aria-hidden": "true" },
            el("span", { class: "cc-shot-bar" }), el("span", { class: "cc-shot-side" }), el("span", { class: "cc-shot-main" })),
          el("figcaption", { class: "cc-shot-label" }, "Preview, real screenshot coming"))));
  }

  function featureList() {
    return el("div", { class: "cc-features" },
      el("h3", { class: "cc-features-title" }, "Features"),
      item.featuresNote ? el("p", { class: "cc-features-note" }, item.featuresNote) : null,
      item.features.map((group) => {
        const built = group.items.filter(([status]) => status === "in").length;
        const soon = group.items.length - built;
        const counts = [built && `${built} in the client`, soon && `${soon} coming soon`].filter(Boolean).join(", ");
        return el("details", { class: "cc-cat" },
          el("summary", { class: "cc-cat-summary" },
            el("span", { class: "cc-cat-name" }, group.category),
            el("span", { class: "cc-cat-count" }, counts),
            chevron()),
          el("ul", { class: "cc-cat-list" }, group.items.map(([status, name, desc]) =>
            el("li", { class: `cc-feature is-${status}` },
              el("span", { class: "cc-feature-text" },
                el("span", { class: "cc-feature-name" }, name),
                desc ? el("span", { class: "cc-feature-desc" }, desc) : null),
              el("span", { class: "cc-status" }, STATUS[status] || STATUS.soon)))));
      }));
  }

  function chevron() {
    const wrap = document.createElement("span");
    wrap.innerHTML = '<svg class="cc-cat-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>';
    return wrap.firstChild;
  }

  function build() {
    return el("div", { class: "cc-extra" }, previews(), featureList());
  }

  // home: the card's details, after the description
  const home = document.querySelector("#details-cryptoclient .project-details-inner");
  if (home) home.querySelector("p").after(build());

  // /projects/#cryptoclient
  const post = document.querySelector('[data-post="cryptoclient"] .post-copy');
  if (post) post.append(build());
})();
