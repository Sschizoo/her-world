/* Source-scoped recall policy. No IO, model calls, audit mutation or semantic matching.
 * Runtime integration: project the pre-turn context, pass its opaque exposure to
 * every generated record, and keep this sidecar out of both model messages.
 * Precise spans use Unicode code points. Unstructured sources suppress their
 * whole turn; missing legacy dependencies suppress their derived recall after
 * any deletion. Current visible objects/weather and story progression survive.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerMemoryPolicy = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const SCHEMA = 'her-world-memory-policy-v1';
  const kinds = ['concept', 'preference', 'experience', 'promise', 'note'];
  const perspectives = ['player_report', 'shared_event', 'character_interpretation'];
  const kindTitles = { concept: '概念', preference: '偏好', experience: '经历', promise: '约定', note: '笔记' };
  // 1000 turns * (12 operations * 3 tracked generated fields + 4 lines),
  // plus all 64 once-completed nodes' <=128 facts and initial/import records.
  // <=8384 facts +64 answers +80 annotations +28 note fields +16 object
  // sources +3 role fields +weather +12 transcript entries fit below9000.
  const limits = { records: 50000, directReferences: 512, directDependencies: 9000, tombstones: 12000 };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o));
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  const requireThat = (value, code) => { if (!value) fail(code); };
  const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,180}$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
  const noteId = value => typeof value === 'string' && /^note_[a-z0-9_]{1,32}$/u.test(value);
  const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && [...value].length <= max && !/[\x00-\x1f\x7f]/u.test(value);
  const exactFields = (value, allowed, required = allowed) => plain(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => allowed.includes(key));
  const unique = values => [...new Set(values)];
  const exposures = new WeakMap();
  const sharedEvents = new WeakMap();
  const trustedPolicies = new WeakSet();
  const recordIndexes = new WeakMap();
  const sealPolicy = value => { freeze(value); trustedPolicies.add(value); return value; };
  const recordIds = freeze({
    memory: (id, generation) => `memory:${id}:${generation}`,
    memoryTitle: (id, generation) => `memory:${id}:${generation}:title`,
    transcript: (eventId, role, line = 0) => `transcript:${eventId}:${role}:${line}`,
    objectSource: (id, field) => `object:${id}:source:${field}`,
    annotation: (id, field) => `annotation:${id}:${field}`,
    weatherSource: () => 'weather:source',
    character: field => `character:${field}`,
    answer: id => `answer:${id}`,
    fact: key => `fact:${key}`
  });
  function createPolicy() { return sealPolicy({ schema: SCHEMA, generations: {}, active: {}, records: {}, bindings: {}, nextRecord: 1, handles: {}, nextHandle: 1, tombstones: [] }); }
  function normalizeSource(value) {
    requireThat(exactFields(value, ['eventId', 'channel', 'start', 'end'], ['eventId', 'channel']) && safeId(value.eventId) && ['player', 'character', 'operation', 'legacy'].includes(value.channel), 'RECALL_SOURCE_INVALID');
    const span = own(value, 'start') || own(value, 'end');
    requireThat(!span || Number.isInteger(value.start) && Number.isInteger(value.end) && value.start >= 0 && value.end > value.start && value.end <= 5000, 'RECALL_SPAN_INVALID');
    return { eventId: value.eventId, channel: value.channel, ...(span ? { start: value.start, end: value.end } : {}) };
  }
  const normalizeSources = (values, maximum = limits.directReferences) => {
    requireThat(Array.isArray(values), 'RECALL_SOURCE_INVALID');
    const result = [...new Map(values.map(value => { const source = normalizeSource(value); return [JSON.stringify(source), source]; })).values()];
    requireThat(result.length <= maximum, 'RECALL_CAPACITY');
    return result;
  };
  function validatePolicy(policy) {
    if (trustedPolicies.has(policy)) return policy;
    requireThat(exactFields(policy, ['schema', 'generations', 'active', 'records', 'bindings', 'nextRecord', 'handles', 'nextHandle', 'tombstones']) && policy.schema === SCHEMA && plain(policy.generations) && plain(policy.active) && plain(policy.records) && plain(policy.bindings) && plain(policy.handles) && Number.isInteger(policy.nextHandle) && policy.nextHandle >= 1 && Array.isArray(policy.tombstones) && Number.isInteger(policy.nextRecord) && policy.nextRecord >= 1, 'RECALL_POLICY_INVALID');
    requireThat(Object.keys(policy.records).length <= limits.records && policy.tombstones.length <= limits.tombstones, 'RECALL_CAPACITY');
    for (const [id, generation] of Object.entries(policy.generations)) requireThat(noteId(id) && Number.isInteger(generation) && generation >= 1, 'RECALL_POLICY_INVALID');
    for (const [id, record] of Object.entries(policy.records)) {
      const number = Number(id.slice(7));
      requireThat(/^record_[1-9][0-9]*$/u.test(id) && number < policy.nextRecord && exactFields(record, ['ownSources', 'sources', 'dependencies', 'previous']) && Array.isArray(record.dependencies) && record.dependencies.length <= limits.directDependencies, 'RECALL_POLICY_INVALID');
      for (const dependency of [...record.dependencies, ...(record.previous ? [record.previous] : [])]) requireThat(own(policy.records, dependency) && Number(dependency.slice(7)) < number, 'RECALL_DAG_INVALID');
      requireThat(record.previous === null || typeof record.previous === 'string', 'RECALL_DAG_INVALID');
      normalizeSources(record.ownSources);
      normalizeSources(record.sources);
    }
    for (const [id, target] of Object.entries(policy.bindings)) requireThat(safeId(id) && own(policy.records, target), 'RECALL_POLICY_INVALID');
    const handleValues = Object.values(policy.handles);
    requireThat(new Set(handleValues).size === handleValues.length && Object.entries(policy.handles).every(([id, handle]) => safeId(id) && /^memory_[1-9][0-9]*$/u.test(handle) && Number(handle.slice(7)) < policy.nextHandle), 'RECALL_POLICY_INVALID');
    for (const [id, value] of Object.entries(policy.active)) requireThat(noteId(id) && exactFields(value, ['generation', 'revision', 'origin', 'recordId']) && value.generation === policy.generations[id] && Number.isInteger(value.revision) && value.revision >= 1 && safeId(value.recordId) && own(policy.records, value.recordId) && (value.origin === null || plain(value.origin)), 'RECALL_POLICY_INVALID');
    for (const item of policy.tombstones) {
      requireThat(exactFields(item, ['noteId', 'generation', 'removedAt', 'recordId', 'sources']) && noteId(item.noteId) && Number.isInteger(item.generation) && item.generation >= 1 && safeId(item.removedAt) && safeId(item.recordId), 'RECALL_POLICY_INVALID');
      normalizeSources(item.sources, limits.records);
    }
    return policy;
  }
  function sourceSpan(eventId, input, start = 0, end = [...String(input)].length) {
    requireThat(typeof input === 'string' && safeId(eventId) && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= [...input].length, 'MEMORY_SUPPORT_INVALID');
    return freeze({ eventId, channel: 'player', start, end });
  }
  function withHandle(policy, id, generation) {
    const key = recordIds.memory(id, generation);
    if (own(policy.handles, key)) return policy;
    return { ...policy, handles: { ...policy.handles, [key]: 'memory_' + policy.nextHandle }, nextHandle: policy.nextHandle + 1 };
  }
  function resolveHandle(policy, handle) {
    validatePolicy(policy);
    if (typeof handle !== 'string' || !/^memory_[1-9][0-9]*$/u.test(handle)) return null;
    return Object.keys(policy.active).find(id => policy.handles[recordIds.memory(id, policy.active[id].generation)] === handle) || null;
  }
  function currentSupport(eventId, input, supplied) {
    requireThat(typeof input === 'string' && text(input, 200), 'MEMORY_SUPPORT_INVALID');
    requireThat(supplied === undefined || exactFields(supplied, ['start', 'end', 'quote'], ['quote']) && text(supplied.quote, 200) && own(supplied, 'start') === own(supplied, 'end'), 'MEMORY_SUPPORT_INVALID');
    let start = supplied?.start, end = supplied?.end;
    if (supplied && start === undefined) {
      const haystack = [...input], needle = [...supplied.quote], matches = [];
      for (let index = 0; index <= haystack.length - needle.length; index++) if (needle.every((character, offset) => haystack[index + offset] === character)) matches.push(index);
      requireThat(matches.length > 0, 'MEMORY_SUPPORT_INVALID');
      requireThat(matches.length === 1, 'MEMORY_SUPPORT_AMBIGUOUS');
      start = matches[0]; end = start + needle.length;
    }
    const source = sourceSpan(eventId, input, start ?? 0, end ?? [...input].length);
    const quote = [...input].slice(source.start, source.end).join('');
    requireThat(supplied === undefined || supplied.quote === quote, 'MEMORY_SUPPORT_INVALID');
    return freeze({ ...source, quote });
  }
  // Runtime calls this only for an operation it has already locally applied.
  // The supplied values are its validated result, not a model-authored claim.
  function sharedEventFromOperation(eventId, index, operation) {
    requireThat(safeId(eventId) && Number.isInteger(index) && index >= 0 && index < 12 && plain(operation), 'MEMORY_SHARED_EVENT_UNVERIFIED');
    const verbs = { 'world.create': '创建', 'world.update': '修改', 'world.remove': '移除' };
    let summary, target = null;
    if (own(verbs, operation.type)) {
      requireThat(/^obj_[1-9][0-9]*$/u.test(operation.target) && text(operation.label, 40), 'MEMORY_SHARED_EVENT_UNVERIFIED');
      target = operation.target; summary = `一起${verbs[operation.type]}了世界中的「${operation.label}」`;
    } else {
      requireThat(operation.type === 'weather.set', 'MEMORY_SHARED_EVENT_UNVERIFIED');
      summary = '一起调整了世界里的天气';
    }
    const token = freeze({ summary });
    sharedEvents.set(token, freeze({ eventId, index, type: operation.type, ...(target ? { target } : {}) }));
    return token;
  }
  function validateMemoryMetadata(operation, { eventId, input, sharedEvent = null } = {}) {
    requireThat(plain(operation) && noteId(operation.id) && text(operation.title, 60) && text(operation.body, 240) && typeof input === 'string' && text(input, 200), 'MEMORY_INVALID');
    const kind = operation.kind ?? 'note', perspective = operation.perspective ?? 'character_interpretation';
    requireThat(kinds.includes(kind) && perspectives.includes(perspective), 'MEMORY_METADATA_INVALID');
    const support = currentSupport(eventId, input, operation.support), quote = support.quote;
    // A report is an exact attributed quotation, never an inferred diagnosis,
    // preference or trait. Summaries belong to character_interpretation.
    requireThat(perspective !== 'player_report' || operation.body === quote, 'MEMORY_CLAIM_INVALID');
    const event = sharedEvents.get(sharedEvent);
    requireThat(perspective !== 'shared_event' || event?.eventId === eventId && operation.body === sharedEvent.summary, 'MEMORY_SHARED_EVENT_UNVERIFIED');
    return freeze({ kind, perspective, support, ...(perspective === 'shared_event' ? { eventSupport: event } : {}) });
  }
  function captured(exposure) {
    if (exposure === null || exposure === undefined) return { records: [], sources: [] };
    requireThat(exposures.has(exposure), 'RECALL_EXPOSURE_INVALID');
    return exposures.get(exposure);
  }
  function recordDerivation(policy, recordId, { sources = [], exposure = null, retain = false } = {}) {
    validatePolicy(policy); requireThat(safeId(recordId), 'RECALL_RECORD_INVALID');
    const retrieved = captured(exposure), previous = retain ? policy.bindings[recordId] || null : null;
    const sortedSources = values => normalizeSources(values).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const node = {
      ownSources: sortedSources(sources), sources: sortedSources(retrieved.sources),
      dependencies: unique(retrieved.records).sort(), previous
    };
    requireThat(node.dependencies.length <= limits.directDependencies && node.dependencies.every(id => own(policy.records, id)), 'RECALL_EXPOSURE_INVALID');
    // Equal provenance is shared across bindings, including hundreds of facts
    // from one checkpoint. All fields, including the audit previous link, are
    // part of equality. The index is transient and never serialized.
    let index = recordIndexes.get(policy.records);
    if (!index) { index = new Map(); for (const [id, existing] of Object.entries(policy.records)) index.set(JSON.stringify(existing), id); recordIndexes.set(policy.records, index); }
    const signature = JSON.stringify(node), candidate = index.get(signature);
    let nodeId = candidate && own(policy.records, candidate) && JSON.stringify(policy.records[candidate]) === signature ? candidate : null;
    const next = { ...policy, bindings: { ...policy.bindings } };
    if (!nodeId) {
      requireThat(Object.keys(policy.records).length < limits.records, 'RECALL_CAPACITY');
      nodeId = 'record_' + next.nextRecord++;
      next.records = { ...policy.records, [nodeId]: node };
      // A discarded speculative branch must not change the parent's cached
      // signature mapping: the same node ID can mean something else there.
      const branchIndex = new Map(index);
      branchIndex.set(signature, nodeId); recordIndexes.set(next.records, branchIndex);
    }
    next.bindings[recordId] = nodeId;
    return sealPolicy(next);
  }
  function upsertMemory(policy, operation, options) {
    validatePolicy(policy);
    const metadata = validateMemoryMetadata(operation, options), previous = policy.active[operation.id];
    const generation = previous?.generation || (policy.generations[operation.id] || 0) + 1;
    const revision = (previous?.revision || 0) + 1, recordId = recordIds.memory(operation.id, generation);
    const support = normalizeSource({ eventId: metadata.support.eventId, channel: 'player', start: metadata.support.start, end: metadata.support.end });
    // Exact player quotations are independently grounded in this current input.
    // Interpretations/shared events can depend on everything actually retrieved.
    let derived = recordDerivation(policy, recordId, { sources: [support, ...(metadata.eventSupport ? [{ eventId: options.eventId, channel: 'operation' }] : [])], exposure: metadata.perspective === 'player_report' ? null : options.exposure, retain: true });
    const literalTitle = metadata.support.quote.includes(operation.title) || operation.title === kindTitles[metadata.kind];
    derived = recordDerivation(derived, recordIds.memoryTitle(operation.id, generation), { sources: [support], exposure: literalTitle ? null : options.exposure });
    const next = { ...derived, generations: { ...derived.generations }, active: { ...derived.active } };
    const current = { eventId: options.eventId, text: options.input, span: { start: support.start, end: support.end } };
    const origin = previous ? previous.origin : current;
    next.generations[operation.id] = generation;
    next.active[operation.id] = { generation, revision, origin, recordId: next.bindings[recordId] };
    const note = { id: operation.id, title: operation.title, body: operation.body, ...metadata, generation, source: copy(origin), currentRevision: { ...current, number: revision } };
    return freeze({ policy: sealPolicy(withHandle(next, operation.id, generation)), note });
  }
  function sourceFromObject(source) {
    if (!plain(source) || !safeId(source.eventId)) return [];
    const ref = { eventId: source.eventId, channel: source.eventId === 'legacy' ? 'legacy' : 'player' };
    if (plain(source.span)) { ref.start = source.span.start; ref.end = source.span.end; }
    try { return [normalizeSource(ref)]; } catch { return [{ eventId: source.eventId, channel: ref.channel }]; }
  }
  // Call only while importing a runtime-validated legacy snapshot. This keeps
  // its historical origin/revision without pretending its old derivations are
  // known. A legacy source is intentionally a coarse shared recall boundary.
  function importMemory(policy, note) {
    validatePolicy(policy);
    requireThat(plain(note) && noteId(note.id) && text(note.title, 60) && text(note.body, 240) && !own(policy.generations, note.id), 'MEMORY_IMPORT_INVALID');
    const sourceRefs = [...sourceFromObject(note.source), ...sourceFromObject(note.currentRevision)];
    requireThat(sourceRefs.every(ref => ref.eventId === 'legacy'), 'MEMORY_IMPORT_INVALID');
    const recordId = recordIds.memory(note.id, 1), revision = note.currentRevision?.number || 1;
    requireThat(Number.isInteger(revision) && revision >= 1, 'MEMORY_IMPORT_INVALID');
    const derived = recordDerivation(policy, recordId, { sources: sourceRefs.length ? sourceRefs : [{ eventId: 'legacy', channel: 'legacy' }] });
    const next = { ...derived, generations: { ...derived.generations }, active: { ...derived.active } };
    next.generations[note.id] = 1;
    next.active[note.id] = { generation: 1, revision, origin: note.source == null ? null : copy(note.source), recordId: next.bindings[recordId] };
    return sealPolicy(withHandle(next, note.id, 1));
  }
  // Historical rules keep their own note projection byte-for-byte. Rebuild
  // only provenance from validated replay operations, not a supplied save
  // sidecar. Old removals were not forgetting requests under this policy.
  function trackHistoricalMemory(policy, note, { eventId, input, exposure = null } = {}) {
    validatePolicy(policy);
    requireThat(plain(note) && noteId(note.id) && text(note.title, 60) && text(note.body, 240), 'MEMORY_IMPORT_INVALID');
    const generation = policy.active[note.id]?.generation || policy.generations[note.id] || 1;
    const revision = note.currentRevision?.number || 1, recordId = recordIds.memory(note.id, generation);
    requireThat(Number.isInteger(revision) && revision >= 1, 'MEMORY_IMPORT_INVALID');
    const derived = recordDerivation(policy, recordId, { sources: [sourceSpan(eventId, input)], exposure, retain: true });
    const next = { ...derived, generations: { ...derived.generations }, active: { ...derived.active } };
    next.generations[note.id] = generation;
    next.active[note.id] = { generation, revision, origin: note.source == null ? null : copy(note.source), recordId: next.bindings[recordId] };
    return sealPolicy(withHandle(next, note.id, generation));
  }
  function dropHistoricalMemory(policy, id) {
    validatePolicy(policy); requireThat(noteId(id), 'MEMORY_REMOVE_INVALID');
    const next = { ...policy, active: { ...policy.active } };
    delete next.active[id];
    return sealPolicy(next);
  }
  function forgetMemory(policy, note, { eventId, input, support } = {}) {
    validatePolicy(policy); requireThat(plain(note) && noteId(note.id) && safeId(eventId), 'MEMORY_REMOVE_INVALID');
    const active = policy.active[note.id];
    const generation = active?.generation || note.generation || policy.generations[note.id] || 1;
    requireThat(Number.isInteger(generation) && generation >= 1 && (!active || note.generation === undefined || note.generation === active.generation), 'MEMORY_STALE_GENERATION');
    const recordId = policy.bindings[recordIds.memory(note.id, generation)] || recordIds.memory(note.id, generation);
    requireThat(!policy.tombstones.some(item => item.noteId === note.id && item.generation === generation), 'MEMORY_ALREADY_REMOVED');
    // Block only this note's own support, not everything it happened to read.
    const ownSupport = note.support ? [normalizeSource({ eventId: note.support.eventId, channel: note.support.channel, start: note.support.start, end: note.support.end })] : [];
    const origins = [...sourceFromObject(note.source), ...sourceFromObject(note.currentRevision), ...ownSupport];
    for (let current = policy.records[recordId]; current; current = current.previous ? policy.records[current.previous] : null) origins.push(...current.ownSources);
    // Imported notes can have entirely missing provenance. There is then no
    // safe way to distinguish their old transcript passages from other legacy
    // recall. Current, independently sourced player input remains available.
    if (!origins.length) origins.push({ eventId: 'legacy', channel: 'legacy' });
    const next = { ...policy, generations: { ...policy.generations }, active: { ...policy.active }, tombstones: [...policy.tombstones] };
    next.generations[note.id] = generation;
    delete next.active[note.id];
    requireThat(next.tombstones.length < limits.tombstones, 'RECALL_CAPACITY');
    const removal = support === undefined ? { eventId, channel: 'player' } : currentSupport(eventId, input, support);
    const removalSource = { eventId, channel: 'player', ...(removal.start === undefined ? {} : { start: removal.start, end: removal.end }) };
    next.tombstones.push({ noteId: note.id, generation, removedAt: eventId, recordId, sources: normalizeSources([...origins, removalSource], limits.records) });
    return sealPolicy(next);
  }
  function overlap(a, b) {
    if (a.eventId !== b.eventId) return false;
    if (a.channel !== b.channel && a.channel !== 'legacy' && b.channel !== 'legacy') return false;
    return a.start === undefined || b.start === undefined || a.start < b.end && b.start < a.end;
  }
  function blocker(policy) {
    const roots = policy.tombstones.flatMap(item => item.sources), blocked = new Set(policy.tombstones.map(item => item.recordId));
    const blockedSources = values => values.some(value => roots.some(root => overlap(value, root)));
    // Immutable node IDs increase monotonically; dependencies only point back.
    // previous is solely an audit/revision link, not a retrieval dependency.
    // Fresh, exact current evidence can rehabilitate the present body while
    // future deletion still walks every historical revision's ownSources.
    for (const [id, record] of Object.entries(policy.records).sort((a, b) => Number(a[0].slice(7)) - Number(b[0].slice(7)))) if (blockedSources(record.ownSources) || blockedSources(record.sources) || record.dependencies.some(ref => blocked.has(ref))) blocked.add(id);
    return { blocked, blockedSources };
  }
  function projectContext(raw, policy) {
    validatePolicy(policy); requireThat(plain(raw) && raw.schema === 'her-world-context-v1' && plain(raw.world) && plain(raw.character), 'RECALL_CONTEXT_INVALID');
    const { blocked, blockedSources } = blocker(policy), hasDeletion = policy.tombstones.length > 0;
    const exposedRecords = [], exposedSources = [];
    const allowed = (id, fallback = [], unknown = false) => {
      const nodeId = policy.bindings[id], record = policy.records[nodeId];
      if (blocked.has(nodeId || id) || !record && blockedSources(fallback) || !record && unknown && hasDeletion) return false;
      if (record) exposedRecords.push(nodeId);
      else exposedSources.push(...fallback);
      return true;
    };
    const sourceProjection = (source, id, alternate = null) => {
      if (source === null || source === undefined) return null;
      const refs = sourceFromObject(source);
      if (!allowed(id, refs, !refs.length)) return null;
      if (typeof source.text !== 'string') return null;
      let span = source.span || alternate;
      if (!span) {
        const local = policy.records[policy.bindings[id]]?.ownSources.filter(ref => ref.eventId === source.eventId && ref.channel === 'player');
        if (local?.length === 1 && local[0].start !== undefined) span = local[0];
      }
      // Never return the complete mixed input behind a narrow supported field.
      const actual = { eventId: source.eventId, channel: source.eventId === 'legacy' ? 'legacy' : 'player', ...(span ? { start: span.start, end: span.end } : {}) };
      if (blockedSources([actual])) return null;
      return { eventId: source.eventId, text: span ? [...source.text].slice(span.start, span.end).join('') : source.text, ...(span ? { span: { start: span.start, end: span.end } } : {}), ...(Number.isInteger(source.number) ? { number: source.number } : {}) };
    };
    const staticKeys = ['schema', 'pack', 'guidance', 'entities', 'pendingQuestions', 'activeQuestionId', 'topics', 'capabilities', 'revision'];
    const context = {};
    for (const key of staticKeys) if (own(raw, key)) context[key] = copy(raw[key]);
    const pick = (value, keys) => Object.fromEntries(keys.filter(key => own(value, key)).map(key => [key, copy(value[key])]));
    context.world = pick(raw.world, ['grid', 'capacity', 'landmarks', 'nextId']);
    context.world.objects = (raw.world.objects || []).map(object => {
      const result = pick(object, ['id', 'label', 'glyphs', 'x', 'y', 'scale']);
      const original = object.source || {};
      const created = sourceProjection({ eventId: original.createdEventId, text: original.createdBy }, recordIds.objectSource(object.id, 'createdBy'));
      const changed = sourceProjection({ eventId: original.eventId, text: original.lastChangedBy }, recordIds.objectSource(object.id, 'lastChangedBy'));
      result.source = { createdBy: created?.text ?? null, lastChangedBy: changed?.text ?? null, createdEventId: created?.eventId ?? null, eventId: changed?.eventId ?? null };
      return result;
    });
    context.world.weather = pick(raw.world.weather || {}, ['kind', 'name', 'intensity', 'paused']);
    context.world.weather.source = sourceProjection(raw.world.weather?.source, recordIds.weatherSource());
    context.world.annotations = {};
    for (const [target, annotation] of Object.entries(raw.world.annotations || {})) {
      const out = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
      for (const field of ['meaning', 'interpretation']) {
        const id = recordIds.annotation(target, field), refs = sourceFromObject(annotation.sources?.[field]);
        if (annotation[field] !== null && annotation[field] !== undefined && allowed(id, refs, true)) {
          out[field] = copy(annotation[field]); out.sources[field] = sourceProjection(annotation.sources?.[field], id);
        }
      }
      context.world.annotations[target] = out;
    }
    context.character = pick(raw.character, ['name', 'role', 'trust', 'familiarity']);
    for (const field of ['mood', 'stance']) {
      if (!own(raw.character, field)) continue;
      const id = recordIds.character(field), refs = sourceFromObject(raw.character.basis);
      context.character[field] = allowed(id, refs, raw.character.basis != null) ? copy(raw.character[field]) : null;
    }
    context.character.basis = sourceProjection(raw.character.basis, recordIds.character('basis'));
    context.memories = [];
    for (const note of raw.memories || []) {
      const generation = note.generation || policy.active[note.id]?.generation || 1, id = recordIds.memory(note.id, generation);
      const handle = policy.handles[id];
      if (!handle) continue;
      const refs = [...sourceFromObject(note.source), ...sourceFromObject(note.currentRevision)];
      if (!allowed(id, refs, true)) continue;
      const out = pick(note, ['body', 'kind', 'perspective', 'generation', 'eventSupport']);
      out.id = handle;
      out.title = allowed(recordIds.memoryTitle(note.id, generation), refs, true) ? note.title : kindTitles[note.kind] || kindTitles.note;
      let origin = policy.bindings[id];
      while (policy.records[origin]?.previous) origin = policy.records[origin].previous;
      out.source = blocked.has(origin) ? null : sourceProjection(note.source, id + ':origin');
      out.currentRevision = sourceProjection(note.currentRevision, id + ':revision');
      if (note.support) {
        const support = normalizeSource({ eventId: note.support.eventId, channel: note.support.channel, start: note.support.start, end: note.support.end });
        if (!blockedSources([support])) out.support = pick(note.support, ['eventId', 'channel', 'start', 'end', 'quote']);
      }
      context.memories.push(out);
    }
    // This is a source-free management inventory, not retrieved memory. It
    // exposes only current opaque handles and counts, and must never call
    // allowed() or add withheld provenance to the next turn's exposure.
    const visibleHandles = new Set(context.memories.map(note => note.id));
    context.memoryCapacity = { limit: 14, used: (raw.memories || []).length, withheld: [] };
    for (const note of raw.memories || []) {
      const active = policy.active[note.id], generation = note.generation || active?.generation || 1;
      if (!active || active.generation !== generation) continue;
      const handle = policy.handles[recordIds.memory(note.id, generation)];
      if (handle && !visibleHandles.has(handle)) context.memoryCapacity.withheld.push({ id: handle });
    }
    context.story = pick(raw.story || {}, ['topic', 'completed', 'deferred']);
    context.story.answers = {};
    const hiddenAnswers = new Set();
    for (const [id, answer] of Object.entries(raw.story?.answers || {})) {
      const ref = recordIds.answer(id), refs = sourceFromObject(answer.source);
      if (!allowed(ref, refs, true)) { hiddenAnswers.add(id); continue; }
      context.story.answers[id] = { value: copy(answer.value), source: sourceProjection(answer.source, ref) };
    }
    context.facts = {};
    for (const [key, value] of Object.entries(raw.facts || {})) {
      if (key.startsWith('answer.')) {
        if (!hiddenAnswers.has(key.slice(7)) && own(context.story.answers, key.slice(7))) context.facts[key] = copy(value);
      } else if (allowed(recordIds.fact(key), [], true)) context.facts[key] = copy(value);
    }
    context.recentTranscript = [];
    for (const item of raw.recentTranscript || []) {
      if (!['user', 'character'].includes(item.role) || typeof item.text !== 'string') continue;
      if (policy.tombstones.some(tombstone => tombstone.removedAt === item.eventId)) continue;
      const id = recordIds.transcript(item.eventId, item.role, item.line || 0);
      const refs = safeId(item.eventId) ? [{ eventId: item.eventId, channel: item.eventId === 'legacy' ? 'legacy' : 'player' }] : [];
      // User transcript entries contain the entire utterance, so a narrow
      // field record must never make a mixed full utterance visible again.
      if (!blockedSources(refs) && allowed(id, refs, item.role === 'character' || !refs.length)) context.recentTranscript.push(pick(item, ['eventId', 'role', 'text', 'line']));
    }
    const exposure = freeze({ schema: 'her-world-recall-exposure-v1' });
    exposures.set(exposure, freeze({ records: unique(exposedRecords), sources: normalizeSources(exposedSources) }));
    return freeze({ context, exposure });
  }
  return freeze({ SCHEMA, kinds, perspectives, kindTitles, limits, recordIds, createPolicy, validatePolicy, sourceSpan, currentSupport, resolveHandle, sharedEventFromOperation, validateMemoryMetadata, recordDerivation, upsertMemory, importMemory, trackHistoricalMemory, dropHistoricalMemory, forgetMemory, projectContext });
});
