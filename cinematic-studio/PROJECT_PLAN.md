# Cinematic Studio — project plan

Working plan for what this app is becoming, why, and what's actually done vs. still open. Detailed platform gotchas live in `ISSUES.md`; live schema/logic definitions live in `entities.json` / `logicblocks.json` / `events.json` / `connectors.json` / `roles.json`. This file is the narrative connecting them.

---

## 1. What this product is

Started as a narrow "article → AI slide deck → voiceover → render" pipeline. Merged with a second app (`storyboard-presenter`, a manual slide/camera/cursor authoring tool whose only way to get an mp4 was: export standalone HTML, run a Python `cursor_driver.py` sidecar to physically drag the OS cursor, and manually screen-record while it played).

Current direction, decided across this build:

- **Input isn't just an article anymore.** A project can pull in any mix of text, URL, PDF, image, or a raw user query as `ContentSource` rows.
- **Output isn't just "marketing video" anymore.** `project.video_type` (marketing / explainer / tutorial / product-demo / social-short / educational / narrative / other) steers the AI's tone and structure.
- **AI writes the first draft; the pipeline can also auto-generate camera direction** (zoom/pan shots, highlight effects) from that draft — ported from `storyboard-presenter`'s `directorEngine.ts` rules, reimplemented as an AI-driven step since the platform has no sqrt/trig formula functions to port the literal easing math.
- **Rendering is fully automatic**, not a manual screen-record. This is the actual point of the merge: replace `cursor_driver.py` + a human hitting record with a headless-browser (Playwright) worker that drives an in-page fake cursor and captures frames + FFmpeg-encodes an mp4, with zero human in the loop.
- A **manual storyboard editor** (ported from `storyboard-presenter`'s React components) still exists for refining the AI's draft before rendering — slides, interactions, camera shots, cursor timeline — but persists to the real nostackai entities instead of `localStorage`.

## 2. Pipeline stages

```
draft
  ↓ (user adds ContentSource rows; each auto-ingests via ingest_source)
generating_content   → generate_storyboard_draft (AI writes slides + interactions)
  ↓
generating_voice     → generate_voiceover (TTS per slide)
  ↓
generating_direction → generate_cinematic_direction (auto camera shots + effect cues)
  ↓
ready_to_render       (open for manual edits in the storyboard editor)
  ↓ (ONLY manual gate — user clicks "Render Now")
rendering             → start_render (bundles snapshot, calls render worker)
  ↓ (render worker callback)
ready / failed
```

Every transition except `→ rendering` is fully automatic: each logicblock's last step advances `project.status`, which re-triggers the next stage's event. `→ rendering` is the one deliberate UI button, since "render now" is a real user decision (see `events.json`'s `trigger_start_render` note).

## 3. Entities — status

All live in the `nostackai` org as of 2026-08-10. Full field definitions in `entities.json`.

| Entity | Role | Status |
|---|---|---|
| `project` | Top-level container | ✅ Live — deleted & recreated this session to add `video_type`, expanded `status` enum, canvas/director/cursor settings. Owner-scoping (`user_id` auto-stamp) confirmed working after fixing a `create_entity` quirk (see §6). |
| `contentsource` | Multi-type input (text/url/pdf/image/query) | ✅ Live — new |
| `generatedhtml` | Slide (kept old name; holds `html_content` + `narration_text`) | ✅ Live — unchanged, already matched plan |
| `interaction` | Timed highlight/glow cue on a slide | ✅ Live — unchanged, already matched plan |
| `camerashot` | Auto/manual zoom-pan camera direction | ✅ Live — new |
| `videoeffectcue` | Spotlight/glow/etc. overlay effect | ✅ Live — new |
| `cursortimelinepoint` | Cursor path point (manual editor + render worker's fake-cursor overlay) | ✅ Live — new |
| `voiceover` | Per-slide TTS clip | ✅ Live — unchanged, already matched plan |
| `exportasset` | Any exported artifact (config-json / standalone-html / video / image) | ✅ Live — new, replaces `finalvideo` |
| `script`, `finalvideo` | Old whole-project script + video-only export | Deprecated in place, not deleted. Narration now lives on `generatedhtml.narration_text`; exports now use `exportasset`. |

## 4. Logicblocks — status

Full step JSON in `logicblocks.json`. Console quirks that shaped how these had to be written are in `ISSUES.md` #23–25 (bare `steps` array only, `outputAs` required on every step including `condition`/`end`, `condition` needs an empty `config: {}`). Two more found 2026-08-18–09-02, both load-bearing:
- **A `condition` branch's `then`/`defaultThen` must list every step id that should run in sequence** — steps aren't auto-chained just by being siblings in the same nested `steps` array; only ids explicitly referenced actually execute. `defaultThen` targets must also live inside that same condition's own nested `steps` — cross-scope references to a sibling outside the condition silently resolve to nothing ("empty branch" in the console's canvas view).
- **`mcp__nostackai__create_logicblock` has a stricter/different validator than the console+runtime accept.** `end` steps stored via the console use `config: { response: {...} }`, but `create_logicblock` rejects that shape ("unknown config fields: response") and requires `response` as a step-level sibling of `config` instead: `{ id, type: "end", outputAs, config: {}, response: {...} }`. Both shapes are apparently valid once stored — only the flat one passes this tool's own creation-time check.

**2026-10-10 full rebuild:** All 4 previously-live blocks (`ingest`, `generate_storyboard_draft`, plus the undocumented orphan `copy` and unused test copy `ingestpdf`) were deleted and every block recreated from scratch from this plan, because an audit found the 6 "written, not yet pasted" drafts in `logicblocks.json` systematically violated the two load-bearing rules above: their `condition` branches' `then` arrays referenced only the first nested step id instead of the full sequence (so e.g. `generate_voiceover`'s TTS loop and status-advance step would never have run), and their `defaultThen` skip targets were siblings outside the condition's own scope (dead/no-op skip paths). All 8 blocks are now live with these fixed, plus three real logic bugs found and corrected during the rebuild:
- `start_render`'s gate checked `status IN [ready_to_render, ready, failed]`, but the actual `trigger_start_render` event only fires on `status == "rendering"` — the original would have always hit its own skip branch. Fixed to gate on `rendering`.
- `render_complete` had its failure-path step (`update project.status = "failed"`) as a top-level sibling *after* the success/failure condition, so it ran unconditionally and clobbered a successful `ready` status moments after setting it. Moved into the failure branch only.
- `generate_voiceover`'s `ai_call` instructions claimed "audio outputFormat always uses OpenAI TTS" — wrong per `get_platform_capabilities`; both `gemini` and `openai` support TTS. Corrected.

| Logicblock | Purpose | Status |
|---|---|---|
| `ingest` | Normalize any ContentSource into `raw_text` + `summary` | ✅ **Live**, recreated 2026-10-10. Event (`ingest_source_on_create`) already correctly targets `ingest` with field mapping `_query.contentsource_id`; duplicate disabled copy of this event deleted. PDF branch still fails loud by design (no native PDF text extraction). |
| `generate_storyboard_draft` | Multi-source, `video_type`-aware AI slide deck generation | ✅ **Live**, recreated 2026-10-10 identical to its previously-verified-correct structure. Not yet end-to-end tested with real data. |
| `generate_voiceover` | Per-slide TTS | ✅ **Live**, recreated 2026-10-10 with `then`/`defaultThen` scoping fixed. Still unverified: whether `voiceover.audio_file` (s3 colType) accepts a hosted TTS URL (`{{tts_result.url}}`) directly, or needs the bytes re-uploaded. `trigger_generate_voiceover` event re-enabled (was silently `enabled: false` — pipeline would have stalled forever at `generating_voice` even with a working block). |
| `generate_cinematic_direction` | AI-approximated camera shots + effect cues | ✅ **Live**, recreated 2026-10-10 with `then`/`defaultThen` scoping fixed. |
| `start_render` | Bundle project snapshot, call render worker via webhook step | ✅ **Live**, recreated 2026-10-10 with scoping fixed and trigger-condition bug fixed (see above). `RENDER_WORKER_URL`/`CALLBACK_BASE_URL` are still placeholders — worker doesn't exist yet. |
| `render_complete` | Render worker's callback endpoint (`isPublic: true`) | ✅ **Live**, recreated 2026-10-10 with scoping fixed and the status-clobber bug fixed (see above). |
| `duplicate_project` | Cascade-copy a project across all 7 entities | ✅ **Live**, recreated 2026-10-10. Known gap: project-level-only `CursorTimelinePoint` rows (no `slide_id`) are currently *not* duplicated — the condition that was meant to copy them only ever resolves to a skip no-op. Low priority since the storyboard editor doesn't yet create project-level-only cursor points (see §7's scoped-out items). |
| `delete_project_cascade` | Cascade-delete a project | ✅ **Live**, recreated 2026-10-10. |

