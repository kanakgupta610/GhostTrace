# GhostTrace v6: clearer structure, more pages, less on each

Every page now answers one question. Nothing was removed; busy pages were split, and secondary details moved one click away.

## New navigation (grouped)

| Group | Page | What it answers |
| --- | --- | --- |
| Investigate | **Graph** | Where did the money go? (graph only, plus the wallet panel) |
| | **Transactions** *(new page)* | Every transfer, in time order, with search, wallet, asset and stolen-funds filters and CSV export. Clicking a row opens it on the graph. |
| | **Evidence** | A card list of public findings → click one for its **own detail page** (source capture, linked wallets, timeline). |
| Analyse | **Risk** | Four sub-pages: **Scores** (ranking + explanation), **Timing** (how fast funds moved), **Clusters**, **Patterns** (and how scoring works). |
| Case | **Overview** | Three headline numbers, the guided walkthrough, and three shortcuts. |
| | **Cases** | Case cards → click one for its **own case page** (summary, key numbers, top wallets, case log). |
| | **Reports** | Unchanged. |

## What moved where

- **Graph:** the ledger moved to **Transactions**. Clusters, colour key, show-all, tidy layout, export image and reset moved into a **View ▾** menu. The timeline appears only while **Replay** is running. Canvas tools are down to lens, zoom in, zoom out and fit. A one-line hint tells first-time users where to start.
- **Wallet panel:** the **Summary** tab shows only why the wallet is flagged, money in/out and the address. Labels, cluster, wallet facts and connected wallets moved to a **Links** tab.
- **Overview:** the cases table moved to **Cases**. Activity moved to each case's log. Volume, timing and patterns moved to **Risk**.
- **Risk ranking:** three columns (wallet, score, main reason) instead of six.
- **Spacing:** larger titles, more padding, roomier tables, single-line sidebar items with tooltips instead of subtitles.

## Files changed

`src/App.jsx` (grouped nav), `src/store.jsx` (sub-page routing), `src/sections/Transactions.jsx` (**new**), `src/sections/GraphWorkspace.jsx`, `src/components/Inspector.jsx`, `src/sections/Overview.jsx`, `src/sections/Investigations.jsx`, `src/sections/Osint.jsx`, `src/sections/Risk.jsx`, `src/styles.css`.

---

# GhostTrace v5: the transaction graph is the star

| Feature | How to use it | What happens |
| --- | --- | --- |
| **Evidence reveal** | Open any scored wallet → **Reveal the evidence** (copper button in the wallet panel) | A four-stage flow docks over the bottom of the graph and drives it. **1 Wallet:** the camera flies to the wallet, its risk ring sweeps up and its name and address decode. **2 Timeline:** its transfers replay one by one on the graph, each with a comet and an amount + time label, while a list builds alongside (play, pause, scrub). **3 Evidence:** the public findings that name this wallet fly in, and a dashed beam runs from each card to the wallet, coloured by confidence (green = confirmed, teal = strong, amber = weak). **4 Verdict:** a plain-English sentence explains the score, the factor bars grow, and the transfers that triggered those factors light up. **Auto** walks through on its own; Back/Next, ←/→ and Esc work too. Clicking another wallet restarts the reveal for that wallet. |
| **Trace funds** | Wallet panel → **Trace funds** (was "Trace path") | The route from the vault lights up one hop at a time; each hop keeps a label with the amount and the date/time (UTC), then the sequence repeats. |
| **Replayable timeline** | Toolbar → **Replay flow** | Play, pause, restart and scrub every transfer, now at **0.5×, 1× or 2×**; the transfer that just happened gets an amount + time label on the graph. |
| **Evidence-to-wallet** | Toolbar → **Evidence**, then click a clue; or Evidence (OSINT) page → **Show the link in the graph** | A beam runs from the clue card to the wallet(s) it names, with a pulsing confidence ring and an "OS-02 · Strong link" badge; the related transfers glow and the banner gives the reason for the match. |
| **Micro-interactions** | Anywhere | Metallic rotating edge on primary buttons, hover lift, 3D tilt toward the pointer on metric and finding cards, a smooth slide for the side panel, staggered entrances in the reveal. |

With reduce-motion on, everything still works: labels and beams show without movement.

## Files changed

