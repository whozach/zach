/* zach: everything on the page comes from here.
   Paths are root-relative so /projects/ can share them. */
window.BOO_CONFIG = {
  // Name on the profile screen and in the browser tab.
  name: "zach",
  handle: "@whozach",

  avatar: { src: "/assets/pfp.webp", alt: "zach" },

  // About card.
  bio: "trust in the process. dw about me.",

  // Pills under the about cards: text, plus an optional icon (github or globe).
  // Leave the list empty to hide the row.
  skills: [],

  // Glowing icons on the profile screen. icon: github, globe or x.
  // The first link is also where the about card's profile chip points.
  links: [
    { icon: "github", name: "GitHub", url: "https://github.com/whozach" }
  ],

  // Projects, newest first. id is the link anchor on /projects/ (#id), so keep it
  // stable once published. The home screen shows the first `featured` of them.
  projects: {
    title: "projects i work on",
    featured: 2,
    items: [
      {
        id: "zach",
        title: "haunted.ong",
        image: "/assets/projects/zach.jpg",
        imageAlt: "haunted.ong profile screen",
        chips: ["HTML", "CSS", "JavaScript"],
        line: "The site you're on right now.",
        body: "My biolink page, built with HTML, CSS and JS. No framework.",
        links: [
          { label: "Live site", url: "https://haunted.ong" },
          { label: "Source", url: "https://github.com/whozach/zach" }
        ]
      }
    ]
  }
};