All 8 are now live and enabled. Next actions: verify `voiceover.audio_file`'s hosted-URL assumption and `generate_storyboard_draft`/`generate_voiceover` end-to-end against a real project; build the render worker and point `RENDER_WORKER_URL`/`CALLBACK_BASE_URL` at it; fix `duplicate_project`'s project-level-cursor-point gap if/when that feature ships.

## 5. Events — status

✅ All 5 live and now all actually enabled (as of the 2026-10-10 rebuild; `trigger_generate_voiceover` had silently been `enabled: false` since creation, so the §4 "✅ All 5 live" claim here was previously wrong — the pipeline would have stalled forever at `generating_voice` even once the block existed). A duplicate disabled copy of `ingest_source_on_create` (an August leftover) was also deleted:

- `ingest_source_on_create` — on `contentsource` create, targets `ingest`
- `trigger_generate_storyboard_draft` — on `project` update, `status == generating_content`, targets `generate_storyboard_draft`
- `trigger_generate_voiceover` — `status == generating_voice`, targets `generate_voiceover` — **re-enabled 2026-10-10**
- `trigger_generate_cinematic_direction` — `status == generating_direction`, targets `generate_cinematic_direction`
- `trigger_start_render` — `status == rendering`, targets `start_render`
- `project notification.email` — unverified placeholder, still doesn't solve the real problem (no owner-email field to source from)