- `src/components/Reveal.jsx`: **new.** Evidence reveal dock (4 stages) and the evidence clue dock.
- `src/lib/evidence.js`: **new.** Builds the evidence-to-wallet highlight from OSINT findings.
- `src/components/GraphCanvas.jsx`: amount/time labels, hop-by-hop trace illumination, reveal timeline comets, verdict cascade, evidence beams and confidence badges, timeline labels; runs (static) under reduced motion.
- `src/sections/GraphWorkspace.jsx`: Evidence button, reveal and clue docks, camera framing, replay speed, reveal-aware clicks.
- `src/components/Inspector.jsx`: **Reveal the evidence** button; "Trace funds" label.
- `src/sections/Osint.jsx`: **Show the link in the graph** opens the graph with the beam drawn.
- `src/components/Motion.jsx`: card tilt.
- `src/store.jsx`: reveal and evidence-panel state.
- `src/styles.css`: styles for all of the above, including the phone layout.

## Demo script for judges (about 90 seconds)

1. Enter the investigation and click **Hop 2** → **Reveal the evidence**. Let Auto run through the wallet, the timeline, the researcher's thread beaming to the wallet, and the verdict.
2. Click **Peel 3** → **Trace funds** and watch the six hops light up with amounts and times.
3. Open **Evidence** and click **OS-05 Northgate deposit freeze notice** to see the beam to the exchange deposit.
4. **Replay flow** at 2× to watch the whole $42M theft play out.
5. **Reports → Export PDF.**

---

# GhostTrace v4: signature motion + new headline

**New headline:** "Money hides. / Ghosts leave *traces.*" The last word decodes out of scrambled hex, like an address being read off-chain. The supporting line now reads "Every transfer leaves a mark. GhostTrace follows stolen funds across wallets, transactions and public intelligence."

## What's new (and what each effect tells the investigator)

| Effect | Where | Why it helps |
| --- | --- | --- |
| **Decode text** (hex scramble → final text) | Hero headline, every section title's accent word, metric values, wallet name, full address, transfer amount | Ties the whole interface to on-chain data being resolved. Readers using assistive tech get the final text immediately. |
| **Selection shockwave** | Graph: when a wallet opens | Shows exactly which wallet you just selected. |
| **Money-in / money-out comets** | Graph: on the selected wallet | Teal comets arrive on incoming transfers first, then copper or ivory comets leave on outgoing transfers, in time order, every 3 seconds. You can *see* how funds passed through the wallet. |
| **Animated trace path** | Graph: Trace path | A lilac comet walks the path hop by hop from the vault to the wallet, then repeats, so the route reads as a sequence. |
| **Follow-funds cascade** | Graph: Follow funds | Comets fire down every onward transfer in time order. |
| **Transfer comet** | Graph: a selected transfer | A comet runs along that single transfer to show its direction. |
| **Risk gauge** | Wallet panel and Risk Analytics | The score sweeps up to its value in the band's colour. |
| **Copper scan beam** | Whenever you change section or case | A forensic "scan" sweeps the work area as new content arrives. |
| **Cursor spotlight on cards** | Cards, metrics, evidence matches, findings | Copper light follows the pointer over the panel you're reading. |
| **Editorial titles** | Every section | Serif italic accent word with a copper gradient, matching the hero. |
| **Row cascade** | All tables (ledger, rankings, drawers) | Rows slide in quickly, top to bottom. |
| **Living aurora** | App background | Slow-drifting copper and lilac light gives depth without distraction. |

All effects switch off with the OS "reduce motion" setting. No new dependencies; data, calculations and every feature are unchanged.

## Files changed

- `src/components/Motion.jsx`: **new.** `Decode`, `ScoreRing`, `useCardSpotlight`, `ScanBeam`.
- `src/components/GraphCanvas.jsx`: shockwave, money-in/out comets, animated trace path, follow-funds cascade, transfer comet (drawn on the existing motion canvas; the graph stays fully interactive).
- `src/components/Inspector.jsx`: risk gauge, decoding wallet name / address / amount.
- `src/sections/Hero.jsx`: new headline and supporting line.
- `src/sections/Overview.jsx`, `Investigations.jsx`, `Osint.jsx`, `Risk.jsx`, `Reports.jsx`: editorial decoding titles; decoding metrics; risk gauge on Risk Analytics.
- `src/App.jsx`: scan beam, card spotlight.
- `src/styles.css`: styles for all of the above.

## How to test

