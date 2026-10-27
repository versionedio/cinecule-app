// secure_write: applies a signed-in person's edits to films, after checking they own the film each edit belongs to.
// Called only by the secure_write logic block, which passes `caller` from the signed session.
//
// This file is the source of the `secure_write` glyph (id 3bd0265b-7380-4878-9411-7d965ca830fa). It is published to
// nostackai with the MCP update_glyph + publish_glyph tools; edit it here first so the code is versioned, then publish.
// Tests: glyphs/secure-write.test.mjs.
//
// A viewer's picture: when the app creates an image source it sends `image_preview`, a small JPEG (base64) of the
// picture. This glyph checks it and stores it on the new source as a data: address (image_preview). It does NOT read it
// here: a vision model needs longer than a glyph's HTTP call may wait (10 s, measured), so the `ingest` logic block,
// which runs in the background after the source is created, has Kimi read it, saves the text as raw_text, and clears
// the preview. The text therefore always comes from the model and never from the browser: any raw_text sent along
// with a preview is dropped. The preview is never handed back to the app.

const MAX_OPS = 25;
const MAX_BYTES = 400000;

// A picture preview, as base64 characters. The whole request may be MAX_BYTES, so this leaves room for the rest of it.
const MAX_PREVIEW = 330000;

// The narration voices the app offers (see src/config/voices.ts). A film may only be pointed at one of these, or at
// nothing (the standard voice), so nobody can aim a film at some other voice on the account.
const ALLOWED_VOICES = new Set([
  "",
  "hpp4J3VqNfWAUOO0d1Us", // Bella
  "Xb7hH8MSUJpSbSDYk0k2", // Alice
  "nPczCjzI2devNBz1zQrb", // Brian
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
  "FGY2WhTYpPnrIDTdsKH5" // Laura
]);

// The shapes a film can be rendered in. A film may ask for any of them, each at most once, or for none (its own shape).
const RENDER_SHAPES = ["16:9", "9:16", "1:1"];
const validShapes = (value) => {
  const text = String(value == null ? "" : value).trim();
  if (text === "") return true;
  const parts = text.split(",").map((s) => s.trim());
  return parts.every((s) => RENDER_SHAPES.includes(s)) && new Set(parts).size === parts.length;
};

const COMMON = ["name", "active"];
const RULES = {
  project: {
    root: true,
    create: true,
    update: true,
    delete: true,
    fields: COMMON.concat([
      "article_content", "video_type", "status", "canvas_aspect_ratio", "custom_canvas_width", "custom_canvas_height",
      "director_camera_intensity", "director_auto_generate_effects", "director_zoom_hold_after_effect_sec",
      "director_camera_move_duration_sec", "cursor_speed", "render_resolution", "render_fps", "error_message", "voice_id",
      "render_aspect_ratios"
    ])
  },
  generatedhtml: { create: true, update: true, delete: true, fields: COMMON.concat(["html_content", "sort_order", "duration", "transition", "transition_duration", "narration_text"]) },
  interaction: { create: true, update: true, delete: true, fields: COMMON.concat(["slide_id", "target_text", "target_selector", "action", "trigger", "time_offset", "duration", "label", "sort_order"]) },
  camerashot: { create: true, update: true, delete: true, fields: COMMON.concat(["slide_id", "label", "start_time", "end_time", "target_selector", "x_percent", "y_percent", "zoom", "transition_duration", "easing", "shot_type"]) },
  videoeffectcue: { create: true, update: true, delete: true, fields: COMMON.concat(["slide_id", "interaction_id", "label", "start_time", "duration", "target_selector", "effect"]) },
  cursortimelinepoint: { create: true, update: true, delete: true, fields: COMMON.concat(["slide_id", "interaction_id", "time", "x_percent", "y_percent", "duration_ms", "click", "label", "source", "selector", "point_role", "sequence_index"]) },
  // A person adds sources to their own film and may remove them; the pipeline is what fills in summaries and status.
  // An image source may carry image_preview (see the top of this file); it is checked here and kept for ingest to read.
  contentsource: { create: true, update: false, delete: true, fields: COMMON.concat(["source_type", "title", "url", "raw_text", "file_key", "file_url", "image_preview"]), forced: { status: "draft" } },
  // Made by the pipeline and the render worker. A person can only clear them away when deleting their film.
  voiceover: { create: false, update: false, delete: true, fields: [] },
  audio: { create: false, update: false, delete: true, fields: [] },
  exportasset: { create: false, update: false, delete: true, fields: [] }
};

class Refused extends Error {}
const refuse = (m) => {
  throw new Refused(m);
};

