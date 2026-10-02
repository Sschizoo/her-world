#!/usr/bin/env node
/* GPT surrogate QA only. No provider client, real credentials, or network.
 * init --dir DIR
 * apply --dir DIR --response RAW.txt [--next-input TEXT]
 * prompt --dir DIR --input TEXT  (or --opening true to retry an opening)
 * build-page --dir DIR [--out tests/model-playback.html]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('./fixtures/surrogate-vm.cjs');
const { inspectSources } = require('./fixtures/surrogate-sources.cjs');
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const parse = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function options(argv) { const result = {}; for (let index = 0; index < argv.length; index += 2) { if (!argv[index].startsWith('--') || argv[index + 1] === undefined) throw new Error('Options require --name value'); result[argv[index].slice(2)] = argv[index + 1]; } return result; }
function summary(result) { return { started: result.state.started, events: result.state.events.length, rain: result.view.rain, name: result.view.name, milestones: result.view.milestones, objects: result.view.scene?.objects || [], annotations: result.view.scene?.annotations || [], memoryContext: result.view.memoryContext }; }
function saveSession(dir, session) { fs.writeFileSync(path.join(dir, 'session.json'), json(session)); fs.writeFileSync(path.join(dir, 'state.json'), json(session.state)); }
async function capture(dir, session, pending) {
  const result = await run({ sourceDir: path.join(dir, 'production'), state: session.state, pending });
  if (session.state === null) session.state = result.state;
  const file = `request-${String(session.records.length).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(dir, file), json(result.body));
  fs.writeFileSync(path.join(dir, 'request.json'), json(result.body));
  session.pending = { ...pending, requestFile: file, requestSha256: hash(json(result.body)) };
  saveSession(dir, session);
  return { request: path.join(dir, 'request.json'), input: pending.opening ? '[opening]' : pending.input, messages: result.body.messages.length };
}

async function main(argv) {
  const [command, ...rest] = argv, flags = options(rest);
  const dir = path.resolve(flags.dir || path.join(root, '..', '.qa', 'gpt-surrogate'));
  if (command === 'init') {
    if (fs.existsSync(path.join(dir, 'session.json'))) throw new Error('Session exists; use a new --dir to start fresh without overwriting evidence');
    fs.mkdirSync(path.join(dir, 'production'), { recursive: true });
    const hashes = {};
    for (const name of inspectSources(root).files) { const bytes = fs.readFileSync(path.join(root, name)); fs.writeFileSync(path.join(dir, 'production', name), bytes); hashes[name] = hash(bytes); }
    for (const [name, expected] of Object.entries(hashes)) if (hash(fs.readFileSync(path.join(root, name))) !== expected) throw new Error(`Production changed while snapshotting: ${name}. Retry after sources settle.`);
    const session = { version: 1, kind: 'GPT surrogate fixture replay; not a live provider test', createdAt: new Date().toISOString(), productionHashes: hashes, state: null, records: [], pending: null };
    console.log(json({ initialized: dir, next: await capture(dir, session, { opening: true, input: '' }) }));
    return;
  }
  const session = parse(path.join(dir, 'session.json'));
  if (session.stale) throw new Error(`This run is stale: ${session.staleReason || 'production runtime has changed'}. Initialize a new directory after the new runtime is ready.`);
  for (const [name, expected] of Object.entries(session.productionHashes)) if (hash(fs.readFileSync(path.join(dir, 'production', name))) !== expected) throw new Error(`Captured production source changed: ${name}`);
  if (command === 'prompt') {
    if (session.pending) throw new Error('A captured request is pending; apply its raw response first');
    if (flags.opening === 'true') {
      if (session.state.started) throw new Error('Opening is already accepted');
      console.log(json({ next: await capture(dir, session, { opening: true, input: '' }) }));
    } else {
      if (!session.state.started) throw new Error('Apply a successful opening first, or capture a retry with --opening true');
      if (typeof flags.input !== 'string') throw new Error('--input is required');
      console.log(json({ next: await capture(dir, session, { opening: false, input: flags.input }) }));
    }
  } else if (command === 'apply') {
    if (!session.pending || !flags.response) throw new Error('A pending request and --response RAW.txt are required');
    const rawBytes = fs.readFileSync(path.resolve(flags.response));
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    if (!Buffer.from(raw, 'utf8').equals(rawBytes)) throw new Error('Raw file must be lossless UTF-8 (no BOM stripping or encoding conversion)');
    const pending = session.pending;
    const result = await run({ sourceDir: path.join(dir, 'production'), state: session.state, pending, raw });
    if (hash(json(result.body)) !== pending.requestSha256) throw new Error('Actual request differs from the captured request; raw response was not recorded');
    const index = session.records.length, rawFile = `response-${String(index).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(dir, rawFile), rawBytes);
    const record = { index, opening: pending.opening, input: pending.input, requestFile: pending.requestFile, rawFile, rawSha256: hash(rawBytes), accepted: result.accepted, error: result.error, beforeStateSha256: hash(json(session.state)), afterStateSha256: hash(json(result.state)), stateAfter: result.state, stateSummary: summary(result) };
    session.records.push(record); session.state = result.state; session.pending = null;
    saveSession(dir, session);
    fs.writeFileSync(path.join(dir, `result-${String(index).padStart(3, '0')}.json`), json({ ...record, transcript: result.transcript }));
    let next = null;
    if (flags['next-input'] !== undefined && session.state.started) next = await capture(dir, session, { opening: false, input: flags['next-input'] });
    console.log(json({ accepted: result.accepted, error: result.error, rawSha256: record.rawSha256, state: record.stateSummary, next }));
  } else if (command === 'build-page') {
    const { buildPage } = require('./fixtures/surrogate-page.cjs');
    const out = path.resolve(flags.out || path.join(__dirname, 'model-playback.html'));
    const html = buildPage(dir, session);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
    console.log(json({ page: out, records: session.records.length, bytes: Buffer.byteLength(html), network: 'blocked by CSP; fetch returns only recorded fixture strings', storage: 'in-memory only' }));
  } else throw new Error('Use init, prompt, apply, or build-page; see the file header for arguments');
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