1. Open the app and watch "traces." decode in the hero headline.
2. Enter the investigation, then click **Exploiter EOA**: a shockwave, then teal comets in and copper comets out. The risk gauge sweeps to 99.
3. Click **Peel 3**, then **Trace path**: a lilac comet walks the six hops from the vault.
4. Click **Follow funds** on any wallet to see the onward cascade.
5. Switch sections: the copper scan beam sweeps and the title's accent word decodes.
6. Move the pointer over Overview cards to see the spotlight.

---

# GhostTrace v3: animation templates

The four templates are borrowed for **technique only**. None of their videos, photos, fonts-as-branding or copy is used, and GhostTrace stays a React + Vite app. Cases, sample data, calculations, the graph, wallet inspector, ledger, OSINT explorer, risk analysis and report exports all work as before. No new dependencies; there is no backend or database to touch.

| Template | Technique borrowed | Where it lives in GhostTrace |
| --- | --- | --- |
| **Ethan Vale** | Fibonacci-sphere "orb" with depth shading, perspective, drag to rotate with momentum, and the headline fixed at the orb's centre while near items pass in front | Hero: the orb is the real 24 wallets of GT-2026-014, with its transfers as arcs. Drag rotates it; **clicking a wallet opens it in the graph**. |
| **Lithos** | Soft circular spotlight trailing the cursor that reveals a second layer through a radial mask (same stops: 1 / 1 / .75 / .4 / .12 / 0) | Hero: the light reveals an x-ray of the orb showing only stolen-fund paths with amounts, and each wallet's risk score. Graph: an **X-ray lens** (toggle at the top of the graph tools) shows "% stolen" on every transfer and the risk score on every wallet under the cursor. |
| **Vesper.ai** | `.appear` entrance system (resting opacity 1, `animationend` → `.is-in`, two-rAF fallback), masked line reveals, popping badge with star, liquid-metal nav pills, glass buttons with a shine sweep, three-stat footer | Hero header, headline, badge, buttons and stats. Shine sweep on every button in the app; liquid-metal active nav item; masked reveal on section titles. |
| **Bloom** | Two-tier liquid glass: translucent fill, backdrop blur, gradient border drawn by a masked `::before` | Strong glass on the wallet inspector, evidence (OSINT) panels, drawers, modals and filters; light glass on cards, metrics, timeline, legend and path banner. |

## Files changed

| File | Change |
| --- | --- |
| `src/sections/Hero.jsx` | Rewritten: wallet orb (Ethan Vale), x-ray spotlight (Lithos), appear system and controls (Vesper). The nav pills open Graph / Evidence / Risk / Reports, **Enter investigation** opens the graph, **Replay the theft** opens the graph and starts the timeline replay, and clicking an orb wallet opens that wallet. The spotlight drifts on its own until you move the mouse; on touch it appears while you drag. |
| `src/components/GraphCanvas.jsx` | X-ray lens layer (canvas + CSS radial mask), passes pointer events through to the graph. Node data now carries name and score for the lens. Animation loops guard against running after unmount. |
| `src/sections/GraphWorkspace.jsx` | X-ray lens toggle (on by default; it only appears while the pointer is over the graph). |
| `src/store.jsx` | Opening a high-risk wallet from the hero orb or search now ticks "Select a suspicious wallet" in the journey. |
| `src/styles.css` | Hero v3 styles, Vesper keyframes, liquid-metal pills, glass buttons, Lithos masks, Bloom glass tiers, button shine, title reveals, phone menu, reduced-motion overrides. Fixed a sideways scroll on phones caused by the entrance animation. |
| `index.html` | Adds Instrument Serif italic (the accent face Vesper uses for emphasised words). |

## How to test each feature

1. **Hero orb (Ethan Vale):** open the app. Drag anywhere to spin the orb and release to feel the momentum. Hover a wallet: a hint names it. Click it: you land in the graph with that wallet open.
2. **Spotlight (Lithos):** wait a few seconds and the light drifts across the orb. Move your mouse and it follows you. Inside it, copper paths are stolen funds with amounts, and wallets show their risk score.
3. **Vesper motion:** reload and watch the logo, pills, badge star, the two masked headline lines, the lede, the buttons and the stats arrive in sequence. Hover any button for the shine.
4. **Hero controls:** try each pill (Graph, Evidence, Risk, Reports), **Enter investigation**, and **Replay the theft**; each one goes to the real section. On a phone, use the ☰ menu.
5. **Graph X-ray lens:** in the graph, move the pointer over the network. Transfers show "% stolen", and wallets show their score (rose = high, amber = elevated). Toggle it with the scan icon at the top of the right-hand tools. Clicking and dragging the graph still work through the lens.
6. **Glass (Bloom):** open a wallet. The inspector, the evidence panels (Evidence → any finding), the filters and the metric drawers sit on frosted glass with a light edge.
7. **Reduced motion:** turn on "reduce motion" in your OS. Everything is visible at once with no movement, and every control still works.
8. **Everything else:** Replay flow, Trace path, filters, OSINT, Risk, and **Reports → Export PDF** all work as before.

