/* zach: everything on the page comes from here.
   Paths are root-relative so /projects/ can share them. */
window.BOO_CONFIG = {
  // Name on the profile screen and in the browser tab.
  name: "zach",
  handle: "@whozach",

  avatar: { src: "/assets/pfp.webp", alt: "zach" },

  // About card.
  bio: "trust in the process. dw about me.",

  // One static line under the bio, like "currently building ...". Leave "" to hide it.
  now: "",

  // Pills under the about cards: text, plus an optional icon (github or globe).
  // Leave the list empty to hide the row.
  skills: [],

  // Glowing icons on the profile screen. icon: github, discord, globe or x.
  // The first link is also where the about card's profile chip points.
  // A link with `copy` instead of `url` copies that text on click and shows
  // `label` on hover (Discord usernames have no profile URL).
  links: [
    { icon: "github", name: "GitHub", url: "https://github.com/whozach" },
    { icon: "discord", name: "Discord", label: "@1cwo", copy: "1cwo" }
  ],

  // Projects, in the order shown. id is the link anchor on /projects/ (#id), so keep it
  // stable once published. The home screen shows the first `featured` of them.
  projects: {
    title: "projects i work on",
    featured: 2,
    items: [
      {
        id: "isntrip",
        title: "isnt.rip",
        image: "/assets/projects/isntrip.jpg",
        imageAlt: "isnt.rip landing page",
        // Which part of the photo the short home-screen card shows.
        imageFocus: "center 28%",
        chips: ["Bio pages", "Short links"],
        line: "Claim a short link, build your page.",
        body: "A bio page host: claim a short isnt.rip handle and build a page with video backgrounds, music, effects, badges, custom layouts and honest view counts.",
        links: [
          { label: "Live site", url: "https://isnt.rip" }
        ]
      },
      {
        // Not out yet, so no links.
        id: "vrcam",
        title: "VRCAM",
        image: "/assets/projects/vrcam.jpg",
        imageAlt: "VRCAM, in the works",
        chips: ["In the works"],
        line: "Still being built.",
        body: "VRCAM isn't out yet. More here when it's ready."
      },
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
      },
      {
        id: "octo",
        title: "Octo",
        image: "/assets/projects/octo.jpg",
        imageAlt: "Octo voice assistant",
        chips: ["In the works", "Voice assistant", "NixOS"],
        line: "An always-on voice assistant for my Linux PC.",
        body: "Octo is a voice assistant that runs all the time on my NixOS and Hyprland setup."
      },
      {
        id: "cryptoclient",
        title: "Crypto Client",
        image: "/assets/projects/cryptoclient.jpg",
        imageAlt: "Crypto Client for VRChat",
        chips: ["In the works", "VRChat", "Linux"],
        line: "A desktop VRChat client for Linux.",
        body: "A VRChat desktop client built for Linux, running through Steam and Proton."
      },
      {
        id: "ls5",
        title: "Linux Station 5",
        image: "/assets/projects/ls5.jpg",
        imageAlt: "Linux Station 5 launcher",
        chips: ["In the works", "Godot", "Linux"],
        line: "A controller-first game launcher for Linux.",
        body: "A fullscreen game launcher built in Godot, made to be driven with a controller."
      }
    ]
  }
};
