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

  // The showcase card under the name on the profile screen: the id of one project below.
  // It shows that project's chips, title and line, and links to it on /projects/.
  // Leave "" to hide it. (Off: the Experience card in About took its place.)
  showcase: "",

  // Experience card in About. One entry per project worked on. The +/- and file totals are added up
  // from `changes`; clicking the totals line opens the list of changes, word for word.
  experience: [
    {
      name: "OpenBot",
      icon: "/assets/experience/openbot.svg",
      role: "Contributor",
      line: "A desktop app for working with a team of AI agents. I built parts of its Dynamic Island and agent dock for Linux and Hyprland.",
      changes: [
        { id: "#7968", add: 1086, del: 4, files: 8, text: "Show the Dynamic Island and the agent dock as Wayland layers on Hyprland. The main one: they sit above everything, on every workspace, with no snow." },
        { id: "#7969", add: 88, del: 6, files: 27, text: "Add Always animate for the Dynamic Island and the agent dock (most files are translations). A new setting, off by default." },
        { id: "#7970", add: 447, del: 36, files: 23, text: "Show channel work and replies on the Dynamic Island." },
        { id: "#7971", add: 235, del: 152, files: 18, text: "Show the app and the status at the top of the open island without a notch." },
        { id: "#7972", add: 12, del: 0, files: 4, text: "Give the desktop agent dock the notch colour of the Dynamic Island." },
        { id: "#7973", add: 26, del: 2, files: 3, text: "Keep the agent dock's chat link inside the dock band." }
      ]
    }
  ],


  // Projects, in the order shown. id is the link anchor on /projects/ (#id), so keep it
  // stable once published. The home screen shows the first `featured` of them.
  projects: {
    title: "projects i work on",
    featured: 2,
    items: [
      {
        id: "cryptoclient",
        title: "Crypto Client",
        // imageWebp (optional): served first, with image as the fallback for browsers without webp.
        image: "/assets/projects/crypto-client-movement.png",
        imageWebp: "/assets/projects/crypto-client-movement.webp",
        imageAlt: "Crypto Client 0.53.1 menu, Movement page with flight and speed settings",
        // Which part of the photo the short cards show (the window's title bar and menu).
        imageFocus: "center 16%",
        chips: ["In the works", "VRChat", "Linux"],
        line: "A desktop VRChat client for Linux.",
        body: "Crypto Client is my VRChat desktop client for Linux. It runs on NixOS, with VRChat going through Steam and Proton. It needs a license key, bought and managed here on haunted.ong.",
        // Buy button, at the bottom of the entry. enabled: false shows a disabled "Buy · Coming soon" with no link.
        // Set enabled: true to make it a normal link to url, labelled with label. Nothing else to change.
        // disclaimer: the small grey line under the button (shown either way; "" hides it).
        buy: { enabled: true, url: "/client/buy/", label: "Buy a key",
               disclaimer: "haunted.ong is not responsible for how Crypto Client is used or by whom." },
        // Crypto Client only (rendered by /js/projects-client.js). Each is a 1600x900 image in
        // /assets/projects/: src is the png fallback, webp is served first, alt describes it.
        // { src: "", alt: "" } shows an empty "real screenshot coming" frame instead.
        screenshots: [
          { src: "/assets/projects/crypto-client-movement.png", webp: "/assets/projects/crypto-client-movement.webp",
            alt: "Crypto Client 0.53.1 menu, Movement page: flight, flight speed, fly where you look and speed" },
          { src: "/assets/projects/crypto-client-visuals-esp.png", webp: "/assets/projects/crypto-client-visuals-esp.webp",
            alt: "Crypto Client 0.53.1 menu, Visuals page: ESP, nameplates, speaking glow, render distance and boxes" },
          { src: "/assets/projects/crypto-client-hotkeys.png", webp: "/assets/projects/crypto-client-hotkeys.webp",
            alt: "Crypto Client 0.53.1 menu, Settings page with rebindable hotkeys for panic, spectate, zoom, fly and ESP" }
        ],
        // Feature list (0.53.1 menu, src/menu.cpp). One line per feature: status "in" = In the client (built in 0.53.1), "soon" = Coming soon.
        // To revert a feature that fails testing, change only its status on its own line, e.g.
        //   { status: "in", name: "Freecam", ... }  ->  { status: "soon", name: "Freecam", ... }
        // The counts on the page are worked out from these lines; nothing else needs editing.
        featuresNote: "In the client: built into the current version. Coming soon: planned, not built yet.",
        features: [
          { category: "Movement", items: [
            { status: "in", name: "Flight", desc: "WASD to move, Space and Ctrl for up and down, Shift to boost" },
            { status: "in", name: "Flight speed", desc: "Slider from 1 to 20 m/s" },
            { status: "in", name: "Fly where you look", desc: "W follows where the camera points instead of staying level" },
            { status: "in", name: "Hover lock", desc: "Hold your altitude when no keys are pressed" },
            { status: "in", name: "Noclip flight", desc: "Pass through walls while flying" },
            { status: "in", name: "Speed", desc: "Walk, run and strafe speed from 0.5 to 5x" },
            { status: "in", name: "Separate walk, run and strafe", desc: "A multiplier for each" },
            { status: "in", name: "Jump height", desc: "From 0.5 to 5x" },
            { status: "in", name: "Infinite jump", desc: "Jump again in midair" },
            { status: "in", name: "Bunny-hop assist", desc: "Keep your speed when you jump again on landing" },
            { status: "in", name: "Gravity and moon gravity", desc: "Your own gravity from 0 to 2x, or one-click moon gravity" },
            { status: "in", name: "Auto-walk", desc: "Walk forward hands-free; WASD still steers" },
            { status: "in", name: "Safe landing", desc: "Cancels your fall speed just before you land" },
            { status: "in", name: "Saved spot", desc: "Save a spot and teleport yourself back to it" },
            { status: "in", name: "Waypoints", desc: "Save several spots and go back to the last one" },
            { status: "in", name: "Click-to-teleport", desc: "Teleport yourself to the point under the crosshair" },
            { status: "in", name: "Respawn", desc: "Back to the world spawn, from the menu or a key" },
            { status: "in", name: "Teleport to spawn", desc: "Moves only you to the world's first spawn point" },
            { status: "in", name: "Movement presets", desc: "Save and load flight, speed, jump and gravity" }
          ]},
          { category: "Visuals", items: [
            { status: "in", name: "ESP", desc: "One switch for all the player visuals below" },
            { status: "in", name: "Nameplates", desc: "Name, distance and device for each player" },
            { status: "in", name: "Nameplate anchoring and draw order", desc: "Pinned to the head, drawn far to near" },
            { status: "in", name: "Friend highlight", desc: "Friends stand out on their nameplate" },
            { status: "in", name: "Speaking glow", desc: "Nameplates light up while someone talks" },
            { status: "in", name: "Render distance", desc: "From 10 to 250 m" },
            { status: "in", name: "Boxes", desc: "" },
            { status: "in", name: "Cylinder outlines", desc: "Used instead of boxes when both are on" },
            { status: "in", name: "Skeletons", desc: "" },
            { status: "in", name: "Tracers", desc: "" },
            { status: "in", name: "ESP workload guard", desc: "Limits ESP to 6 ms of work per frame" }
          ]},
          { category: "Camera and view", items: [
            { status: "in", name: "Third person and selfie view", desc: "See yourself from behind or in front, with distance, height and shoulder sliders" },
            { status: "in", name: "Freecam", desc: "Fly the camera while your avatar stays put, with speed and smoothing" },
            { status: "in", name: "Spectate view", desc: "Shoulder, first person or orbit, on the player you're watching" },
            { status: "in", name: "Spectate hotkeys", desc: "Page Up and Page Down switch who you're watching" },
            { status: "in", name: "Print orbit", desc: "Your own photo prints that nobody holds circle you, with radius and speed. Others see them move" },
            { status: "in", name: "Custom field of view", desc: "From 40 to 110 degrees" },
            { status: "in", name: "Zoom key", desc: "Hold a key to zoom in" },
            { status: "in", name: "Near clip", desc: "So close geometry doesn't vanish" },
            { status: "in", name: "Far clip", desc: "Draw distance from 20 to 1000 m" },
            { status: "in", name: "Horizon lock", desc: "Keeps the horizon level" },
            { status: "in", name: "Cinematic smoothing", desc: "Softer camera motion for recording" },
            { status: "in", name: "Camera presets", desc: "Save and restore view, distance and FOV" }
          ]},
          { category: "HUD and info", items: [
            { status: "in", name: "Status panel", desc: "Players, ESP rate, FPS and license state" },
            { status: "in", name: "Custom HUD", desc: "Pick what shows: FPS, position, speed, clock, active features, compass and crosshair" },
            { status: "in", name: "Frame-time graph", desc: "The last 120 frames" },
            { status: "in", name: "Eye height", desc: "Your avatar's eye height in meters" },
            { status: "in", name: "Memory readout", desc: "" },
            { status: "in", name: "Keybind overlay", desc: "Hold a key to see every hotkey" },
            { status: "in", name: "Friend join alerts", desc: "A notice when a friend joins your instance" },
            { status: "in", name: "World name", desc: "World title and author" },
            { status: "in", name: "Player count and capacity", desc: "Players here against the world's capacity" },
            { status: "in", name: "Trust rank", desc: "As VRChat shows it, on nameplates and the player list" },
            { status: "in", name: "Status text", desc: "Their public status line" },
            { status: "in", name: "Pronouns", desc: "When VRChat shows them" },
            { status: "in", name: "Mic indicator", desc: "Shows when your mic is open or muted" },
            { status: "in", name: "Push-to-talk badge", desc: "Shows while your talk key is held" },
            { status: "in", name: "Clean view", desc: "One key hides the HUD and overlays; your settings stay" },
            { status: "soon", name: "Ping", desc: "Your own round-trip time" }
          ]},
          { category: "World", items: [
            { status: "in", name: "Disable fog", desc: "" },
            { status: "in", name: "Fullbright", desc: "Raise the ambient light for you" },
            { status: "in", name: "Time-of-day tint", desc: "Noon, sunset or night lighting, for you only" },
            { status: "in", name: "Hide mirrors", desc: "For you only" },
            { status: "in", name: "Mirror quality", desc: "Low, medium or high" },
            { status: "in", name: "Hide pickups", desc: "On your screen only" },
            { status: "in", name: "Pickup markers", desc: "Show where pickups are" },
            { status: "in", name: "Show colliders", desc: "Wireframe of nearby world colliders" },
            { status: "in", name: "Hide chairs", desc: "On your screen only" },
            { status: "in", name: "Spawn marker", desc: "Show where the world spawn is" },
            { status: "in", name: "Video volume", desc: "Lower or mute world video players for you" }
          ]},
          { category: "Avatar", items: [
            { status: "in", name: "Hide own avatar", desc: "In your own view only" },
            { status: "in", name: "Hide avatars beyond distance", desc: "Hide other avatars past a set distance, on your screen only" },
            { status: "in", name: "Own avatar stats", desc: "Your avatar's triangles, materials and bones" },
            { status: "in", name: "Scale preview camera", desc: "See yourself as if scaled; others still see your normal size" },
            { status: "in", name: "Bone overlay", desc: "Skeleton on yourself, for checking poses" },
            { status: "in", name: "Nameplate preview", desc: "See your own nameplate in third person" },
            { status: "in", name: "Pin current avatar", desc: "Keep a local list of avatars you pin; switch in VRChat's own menu" },
            { status: "in", name: "Expression parameters viewer", desc: "Read-only view of your expression parameters" },
            { status: "in", name: "Hide own shadow", desc: "" }
          ]},
          { category: "Audio", items: [
            { status: "in", name: "Per-player volume", desc: "Turn one voice up or down for you" },
            { status: "in", name: "Local mute", desc: "Mute someone for yourself" },
            { status: "in", name: "Loudness limiter", desc: "Caps how loud anyone's voice gets for you" },
            { status: "in", name: "Speaker list", desc: "Who's talking right now" },
            { status: "in", name: "World audio volume", desc: "Lower non-voice world audio" },
            { status: "in", name: "Avatar audio volume", desc: "Lower sounds coming from avatars" },
            { status: "in", name: "Voice distance falloff", desc: "Change how far voices carry, for you" },
            { status: "in", name: "Mute on focus loss", desc: "Mutes the game when VRChat isn't the focused window" }
          ]},
          { category: "Performance and graphics", items: [
            { status: "in", name: "FPS cap", desc: "" },
            { status: "in", name: "VSync", desc: "" },
            { status: "in", name: "Shadows", desc: "Off, hard or all" },
            { status: "in", name: "LOD bias", desc: "" },
            { status: "in", name: "Pixel lights", desc: "" },
            { status: "in", name: "Anti-aliasing", desc: "Off, 2x, 4x or 8x" },
            { status: "in", name: "Proton preset", desc: "One click for settings tuned for Proton" },
            { status: "in", name: "Render scale", desc: "Lower the internal resolution for speed" },
            { status: "in", name: "Limit far particles", desc: "Pause particles past a set distance" },
            { status: "in", name: "Disable post-processing", desc: "" },
            { status: "in", name: "Collect garbage", desc: "Run garbage collection on demand" }
          ]},
          { category: "Menu", items: [
            { status: "in", name: "Floating menu with search", desc: "Insert opens it; search finds any feature by name" },
            { status: "in", name: "VRChat quick-menu tab", desc: "A Crypto tab inside VRChat's own quick menu" },
            { status: "in", name: "Disable all", desc: "Turns every feature off at once" },
            { status: "in", name: "Panic key", desc: "One key turns everything off and closes the menu" },
            { status: "in", name: "Auto-saved settings", desc: "Settings are saved as you change them" },
            { status: "in", name: "Remembered menu position, scale and opacity", desc: "" },
            { status: "in", name: "Profiles", desc: "Save and load named setting profiles" },
            { status: "in", name: "Accent colors", desc: "Four preset accents" },
            { status: "in", name: "Log viewer", desc: "The last 50 log lines, in the menu" },
            { status: "in", name: "Rebindable hotkeys", desc: "Bind the menu, panic, spectate, zoom and other keys" },
            { status: "in", name: "License panel", desc: "Activate a key, see your plan and expiry, with a warning 3 days before" }
          ]},
          { category: "Players", items: [
            { status: "in", name: "Player list", desc: "Everyone in the instance, with distance" },
            { status: "in", name: "Sort players", desc: "By name or distance" },
            { status: "in", name: "Watch player", desc: "A camera on someone else, on your screen only" },
            { status: "in", name: "Go to player", desc: "Moves only you, to just in front of them" },
            { status: "in", name: "Private player notes", desc: "Your own notes, kept on your PC" },
            { status: "in", name: "Friends here", desc: "Your friends in this instance" },
            { status: "in", name: "Join log", desc: "Who joined or left, with times" },
            { status: "in", name: "Hide a player for yourself", desc: "On your screen only, and reversible" }
          ]}
        ]
      },
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
