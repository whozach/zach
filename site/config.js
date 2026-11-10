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
  // Leave "" to hide it.
  showcase: "cryptoclient",

  // Projects, in the order shown. id is the link anchor on /projects/ (#id), so keep it
  // stable once published. The home screen shows the first `featured` of them.
  projects: {
    title: "projects i work on",
    featured: 2,
    items: [
      {
        id: "cryptoclient",
        title: "Crypto Client",
        image: "/assets/projects/cryptoclient.jpg",
        imageAlt: "Crypto Client for VRChat",
        chips: ["In the works", "VRChat", "Linux"],
        line: "A desktop VRChat client for Linux.",
        body: "Crypto Client is my VRChat desktop client for Linux. It runs on NixOS, with VRChat going through Steam and Proton. It needs a license key, bought and managed here on haunted.ong.",
        // Buy button, at the bottom of the entry. enabled: false shows a disabled "Buy · Coming soon" with no link.
        // Set enabled: true to make it a normal link to url, labelled with label. Nothing else to change.
        // disclaimer: the small grey line under the button (shown either way; "" hides it).
        buy: { enabled: false, url: "/client/buy/", label: "Buy a key",
               disclaimer: "haunted.ong is not responsible for how Crypto Client is used or by whom." },
        // Crypto Client only (rendered by /js/projects-client.js). To swap a preview for a real
        // screenshot, set its src to an 800x500 greyscale image in /assets/projects/ and give it an alt.
        screenshots: [
          { src: "", alt: "" },
          { src: "", alt: "" },
          { src: "", alt: "" }
        ],
        // "in" = in the client now (0.46). "soon" = coming soon, not built yet.
        featuresNote: "In the client: built into the current version. Coming soon: planned, not built yet.",
        features: [
          { category: "Movement", items: [
            ["in", "Flight", "WASD to move, Space and Ctrl for up and down, Shift to boost"],
            ["in", "Flight speed", "Slider from 1 to 20 m/s"],
            ["in", "Speed modifier", "Walk, run and strafe speed from 0.5 to 5x"],
            ["in", "Jump modifier", "Jump height from 0.5 to 5x"],
            ["in", "Infinite jump", "Jump again in midair"],
            ["soon", "Teleport to a player", "Moves only you, to just in front of them"],
            ["soon", "Noclip flight", "Flight that also passes through walls"],
            ["soon", "Camera-relative flight", "Fly in the direction you're looking"],
            ["soon", "Hover lock", "Hold your altitude when no keys are pressed"],
            ["soon", "Bunny-hop assist", "Keep momentum when you jump again on landing"],
            ["soon", "Gravity slider", "Your own gravity from 0 to 2x"],
            ["soon", "Low gravity", "One-click moon gravity"],
            ["soon", "Save position", "Bookmark a spot and teleport back to it"],
            ["soon", "Waypoints", "Named waypoints for each world"],
            ["soon", "Click to teleport", "Teleport to the point under the crosshair"],
            ["soon", "Respawn key", "Go back to the world spawn"],
            ["soon", "Auto-walk", "Walk forward hands-free"],
            ["soon", "Separate walk, run and strafe sliders", ""],
            ["soon", "Soft landing", "Cancels your fall speed just before you land"],
            ["soon", "Movement presets", "Save flight, speed and jump combos"]
          ]},
          { category: "Visuals", items: [
            ["in", "ESP", "One switch for all the player visuals below"],
            ["in", "Nameplates", "Name, distance and device for each player"],
            ["in", "Head-anchored nameplates", "Pinned to the head, drawn far to near"],
            ["in", "Friend highlight", "Friends stand out on their nameplate"],
            ["in", "Speaking glow", "Nameplates light up while someone talks"],
            ["in", "Render distance", "From 10 to 250 m"],
            ["in", "Boxes", ""],
            ["in", "Cylinder outlines", "Used instead of boxes when both are on"],
            ["in", "Skeletons", ""],
            ["in", "Tracers", ""],
            ["in", "Workload guard", "Limits ESP to 6 ms of work per frame"]
          ]},
          { category: "Camera and view", items: [
            ["soon", "Spectate a player", "Over-the-shoulder camera on someone else, on your screen only"],
            ["soon", "FOV slider", "Desktop field of view from 60 to 120 degrees"],
            ["soon", "Zoom key", "Hold a key to zoom in smoothly"],
            ["soon", "Freecam", "Fly the camera while your avatar stays put"],
            ["soon", "Freecam speed and smoothing", ""],
            ["soon", "Third-person camera", "Over-the-shoulder view of yourself"],
            ["soon", "Third-person distance and side", "Sliders for distance, height and shoulder"],
            ["soon", "Selfie view", "Camera in front of your face, looking back"],
            ["soon", "Spectate: first-person", "Watch from their head position"],
            ["soon", "Spectate: orbit", "Slow orbit around the player you're watching"],
            ["soon", "Spectate next and previous keys", ""],
            ["soon", "Near-clip slider", "So close geometry doesn't vanish"],
            ["soon", "Draw distance slider", "Also helps performance"],
            ["soon", "Roll lock", "Keep the horizon level in freecam and third-person"],
            ["soon", "Cinematic smoothing", "Smoother camera for recording"],
            ["soon", "Hide your own avatar", "In your own view only"],
            ["soon", "Camera presets", "Save and restore FOV and camera settings"]
          ]},
          { category: "HUD and info", items: [
            ["in", "Status panel", "Players, ESP updates per second and frame cost"],
            ["soon", "FPS counter", "Frame rate and frame time"],
            ["soon", "Frame-time graph", "The last 120 frames"],
            ["soon", "Ping", "Your own round-trip time"],
            ["soon", "Coordinates", "Your position and heading"],
            ["soon", "Speedometer", "Your speed in m/s"],
            ["soon", "Instance clock", "Time in this instance, and local time"],
            ["soon", "Player count", "Players here against the world's capacity"],
            ["soon", "World name and author", ""],
            ["soon", "Compass bar", ""],
            ["soon", "Crosshair", "Optional dot or cross"],
            ["soon", "Active features list", "Corner list of what you have on"],
            ["soon", "Keybind overlay", "Hold a key to see every hotkey"],
            ["soon", "Memory readout", ""],
            ["soon", "Notifications", "Short notices for features turning on and off, and errors"]
          ]},
          { category: "World", items: [
            ["soon", "Mirror toggle", "Show or hide world mirrors for you only"],
            ["soon", "Mirror quality", ""],
            ["soon", "Hide pickups", "On your screen only"],
            ["soon", "Pickup markers", "Show where pickups are"],
            ["soon", "Show colliders", "Wireframe of nearby world colliders"],
            ["soon", "Hide chairs", "On your screen only"],
            ["soon", "Spawn marker", "Show where the world spawn is"],
            ["soon", "Video player volume", "Lower or mute world video players for you"],
            ["soon", "Fog toggle", ""],
            ["soon", "Fullbright", "Raise the ambient light for you"],
            ["soon", "Time-of-day tint", "Sunset or night lighting, for you only"],
            ["soon", "Join log", "Who joined or left, with times"]
          ]},
          { category: "Avatar", items: [
            ["soon", "Avatar stats", "Your avatar's polygons, materials and bones"],
            ["soon", "Height readout", "Your eye height in meters"],
            ["soon", "Scale preview", "See your avatar scaled in a local mirror"],
            ["soon", "Bone overlay", "Skeleton on yourself, for checking poses"],
            ["soon", "Nameplate preview", "See your own nameplate in third-person"],
            ["soon", "Own avatars list", "Quick list of your own and favorited avatars"],
            ["soon", "Parameter viewer", "Read-only view of your expression parameters"],
            ["soon", "Hide your own shadow", ""],
            ["soon", "Hide avatars by distance", "Hide other avatars past a set distance, on your screen only"],
            ["soon", "Hide one player's avatar", "On your screen only, and reversible"]
          ]},
          { category: "Audio", items: [
            ["soon", "Per-player volume", "Turn one voice up or down for you"],
            ["soon", "Local mute", "Mute someone for yourself"],
            ["soon", "Loudness limiter", "Caps how loud anyone's voice gets for you"],
            ["soon", "Who's talking", "List of who's speaking right now"],
            ["soon", "World audio volume", "Lower non-voice world audio"],
            ["soon", "Avatar audio volume", "Lower sounds coming from avatars"],
            ["soon", "Voice falloff", "Change how voices fade with distance for you"],
            ["soon", "Mic indicator", "Shows when your mic is open or muted"],
            ["soon", "Push-to-talk indicator", ""],
            ["soon", "Mute when unfocused", "Mutes the game when VRChat isn't the focused window"]
          ]},
          { category: "Performance and graphics", items: [
            ["soon", "FPS cap", ""],
            ["soon", "VSync toggle", ""],
            ["soon", "Shadow quality", "Off, low or high"],
            ["soon", "LOD bias", ""],
            ["soon", "Pixel-light count", ""],
            ["soon", "Anti-aliasing level", ""],
            ["soon", "Render scale", "Lower the internal resolution for speed"],
            ["soon", "Particle limiter", "Pause far-away particles"],
            ["soon", "Distance avatar culling", "Hide far avatars for performance"],
            ["soon", "Post-processing toggle", ""],
            ["soon", "Proton preset", "One click for settings tuned for Proton"],
            ["soon", "Memory cleanup", "Run garbage collection when the game hitches"]
          ]},
          { category: "Menu", items: [
            ["in", "Insert menu", "Floating menu on the Insert key, with collapsible sections"],
            ["in", "Quick menu tab", "A Crypto tab inside VRChat's own quick menu"],
            ["in", "Disable all", "Turns every feature off at once. A one-key version that also closes the menu is planned"],
            ["soon", "Search", "Filter every feature by name"],
            ["soon", "Rebindable hotkeys", "Bind any toggle to a key"],
            ["soon", "Save and load settings", ""],
            ["soon", "Profiles", "Several named setting profiles"],
            ["soon", "Accent picker", "Four preset accents"],
            ["soon", "UI scale", ""],
            ["soon", "Menu opacity", ""],
            ["soon", "Remember menu position", ""],
            ["soon", "Favorites tab", "Pin features you use most"],
            ["soon", "Log viewer", "The last 50 log lines, in the menu"],
            ["soon", "License panel", "Key status, device, expiry and deactivate"]
          ]},
          { category: "Players", items: [
            ["soon", "Player list", "Everyone in the instance with distance, sortable by name, distance, VR or desktop, and who's speaking"],
            ["soon", "Trust rank on nameplates", "As VRChat's own nameplate shows it"],
            ["soon", "Friends here", "Your friends in this instance"],
            ["soon", "Nearest players first", ""],
            ["soon", "Friend joined notice", "When a friend joins your instance"],
            ["soon", "Status on nameplates", "Their public status line"],
            ["soon", "Pronouns on nameplates", "When VRChat shows them"],
            ["soon", "Player notes", "Your own private notes, kept on your PC"]
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
