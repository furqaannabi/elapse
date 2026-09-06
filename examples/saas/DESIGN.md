---
name: Acme GPU (example merchant)
description: Rack rail and rating plates. A colocation cage under cold white LED light, for the demo merchant only.
colors:
  alu: "#cfd3d6"
  alu-hi: "#e4e7e9"
  alu-lo: "#b7bcc0"
  rail: "#383d42"
  rail-ink: "#cdd1d4"
  plate: "#141516"
  plate-ink: "#f2f3f4"
  plate-dim: "#a9aeb3"
  etch: "#3b4046"
  yellow: "#f2c11c"
  tape: "#b3261e"
  led-off: "#3a3f44"
  led-on: "#3ddc84"
  push: "#dde0e3"
  push-lo: "#c3c8cc"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(30px, 9vw, 40px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.04em"
  headline:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(24px, 6.6vw, 30px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(19px, 5.4vw, 24px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.01em"
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.16em"
rounded:
  label: "2px"
  plate: "3px"
  push: "4px"
  led: "50%"
spacing:
  rail: "30px"
  u: "14px"
  bay-x: "18px"
  bay-top: "22px"
  stack-sm: "14px"
  stack-md: "18px"
  stack-lg: "26px"
  stack-xl: "40px"
components:
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.plate-ink}"
    typography: "{typography.display}"
    rounded: "{rounded.plate}"
    padding: "22px 26px 20px"
  label:
    backgroundColor: "{colors.yellow}"
    textColor: "#111111"
    typography: "{typography.title}"
    rounded: "{rounded.label}"
    padding: "12px 14px 11px"
  tape:
    backgroundColor: "{colors.tape}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "0"
    padding: "7px 14px 6px"
  push:
    backgroundColor: "{colors.push}"
    textColor: "#0e0f10"
    rounded: "{rounded.push}"
    padding: "0 20px 0 22px"
    height: "64px"
  led:
    backgroundColor: "{colors.led-off}"
    rounded: "{rounded.led}"
    size: "14px"
  led-on:
    backgroundColor: "{colors.led-on}"
    rounded: "{rounded.led}"
    size: "14px"
  back:
    textColor: "#111111"
    typography: "{typography.label}"
    padding: "0 4px"
    height: "44px"
---

# Design System: Acme GPU (example merchant)

**This world belongs to the example merchant only.** `examples/saas` is Acme GPU, the fictional merchant a judge clones; by [ADR 2026-09-06](../../docs/decisions/2026-09-06-example-merchant-own-brand.md) it has its own look so the video reads "a merchant's site hands me to Elapse Checkout". Every Elapse surface (landing, checkout, dashboard, docs) inherits the root `DESIGN.md` instead and must not borrow from this file. Ground truth is `public/acme.css` and the three pages `public/{index,ok,cancel}.html`.

## Overview

**Creative North Star: "Rack rail and rating plates"**

A colocation cage under cold white LED light. The page is not a pricing card; it is the signage on the machine itself. Brushed aluminium is the ground, a numbered U-strip runs down the rail, and everything the subscriber reads is a physical marking: an engraved laminate plate for the product, a safety-yellow rating label for the price, a strip of red embossed tape for the promise, and a steel push plate with a status LED for Start. Mode is Persuade: a developer on a phone decides to press Start, and then Elapse Checkout takes over in its own world.

The materials are all in one stylesheet with no images: four inline SVG data-URIs (brushed grain, matte grain, a Phillips screw head, a square cage-nut hole) layered under gradients. Type is engraving and label stock: condensed caps cut into the plate, monospaced caps printed on the labels. Nothing is decorative that a real rack would not carry.

**Key Characteristics:**
- Every element is a named physical object with its own material recipe; there are no generic cards, chips or pills.
- One dark plate, one yellow label, one red tape, one steel plate per page. Rarity is the hierarchy.
- Cold neutral aluminium with three signal colors: safety yellow (rating, focus, "you are here"), tape red (promise, the GPU in the wordmark), LED green (running).
- Phone first at 390px with the whole story above the fold; two rack posts appear only from 1024px.
- One authored motion moment: the bay settles, the LED self-tests.

## Colors

Cold neutrals for the cage, three signal colors for the markings, each with one job.

### Primary
- **Safety Yellow** (`yellow`): the rating label ground, the focus ring on Start and Back, and the highlighted U number on the rail. It marks "this is the number that matters" and "you are here".

### Secondary
- **Tape Red** (`tape`): the embossed tape ground and the `GPU` half of the wordmark. The promise ("Pay only what elapsed" / "No meter started") and nothing else.

### Tertiary
- **LED Green** (`led-on`): the only green; a lit status LED means the meter is running. **LED Slate** (`led-off`) is the unlit lens.

### Neutral
- **Brushed Aluminium** (`alu`, with `alu-hi` / `alu-lo` as sheen bounds): the page ground, under a fixed diagonal sheen and horizontal grain.
- **Anodized Rail** (`rail`) / **Rail Ink** (`rail-ink`): the U-strip post and its printed numbers.
- **Laminate** (`plate`) / **Plate Ink** (`plate-ink`) / **Plate Dim** (`plate-dim`): the engraved plate, its engraved white, and its secondary engraving.
- **Etch** (`etch`): everything written directly onto the aluminium (notes, location, footer tag, push hint).
- **Push Steel** (`push`, `push-lo`): the Start plate face and its lower edge.

### Named Rules
**The One-Of-Each Rule.** A page carries at most one plate, one rating label, one tape, one push plate. A second yellow surface or a second red strip breaks the rack; use a second `plate--small` only for a secondary engraving.
**The Signal Rule.** Yellow, red and green never appear as text color on the aluminium except the yellow U number; they are grounds (label, tape) or a lens (LED). Focus rings are the one exception and are always yellow.

## Typography

**Display / Engraving Font:** Barlow Semi Condensed 500 / 700 (with Arial Narrow, Helvetica Neue, Arial, sans-serif)
**Label / Mono Font:** Martian Mono 400 / 700 (with ui-monospace, SF Mono, Menlo, Consolas, monospace)

**Character:** Condensed caps read as letters cut into laminate; the mono reads as label-maker and printed strip. Both come from Google Fonts with `display=swap`; offline the fallbacks still hold the layout.

### Hierarchy
- **Display** (700, clamp(30px, 9vw, 40px) rising to 46px from 640px, 1.05, +0.04em, uppercase): the product engraving on the plate (`GPU · 4090`). Engraved with a dark upper and light lower text-shadow.
- **Headline** (700, clamp(24px, 6.6vw, 30px), 34px from 1024px, 1.05, +0.01em, sentence case, `overflow-wrap: anywhere`): the `long` variant of the engraving for the success and cancel sentences, which carry a session id and must never clip.
- **Title** (700, clamp(19px, 5.4vw, 24px), 1.15, tabular numerals): the rating value on the yellow label (`$0.004 / second · ~$14.40 / hour`).
- **Push** (700, 22px → 24px, +0.16em, uppercase): the word on the push plate (`Start`).
- **Wordmark** (700, 22px → 26px, +0.12em, uppercase): `AcmeGPU`, with `GPU` in tape red.
- **Sub-engraving** (500, 13px, +0.14em, uppercase, plate-dim): the second line on the plate; ids inside it drop to the mono at 11px, no tracking, plate-ink.
- **Body** (500, 14px → 15px, 1.45, max 44ch, `text-wrap: pretty`): the etched note under the push plate.
- **Label** (mono 700, 10–12px, +0.14–0.2em, uppercase): rail numbers (8px → 10px), label key (10px), tape and status (11px), back link (12px).
- **Meta** (mono 400, 11px → 12px, +0.06–0.08em, uppercase): location, push hint, footer tag.

### Named Rules
**The Engraving Rule.** Text on the dark plate always carries the two-tone text-shadow (`0 -1px 0 rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.28)`); text on aluminium and yellow never does. The tape uses the embossed variant (light above, dark below).
**The Two Faces Rule.** Sans for what is engraved or pressed, mono for what is printed. No third face, no system display face.

## Layout

The cage is a CSS grid: a rail column of `--rail-w` (30px on phones, 56px from 640px) and a bay that fills the rest, `min-height: 100dvh`. From 1024px a second rail appears on the right and the bay centres between the two posts (`grid-template-columns: rail 1fr rail`), the way a rack has two posts.

The bay is a single column, `max-width: 560px` (640px from 640px), padded `22px 18px 40px` on phones and `40px 40px 56px 44px` on wider screens. Vertical rhythm is a stack of fixed gaps rather than a scale: identity → plate 26px, plate → label 14px, label → tape 18px, tape → push 26px, push → note 20px, note → back 28px, → footer 40px. The rail's U pitch is `3 × --u` (42px on phones, 48px wider); the cage-nut holes repeat on the same pitch so numbers and holes stay aligned for the full height.

First viewport at 390px: identity, plate, rating label, tape, and the Start push plate all sit above the fold. The rack is at U40 (`.here`) on every page.

## Elevation & Depth

Depth is material, not floating. Nothing uses a soft drop shadow to lift a card; instead each object has the shadow its material would have when screwed or stuck to the rack.

### Shadow Vocabulary
- **Plate seat** (`inset 0 1px 0 rgba(255,255,255,.09), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.4), 0 10px 18px -12px rgba(0,0,0,.6)`): laminate with a lit top edge, a dark bottom edge and a tight shadow onto the aluminium.
- **Label stick** (`0 1px 1px rgba(0,0,0,.25), 0 4px 10px -8px rgba(0,0,0,.5)`): a sticker, barely off the surface.
- **Tape lift** (`0 1px 1px rgba(0,0,0,.3)`): the raised tape, nearly flat.
- **Push chamfer** (`inset 0 1px 0 #fff, inset 1px 0 0 rgba(255,255,255,.7), inset 0 -1px 0 rgba(0,0,0,.28), inset -1px 0 0 rgba(0,0,0,.14), 0 2px 0 #8d9398, 0 3px 0 #5f6569, 0 8px 14px -6px rgba(0,0,0,.5)`): light on top and left, dark on bottom and right, then a 3px steel lip. On `:active` the lip collapses to 0 and the plate moves down 3px.
- **LED lens** (`inset 0 1px 2px rgba(0,0,0,.7)` off; `inset 0 1px 1px rgba(255,255,255,.6), 0 0 0 3px rgba(61,220,132,.22), 0 0 12px 2px rgba(61,220,132,.65)` on): the only glow in the system.
- **Rail edge** (`1px 0 0 rgba(255,255,255,.12), 2px 0 6px rgba(0,0,0,.25)`): the post standing proud of the ground.

### Named Rules
**The Only Glow Rule.** The lit LED is the only element that emits light. No other glow, no halo on hover, no colored shadow.

## Shapes

Near-square with hairline radii, as machined parts: label 2px, plate 3px, push plate 4px, LED a 14px circle. Borders are real edges: the plate has a 1px `#2c2f32` rim, the label a 1.5px black rim, the push plate a 1px `#7f858a` rim, the LED a 1px `#1d2023` bezel. The tape is the one non-rectangle: `clip-path` notches both ends by 4px and it rotates -1.4° from its left edge, the way tape is applied by hand. Screw heads are 14px (12px on the small plate) placed 7px from each corner as background layers, never as DOM.

## Components

### Rail
An `aside` post, `aria-hidden`, with an ordered list of U numbers from U42 down to U01. Anodized ground (`rail` with a horizontal light gradient and matte grain), cage-nut holes repeated every U pitch, numbers in mono 700 at 8px (10px wide) in `rail-ink`, rotated to read bottom-up on the left post and top-down on the right (`rail--right`, `display: none` below 1024px). `li.here` is yellow and is always U40.

### Plate
- **Shape:** 3px radius, 1px rim, four screw heads in the corners.
- **Ground:** laminate gradient (`#1e2022` to `plate` at 40%) under matte grain.
- **Content:** an `h1` engraving (Display, or `.long` for sentences) and a `.sub` line; ids in the sub line use `.id-mono`.
- **Small variant** (`plate--small`): `12px 18px 11px` padding, two screws at mid-height, for a secondary engraving.

### Rating label
- **Shape:** 2px radius, 1.5px black rim, safety yellow under a top-lit gloss gradient.
- **Content:** `.k` key (mono 700 10px, +0.16em, uppercase) above `.v` value (Title with tabular numerals). Used for the rate on the product page and the entitlement state on the success page.

### Tape
An inline-block label in mono 700 11px +0.2em uppercase white, embossed text-shadow, tape red under gloss and grain, notched ends, -1.4° rotation, margin `18px 0 0 -2px` so the rotation overhangs the left edge slightly. Only carries a promise sentence.

### Push plate
- **Shape:** 4px radius, min-height 64px (72px from 640px), full width, flex row.
- **Ground:** brushed steel (`#e9ecee` to `push` to `push-lo`) under the brushed grain and a top gloss, with the chamfer shadow.
- **Content:** the word `Start` (Push type) on the left, a two-line mono hint (`Secure / checkout`) right-aligned, then the LED.
- **Hover / Focus:** the LED lights (`led-on` with glow); the plate itself does not change color. `:focus-visible` adds a 3px yellow outline at 3px offset.
- **Active:** `translateY(3px)` with the lip shadows zeroed, 120ms `cubic-bezier(.2,.8,.2,1)`. It is pressed, not clicked.

### LED
A 14px circle, `led-off` with a 1px bezel and a dark inset. `.on` lights it green with the glow. `.post` runs the power-on self-test on load (see motion). It is always `aria-hidden`; the adjacent text carries the meaning.

### Status
A flex row of an LED and a mono 700 11px +0.16em uppercase word in `etch` (`Meter running`, `Meter stopped`, `Meter off`). Used on the success and cancel pages where there is no push plate; the LED state follows the entitlement.

### Etched note
A body paragraph in `etch`, 500 weight, max 44ch, `text-wrap: pretty`; the plain-language explanation under the action.

### Back link
An inline-flex link, min-height 44px, mono 700 12px +0.14em uppercase in `#111`, underlined at 4px offset with a 1.5px line; yellow focus outline at 2px offset.

### Identity and tag
The header `.id` sets the wordmark (`Acme` black, `GPU` tape red) against a right-aligned mono location (`Cage 4 · Rack 12 / Cold aisle`). The footer `.tag` is mono 400 11px uppercase in `etch`: `{{merchant}} · demo merchant`.

### Motion
One authored moment under `prefers-reduced-motion: no-preference`, none otherwise:
- **Settle** (`.settle` on the bay): opacity 0 → 1, `translateY(6px)` → 0, 360ms `cubic-bezier(.2,.8,.2,1)`, both fill modes. Plates settle onto the rack.
- **POST** (`.led.post`): after 300ms, 900ms of `steps(1, end)`: two green blinks (on at 0/30/60%, off at 15/45%), then whatever the page state says. A power-on self-test, not a pulse.
- **Press** (`.push`): transform and box-shadow 120ms; LED background and glow 120ms ease-out.

## Do's and Don'ts

### Do:
- **Do** treat every new element as a physical marking with a material recipe: ground gradient, grain, edge, seat shadow. Reuse `--brushed`, `--grain`, `--screw`, `--hole`.
- **Do** keep the pinned copy strings from FR-EXM-010/011 verbatim and contiguous in one element each: `Acme GPU`, `GPU · 4090`, `$0.004 / second · ~$14.40 / hour`, `Start`, `Access granted for session cs_…`, `Checkout canceled. Nothing was charged.` The Playwright and route tests match on them.
- **Do** design at 390px first with the full story above the fold; keep interactive targets at 44px or taller (push plate 64px, back link 44px).
- **Do** give every focusable element the yellow 3px `:focus-visible` outline.
- **Do** use tabular numerals for any money or count on a label.
- **Do** use `.long` on the plate engraving whenever the text is a sentence or carries an id.

### Don't:
- **Don't** use any Elapse token, component, font, or color from the root `DESIGN.md` (no cobalt, no warm paper, no strip-chart motifs). This world is the merchant's and must look like a different company.
- **Don't** use chain vocabulary anywhere on these pages: no wallet, chain, tx, gas, AUSD, Monad. Subscriber language only (rate, meter, start, cancel, charged).
- **Don't** add a second plate, label, tape, or push plate to a page; the hierarchy is that each exists once.
- **Don't** lift anything with a soft ambient drop shadow or add a glow to anything but the lit LED.
- **Don't** pulse, blink, or animate per second. The LED self-tests once on load and then holds its state.
- **Don't** add images, icon fonts, glyph icons, a framework, or a build step; one HTML file per page and one stylesheet, with fonts from Google Fonts and system fallbacks.
- **Don't** put gloss or emboss effects on text outside the plate and the tape; text on aluminium and on the yellow label is flat.
