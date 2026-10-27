# Chat Reef

A living coral reef, grown by Twitch chat. Every chatter becomes a fish, jellyfish, seahorse, crab, or turtle. Conversations grow the reef; emotes send bubbles through the water. Subscriptions open a pearl clam, gifts bring a rain of fish, and raids arrive as a passing school.

Static HTML, Canvas 2D, CSS, and vanilla JavaScript. No backend, install, build step, accounts, API keys, external images, fonts, or third-party libraries.

## Open your ocean

Open `index.html` in Chrome. The opening screen lets you enter a Twitch channel or explore the offline demo. You can also append the query directly to the file URL in Chrome's address bar:

```text
file:///path/to/chat-reef/index.html?demo=1
file:///path/to/chat-reef/index.html?channel=yourchannel
```

For a hosted version, upload this folder to any static host and use:

```text
https://your-host.example/chat-reef/?channel=yourchannel
```

The demo uses simulated chat and works completely offline. It starts with 22 creatures and introduces more chatters, subscriptions, gifts, and raids over time. Demo records are kept separate from live channel records. No Twitch connection is made in demo mode.

## Use in OBS Studio

1. Host the files on a static website, or serve this folder locally with a static server you already have available. For example, if Python is installed, run `python -m http.server 8080 --bind 127.0.0.1` in this folder.
2. Add a **Browser Source** to your scene.
3. Set its URL to `http://127.0.0.1:8080/index.html?channel=yourchannel` or the hosted URL. Set **Width: 1920** and **Height: 1080**, with **60 FPS** if available.
4. For a transparent overlay, append `&transparent=1`. The ocean backdrop disappears; creatures, coral, particles, and the small HUD remain. Place the source above your video.
5. Use `&anon=1` to hide chatter names, including subscription announcements. The anonymous welcome-back sparkle still appears.

Keep the source active to maintain its chat connection. OBS and Chrome have separate browser storage, so their reefs develop independently. To preserve the connection while changing scenes, leave OBS's “Shutdown source when not visible” option unchecked. For a completely offline OBS preview, use `?demo=1&transparent=1`.

The OBS **Local file** picker does not offer a convenient query field; a local static-server URL or hosted URL is the simplest way to set parameters. Direct file opening in Chrome needs no server.

## Query parameters

| Parameter | Value / default | Effect |
| --- | --- | --- |
| `channel` | Twitch login, no `#`; unset by default | Channel to listen to. Letters, numbers, underscores; up to 25 characters. An unset or invalid channel shows the setup screen. |
| `demo` | `1`; off by default | Offline simulated chat. Takes precedence over live chat. |
| `anon` | `1`; off by default | Hides all chatter usernames in labels and event notices. |
| `transparent` | `1`; off by default | Removes the ocean gradient, light rays, and seabed fill for compositing in OBS. |

Example: `?channel=yourchannel&anon=1&transparent=1`.

## How the reef works

- A deterministic hash of the user ID chooses one of five species. A chatter's Twitch color becomes their creature's color; absent colors receive a deterministic pastel fallback.
- Every message grows the creature a little, with a size cap of 2.2. Labels appear for four seconds and fade. Neighbors gently separate, align, and drift together. Crabs stay near the seabed.
- Twitch-tagged emote occurrences create bubbles. Five or more emotes in one message trigger a coral bloom. Plain text and unsupported third-party emote words do not count as Twitch emotes.
- Sub/resub notices open a glowing pearl clam for ten seconds and shimmer the subscriber for twelve seconds. Gift notices create a bounded rain of fish. Raids create one transient fish per viewer, capped at 150 per raid.
- A rolling 60-second message count powers the chat pulse meter, water light, and persistent coral growth. After 60 seconds without chat activity, the reef dims and a sleepy anglerfish asks “say hi to wake the reef.” The next chat event wakes it.
- Local storage remembers up to 2,000 creature records per channel: user ID, species, size, color, first-seen timestamp, and message count. Returning chatters reappear when they speak and receive a welcome-back sparkle. Dormant records are evicted first at the storage cap. Reef age is elapsed wall-clock time since that channel's reef was first created, including time offline.
- Up to 120 chatter creatures are rendered at once. At capacity, the least recently active creature becomes dormant, retaining its saved progress. Transient fish are separately capped at 220, and particles at 420. Coral artwork is pre-rendered locally, and motion uses frame delta time with `requestAnimationFrame`, targeting 60 FPS; actual speed depends on the browser and hardware.
- `CLEARCHAT` immediately removes a targeted chatter and their saved record, including timeout notices. A channel-wide clear empties chatter records and transient effects. A future message can create a fresh creature.

Progress saves every five seconds and when the page becomes hidden or leaves. If local storage is unavailable or full, the overlay continues in memory and displays a brief notice. To reset a reef, clear this site's local storage in your browser's developer tools. Keys start with `chat-reef:v1:`. Direct `file:` URL storage behavior varies by browser; a stable hosted or local-server URL is best for long-term persistence.

## Twitch connection and privacy

`twitch.js` reads public Twitch IRC over `wss://irc-ws.chat.twitch.tv:443` with an anonymous `justinfan` nickname, requests IRCv3 tags and commands, responds to PING, and reconnects with exponential backoff and jitter (about 1–61 seconds). The fixed anonymous IRC handshake value is a public protocol convention, not a private credential. No channel authorization or login is requested.

No chat text, usernames, badges, or emote contents are persisted. The application sends no messages to chat and has no analytics. In live mode your browser makes a direct connection to Twitch, which can observe the normal connection metadata and channel joined. A static host may keep ordinary access logs. `anon=1` changes visible labels; user IDs still identify creatures in local storage. Twitch moderation notices can only be applied while the source is connected; bans occurring while offline cannot be replayed from history. Anonymous IRC availability is controlled by Twitch; if network access is interrupted, the connection status shows retries and the offline demo remains available.

## Files and tests

```text
index.html          Entry point and accessible HUD
style.css           Overlay, setup screen, and transparent mode
reef.js             Persistence, simulation, vector artwork, and rendering
twitch.js           IRC parser and reconnecting anonymous WebSocket client
demo.js             Offline event generator
test/parse.test.js  Dependency-free parser and transport checks
LICENSE             MIT
```

Run with Node.js 18 or newer:

```sh
node test/parse.test.js
```

Tests cover IRCv3 escaping, message tags, badges, emote ranges, sub/resub/gift/raid notices, moderation, malformed input, channel validation, fragmented WebSocket frames, handshake, and PONG. For a visual check, open `index.html?demo=1` in Chrome; check `?demo=1&anon=1&transparent=1` for the anonymous OBS view. After a minute the demo has shown subscriptions, gifts, and a raid. A live channel needs an internet connection and public chat activity.

## Built with Codex

Chat Reef was implemented with OpenAI Codex from the included `SPEC.md`: the IRC parser, simulation, hand-drawn-feel vector creatures, procedural coral, UI, offline event generator, and Node tests were written as ordinary source files. No generated raster assets or runtime AI services are used. The local parser tests provide a repeatable check without connecting to Twitch.

MIT licensed. See `LICENSE`.