module.exports.handler = async function (request, ctx) {
  let { caller, ops } = request || {};
  if (typeof ops === "string") {
    try {
      ops = JSON.parse(ops);
    } catch (e) {
      return { ok: false, error: "Couldn't read the changes." };
    }
  }
  if (!caller || typeof caller !== "string") return { ok: false, error: "Not signed in." };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, error: "Nothing to change." };
  if (ops.length > MAX_OPS) return { ok: false, error: "Too many changes at once." };
  if (JSON.stringify(ops).length > MAX_BYTES) return { ok: false, error: "That change is too large." };

  const db = ctx.app_db;
  const projects = new Map(); // project id -> project record, so a batch reads each film once

  // The owner's email comes from the signed session, never from the request, so nobody can aim a film's
  // "your render is ready" email at someone else's inbox.
  const sessionEmail = ctx.user && typeof ctx.user.email === "string" ? ctx.user.email.trim().toLowerCase() : "";

  const loadRecord = async (entity, id) => {
    if (!id || typeof id !== "string") refuse("Missing id.");
    let rec = null;
    try {
      rec = await db.getEntity(entity, id);
    } catch (e) {
      rec = null;
    }
    if (!rec || !rec.id) refuse("Not found.");
    return rec;
  };

  const ownedProject = async (projectId) => {
    if (!projectId || typeof projectId !== "string") refuse("Missing film.");
    let p = projects.get(projectId);
    if (!p) {
      p = await loadRecord("project", projectId);
      projects.set(projectId, p);
    }
    // The same answer for a film that does not exist and one that belongs to someone else.
    if (p.user_id !== caller) refuse("Not found.");
    return p;
  };

  const pick = (rule, fields, what) => {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (!rule.fields.includes(k)) refuse(`That field can't be set here: ${k}.`);
      out[k] = v;
    }
    if (what === "update" && Object.keys(out).length === 0) refuse("Nothing to change.");
    if (rule.root && "voice_id" in out && !ALLOWED_VOICES.has(String(out.voice_id == null ? "" : out.voice_id))) refuse("That voice isn't available.");
    if (rule.root && "render_aspect_ratios" in out && !validShapes(out.render_aspect_ratios)) refuse("Those video shapes aren't available.");
    return out;
  };

  // An image source's preview is checked and kept for `ingest` to read (see the top of this file). Runs only after the
  // film is known to be the caller's.
  const keepPreview = (fields) => {
    const preview = fields.image_preview;
    if (preview === undefined || preview === null || preview === "") {
      delete fields.image_preview;
      return;
    }
    if (fields.source_type !== "image") refuse("Only a picture can carry a preview.");
    if (typeof preview !== "string" || preview.length > MAX_PREVIEW || !/^[A-Za-z0-9+/]+={0,2}$/.test(preview)) refuse("That picture couldn't be read.");
    const head = ctx.lib.buffer.from(preview.slice(0, 8), "base64");
    if (!(head[0] === 0xff && head[1] === 0xd8)) refuse("That picture couldn't be read.");
    fields.image_preview = `data:image/jpeg;base64,${preview}`;
    // What the picture says comes from the model, never from the request.
    delete fields.raw_text;
  };

  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i] || {};
    try {
      const rule = RULES[o.entity];
      if (!rule) refuse("That can't be changed here.");
      if (o.op !== "create" && o.op !== "update" && o.op !== "delete") refuse("Unknown change.");
      if (!rule[o.op]) refuse("That change isn't allowed here.");

      if (o.op === "create") {
        if (rule.root) {
          const fields = Object.assign(pick(rule, o.fields, "create"), rule.forced || {}, { user_id: caller });
          // A new film always starts as a draft; the pipeline moves it on.
          if (fields.status === undefined) fields.status = "draft";
          const stored = sessionEmail ? Object.assign({}, fields, { owner_email: sessionEmail }) : fields;
          const made = await db.createEntity("project", stored);
          const id = made && (made.id || made.entityId);
          if (!id) refuse("Couldn't create that.");
          // The email is stored but never handed back to the app.
          results.push({ ok: true, record: Object.assign({}, fields, { id }) });
        } else {
          await ownedProject(o.project_id);
          const fields = Object.assign(pick(rule, o.fields, "create"), rule.forced || {}, { project_id: o.project_id });
          if (o.entity === "contentsource") keepPreview(fields);
          const made = await db.createEntity(o.entity, fields);
          const id = made && (made.id || made.entityId);
          if (!id) refuse("Couldn't create that.");
          // The stored preview is large and is for ingest only: never hand it back to the app.
          const record = Object.assign({}, fields, { id });
          delete record.image_preview;
          results.push({ ok: true, record });
        }
        continue;
      }

      // update and delete: find the film through the record itself, never through anything the caller says
      const rec = await loadRecord(o.entity, o.id);
      if (rule.root) {
        if (rec.user_id !== caller) refuse("Not found.");
        projects.set(rec.id, rec);
      } else {
        await ownedProject(rec.project_id);
      }

      if (o.op === "update") {
        const fields = pick(rule, o.fields, "update");
        await db.updateEntity(o.entity, o.id, fields);
        results.push({ ok: true, record: Object.assign({}, fields, { id: o.id }) });
      } else {
        await db.deleteEntity(o.entity, o.id);
        results.push({ ok: true, id: o.id });
      }
    } catch (e) {
      const message = e instanceof Refused ? e.message : "That didn't go through.";
      if (!(e instanceof Refused)) ctx.log("secure_write failed", { entity: o.entity, op: o.op, message: String((e && e.message) || e).slice(0, 200) });
      // Stop at the first problem: later changes in the same batch may depend on this one.
      return { ok: false, error: message, failedAt: i, done: results };
    }
  }
  return { ok: true, results };
};