`render_complete` has no triggering event by design — it's a public (`isPublic: true`) callback endpoint the external render worker calls directly. `duplicate_project`/`delete_project_cascade` are likewise not event-triggered — called directly from the UI.

## 6. Platform constraints discovered this build

(Full detail in `ISSUES.md` #23–28.) Load-bearing ones to remember:

- **No `update_entity`/`delete_entity` MCP tool exists.** Only `create_entity`/`describe_entity`/`list_entities`. Schema changes to a live entity require either a manual console edit, or delete-in-console + recreate-via-MCP (only safe with no real data yet, as was the case for `project` this session).
- **`create_entity`'s `ownerIndexes` param isn't in its declared schema** but gets silently accepted and mis-stored as a stringified blob instead of erroring — always re-verify via `describe_entity` after passing anything not in the tool's documented parameter list.
- **Render worker (headless browser + FFmpeg) cannot be a logicblock** — no such step type exists. Must be a standalone external service, invoked via `start_render`'s `webhook` step, calling back into `render_complete`.

## 7. UI

Revamped three times. First pass (early session) landed "Canvas Violet". Second pass redid it as "Reel Indigo" (warm near-black, indigo primary, amber accent — dark-only, no toggle). This session replaced Reel Indigo entirely with **"Classical"**, ported from a Claude Design canvas (`Cinematic Studio.dc.html`, project `ba07c13e-7718-4841-ba81-1ab0bfa20f13`) — a paper/ink theme explicitly designed to move away from the "vibe-coded" dark-glass-plus-glow look every AI tool ships:

- Two full token sets in `src/index.css`: `:root` (Paper, light) and `.dark` (Ink, dark) — same raw-HSL-triplet convention as before so `bg-x/20` opacity modifiers keep working. Cormorant Garamond (headings, `font-display`) + Lora (body, `font-sans`) replace Space Grotesk/Inter/JetBrains Mono. Gold accent used as a stroke/text color, not a fill — buttons, tags, and card icons are bordered, not solid.
- New `ThemeProvider`/`useTheme` hook (`src/hooks/useTheme.tsx`) + `ThemeToggle` component — toggles `.dark` on `<html>`, persists to `localStorage["theme"]`, defaults to **Ink**. Wired into `AppLayout`'s header and `HomePage`'s header. There was no toggle infrastructure at all before this.
- Dropped `.grain-bg`, `.scene-glow`, and the `pulse-lamp`/`drift`/`flow-x` keyframes/glow-shadow — none fit a stroke-not-fill paper aesthetic. `PipelineTimeline` became a perforated-film-strip treatment (bordered squares per stage) instead of the old sprocket-hole-and-bar-segment design.
- All 7 pages + `AppLayout` retheme'd and rechecked against the **live 9-stage status enum** (`draft, generating_content, generating_voice, generating_direction, ready_to_render, rendering, ready, failed, archived`) — `src/config/entities.ts` was stale on the old 5-stage enum before this pass; fixed, plus added TS types/`ENTITY_NAMES` for the 5 previously-untyped entities (`ContentSource`, `CameraShot`, `VideoEffectCue`, `CursorTimelinePoint`, `ExportAsset`). `ProjectsPage`'s create call now sends the required `video_type`/`canvas_aspect_ratio` fields it was previously missing.
- Hand-verified WCAG contrast for every new token pair (background/foreground, accent-as-text, success/destructive/info as text) in both themes — see `src/index.css`'s inline notes for the exact ratios.
- `tsc -b` and `vite build` both pass clean. **Visually verified this session** via a headless-Chromium screenshot pass (Playwright, no project skill for this existed yet) on the public Home and Auth pages in both Paper and Ink — matches the design doc's direction, no console errors. The 6 logged-in pages (Dashboard/Projects/Project detail/Integrations/Profile/Storyboard Editor) are build-verified only — no nostackai credentials available in this environment to log in and screenshot them.

### Storyboard Editor (new)

Built at `src/pages/StoryboardEditorPage.tsx` (+ `src/components/storyboard/*`), routed at `/projects/:id/storyboard`, linked from `ProjectDetailPage`. Ported from `storyboard-presenter`'s `SlideEditor.tsx`/`CursorTimelinePanel.tsx`/`StageFrame.tsx`/`SlideRenderer.tsx` (~3800 lines total), re-plumbed onto real entities (`generatedhtml`, `interaction`, `camerashot`, `videoeffectcue`, `cursortimelinepoint`) instead of that app's `localStorage` keys.

Ported faithfully: sandboxed-iframe slide preview with click-to-select element targeting, the interaction-effect-class application loop, slide reorder/add/delete, per-slide interaction CRUD, and a cursor-timeline point list sorted by global time.

Scoped out this pass (source app had no equivalent, or the equivalent needs infra this app doesn't have yet) — noted in-code where relevant:
- **Camera shots have no source-app analogue at all** (that source app only ever had DOM-element interactions + a 2D fake-cursor path, never canvas zoom/pan) — the `CameraShotPanel` UI here is newly designed against the `CameraShot` entity's fields, not ported from anything.
- Tap-to-place cursor points, word-level text-node interaction targeting, the "auto-follow" cursor-point generator (needs an off-screen DOM-target resolver the source app had via `lib/offscreenResolver.ts`, not brought over), multi-file HTML upload/segmentation, and the drag-based timeline-ruler cue positioning (source app hand-rolled `mousemove` dragging on a ruler; this port uses plain number-input fields instead).
- Effect cues (`VideoEffectCue` — whole-canvas spotlight/dim/wipe effects) are a separate new entity from interactions; the editor exposes them as their own CRUD panel per slide rather than deriving them from interactions automatically.

## 7a. Running the app in this environment

No project skill existed for launching this app before this session — added ad hoc via the `run` skill's browser-driven pattern (`npm run dev` in background, poll `curl` until the port answers, drive with Playwright since `chromium-cli` wasn't installed here). Worth generating a proper project skill (`/run-skill-generator`) next time so this doesn't need rediscovering.

## 8. Open items / next steps

- [ ] Create remaining 6 logicblocks (`generate_voiceover`, `generate_cinematic_direction`, `start_render`, `render_complete`, `duplicate_project`, `delete_project_cascade`) — `create_logicblock` via MCP now confirmed working (see §4's `end`-step-shape quirk), no need to hand-paste through the console
- [ ] End-to-end test `generate_storyboard_draft` against a real project once a `ContentSource` reaches `status: "processed"` and `project.status` is set to `generating_content`
- [ ] Build the actual render worker (Playwright + FFmpeg, in-page fake-cursor overlay replacing `cursor_driver.py`'s OS-level automation) and wire its real URL into `start_render`
- [x] Port `storyboard-presenter`'s manual editor components into this app's page structure, backed by real entities — done this session as `StoryboardEditorPage` (§7); tap-cursor placement, auto-follow cursor generation, and drag-based timeline-ruler editing were scoped out, see §7's Storyboard Editor notes
- [ ] Solve the owner-email gap for the completion notification event
- [ ] Manually verify `project`'s new fields propagated to all 4 generated endpoints (create/get/list/update) per the recurring per-endpoint propagation bug (`ISSUES.md` #13/#21b)
- [x] Visually verify the Classical UI revamp in a real browser — done this session for the public Home/Auth pages (§7); the 6 logged-in pages still need a real login to check
- [ ] Log into the app with real nostackai credentials and screenshot the 6 logged-in pages (Dashboard/Projects/Project detail/Integrations/Profile/Storyboard Editor) in both Paper and Ink
- [ ] Confirm `voiceover.audio_file` accepts a hosted TTS URL directly (flagged assumption in `generate_voiceover`)
- [ ] Build the auto-follow cursor-point generator and an off-screen DOM-target resolver for the Storyboard Editor (scoped out this session, see §7)
- [ ] Consider a project skill for launching the dev server + driving it with Playwright, via `/run-skill-generator` (none existed before this session, see §7a)
