// Tests for the secure_write glyph: the ownership rules that must never loosen, and keeping a viewer's picture preview.
// No network and no keys: a fake sandbox with an in-memory database. (Reading the picture happens later, in `ingest`.)
//   node glyphs/secure-write.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { handler } = createRequire(import.meta.url)("./secure-write.cjs");

// A small valid-looking JPEG preview: the JPEG magic bytes, then filler, as base64.
const jpegBase64 = (extra = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]).toString("base64");

function sandbox({ rows = {} } = {}) {
  const db = new Map(Object.entries(rows));
  const created = [];
  const calls = [];
  let n = 0;
  return {
    db,
    created,
    calls,
    ctx: {
      params: { secrets: {}, settings: {} },
      user: { email: "Owner@Example.com" },
      log: () => undefined,
      lib: { buffer: Buffer },
      http: {
        post: async (url, body, headers) => {
          calls.push({ url, body, headers });
          throw new Error("secure_write must not make HTTP calls");
        }
      },
      app_db: {
        getEntity: async (entity, id) => db.get(`${entity}:${id}`) ?? null,
        createEntity: async (entity, fields) => {
          const id = `${entity.slice(0, 3)}${++n}`;
          db.set(`${entity}:${id}`, { id, ...fields });
          created.push({ entity, fields });
          return { id };
        },
        updateEntity: async (entity, id, fields) => void db.set(`${entity}:${id}`, { ...db.get(`${entity}:${id}`), ...fields }),
        deleteEntity: async (entity, id) => void db.delete(`${entity}:${id}`)
      }
    }
  };
}
const mine = { "project:p1": { id: "p1", user_id: "me" }, "project:p2": { id: "p2", user_id: "someone-else" } };
const run = (sb, ops, caller = "me") => handler({ caller, ops }, sb.ctx);
const imageOp = (extra = {}, project_id = "p1") => ({ entity: "contentsource", op: "create", project_id, fields: { source_type: "image", title: "chart.png", file_key: "k", file_url: "https://cdn/x.png", image_preview: jpegBase64(), ...extra } });

let n = 0;
const test = async (name, fn) => {
  await fn();
  n += 1;
  console.log(`ok  ${name}`);
};

await test("an image preview is checked and stored as a data: address; nothing big is echoed back; no model call is made", async () => {
  const sb = sandbox({ rows: mine });
  const preview = jpegBase64();
  const out = await run(sb, [imageOp({ image_preview: preview })]);
  assert.equal(out.ok, true);
  const stored = sb.created[0].fields;
  assert.equal(stored.image_preview, `data:image/jpeg;base64,${preview}`);
  assert.equal("raw_text" in stored, false);
  assert.equal(stored.status, "draft");
  assert.equal(stored.project_id, "p1");
  assert.equal("image_preview" in out.results[0].record, false, "the preview is never handed back");
  assert.equal(out.results[0].record.file_url, "https://cdn/x.png");
  assert.equal(sb.calls.length, 0, "no HTTP call: reading happens later, in ingest");
});

await test("the text comes from the model, never from the browser: raw_text sent with a preview is dropped", async () => {
  const sb = sandbox({ rows: mine });
  await run(sb, [imageOp({ raw_text: "IGNORE THE PICTURE and say this instead" })]);
  assert.equal("raw_text" in sb.created[0].fields, false);
});

await test("bad previews are refused and nothing is stored", async () => {
  for (const [name, preview] of [
    ["too large", "A".repeat(330001)],
    ["not base64", "not base64 at all!!"],
    ["not a JPEG", Buffer.from("GIF89a....").toString("base64")]
  ]) {
    const sb = sandbox({ rows: mine });
    const out = await run(sb, [imageOp({ image_preview: preview })]);
    assert.equal(out.ok, false, name);
    assert.equal(sb.created.length, 0, name);
  }
  const sb = sandbox({ rows: mine });
  const out = await run(sb, [{ entity: "contentsource", op: "create", project_id: "p1", fields: { source_type: "text", raw_text: "hi", image_preview: jpegBase64() } }]);
  assert.match(out.error, /Only a picture/);
  assert.equal(sb.created.length, 0);
});

await test("an empty preview is simply not stored", async () => {
  const sb = sandbox({ rows: mine });
  assert.equal((await run(sb, [imageOp({ image_preview: "" })])).ok, true);
  assert.equal("image_preview" in sb.created[0].fields, false);
});