---

# GhostTrace v2: cinematic update

The data engine, sample cases, calculations, wallet selection, graph interactions, OSINT evidence, risk explanations and report exports are unchanged in behaviour. This update adds the hero, puts the graph first, adds meaningful motion and simplifies the interface.

## Files changed

| File | Change |
| --- | --- |
| `src/sections/Hero.jsx` | **New.** Full-screen intro. The network is drawn on a canvas from the real GT-2026-014 wallets and transfers: nodes appear in order, transfers draw themselves in time order, copper particles carry stolen funds along each transfer, high-risk wallets pulse, and the view drifts in 3D with mouse parallax. "Follow the money. Find the connections." headline with word-by-word reveal, count-up stats computed from the case, and one **ENTER INVESTIGATION** button that zooms into the network and opens the real graph workspace. |
| `src/data/cases.js` | Sample case renamed **Ghost Attacks: Halcyon Bridge exploit**, with its fictional amounts scaled so the stolen total is $42.0M (12,110 ETH + 12.94M USDC at the sample reference price). The same changes were applied to the OSINT excerpts and cluster notes. Still clearly labelled as fictional. |
| `src/components/GraphCanvas.jsx` | Motion layer over the graph: particles travel every visible transfer in the direction funds moved (copper = carries stolen funds, lilac = traced path). High-risk wallets pulse; suspicious wallets glow. Selections glow and transition smoothly. Nodes and transfers stagger in when a case opens. Timeline replay hides future transfers and flashes each new one. The graph stays fully interactive (the motion canvas ignores the pointer). |
| `src/sections/GraphWorkspace.jsx` | **Replay flow**: a timeline strip with play, pause, restart and scrub that steps through every transfer in order. A **Details** button collapses the side panel so the graph fills the screen. The ledger starts collapsed. The amounts toggle moved into Filters. Tooltips explain technical terms. |
| `src/components/Inspector.jsx` | The wallet panel opens with a slide-in transition. It now leads with **"Why this wallet is flagged"** (the top three risk factors) and an animated money in/out view. Chain, balance, counts and incident share are in a collapsible **Technical details** section. |
| `src/components/common.jsx` | App-wide tooltip layer (`data-tip`) and a glossary of terms (hop, incident funds, cluster, peel chain, mixer, OSINT…). |
| `src/App.jsx` | Opens on the hero. The Transaction Graph is first in the navigation. Labels are simpler. Clicking the GhostTrace logo replays the intro. Background lighting added. |
| `src/store.jsx` | Hero route, replay state and side-panel state. |
| `src/sections/Overview.jsx` | Five metric cards cut to three. An "Open transaction graph" button added. Volume, activity and patterns moved into a collapsible panel. |
| `src/sections/Risk.jsx` | Scoring method moved into a collapsible panel. Tooltips added for terms. |
| `src/sections/Osint.jsx` | Source details and extracted identifiers moved into a collapsible panel. The captured evidence stays visible. |
| `src/styles.css` | Hero styles, background lighting, glass panels, staggered entrances, the timeline strip, collapsible panels, tooltips and mobile layouts. `prefers-reduced-motion` turns off every animation; the hero then shows a still frame. |

No new dependencies.

## How to test

1. `npm install && npm run dev`, then open http://localhost:5173. Or double-click `GhostTrace-standalone.html`.
2. Watch the hero. The network builds from the case data, then press **ENTER INVESTIGATION**.
3. In the graph, press **Replay flow** and watch the theft play out transfer by transfer. Drag the timeline to scrub.
4. Click **Hop 2**. The panel slides in with why it is flagged. Press **Trace path** to see the route light up from the vault.
5. Press **Details** to hide the panel. Hover **Clusters** for its tooltip.
6. Open **Reports → Export PDF**. The export still works.
7. With your OS set to reduce motion, everything still works without animation.
