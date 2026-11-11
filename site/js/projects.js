/* /projects/: every project as a list, and one at a time at /projects/#id. */
const list = document.getElementById("blog-list");
const items = config.projects.items;
const listTitle = `projects — ${config.name}`;

document.getElementById("posts").append(...items.map((item, index) =>
  el("article", { class: "blog-post" },
    // the first post is above the fold; the rest load as they scroll in
    picture(item.image, item.imageWebp, { class: "blog-post-photo", alt: item.imageAlt, loading: index ? "lazy" : null }),
    el("div", { class: "blog-post-body" },
      el("h2", { class: "blog-post-title" }, el("a", { href: `#${item.id}` }, item.title)),
      el("div", { class: "blog-post-copy" }, el("p", null, item.line), el("p", null, item.body)),
      projectLinks(item, "blog-post-links")))));

const posts = items.map((item) =>
  el("section", { class: "post is-hidden", "data-post": item.id },
    el("div", { class: "post-inner" },
      el("div", { class: "post-media" },
        picture(item.image, item.imageWebp, { class: "post-photo", alt: item.imageAlt }),
        projectLinks(item, "post-bar")),
      el("div", { class: "post-body" },
        el("div", { class: "post-heading-row" },
          el("a", { class: "blog-back", href: "/projects/", "aria-label": "Back" }, icon("back")),
          el("h1", { class: "post-title" }, item.title)),
        el("div", { class: "post-copy" }, el("p", null, item.line), el("p", null, item.body))))));

document.getElementById("postViews").append(...posts);

function syncProjectsView() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  const item = items.find((entry) => entry.id === id);
  list.classList.toggle("is-hidden", Boolean(item));
  posts.forEach((post) => {
    post.classList.toggle("is-hidden", !item || post.dataset.post !== id);
  });
  document.title = item ? `${item.title} — projects` : listTitle;
  if (item) window.scrollTo(0, 0);
}

window.addEventListener("hashchange", syncProjectsView);
syncProjectsView();