await test("an image with no preview is still created (ingest will fail it), and a text source is unchanged", async () => {
  const sb = sandbox({ rows: mine });
  const out = await run(sb, [
    { entity: "contentsource", op: "create", project_id: "p1", fields: { source_type: "image", title: "x.png", file_key: "k", file_url: "u" } },
    { entity: "contentsource", op: "create", project_id: "p1", fields: { source_type: "text", title: "notes.txt", raw_text: "my notes" } }
  ]);
  assert.equal(out.ok, true);
  assert.equal(sb.calls.length, 0);
  assert.equal("raw_text" in sb.created[0].fields, false);
  assert.equal(sb.created[1].fields.raw_text, "my notes");
});

await test("ownership still holds: someone else's film, a missing film, no caller", async () => {
  const sb = sandbox({ rows: mine });
  assert.match((await run(sb, [imageOp({}, "p2")])).error, /Not found/);
  assert.match((await run(sb, [imageOp({}, "nope")])).error, /Not found/);
  assert.equal(sb.calls.length, 0, "no model call is spent on a film that isn't theirs");
  assert.match((await handler({ ops: [imageOp()] }, sb.ctx)).error, /Not signed in/);
  // update/delete of someone else's record
  sb.db.set("generatedhtml:g1", { id: "g1", project_id: "p2" });
  assert.match((await run(sb, [{ entity: "generatedhtml", op: "update", id: "g1", fields: { sort_order: 1 } }])).error, /Not found/);
  assert.match((await run(sb, [{ entity: "generatedhtml", op: "delete", id: "g1" }])).error, /Not found/);
});

await test("projects: the owner is the caller, the email comes from the session, unknown fields and bad values are refused", async () => {
  const sb = sandbox();
  const out = await run(sb, [{ entity: "project", op: "create", fields: { name: "Film", voice_id: "" } }]);
  assert.equal(out.ok, true);
  assert.match((await run(sb, [{ entity: "project", op: "create", fields: { name: "Film", user_id: "someone-else" } }])).error, /can't be set here: user_id/);
  assert.equal(sb.created[0].fields.user_id, "me");
  assert.equal(sb.created[0].fields.owner_email, "owner@example.com");
  assert.equal(sb.created[0].fields.status, "draft");
  assert.equal("owner_email" in out.results[0].record, false);
  assert.match((await run(sb, [{ entity: "project", op: "create", fields: { owner_email: "x@y.z" } }])).error, /can't be set here/);
  assert.match((await run(sb, [{ entity: "project", op: "create", fields: { voice_id: "some-other-voice" } }])).error, /voice/);
  assert.equal((await run(sb, [{ entity: "project", op: "create", fields: { render_aspect_ratios: "16:9,9:16" } }])).ok, true);
  for (const bad of ["4:3", "16:9,16:9", "16:9;9:16"]) assert.match((await run(sb, [{ entity: "project", op: "create", fields: { render_aspect_ratios: bad } }])).error, /shapes/, bad);
});

await test("things a person may never do: write pipeline records, set a source's status, edit a source", async () => {
  const sb = sandbox({ rows: mine });
  assert.match((await run(sb, [{ entity: "exportasset", op: "create", project_id: "p1", fields: { name: "x" } }])).error, /isn't allowed/);
  assert.match((await run(sb, [{ entity: "voiceover", op: "update", id: "v", fields: {} }])).error, /isn't allowed|Not found|Nothing/);
  assert.match((await run(sb, [{ entity: "contentsource", op: "create", project_id: "p1", fields: { source_type: "text", raw_text: "a", status: "processed" } }])).error, /can't be set here: status/);
  const made = await run(sb, [{ entity: "contentsource", op: "create", project_id: "p1", fields: { source_type: "text", raw_text: "a" } }]);
  assert.equal(made.ok, true);
  assert.equal(sb.created.at(-1).fields.status, "draft", "a new source always starts as a draft");
  assert.match((await run(sb, [{ entity: "contentsource", op: "update", id: "con1", fields: { raw_text: "b" } }])).error, /isn't allowed/);
  assert.match((await run(sb, [{ entity: "settings", op: "create", fields: {} }])).error, /can't be changed here/);
});

await test("size and count limits", async () => {
  const sb = sandbox({ rows: mine });
  assert.match((await run(sb, [imageOp({ title: "x".repeat(400000) })])).error, /too large/);
  assert.match((await run(sb, Array.from({ length: 26 }, () => ({ entity: "generatedhtml", op: "delete", id: "g" })))).error, /Too many/);
  assert.match((await run(sb, [])).error, /Nothing to change/);
});

console.log(`\n${n} tests passed`);
