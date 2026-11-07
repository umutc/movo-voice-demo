# design/

Static reference mockups for the demo UI, exported from the design canvas. Read this file and the relevant `*.html` before touching `web/`. The canvas itself (https://claude.ai/artifact/VecJ6LFC4u6uia4TPwyjx5) is for humans; Claude Code works from these files.

These are not production code. Each page is one HTML file with inline styles and synthetic data. Use them for structure, spacing, copy, states and tokens. Do not copy the inline-style approach into `web/`; use the starter's styling system (Tailwind or CSS modules, whichever the template ships) with the tokens below.

## Pages

Parent site, BYSA (Phase 4, core):

| File | Screen | Notes |
| --- | --- | --- |
| `parent-main.html` | Pre-call form | Name, phone, email, consent. "A typical call" sample dialog. `[LIVEKIT NUMBER]` comes from env. |
| `parent-call.html` | Live call | Transcript first, level meter and mute in the card header, "Under the hood" aside: identity source, family, pipeline, proposal state, last-turn latency, tool calls. The read-back turn is highlighted. |
| `parent-done.html` | Booked | Headline with the child's name and date, details list, "What Maya will remember", timeline, latency table for the call, Braintrust link. `BK-[ID]` comes from the booking row. |

Console, Rollcall (Stretch, not part of the 15-hour core):

| File | Screen |
| --- | --- |
| `console-dashboard.html` | Today's calls, callbacks waiting, trial seats next 7 days, one sparkline |
| `console-calls.html` | Call list with filters and a call detail (transcript, summary, latency, pipeline) |
| `console-callbacks.html` | Callback queue with a detail panel and the tool call that created it |
| `console-families.html` | Families with identity source and memory summary |
| `console-programs.html` | Programs with next trial slot, slot cards with capacity bars |
| `console-quality.html` | Eval scorecard, invariants, latency p50/p95, cloud simulations |
| `console-settings.html` | Persona, models through LiveKit Inference, channels and feature flags, rails |

The console pages share one left nav (wordmark, tenant switcher, links, "Parent site" at the bottom). "Rollcall" is the product name used in the mockups; BYSA is the tenant.

## Tokens

Fonts (Google Fonts): Inter 400/500/600 for text and controls. Space Grotesk 500/600/700 for page titles, section titles, wordmarks and the one big number per page. Monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) for ids, model names, tool names and latency values.

Type scale: 26px page title, 15px section title, 14px body and controls, 13px table text, 12px captions. One large display number per page where it earns it (40px on Quality, 54 to 56px on Dashboard and Done).

Colors:

| Token | Value | Use |
| --- | --- | --- |
| background | `#F4F6F2` | page |
| surface | `#FFFFFF` | cards, nav |
| surface-muted | `#F8FAF7` | tenant switcher, quiet blocks |
| border | `#E2E8E0` | card borders, nav border, table header rule |
| divider | `#F1F5F9` | row dividers inside cards |
| control-border | `#CBD5D0` | inputs, secondary buttons |
| text | `#0F172A` | primary text |
| text-secondary | `#334155` | nav links, body copy in asides |
| text-muted | `#475569` | captions, labels, table headers |
| accent | `#166534` | primary buttons, links, active dots, highlights |
| accent-strong | `#14532D` | link hover, "Pass" text |
| warning | `#B45309` | callbacks count, waiting states |
| danger | `#B91C1C` | End call only |
| off | `#94A3B8` | disabled feature dots |

Radius: 12px cards, 8px controls and nav items, 3px small marks, 999px dots only. No shadows; cards are a 1px border on the surface color.

Spacing: 40px main padding, 24px card padding, 20px gap between cards, 38 to 44px control height.

## Patterns

- Status is a dot plus text (`Booked`, `Callback`, `On`, `Off`), never a colored pill or badge.
- Numbers are specific and consistent across pages: 6 calls today, 3 trials booked, 3 callbacks waiting, 790 ms median reply over 61 turns, 10 of 10 core scenarios, 6 of 6 invariants. In the app every number comes from the database, `metrics/*.json` or the last eval output, never hardcoded.
- Placeholders in square brackets (`[LIVEKIT NUMBER]`, `BK-[ID]`) are filled from env or data.
- Microcopy is sentence case, says what happens next, and names the thing ("Emma's free trial is set for Saturday, November 14."). No "Powered by AI", no "seamless", no "experience", no exclamation marks.
- The call page is transcript first. Tool calls appear as a quiet monospace line under the user turn that triggered them. The read-back turn gets a left accent border.
- No hero orb, no waveform hero, no three-feature-card rows, no gradients, no emoji.
- Console pages end with the line "Fictional academy and families. Prototype on LiveKit Agents." The parent form and booked pages end with "Fictional academy, programs, coaches and families." The live call page has no footer.
- All names, phones, emails and bookings are synthetic. Phones in the console are masked (`+1 718 ••• 0142`).
