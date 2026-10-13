/* A small plot-independent, event-sourced world runtime. No IO, model or DOM access. */
(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./capabilities.js') : root.HerCapabilities, common ? require('./pack-validator.js') : root.HerPackValidator, common ? require('./memory-policy.js') : root.HerMemoryPolicy, common ? require('./recall-budget.js') : root.HerRecallBudget);
  if (common) module.exports = api;
  if (root) root.HerFramework = api;
})(typeof window !== 'undefined' ? window : null, function (CAPS, PACKS, MEMORY, BUDGET) {
  'use strict';
  // Keep the published logical retrieval allowance stable across prose edits.
  // The model adapter independently enforces the actual 128 KiB wire limit.
  const MAX_INPUT = 200, MAX_EVENTS = 1000, MAX_MEMORIES = 14, MAX_OPERATIONS = CAPS.MAX_OPERATIONS, MAX_CONTEXT_BYTES = 112 * 1024;
  const contextBudgetBytes = BUDGET.createProfile(CAPS).contextBytes;
  const CONSENT_VERSION = 2;
  const COMPLETION_VERSION = 2;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const stage = state => { const { recall, ...data } = state; return { ...copy(data), recall }; };
  const { fields, plain, safeText, identifier } = PACKS;
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const states = new WeakSet(), proposals = new WeakMap();
  const metadata = pack => ({ id: pack.id, version: pack.version, rulesVersion: pack.rulesVersion });
  const fail = (code, path = '$', diagnostic) => ({ ok: false, error: { code, path, ...(diagnostic ? { diagnostic } : {}) } });
  const assert = (condition, code, path = '$') => { if (!condition) { const error = new Error(code); error.code = code; error.path = path; throw error; } };
  // Stable content binding is a corruption check, not an authentication signature.
  function stable(value) { return Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value); }
  function digest(value) { const text = stable(value); let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
  const seal = state => { freeze(state); states.add(state); return state; };
  const requireState = state => assert(states.has(state), 'STATE_INVALID');
  const source = (eventId, text) => ({ eventId, text });
  const hasExistingCompletion = pack => pack.nodes.some(node => node.completion.existing === 'created-object');
  function available(state) { return state.pack.nodes.filter(node => !state.story.completed.includes(node.id) && Object.entries(node.requires).every(([key, value]) => own(state.facts, key) && state.facts[key] === value)); }
  function activeQuestion(state) { const nodes = available(state); return (nodes.find(node => node.topic === state.story.topic && !state.story.deferred.includes(node.question.id)) || nodes.find(node => !state.story.deferred.includes(node.question.id)) || nodes[0])?.question.id || null; }
  function questions(state) { return available(state).map(node => ({ nodeId: node.id, topic: node.topic, ...copy(node.question), deferred: state.story.deferred.includes(node.question.id), completion: copy(node.completion) })); }
  function makeState(pack) {
    return {
      schema: 'her-world-state-v4', pack, revision: 0,
      world: { grid: { cols: 100, rows: 60 }, capacity: pack.world.capacity, landmarks: copy(pack.world.landmarks), nextId: 1, objects: [], annotations: {}, weather: { ...(pack.world.weather || { kind: 'clear', name: 'clear', intensity: 0, paused: false }), source: null } },
      memories: [], character: { ...copy(pack.character), trust: pack.character.trust || 0, familiarity: pack.character.familiarity || 0, basis: null },
      story: { topic: pack.topics[0].id, completed: [], deferred: [], answers: {} }, facts: copy(pack.initialFacts),
      logs: [], transcript: [], events: [], focus: { source: null, operations: [] }, importedSnapshot: null,
      recall: MEMORY.createPolicy()
    };
  }
  function create(pack) { const checked = PACKS.validatePack(pack); assert(checked.ok, checked.error?.code || 'PACK_INVALID', checked.error?.path); const state = makeState(checked.value); for (const key of Object.keys(state.facts)) derive(state, MEMORY.recordIds.fact(key)); makeContext(state); return seal(state); }
  function proposal(state, input) {
    requireState(state);
    assert(fields(input, ['text']) && safeText(input.text, MAX_INPUT), 'INPUT_INVALID', 'text');
    const value = freeze({ schema: 'her-world-proposal-v1', ...metadata(state.pack), packId: state.pack.id, packVersion: state.pack.version, baseRevision: state.revision, baseDigest: digest(state), text: input.text });
    proposals.set(value, state); return value;
  }
  function projection(state, panel = null, display = true) {
    const memories = copy(state.memories);
    if (display && memories.length) {
      // This is a sentence-local display annotation, never a saved note field
      // or model input. Audit cards retain their text even when recall cannot.
      const recalled = MEMORY.projectContext({ schema: 'her-world-context-v1', world: {}, character: {}, memories }, state.recall).context.memories;
      const availableIds = new Set(recalled.map(note => MEMORY.resolveHandle(state.recall, note.id) || note.id));
      for (const note of memories) {
        note.recallStatus = availableIds.has(note.id) ? 'available' : 'withheld';
        note.recallHandle = state.recall.handles[MEMORY.recordIds.memory(note.id, note.generation || state.recall.active[note.id]?.generation || 1)];
      }
    }
    return freeze({ revision: state.revision, pack: { ...metadata(state.pack), title: state.pack.title }, world: copy(state.world), memories, character: copy(state.character), story: copy(state.story), facts: copy(state.facts), pendingQuestions: questions(state), activeQuestionId: activeQuestion(state), ...(display ? { logs: copy(state.logs), transcript: copy(state.transcript) } : {}), focus: copy(state.focus), panel });
  }
  function view(state, cursor) {
    requireState(state);
    if (cursor === undefined || cursor === null) return projection(state);
    assert(fields(cursor, ['event', 'line']) && Number.isInteger(cursor.event) && cursor.event >= 0 && cursor.event < state.events.length && Number.isInteger(cursor.line), 'CURSOR_INVALID');
    let replay = baseFromSave(state.pack, state.importedSnapshot);
    for (let i = 0; i <= cursor.event; i++) {
      const event = state.events[i];
      if (event.type === 'turn') {
        const result = execute(replay, event.input, event.plan, event.rulesVersion, true, false, event.consentVersion || 1, i === cursor.event, event.completionVersion || 1);
        assert(result.ok, 'REPLAY_INVALID');
        if (i === cursor.event) { assert(cursor.line >= 0 && cursor.line < result.frames.length, 'CURSOR_INVALID'); return result.frames[cursor.line]; }
        replay = result.state;
      } else replay = observeEvent(replay, { type: event.type, panel: event.panel, ...(own(event, 'questionIds') ? { questionIds: event.questionIds } : {}) }, event.completionVersion || 1);
    }
    return projection(replay);
  }
  function recallContext(state) {
    const result = projection(state, null, false);
    const snapshot = { schema: 'her-world-context-v1', pack: result.pack, guidance: state.pack.guidance || '', character: result.character, world: result.world, entities: copy(state.pack.entities), memories: result.memories, story: result.story, facts: result.facts, pendingQuestions: result.pendingQuestions, activeQuestionId: result.activeQuestionId, topics: copy(state.pack.topics), capabilities: CAPS.descriptors(state.pack.capabilities, CAPS.RULES_VERSION, result.world, state.pack.entities), recentTranscript: copy(state.transcript.slice(-12)), revision: state.revision };
    let projected = MEMORY.projectContext(snapshot, state.recall);
    let projectedBytes = contextBudgetBytes(projected.context);
    // Brand only the final request projection. Trimmed transcript records must
    // never become dependencies of a model response that could not see them.
    while (snapshot.recentTranscript.length && projectedBytes > MAX_CONTEXT_BYTES) {
      snapshot.recentTranscript.shift();
      projected = MEMORY.projectContext(snapshot, state.recall);
      projectedBytes = contextBudgetBytes(projected.context);
    }
    assert(projectedBytes <= MAX_CONTEXT_BYTES, 'CONTEXT_CAPACITY');
    return projected;
  }
  function makeContext(state) { return recallContext(state).context; }
  function context(state) { requireState(state); return makeContext(state); }
  function derive(state, id, env = null, independent = false) {
    const sources = [...(env?.input ? [MEMORY.sourceSpan(env.eventId, env.input)] : []), ...(env?.completionSources || [])];
    state.recall = MEMORY.recordDerivation(state.recall, id, { sources, exposure: independent ? null : env?.exposure });
  }
  function dimensions(item) { const rows = item.glyphs.split('\n'); return { width: Math.max(...rows.map(row => row.length)) * item.scale, height: rows.length * item.scale }; }
  const geometryReasons = ['SCHEMA_INVALID', 'OBJECT_TARGET_MISSING', 'OBJECT_LABEL_USED', 'REFERENCE_TARGET_MISSING', 'REFERENCE_LABEL_USED', 'LANDMARK_MISSING', 'SELF_TARGET', 'FOOTPRINT_INVALID', 'LANDMARK_FOOTPRINT', 'OUT_OF_BOUNDS', 'POSITION_OCCUPIED', 'NO_FREE_POSITION', 'SEARCH_BUDGET', 'SEARCH_CHOICE', 'WORLD_CAPACITY'];
  const placementAnchors = ['sky', 'ground', 'keep_center', 'keep_base', 'window_left', 'window_right', 'window_below', 'above', 'below', 'left_of', 'right_of'];
  function assertGeometry(condition, code, geometryReason) {
    if (!condition) { const error = new Error(code); error.code = code; error.path = '$'; error.geometryReason = geometryReason; throw error; }
  }
  function missingGeometryTarget(state, target, reference = false) {
    // Labels remain visible in the world projection. Count exact matches only;
    // diagnostics neither resolve a label nor expose the supplied reference.
    if (typeof target === 'string' && state.world.objects.filter(object => object.label === target).length === 1) return reference ? 'REFERENCE_LABEL_USED' : 'OBJECT_LABEL_USED';
    if (reference && ['sky', 'ground', 'window'].includes(target)) return 'LANDMARK_MISSING';
    return reference ? 'REFERENCE_TARGET_MISSING' : 'OBJECT_TARGET_MISSING';
  }
  function geometryDiagnostic(error, op, state) {
    if (!['world.create', 'world.update'].includes(op?.type) || !['OPERATION_INVALID', 'TARGET_MISSING', 'PLACEMENT_INVALID', 'PLACEMENT_TARGET', 'GEOMETRY_INVALID', 'PLACEMENT_CAPACITY', 'WORLD_CAPACITY'].includes(error.code)) return {};
    const current = op.type === 'world.update' ? state.world.objects.find(object => object.id === op.target) : null;
    const detail = {};
    if (geometryReasons.includes(error.geometryReason)) detail.geometryReason = error.geometryReason;
    else if (error.code === 'OPERATION_INVALID' || error.code === 'PLACEMENT_INVALID') detail.geometryReason = 'SCHEMA_INVALID';
    else if (error.code === 'TARGET_MISSING') detail.geometryReason = missingGeometryTarget(state, op.target);
    else if (error.code === 'WORLD_CAPACITY') detail.geometryReason = 'WORLD_CAPACITY';
    // Preserve historical lookup/validation behavior even for prototype names,
    // but do not describe an inherited property as a real geometric reference.
    if (detail.geometryReason === 'OUT_OF_BOUNDS' && ['above', 'below', 'left_of', 'right_of'].includes(op.placement?.anchor) && !state.world.objects.some(object => object.id === op.placement.target) && !own(state.world.landmarks, op.placement.target)) detail.geometryReason = missingGeometryTarget(state, op.placement.target, true);
    if (placementAnchors.includes(op.placement?.anchor)) detail.placementAnchor = op.placement.anchor;
    if (!own(op, 'placementPolicy')) detail.placementPolicy = 'auto';
    else if (['auto', 'exact'].includes(op.placementPolicy)) detail.placementPolicy = op.placementPolicy;
    const item = op.type === 'world.create' ? op.object : current && { ...current, ...(plain(op.changes) ? op.changes : {}) };
    if (plain(item) && typeof item.glyphs === 'string' && item.glyphs.length <= 249 && /^[\x20-\x7e\n]+$/u.test(item.glyphs) && /[\x21-\x7e]/u.test(item.glyphs) && Number.isInteger(item.scale) && item.scale >= 1 && item.scale <= 3) {
      const rows = item.glyphs.split('\n');
      if (rows.length <= 10 && rows.every(row => row.length <= 24)) {
        const { width, height } = dimensions(item);
        detail.footprintCols = width; detail.footprintRows = height;
      }
    }
    detail.occupiedCount = state.world.objects.filter(object => object.id !== current?.id).length;
    return detail;
  }
  function shape(item) {
    if (!fields(item, ['label', 'glyphs', 'x', 'y', 'scale']) || !safeText(item.label, 40) || typeof item.glyphs !== 'string' || !/^[\x20-\x7e\n]+$/u.test(item.glyphs) || !/[\x21-\x7e]/u.test(item.glyphs) || item.glyphs.split('\n').length > 10 || item.glyphs.split('\n').some(row => row.length > 24) || !Number.isInteger(item.scale) || item.scale < 1 || item.scale > 3 || !Number.isInteger(item.x) || !Number.isInteger(item.y)) return false;
    const { width, height } = dimensions(item);
    return item.x >= 0 && item.y >= 0 && item.x + width <= 100 && item.y + height <= 60;
  }
  const autoKeepPlacement = (op, env) => env.rulesVersion !== '2' && !env.replay && op.type === 'world.update' && op.placementPolicy !== 'exact' && ['keep_center', 'keep_base'].includes(op.placement?.anchor);
  function placed(item, placement, state, current, env, autoKeep = false) {
    assertGeometry(shape({ ...item, x: 0, y: 0 }), 'GEOMETRY_INVALID', 'FOOTPRINT_INVALID');
    const { width, height } = dimensions(item), anchor = placement.anchor;
    const center = (start, total, size) => start + Math.floor(total / 2) - Math.floor(size / 2);
    const clamp = (value, maximum) => Math.max(0, Math.min(value, maximum));
    let x, y;
    if (['sky', 'ground', 'keep_center', 'keep_base'].includes(anchor)) {
      assert(fields(placement, ['anchor']), 'PLACEMENT_INVALID');
      if (anchor.startsWith('keep_')) {
        assert(current, 'PLACEMENT_INVALID'); const old = dimensions(current);
        x = current.x + Math.floor(old.width / 2) - Math.floor(width / 2);
        y = anchor === 'keep_base' ? current.y + old.height - height : current.y + Math.floor(old.height / 2) - Math.floor(height / 2);
      } else {
        const landmark = state.world.landmarks[anchor]; assertGeometry(landmark, 'PLACEMENT_TARGET', 'LANDMARK_MISSING');
        assertGeometry(width <= landmark.width && (anchor === 'ground' || height <= landmark.height), 'GEOMETRY_INVALID', 'LANDMARK_FOOTPRINT');
        x = center(landmark.x, landmark.width, width);
        y = anchor === 'ground' ? landmark.y + landmark.height - height : center(landmark.y, landmark.height, height);
      }
    } else {
      const fixed = { window_left: 'left_of', window_right: 'right_of', window_below: 'below' };
      let side, target, gap = 2;
      if (own(fixed, anchor)) { assert(fields(placement, ['anchor', 'gap'], ['anchor']), 'PLACEMENT_INVALID'); side = fixed[anchor]; gap = placement.gap ?? 2; target = state.world.landmarks.window; }
      else {
        assert(fields(placement, ['anchor', 'target', 'gap', ...(['left_of', 'right_of'].includes(anchor) ? ['align'] : [])], ['anchor', 'target']), 'PLACEMENT_INVALID');
        side = anchor; gap = placement.gap ?? 2;
        const object = state.world.objects.find(object => object.id === placement.target);
        assertGeometry(!current || placement.target !== current.id, 'PLACEMENT_INVALID', 'SELF_TARGET');
        target = object ? { x: object.x, y: object.y, ...dimensions(object) } : state.world.landmarks[placement.target];
      }
      assertGeometry(target, 'PLACEMENT_TARGET', own(fixed, anchor) ? 'LANDMARK_MISSING' : missingGeometryTarget(state, placement.target, true));
      x = center(target.x, target.width, width); y = center(target.y, target.height, height);
      if (side === 'left_of' || side === 'right_of') {
        x = side === 'left_of' ? target.x - gap - width : target.x + target.width + gap;
        // Explicit alignment uses the full scaled rectangles, including spaces.
        // Keep its requested contact/center even in air; bounds must reject it
        // rather than silently clamp away the declared relationship.
        if (placement.align === 'bottom') y = target.y + target.height - height;
        else if (!own(placement, 'align')) y = clamp(y, 60 - height);
      }
      else { y = side === 'above' ? target.y - gap - height : target.y + target.height + gap; x = clamp(x, 100 - width); }
    }
    const result = { ...item, x, y };
    const movableTarget = env?.rulesVersion !== '2' && state.world.objects.some(object => object.id === placement.target && object.source.createdEventId === env?.eventId);
    assertGeometry(autoKeep || shape(result), movableTarget ? 'PLACEMENT_CAPACITY' : 'GEOMETRY_INVALID', 'OUT_OF_BOUNDS'); return result;
  }
  function overlaps(first, second) {
    const a = dimensions(first), b = dimensions(second);
    return first.x < second.x + b.width && first.x + a.width > second.x && first.y < second.y + b.height && first.y + a.height > second.y;
  }
  function autoGroundedAdjacency(op, state, current, env) {
    if (!current || env.rulesVersion === '2' || env.replay || op.placementPolicy === 'exact' || !['left_of', 'right_of'].includes(op.placement?.anchor) || own(op.placement, 'align')) return null;
    const ground = state.world.landmarks.ground, reference = state.world.objects.find(object => object.id === op.placement.target);
    if (!ground || !reference) return null;
    const old = dimensions(current), target = dimensions(reference), baseline = current.y + old.height;
    // Existing scenes can touch the top of the ground strip or its lower
    // edge (the ground anchor). Preserve only an already shared contact line;
    // a grounded reference alone does not make a new or airborne object grounded.
    if (baseline !== reference.y + target.height || baseline !== ground.y && baseline !== ground.y + ground.height) return null;
    if (current.x < ground.x || current.x + old.width > ground.x + ground.width || reference.x < ground.x || reference.x + target.width > ground.x + ground.width) return null;
    return { ground, baseline };
  }
  function resolvePlacement(item, op, state, current, env) {
    const autoKeep = autoKeepPlacement(op, env), groundContact = autoGroundedAdjacency(op, state, current, env);
    if (groundContact) item = { ...item, y: groundContact.baseline - dimensions(item).height };
    assertGeometry(autoKeep || shape(item), 'GEOMETRY_INVALID', 'OUT_OF_BOUNDS');
    const occupied = state.world.objects.filter(other => other.id !== current?.id);
    const clear = candidate => !occupied.some(other => overlaps(candidate, other));
    const anchor = op.placement?.anchor;
    if (op.allowOverlap === true) return item;
    // Both the side/gap and an explicit perpendicular alignment are strict,
    // including under auto. Joint search may still move an earlier uncommitted
    // target and recompute this relationship on its next attempt.
    if (op.placementPolicy === 'exact' || op.placement && own(op.placement, 'align')) { assertGeometry(clear(item), 'PLACEMENT_CAPACITY', 'POSITION_OCCUPIED'); return item; }
    if (current && !autoKeep && !groundContact && clear(item)) return item;
    const { width, height } = dimensions(item);
    let minX = 0, maxX = 100 - width, minY = 0, maxY = 60 - height;
    if (anchor === 'sky' || anchor === 'ground') {
      const landmark = state.world.landmarks[anchor];
      minX = landmark.x; maxX = landmark.x + landmark.width - width;
      if (anchor === 'sky') { minY = landmark.y; maxY = landmark.y + landmark.height - height; }
      else minY = maxY = item.y;
    } else if (['window_left', 'window_right', 'left_of', 'right_of'].includes(anchor)) minX = maxX = item.x;
    else if (['window_below', 'above', 'below'].includes(anchor)) minY = maxY = item.y;
    if (groundContact) {
      // The side/gap and existing ground contact must both survive. Obstacles
      // or a ground boundary reject the turn instead of pushing it off the floor.
      minX = Math.max(minX, groundContact.ground.x); maxX = Math.min(maxX, groundContact.ground.x + groundContact.ground.width - width);
      minY = maxY = item.y;
    }
    if (autoKeep) {
      const old = dimensions(current), ground = state.world.landmarks.ground;
      const contains = landmark => current.x >= landmark.x && current.y >= landmark.y && current.x + old.width <= landmark.x + landmark.width && current.y + old.height <= landmark.y + landmark.height;
      // The ground landmark describes a baseline, not a height limit. Other
      // containing landmarks use the smallest area, then stable ID ordering.
      const grounded = ground && current.x >= ground.x && current.x + old.width <= ground.x + ground.width && current.y + old.height === ground.y + ground.height;
      const region = grounded ? ground : Object.entries(state.world.landmarks).filter(([id, landmark]) => id !== 'ground' && contains(landmark)).sort((a, b) => a[1].width * a[1].height - b[1].width * b[1].height || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[1];
      if (region) {
        minX = Math.max(minX, region.x); maxX = Math.min(maxX, region.x + region.width - width);
        minY = Math.max(minY, grounded ? region.y + region.height - height : region.y);
        maxY = Math.min(maxY, region.y + region.height - height);
      }
      if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY && clear(item)) return item;
    }
    const candidates = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      assertGeometry(++env.search.work <= 250000, 'PLACEMENT_CAPACITY', 'SEARCH_BUDGET');
      const candidate = { ...item, x, y };
      if (clear(candidate)) candidates.push(candidate);
    }
    candidates.sort((a, b) => {
      if (!current && env.search.edge === 'top') return a.y - b.y || a.x - b.x;
      if (!current && env.search.edge === 'bottom') return b.y - a.y || a.x - b.x;
      return (autoKeep ? 0 : Number(a.y !== item.y) - Number(b.y !== item.y)) || (!current && env.search.edge === 'left' ? a.x - b.x : 0) || ((a.x - item.x) ** 2 + (a.y - item.y) ** 2) - ((b.x - item.x) ** 2 + (b.y - item.y) ** 2) || a.y - b.y || a.x - b.x;
    });
    assertGeometry(candidates.length, 'PLACEMENT_CAPACITY', 'NO_FREE_POSITION');
    if (current) return candidates[0];
    const index = env.search.decisions.length, selected = env.search.choices[index] || 0;
    env.search.decisions.push({ selected, count: candidates.length });
    assertGeometry(selected < candidates.length, 'PLACEMENT_CAPACITY', 'SEARCH_CHOICE');
    return candidates[selected];
  }
  function needsPlacement(op, current, item) {
    if (own(op, 'placement') || own(op.changes, 'x') || own(op.changes, 'y')) return true;
    const before = dimensions(current), after = dimensions(item);
    return before.width !== after.width || before.height !== after.height;
  }
  function normalizeGeometry(op, state, previous) {
    if (op.type !== 'world.create' && op.type !== 'world.update') return copy(op);
    if (op.type === 'world.update' && !needsPlacement(op, previous, state.world.objects.find(item => item.id === op.target))) return copy(op);
    const normalized = copy(op), object = op.type === 'world.create' ? state.world.objects.at(-1) : state.world.objects.find(item => item.id === op.target);
    delete normalized.placement;
    normalized.placementPolicy = 'exact';
    if (op.type === 'world.create') normalized.object = { ...normalized.object, x: object.x, y: object.y };
    else normalized.changes = { ...normalized.changes, x: object.x, y: object.y };
    return normalized;
  }
  function modelMemoryAliases(state) {
    // Reserve the entire local namespace, including forgotten and imported
    // notes. Neither opaque model handles nor model-chosen slugs own these IDs.
    const used = new Set([...state.memories, ...(state.importedSnapshot?.memories || [])].map(note => note.id));
    for (const id of [...Object.keys(state.recall.generations), ...Object.keys(state.recall.active), ...state.recall.tombstones.map(item => item.noteId)]) used.add(id);
    for (const key of [...Object.keys(state.recall.bindings), ...Object.keys(state.recall.handles)]) {
      const match = /^memory:(note_[a-z0-9_]{1,32}):[1-9][0-9]*(?::title)?$/u.exec(key);
      if (match) used.add(match[1]);
    }
    for (const event of state.events) if (event.type === 'turn') for (const beat of event.plan.beats) for (const op of beat.operations) {
      if (['memory.upsert', 'memory.remove'].includes(op.type)) used.add(op.id);
    }
    return { used, ids: new Map(), next: 1 };
  }
  function resolveMemoryOperation(op, state, rulesVersion, replay, exposedHandles, aliases) {
    if (!['memory.upsert', 'memory.remove'].includes(op?.type)) return op;
    if (aliases) {
      // Validate the original ID and fields before replacing an alias. This
      // entry point must never normalize an otherwise invalid model operation.
      assert(CAPS.validate(op, rulesVersion), 'OPERATION_INVALID');
      if (/^note_[a-z0-9_]{1,32}$/u.test(op.id)) {
        let id = aliases.ids.get(op.id);
        if (id) {
          // Removal ends this alias's lifetime. Recreating it would silently
          // resurrect a deleted record; a distinct new alias is required.
          assert(state.memories.some(note => note.id === id), 'MEMORY_HANDLE_INVALID');
        } else {
          assert(op.type === 'memory.upsert', 'MEMORY_HANDLE_INVALID');
          do { id = 'note_local_' + aliases.next++; } while (aliases.used.has(id));
          aliases.used.add(id); aliases.ids.set(op.id, id);
        }
        return { ...op, id };
      }
    }
    if (typeof op.id !== 'string' || !/^memory_[1-9][0-9]*$/u.test(op.id)) return op;
    assert(rulesVersion === '4' && !replay, 'EVENT_INVALID');
    assert(exposedHandles.has(op.id), 'MEMORY_HANDLE_INVALID');
    const id = MEMORY.resolveHandle(state.recall, op.id);
    assert(id, 'MEMORY_HANDLE_INVALID');
    return { ...op, id };
  }
  function complete(state, node, eventId, input, answer, env = null) {
    if (state.story.completed.includes(node.id)) return;
    state.story.completed.push(node.id);
    state.story.deferred = state.story.deferred.filter(id => id !== node.question.id);
    Object.assign(state.facts, copy(node.sets));
    for (const key of Object.keys(node.sets)) derive(state, MEMORY.recordIds.fact(key), env);
    if (answer !== undefined) {
      state.facts['answer.' + node.question.id] = answer;
      state.story.answers[node.question.id] = { value: answer, source: source(eventId, input) };
      derive(state, MEMORY.recordIds.answer(node.question.id), env);
      derive(state, MEMORY.recordIds.fact('answer.' + node.question.id), env);
    }
  }
  function completeNewlyAvailable(state, previouslyAvailable, env) {
    // Only accepted actions that first unlock a node can recognize prior
    // state. Restoring, rendering a view, importing and idle chat never catch up
    // progress; a fresh actual UI discovery can unlock an authored predicate.
    // This predicate proves only physical, controlled object existence. It does
    // not recover forgotten meanings or source text; the visible object itself
    // may persist after semantic forgetting, under the existing recall policy.
    const witness = state.world.objects.find(object => {
      const id = object.source.createdEventId;
      if (id === env.eventId) return env.createdObjects.has(object.id);
      return state.events.some(event => event.id === id && event.type === 'turn' && event.plan.beats.some(beat => beat.operations.some(op => op.type === 'world.create')));
    });
    if (!witness) return;
    const supported = { ...env, completionSources: [...(env.completionSources || []), MEMORY.sourceSpan(witness.source.createdEventId, witness.source.createdBy)] };
    // Completion is monotonic and the validated graph has at most 64 nodes.
    // A newly satisfied authored fact may expose another explicit predicate.
    for (let pass = 0; pass < state.pack.nodes.length; pass++) {
      const ready = available(state).find(node => !previouslyAvailable.has(node.id) && node.completion.existing === 'created-object');
      if (!ready) break;
      complete(state, ready, env.eventId, env.input, undefined, supported);
      state.logs.push({
        id: env.eventId + '.completion.' + ready.id, kind: 'story_completion',
        text: '采用已创建物件 ' + witness.id + ' 完成节点 ' + ready.id + '（创建 ' + witness.source.createdEventId + '，触发 ' + env.eventId + '）',
        eventId: env.eventId, source: null, reason: 'created-object', nodeId: ready.id,
        objectId: witness.id, creatorEventId: witness.source.createdEventId, triggerEventId: env.eventId
      });
    }
  }
  // Keep the published validator unchanged for unmarked historical events.
  // Accepted archives must replay their own rules, including past limitations.
  function legacyConsent(input) {
    if (/[“”「」『』"‘’？?]|如果|假如|假设|要是|除非|等到|说过|说[：:]|为什么|是否|可不可以|能不能|(?:允许|同意|可以|愿意).{0,20}(?:吗|么|呢)$|\b(?:if|unless|said|asked|whether|why|hypothetical)\b/iu.test(input)) return false;
    if (/(?:不|并非|没有|未曾).{0,8}(?:同意|允许|授权|愿意)|拒绝|反对|撤回|收回|禁止|不要|不想|不希望|不用|不需要|不能|不可以|别.{0,10}(?:记|保留|保存)|\b(?:not|don't|never|refuse|decline|reject|forbid)\b/iu.test(input)) return false;
    if (/(?:昨天|以前|过去|曾经|之前|上次).{0,20}(?:同意|允许|授权)|(?:同意|允许|授权|愿意)过|\b(?:yesterday|previously|earlier|used to)\b/iu.test(input)) return false;
    const text = input.replace(/^\/回答\s+/u, '');
    return /^(?:好|好的|可以|同意|我同意|允许|我允许|愿意|我愿意|是的|确认|yes|okay|ok|i agree|i consent|allow)[。！!]*$/iu.test(text) || /^(?:我(?:同意|允许|愿意)|同意|允许|愿意|你可以|请你?|希望你).{0,60}(?:记住|记得|保留|保存|留下|记录)/u.test(text) || /^(?:记住|记得)我(?:吧|。|！|!|$)/u.test(text) || /^(?:yes[,，]?\s*)?(?:you may|you can|i consent|i agree|please|i want you to)\b.{0,60}\b(?:remember|keep|save|record|retain)\b/iu.test(text);
  }
  // Only consent questions use a conservative local language gate; ordinary
  // creative meaning is validated structurally, without matching literal labels.
  function explicitConsent(input) {
    // Interrogative particles remain questions before ordinary punctuation or
    // another clause. A final period must not turn a question into permission.
    if (/(?:允许|同意|可以|愿意|请|希望你)[^。，,！？!?；;]{0,196}(?:吗|么|呢)(?=$|[\p{P}\p{S}\s])/u.test(input)) return false;
    // Permission that awaits the player's later decision is not current
    // consent. Keep these checks within a clause, and do not read 现在 as 在.
    if (/(?:(?:^|[^现])在|等(?:待)?|待|直到|只有)[^，。！？；,;!?]{0,40}(?:同意|允许|授权|许可|批准|点头|确认)[^，。！？；,;!?]{0,16}(?:之后|以后|后|时|才|再)/u.test(input)) return false;
    if (/(?:等待?|直到)[^，。！？；,;!?]{0,40}(?:同意|允许|授权|许可|批准|点头|确认)/u.test(input)) return false;
    if (/(?:获得|得到|征得|取得)[^，。！？；,;!?]{0,20}(?:同意|允许|授权|许可|批准)[^，。！？；,;!?]{0,16}(?:之后|以后|后|才|再)/u.test(input)) return false;
    if (/\b(?:after|once|when|until|upon)\b[^,;.!?]{0,60}\b(?:consent|permission|approval|authorize|authorise|approve|agree|confirm)\b|\b(?:future|later|subsequent)\s+(?:permission|consent|approval)\b/iu.test(input)) return false;
    if (/\b(?:wait(?:ing)?\s+for|pending|subject\s+to)\b[^,;.!?]{0,60}\b(?:consent|permission|approval|authorization|authorisation)\b/iu.test(input)) return false;
    // An affirmative opening cannot satisfy a later condition or prerequisite.
    // Conditions can appear after English or Chinese punctuation. Keep each
    // additional condition tied to permission within its own clause.
    for (const fragment of input.split(/[，。！？；,.!?;\r\n]+/u)) {
      const clause = fragment.trim();
      if (/(?:^(?:那|你看|这样)?|(?:记住|记得|保留|保存|留下|记录|同意|允许|许可|授权|批准).{0,196})(?:好不好|行不行|可不可以|能不能)(?:呀|啊|呢|吧)?(?=$|[\p{P}\p{S}\s])/u.test(clause)) return false;
      if (/\b(?:withdraw(?:n|ing)?|withdrew|revok(?:e|ed|ing)|rescind(?:ed|ing)?|cancel(?:led|ed|ling|ing)?|withhold(?:ing)?|withheld|den(?:y|ied|ying)|take\s+back|taking\s+back|took\s+back)\b.{0,40}\b(?:consent|permission|approval|authorization|authorisation)\b/iu.test(clause)) return false;
      if (/\b(?:consent|permission|approval|authorization|authorisation)\b.{0,20}\b(?:withdrawn|revoked|rescinded|cancelled|canceled|withheld|denied)\b/iu.test(clause)) return false;
      if (/\b(?:cannot|can't|won't|wouldn't|couldn't|isn't|aren't|haven't|hasn't|hadn't|no|yet\s+to)\b.{0,40}\b(?:consent(?:ed|ing)?|permission|approval|authorization|authorisation|agree|approve|allow|authorize|authorise)\b/iu.test(clause)) return false;
      if (/(?:取消|撤销|作废).{0,16}(?:同意|授权|许可|批准)|(?:同意|授权|许可|批准).{0,16}(?:取消|撤销|作废)|(?:不|没(?:有)?|未(?:曾)?|尚未).{0,8}(?:同意|允许|授权|许可|批准)/u.test(clause)) return false;
      if (/\b(?:provided|providing|on\s+(?:the\s+)?(?:condition|understanding)\s+that|(?:as|so)\s+long\s+as|assuming|supposing|contingent\s+(?:on|upon)|depend(?:s|ing|ent)\s+(?:on|upon)|conditional\s+(?:on|upon))\b.{0,80}\b(?:consent|permission|approval|authorization|authorisation|authorize|authorise|approve|agree|allow|confirm|say\s+(?:yes|so))\b/iu.test(clause)) return false;
      if (/\b(?:only\s+with|with\s+(?:my\s+)?(?:prior|advance))\b.{0,60}\b(?:consent|permission|approval|authorization|authorisation|go-ahead|say-so|okay|ok)\b/iu.test(clause)) return false;
      if (/\b(?:must|need(?:s)?(?:\s+to)?|have\s+to|require(?:s)?|first\s+(?:ask|seek|get|obtain|secure))\b.{0,60}\b(?:consent|permission|approval|authorization|authorisation)\b|\b(?:ask|seek|get|obtain|secure)\b.{0,60}\b(?:consent|permission|approval|authorization|authorisation)\b.{0,20}\b(?:first|beforehand)\b|\b(?:consent|permission|approval|authorization|authorisation)\b.{0,20}\b(?:required|needed|must\s+come\s+first)\b/iu.test(clause)) return false;
      if (/\b(?:consent|permission|approval|authorization|authorisation)\b.{0,20}\b(?:must|needs?\s+to|has\s+to)\b.{0,20}\b(?:obtained|given|granted|secured|confirmed)\b/iu.test(clause)) return false;
      // A bare "ask me first" refers back to this permission; an explicit
      // subject such as "ask me about the weather" is a separate request.
      if (/\b(?:ask\s+me|check\s+with\s+me)\s+(?:first|beforehand)[)）\s]*$|\b(?:first|beforehand)\s+(?:ask\s+me|check\s+with\s+me)[)）\s]*$/iu.test(clause)) return false;
      if (/\b(?:after|once|when|until)\b.{0,20}\b(?:ask\s+me|check\s+with\s+me)[)）\s]*$/iu.test(clause)) return false;
      if (/(?:前提|条件|只要)(?:是|为|要|得)?.{0,40}(?:同意|允许|授权|许可|批准|点头|确认|问.{0,8}我)|(?:同意|允许|授权|许可|批准|点头|确认).{0,20}(?:为前提|是前提)/u.test(clause)) return false;
      if (/(?:必须|需要|须|得先|要先|先|要经|得经|务必|应当|应该).{0,40}(?:征求|同意|允许|授权|许可|批准|点头|确认)|经(?:过)?.{0,16}(?:同意|允许|授权|许可|批准).{0,16}(?:后|才|再)/u.test(clause)) return false;
      if (/(?:同意|授权|许可|批准).{0,16}(?:必须|需要|须|得|要).{0,16}(?:取得|获取|获得|征得|征求|确认)/u.test(clause)) return false;
      if (/(?:先|事先).{0,16}问(?:过|一?下)?我(?:一下|一声)?(?:吧|啊|呀)?[)）\s]*$/u.test(clause)) return false;
      if (/(?:要|得|须|必须).{0,16}问(?:过|一?下)?我(?:之后|以后|后).{0,8}(?:才|再)/u.test(clause)) return false;
    }
    return legacyConsent(input.replace(/\.$/u, '').replace(/^((?:\/回答\s+)?我)现在(?=同意|允许|愿意)/u, '$1'));
  }
  function validOutput(value) {
    if (typeof value === 'string') return !/<\/?(?:think|analysis|reasoning|scratchpad)\b|["'](?:reasoning_content|analysis|thinking|debug)["']\s*:/iu.test(value);
    if (Array.isArray(value)) return value.every(validOutput);
    if (plain(value)) return Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key) && validOutput(value[key]));
    return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
  }
  function previousMemory(state, id) {
    const imported = state.importedSnapshot?.memories.find(memory => memory.id === id);
    let origin = imported ? (imported.source === null ? null : source('legacy', imported.source)) : undefined;
    let revision = imported ? (own(imported, 'latestSource') && imported.latestSource !== imported.source ? 2 : 1) : 0;
    for (const event of state.events) if (event.type === 'turn') for (const beat of event.plan.beats) for (const operation of beat.operations) if (operation.type === 'memory.upsert' && operation.id === id) {
      if (origin === undefined) origin = source(event.id, event.input);
      revision++;
    }
    return revision ? { source: origin, currentRevision: { number: revision } } : null;
  }
  function apply(state, op, env) {
    const { eventId, input, initialQuestions, topic, answered } = env;
    assert(CAPS.validate(op, env.rulesVersion), 'OPERATION_INVALID');
    if (env.rulesVersion === '2') assert(!own(op, 'placementPolicy') && !own(op, 'allowOverlap'), 'OPERATION_INVALID');
    assert(state.pack.capabilities.includes(op.type), 'CAPABILITY_DISABLED');
    assert(!own(op, 'evidence') || op.evidence === input, 'EVIDENCE_INVALID');
    const ref = source(eventId, input);
    if (op.type === 'world.create') {
      assert(state.world.objects.length < state.world.capacity && state.world.nextId <= 10000, 'WORLD_CAPACITY');
      assert(!own(op, 'placement') || !own(op.object, 'x') && !own(op.object, 'y'), 'PLACEMENT_INVALID');
      let item = own(op, 'placement') ? placed(op.object, op.placement, state, undefined, env) : op.object;
      assertGeometry(shape(item), 'GEOMETRY_INVALID', shape({ ...item, x: 0, y: 0 }) ? 'OUT_OF_BOUNDS' : 'FOOTPRINT_INVALID');
      if (env.rulesVersion !== '2') {
        assert(!env.replay || !own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
        item = resolvePlacement(item, op, state, undefined, env);
      }
      state.world.objects.push({ id: 'obj_' + state.world.nextId++, ...copy(item), source: { createdBy: input, lastChangedBy: input, createdEventId: eventId, eventId } });
      const created = state.world.objects.at(-1);
      env.createdObjects.add(created.id);
      derive(state, MEMORY.recordIds.objectSource(created.id, 'createdBy'), env);
      derive(state, MEMORY.recordIds.objectSource(created.id, 'lastChangedBy'), env);
      env.sharedEvents.push(MEMORY.sharedEventFromOperation(eventId, env.operationIndex, { type: op.type, target: created.id, label: created.label }));
    } else if (op.type === 'world.update') {
      const index = state.world.objects.findIndex(item => item.id === op.target); assert(index >= 0, 'TARGET_MISSING');
      const current = state.world.objects[index];
      assert(Object.keys(op.changes).length > 0 || own(op, 'placement'), 'OPERATION_EMPTY');
      assert(!own(op, 'placement') || !own(op.changes, 'x') && !own(op.changes, 'y'), 'PLACEMENT_INVALID');
      const { id, source: oldSource, ...base } = current;
      const shapeValue = { ...base, ...copy(op.changes) };
      const autoKeep = autoKeepPlacement(op, env);
      let item = own(op, 'placement') ? placed(shapeValue, op.placement, state, current, env, autoKeep) : shapeValue;
      assertGeometry(autoKeep || shape(item), 'GEOMETRY_INVALID', shape({ ...item, x: 0, y: 0 }) ? 'OUT_OF_BOUNDS' : 'FOOTPRINT_INVALID');
      if (env.rulesVersion !== '2' && needsPlacement(op, current, item)) {
        assert(!env.replay || !own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
        item = resolvePlacement(item, op, state, current, env);
      }
      state.world.objects[index] = { id, ...item, source: { ...oldSource, lastChangedBy: input, eventId } };
      derive(state, MEMORY.recordIds.objectSource(id, 'lastChangedBy'), env);
      env.sharedEvents.push(MEMORY.sharedEventFromOperation(eventId, env.operationIndex, { type: op.type, target: id, label: item.label }));
    } else if (op.type === 'world.remove') {
      const index = state.world.objects.findIndex(item => item.id === op.target); assert(index >= 0, 'TARGET_MISSING');
      env.sharedEvents.push(MEMORY.sharedEventFromOperation(eventId, env.operationIndex, { type: op.type, target: op.target, label: state.world.objects[index].label }));
      state.world.objects.splice(index, 1); delete state.world.annotations[op.target];
    } else if (op.type === 'world.annotate') {
      assert(state.world.objects.some(item => item.id === op.target) || state.pack.entities.some(entity => entity.id === op.target), 'TARGET_MISSING');
      assert(op.value === null || safeText(op.value, 120), 'TEXT_INVALID');
      if (!own(state.world.annotations, op.target)) state.world.annotations[op.target] = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
      state.world.annotations[op.target][op.field] = op.value;
      state.world.annotations[op.target].sources[op.field] = ref;
      derive(state, MEMORY.recordIds.annotation(op.target, op.field), env);
    } else if (op.type === 'weather.set') {
      for (const key of ['kind', 'name']) if (own(op.changes, key)) assert(safeText(op.changes[key], key === 'kind' ? 32 : 40), 'TEXT_INVALID');
      const weather = { ...state.world.weather, ...copy(op.changes), source: ref };
      if (weather.kind === 'clear') {
        assert(!own(op.changes, 'intensity') || op.changes.intensity === 0, 'WEATHER_CONFLICT', 'world.weather');
        weather.intensity = 0;
      }
      assert(PACKS.validWeather(weather), 'WEATHER_CONFLICT', 'world.weather');
      state.world.weather = weather;
      derive(state, MEMORY.recordIds.weatherSource(), env);
      env.sharedEvents.push(MEMORY.sharedEventFromOperation(eventId, env.operationIndex, { type: op.type }));
    } else if (op.type === 'memory.upsert') {
      assert(safeText(op.title, 60) && safeText(op.body, 240), 'TEXT_INVALID');
      const index = state.memories.findIndex(memory => memory.id === op.id);
      assert(index >= 0 || state.memories.length < MAX_MEMORIES, 'MEMORY_CAPACITY');
      let note;
      if (env.rulesVersion === '4') {
        const result = MEMORY.upsertMemory(state.recall, op, { eventId, input, exposure: env.exposure, sharedEvent: env.sharedEvents.find(value => value.summary === op.body) || null });
        state.recall = result.policy; note = result.note;
      } else {
        // Historical rules revived the first source even after removal. Keep
        // that audit projection exactly, while rebuilding its recall graph.
        const previous = state.memories[index] || env.noteHistory.get(op.id) || previousMemory(state, op.id);
        note = { id: op.id, title: op.title, body: op.body, source: previous ? previous.source : ref, currentRevision: { ...ref, number: previous ? previous.currentRevision.number + 1 : 1 } };
        state.recall = MEMORY.trackHistoricalMemory(state.recall, note, { eventId, input, exposure: env.exposure });
      }
      if (index >= 0) state.memories[index] = note; else state.memories.push(note);
      env.noteHistory.set(op.id, note);
    } else if (op.type === 'memory.remove') {
      const index = state.memories.findIndex(memory => memory.id === op.id); assert(index >= 0, 'TARGET_MISSING');
      state.recall = env.rulesVersion === '4' ? MEMORY.forgetMemory(state.recall, state.memories[index], { eventId, input, support: op.support }) : MEMORY.dropHistoricalMemory(state.recall, op.id);
      env.noteHistory.set(op.id, state.memories[index]); state.memories.splice(index, 1);
    } else if (op.type === 'story.answer') {
      const node = initialQuestions.find(node => node.question.id === op.questionId);
      assert(node && node.completion.type === 'answer' && !state.story.completed.includes(node.id), 'ANSWER_UNAVAILABLE');
      assert(topic === node.topic && !answered.value, 'ANSWER_BOUNDARY');
      assert(safeText(op.value, 200), 'TEXT_INVALID');
      if (node.question.kind !== 'open') assert(node.question.choices.some(choice => choice.id === op.value), 'CHOICE_INVALID');
      if (node.question.kind === 'consent' && op.value === 'allow') assert(env.activeQuestion === node.question.id && (env.consentVersion === 1 ? legacyConsent(input) : explicitConsent(input)), 'CONSENT_REQUIRED');
      complete(state, node, eventId, input, op.value, env); answered.value = true;
    } else if (op.type === 'story.defer') {
      const node = initialQuestions.find(node => node.question.id === op.questionId);
      assert(node && !state.story.completed.includes(node.id), 'QUESTION_UNAVAILABLE');
      if (!state.story.deferred.includes(node.question.id)) state.story.deferred.push(node.question.id);
    } else if (op.type === 'character.update') {
      for (const key of ['mood', 'stance']) if (own(op.changes, key)) { assert(safeText(op.changes[key], key === 'mood' ? 80 : 160), 'TEXT_INVALID'); state.character[key] = op.changes[key]; derive(state, MEMORY.recordIds.character(key), env); }
      for (const key of ['trust', 'familiarity']) if (own(op.changes, key + 'Delta')) {
        env.relationship[key] += op.changes[key + 'Delta']; assert(Math.abs(env.relationship[key]) <= 5, 'RELATIONSHIP_BOUND');
        state.character[key] = Math.max(0, Math.min(100, env.initialRelationship[key] + env.relationship[key]));
      }
      state.character.basis = ref;
      derive(state, MEMORY.recordIds.character('basis'), env);
    } else if (op.type === 'log.note') {
      assert(safeText(op.text, 160), 'TEXT_INVALID');
      state.logs.push({ id: eventId + '.note.' + state.logs.length, kind: 'character_note', text: op.text, eventId, source: ref });
    } else if (op.type === 'panel.open') return op.panel;
    if (!['story.answer', 'story.defer', 'panel.open'].includes(op.type)) for (const node of available(state)) {
      const c = node.completion;
      if (c.type === 'operation' && c.operation === op.type && (!c.target || c.target === op.target || op.type === 'weather.set' && c.target === state.pack.entities.find(entity => entity.kind === 'weather')?.id)) complete(state, node, eventId, input, undefined, env);
    }
    return null;
  }
  function execute(state, input, plan, rulesVersion = CAPS.RULES_VERSION, replay = false, model = false, consentVersion = CONSENT_VERSION, framesNeeded = true, completionVersion = hasExistingCompletion(state.pack) ? COMPLETION_VERSION : 1) {
    const search = { choices: [], decisions: [], work: 0, edge: false };
    const budgetLimited = result => fail(result.error.code, result.error.path, result.error.diagnostic ? { ...result.error.diagnostic, geometryReason: 'SEARCH_BUDGET' } : undefined);
    let attempts = 0, lastFailure;
    while (attempts < 256) {
      const firstAttempt = attempts++ === 0;
      search.decisions = [];
      const result = executeAttempt(state, input, plan, rulesVersion, search, replay, model, consentVersion, framesNeeded, completionVersion);
      if (result.ok || result.error.code !== 'PLACEMENT_CAPACITY') return result;
      if (search.work >= 250000) return budgetLimited(result);
      lastFailure = result;
      // Dense batches have equivalent dead ends around either central axis.
      // Boundary seeds share the search budget and the same anchor constraints.
      if (firstAttempt && search.decisions.length) {
        for (const edge of ['left', 'top', 'bottom']) {
          const edgeSearch = { choices: [], decisions: [], work: search.work, edge };
          attempts++;
          const packed = executeAttempt(state, input, plan, rulesVersion, edgeSearch, replay, model, consentVersion, framesNeeded, completionVersion);
          search.work = edgeSearch.work;
          if (packed.ok) return packed;
          if (search.work >= 250000) return budgetLimited(packed.error.code === 'PLACEMENT_CAPACITY' ? packed : result);
        }
      }
      let index = search.decisions.length - 1;
      while (index >= 0 && search.decisions[index].selected + 1 >= search.decisions[index].count) index--;
      if (index < 0) return result;
      search.choices = search.decisions.slice(0, index + 1).map(decision => decision.selected);
      search.choices[index]++;
    }
    return lastFailure ? budgetLimited(lastFailure) : fail('PLACEMENT_CAPACITY');
  }
  function executeAttempt(state, input, plan, rulesVersion, search, replay, model, consentVersion, framesNeeded, completionVersion) {
    // Only local reason tokens and validated array coordinates enter diagnostics.
    // Keep the legacy error code/path and the validation order unchanged.
    let diagnostic;
    const checkBeat = (condition, reason, path, beatIndex) => {
      if (!condition) {
        diagnostic = { stage: 'RUNTIME', reason, path, ...(beatIndex === undefined ? {} : { beatIndex }) };
        assert(false, 'BEATS_INVALID');
      }
    };
    try {
      assert(['2', '3', '4'].includes(rulesVersion), 'EVENT_INVALID');
      assert(consentVersion === 1 || consentVersion === CONSENT_VERSION && rulesVersion === CAPS.RULES_VERSION, 'EVENT_INVALID');
      assert(completionVersion === 1 || completionVersion === COMPLETION_VERSION && rulesVersion === CAPS.RULES_VERSION && hasExistingCompletion(state.pack), 'EVENT_INVALID');
      assert(state.events.length < MAX_EVENTS, 'EVENT_CAPACITY');
      assert(safeText(input, MAX_INPUT), 'INPUT_INVALID');
      assert(fields(plan, ['schema', 'lines', 'beats', 'topic']) && plan.schema === CAPS.SCHEMA, 'PLAN_INVALID');
      assert(validOutput(plan), 'PROTOCOL_TEXT');
      assert(Array.isArray(plan.lines) && plan.lines.length >= 1 && plan.lines.length <= 4 && plan.lines.every(line => safeText(line, 500)), 'LINES_INVALID');
      assert(plan.topic === null || state.pack.topics.some(topic => topic.id === plan.topic), 'TOPIC_INVALID');
      checkBeat(Array.isArray(plan.beats), 'BEATS_ARRAY_REQUIRED', 'beats');
      checkBeat(plan.beats.length <= 4, 'BEATS_LIMIT', 'beats');
      const lines = new Set(); let count = 0, last = -1;
      for (let beatIndex = 0; beatIndex < plan.beats.length; beatIndex++) {
        const beat = plan.beats[beatIndex], path = 'beats[' + beatIndex + ']';
        checkBeat(fields(beat, ['afterLine', 'operations']), 'BEAT_FIELDS', path, beatIndex);
        checkBeat(Number.isInteger(beat.afterLine), 'BEAT_LINE_INTEGER', path + '.afterLine', beatIndex);
        checkBeat(beat.afterLine >= 0 && beat.afterLine < plan.lines.length, 'BEAT_LINE_RANGE', path + '.afterLine', beatIndex);
        checkBeat(beat.afterLine > last && !lines.has(beat.afterLine), 'BEAT_LINE_ORDER', path + '.afterLine', beatIndex);
        checkBeat(Array.isArray(beat.operations), 'BEAT_OPERATIONS_ARRAY', path + '.operations', beatIndex);
        checkBeat(beat.operations.length > 0, 'BEAT_OPERATIONS_EMPTY', path + '.operations', beatIndex);
        lines.add(beat.afterLine); last = beat.afterLine; count += beat.operations.length;
      }
      assert(count <= MAX_OPERATIONS, 'OPERATION_CAPACITY');
      const aliases = model ? modelMemoryAliases(state) : null;
      const next = stage(state), eventId = 'event_' + (state.revision + 1), frames = [], initialQuestions = available(state);
      const event = { id: eventId, type: 'turn', rulesVersion, ...(consentVersion === CONSENT_VERSION ? { consentVersion } : {}), ...(completionVersion === COMPLETION_VERSION ? { completionVersion } : {}), input, plan: copy(plan) };
      const recalled = recallContext(state);
      // Inventory grants bounded management targets only. Its opaque handles
      // never enter the branded retrieval exposure or source dependencies.
      const env = { input, eventId, rulesVersion, consentVersion, search, replay, exposure: recalled.exposure, exposedHandles: new Set([...recalled.context.memories, ...(recalled.context.memoryCapacity?.withheld || [])].map(note => note.id)), sharedEvents: [], createdObjects: new Set(), operationIndex: 0, initialQuestions, topic: plan.topic, answered: { value: false }, relationship: { trust: 0, familiarity: 0 }, initialRelationship: { trust: state.character.trust, familiarity: state.character.familiarity }, noteHistory: new Map(), activeQuestion: activeQuestion(state) };
      next.revision++;
      next.transcript.push({ eventId, role: 'user', text: input });
      derive(next, MEMORY.recordIds.transcript(eventId, 'user'), env, true);
      let panel = null;
      // Topic movement is staged at the first authored line, never at request time.
      for (let index = 0; index < plan.lines.length; index++) {
        if (index === 0 && plan.topic !== null) {
          next.story.topic = plan.topic;
          next.story.deferred = next.story.deferred.filter(id => !next.pack.nodes.some(node => node.question.id === id && node.topic === plan.topic));
        }
        next.transcript.push({ eventId, role: 'character', text: plan.lines[index], line: index });
        derive(next, MEMORY.recordIds.transcript(eventId, 'character', index), env);
        const beat = plan.beats.find(beat => beat.afterLine === index);
        if (beat) {
          const previouslyAvailable = completionVersion === COMPLETION_VERSION ? new Set(available(next).map(node => node.id)) : null;
          const operations = [];
          const storedBeat = event.plan.beats.find(candidate => candidate.afterLine === index);
          for (let operationIndex = 0; operationIndex < beat.operations.length; operationIndex++) {
            try {
              const op = resolveMemoryOperation(beat.operations[operationIndex], next, rulesVersion, replay, env.exposedHandles, aliases), previous = op.type === 'world.update' ? next.world.objects.find(item => item.id === op.target) : null;
              const requestedPanel = apply(next, op, env);
              env.operationIndex++;
              if (requestedPanel) panel = requestedPanel;
              if (rulesVersion !== '2') storedBeat.operations[operationIndex] = normalizeGeometry(op, next, previous);
              operations.push(op.type);
            } catch (error) {
              const beatIndex = plan.beats.indexOf(beat), op = beat.operations[operationIndex];
              diagnostic = { stage: 'RUNTIME', reason: 'OPERATION_REJECTED', path: 'beats[' + beatIndex + '].operations[' + operationIndex + ']', beatIndex, operationIndex };
              if (typeof op?.type === 'string' && CAPS.ids.includes(op.type)) diagnostic.operationType = op.type;
              Object.assign(diagnostic, geometryDiagnostic(error, op, next));
              if (error.code === 'OPERATION_INVALID') Object.assign(diagnostic, CAPS.memoryDiagnostic(op, rulesVersion));
              if (error.code === 'EVIDENCE_INVALID') {
                diagnostic.reason = typeof op?.evidence === 'string' && input.includes(op.evidence) ? 'EVIDENCE_INPUT_EXCERPT' : 'EVIDENCE_INPUT_MISMATCH';
                diagnostic.path += '.evidence';
              }
              throw error;
            }
          }
          const nonPanels = operations.filter(type => type !== 'panel.open');
          if (nonPanels.length) next.focus = { source: source(eventId, input), operations: nonPanels };
          next.logs.push({ id: eventId + '.beat.' + index, kind: 'operations', text: 'Validated operations', eventId, source: source(eventId, input), operations });
          if (previouslyAvailable) completeNewlyAvailable(next, previouslyAvailable, env);
        }
        if (framesNeeded) frames.push(projection(next, panel));
      }
      next.events.push(event);
      next.logs.push({ id: eventId, kind: 'turn', text: 'Validated turn', eventId, source: source(eventId, input), operations: plan.beats.flatMap(beat => beat.operations.map(op => op.type)) });
      // The last projection includes the locally generated validation receipt.
      if (framesNeeded) frames[frames.length - 1] = projection(next, panel);
      makeContext(next);
      return { ok: true, state: seal(next), frames: freeze(frames), lines: freeze(copy(plan.lines)) };
    } catch (error) { return fail(error.code || 'PLAN_INVALID', error.path || '$', diagnostic); }
  }
  function commitTurn(state, candidate, plan, model) {
    if (!states.has(state)) return fail('STATE_INVALID');
    if (!candidate || proposals.get(candidate) !== state || candidate.baseRevision !== state.revision || candidate.baseDigest !== digest(state)) return fail('STALE_PROPOSAL');
    return execute(state, candidate.text, plan, CAPS.RULES_VERSION, false, model);
  }
  // Model slugs are turn-local aliases. Canonical/offline commits and saved
  // event replay retain their historical stable-ID semantics without remapping.
  function commit(state, candidate, plan) { return commitTurn(state, candidate, plan, false); }
  function commitModel(state, candidate, plan) { return commitTurn(state, candidate, plan, true); }
  function observe(state, event) {
    requireState(state);
    return observeEvent(state, event, hasExistingCompletion(state.pack) ? COMPLETION_VERSION : 1);
  }
  function observeEvent(state, event, completionVersion) {
    requireState(state);
    assert(completionVersion === 1 || completionVersion === COMPLETION_VERSION && hasExistingCompletion(state.pack), 'EVENT_INVALID');
    assert(fields(event, ['type', 'panel', 'questionIds'], ['type', 'panel']) && event.type === 'panel.viewed' && CAPS.panels.includes(event.panel), 'OBSERVATION_INVALID');
    const selected = own(event, 'questionIds') ? event.questionIds : null;
    if (selected !== null) {
      assert(Array.isArray(selected) && selected.length <= state.pack.nodes.length && new Set(selected).size === selected.length
        && [...selected].every(id => state.pack.nodes.some(node => node.question.id === id && node.completion.type === 'ui' && node.completion.panel === event.panel)), 'OBSERVATION_INVALID');
    } else assert(!own(event, 'questionIds'), 'OBSERVATION_INVALID');
    assert(state.events.length < MAX_EVENTS, 'EVENT_CAPACITY');
    const next = stage(state), eventId = 'event_' + (state.revision + 1);
    next.revision++;
    next.events.push({ id: eventId, type: 'panel.viewed', panel: event.panel, ...(selected ? { questionIds: [...selected] } : {}), ...(completionVersion === COMPLETION_VERSION ? { completionVersion } : {}) });
    next.logs.push({ id: eventId, kind: 'ui', text: 'Panel viewed: ' + event.panel, eventId, source: null });
    // A real local observation, never model prose, is the only UI completion path.
    // Delayed UI observations carry only the questions that were eligible in
    // the displayed sentence frame. A later accepted sentence cannot turn an
    // earlier visit into proof that its newly unlocked question was viewed.
    // Historical events without the subset retain their original semantics.
    for (const node of available(state)) if (node.completion.type === 'ui' && node.completion.panel === event.panel && (!selected || selected.includes(node.question.id))) complete(next, node, eventId, '', undefined);
    if (completionVersion === COMPLETION_VERSION) completeNewlyAvailable(next, new Set(available(state).map(node => node.id)), { eventId, input: '', createdObjects: new Set(), completionSources: [{ eventId, channel: 'operation' }] });
    makeContext(next);
    return seal(next);
  }
  function serialize(state) {
    requireState(state);
    return freeze({ schema: 'her-world-save-v4', pack: { ...metadata(state.pack), digest: digest(state.pack) }, importedSnapshot: state.importedSnapshot ? copy(state.importedSnapshot) : null, events: copy(state.events) });
  }
  function baseFromSave(pack, importedSnapshot) {
    const state = create(pack);
    if (importedSnapshot === null || importedSnapshot === undefined) return state;
    const result = importLegacy(importedSnapshot, pack); assert(result.ok, 'IMPORT_INVALID'); return result.state;
  }
  // Only these exact, previously released fixture definitions have a known
  // predecessor. Changing any other content requires a separate migration.
  const RULES_PREDECESSORS = freeze({
    'rain-lab': { '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2' },
    'lantern-lab': { '1': '8dd7d018', '2': '36792093', '3': 'ce388026' }
  });
  const COMPLETION_PREDECESSORS = freeze({ '1': '8dd7d018', '2': '36792093', '3': 'ce388026', '4': 'd11120d9' });
  const COMPLETION_PACK_DIGEST = 'cae92e8e';
  function migrationBinding(saved, pack) {
    assert(fields(saved, ['id', 'version', 'rulesVersion', 'digest']), 'PACK_MISMATCH');
    if (saved.id === pack.id && saved.version === pack.version && saved.rulesVersion === pack.rulesVersion && saved.digest === digest(pack)) return null;
    // This one authored opt-in has an exact old/new content binding. Keep its
    // existing storage identity and old event semantics; never strip arbitrary
    // pack fields from the digest or recompute historical story completion.
    if (pack.id === 'lantern-lab' && pack.version === '1.0.0' && pack.rulesVersion === CAPS.RULES_VERSION && digest(pack) === COMPLETION_PACK_DIGEST
      && saved.id === pack.id && saved.version === pack.version && ['1', '2', '3', '4'].includes(saved.rulesVersion) && saved.digest === COMPLETION_PREDECESSORS[saved.rulesVersion]) {
      return freeze({ type: 'current-object-completion-v2', fromRulesVersion: saved.rulesVersion, toRulesVersion: CAPS.RULES_VERSION, fromPackDigest: saved.digest, toPackDigest: COMPLETION_PACK_DIGEST });
    }
    const predecessor = RULES_PREDECESSORS[pack.id]?.[saved.rulesVersion];
    assert(predecessor && pack.version === '1.0.0' && pack.rulesVersion === CAPS.RULES_VERSION && saved.id === pack.id && saved.version === pack.version && saved.digest === predecessor && digest({ ...copy(pack), rulesVersion: saved.rulesVersion }) === predecessor, 'PACK_MISMATCH');
    return freeze({ type: 'memory-provenance-v4', fromRulesVersion: saved.rulesVersion, toRulesVersion: CAPS.RULES_VERSION, fromPackDigest: predecessor, toPackDigest: digest(pack) });
  }
  function compatibleOldWeather(save, pack) {
    // Replay just weather using the old assignment semantics before current
    // validation. In particular, never silently normalize an old clear+rain
    // intensity: it represented a different accepted historical state.
    let weather = copy(save.importedSnapshot?.world?.weather || pack.world.weather || { kind: 'clear', name: 'clear', intensity: 0, paused: false });
    assert(PACKS.validWeather(weather), 'MIGRATION_WEATHER_INCOMPATIBLE', 'world.weather');
    for (const event of save.events) {
      if (event?.type !== 'turn' || !Array.isArray(event.plan?.beats)) continue;
      for (const beat of event.plan.beats) {
        if (!Array.isArray(beat?.operations)) continue;
        for (const operation of beat.operations) if (operation?.type === 'weather.set' && plain(operation.changes)) {
          weather = { ...weather, ...copy(operation.changes) };
          assert(PACKS.validWeather(weather), 'MIGRATION_WEATHER_INCOMPATIBLE', 'world.weather');
        }
      }
    }
  }
  function restore(raw, pack) {
    try {
      const save = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const checked = PACKS.validatePack(pack); assert(checked.ok, checked.error?.code || 'PACK_INVALID', checked.error?.path);
      assert(fields(save, ['schema', 'pack', 'importedSnapshot', 'events']) && save.schema === 'her-world-save-v4', 'SAVE_INVALID');
      const migration = migrationBinding(save.pack, pack);
      assert(Array.isArray(save.events) && save.events.length <= MAX_EVENTS, 'SAVE_INVALID');
      if (migration?.fromRulesVersion === '1') compatibleOldWeather(save, pack);
      let state = baseFromSave(pack, save.importedSnapshot), lastRules = 2, lastConsentVersion = 1, lastCompletionVersion = 1;
      for (const event of save.events) {
        assert(plain(event) && event.id === 'event_' + (state.revision + 1), 'EVENT_INVALID');
        if (event.type === 'turn') {
          const unversioned = migration && ['1', '2'].includes(migration.fromRulesVersion);
          assert(fields(event, ['id', 'type', 'rulesVersion', 'consentVersion', 'completionVersion', 'input', 'plan'], unversioned ? ['id', 'type', 'input', 'plan'] : ['id', 'type', 'rulesVersion', 'input', 'plan']), 'EVENT_INVALID');
          const rulesVersion = unversioned ? '2' : event.rulesVersion;
          assert(!unversioned || !own(event, 'rulesVersion'), 'EVENT_INVALID');
          const consentVersion = own(event, 'consentVersion') ? event.consentVersion : 1;
          assert(!own(event, 'consentVersion') || consentVersion === CONSENT_VERSION && rulesVersion === CAPS.RULES_VERSION, 'EVENT_INVALID');
          // The first newly committed turn binds the stricter consent policy.
          // Observations preserve that boundary; old semantics cannot return.
          assert(consentVersion >= lastConsentVersion, 'EVENT_INVALID');
          lastConsentVersion = consentVersion;
          const completionVersion = own(event, 'completionVersion') ? event.completionVersion : 1;
          assert(!own(event, 'completionVersion') || completionVersion === COMPLETION_VERSION && rulesVersion === CAPS.RULES_VERSION && hasExistingCompletion(pack) && !migration, 'EVENT_INVALID');
          assert(completionVersion >= lastCompletionVersion, 'EVENT_INVALID');
          lastCompletionVersion = completionVersion;
          // Historical rules form a prefix. An observation does not end that
          // prefix, but current-rule turns can never downgrade replay semantics.
          assert(['2', '3', '4'].includes(rulesVersion) && Number(rulesVersion) >= lastRules && (!migration || Number(rulesVersion) <= Math.max(2, Number(migration.fromRulesVersion))), 'EVENT_INVALID');
          lastRules = Number(rulesVersion);
          if (rulesVersion !== '2') for (const beat of event.plan?.beats || []) for (const op of beat.operations || []) {
            if (op.type === 'world.create' || op.type === 'world.update' && (own(op, 'placement') || ['x', 'y'].some(key => own(op.changes || {}, key)))) assert(!own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
          }
          const result = execute(state, event.input, event.plan, rulesVersion, true, false, consentVersion, false, completionVersion); assert(result.ok, result.error?.code || 'EVENT_INVALID'); state = result.state;
        } else {
          assert(fields(event, ['id', 'type', 'panel', 'questionIds', 'completionVersion'], ['id', 'type', 'panel']), 'EVENT_INVALID');
          const completionVersion = own(event, 'completionVersion') ? event.completionVersion : 1;
          assert(!own(event, 'completionVersion') || completionVersion === COMPLETION_VERSION && hasExistingCompletion(pack) && !migration, 'EVENT_INVALID');
          assert(completionVersion >= lastCompletionVersion, 'EVENT_INVALID');
          lastCompletionVersion = completionVersion;
          state = observeEvent(state, { type: event.type, panel: event.panel, ...(own(event, 'questionIds') ? { questionIds: event.questionIds } : {}) }, completionVersion);
        }
      }
      return { ok: true, state, ...(migration ? { migration } : {}) };
    } catch (error) { return fail(error.code || 'SAVE_INVALID', error.path || '$'); }
  }
  function importLegacy(snapshot, pack) {
    try {
      const state = stage(create(pack));
      assert(fields(snapshot, ['origin', 'world', 'memories', 'transcript', 'facts']), 'IMPORT_INVALID');
      assert(fields(snapshot.origin, ['type', 'version', 'milestones']) && snapshot.origin.type === 'legacy-v3' && snapshot.origin.version === '0.5.4' && Array.isArray(snapshot.origin.milestones) && snapshot.origin.milestones.length <= 32 && snapshot.origin.milestones.every(identifier) && new Set(snapshot.origin.milestones).size === snapshot.origin.milestones.length, 'IMPORT_ORIGIN');
      assert(fields(snapshot.world, ['objects', 'annotations', 'weather']) && Array.isArray(snapshot.world.objects) && snapshot.world.objects.length <= state.world.capacity, 'IMPORT_WORLD');
      const ids = new Set();
      for (const item of snapshot.world.objects) {
        assert(fields(item, ['id', 'label', 'glyphs', 'x', 'y', 'scale', 'source']) && /^obj_[1-9][0-9]{0,3}$/u.test(item.id) && !ids.has(item.id), 'IMPORT_OBJECT');
        const { id, source: history, ...geometry } = item;
        assert(shape(geometry) && fields(history, ['createdBy', 'lastChangedBy']) && safeText(history.createdBy, 200) && safeText(history.lastChangedBy, 200), 'IMPORT_OBJECT');
        ids.add(id); state.world.nextId = Math.max(state.world.nextId, Number(id.slice(4)) + 1);
        state.world.objects.push({ id, ...copy(geometry), source: { ...copy(history), createdEventId: 'legacy', eventId: 'legacy' } });
      }
      assert(plain(snapshot.world.annotations) && Object.keys(snapshot.world.annotations).length <= 40, 'IMPORT_ANNOTATION');
      for (const [target, value] of Object.entries(snapshot.world.annotations)) {
        assert(ids.has(target) || pack.entities.some(entity => entity.id === target), 'IMPORT_ANNOTATION');
        assert(fields(value, ['meaning', 'interpretation', 'sources']) && fields(value.sources, ['meaning', 'interpretation']), 'IMPORT_ANNOTATION');
        const annotation = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
        for (const field of ['meaning', 'interpretation']) {
          assert((value[field] === null || safeText(value[field], 120)) && (value.sources[field] === null || safeText(value.sources[field], 200)) && (value[field] === null || value.sources[field] !== null), 'IMPORT_ANNOTATION');
          annotation[field] = value[field]; annotation.sources[field] = value.sources[field] === null ? null : source('legacy', value.sources[field]);
        }
        state.world.annotations[target] = annotation;
      }
      const weather = snapshot.world.weather;
      assert(fields(weather, ['kind', 'name', 'intensity', 'paused', 'source']) && PACKS.validWeather(weather) && (weather.source === null || safeText(weather.source, 200)), 'IMPORT_WEATHER');
      state.world.weather = { ...copy(weather), source: weather.source === null ? null : source('legacy', weather.source) };
      assert(Array.isArray(snapshot.memories) && snapshot.memories.length <= MAX_MEMORIES, 'IMPORT_MEMORY');
      const notes = new Set();
      for (const memory of snapshot.memories) {
        assert(fields(memory, ['id', 'title', 'body', 'source', 'latestSource'], ['id', 'title', 'body', 'source']) && /^note_[a-z0-9_]{1,32}$/u.test(memory.id) && !notes.has(memory.id) && safeText(memory.title, 60) && safeText(memory.body, 240) && (memory.source === null || safeText(memory.source, 200)) && (!own(memory, 'latestSource') || (memory.latestSource === null || safeText(memory.latestSource, 200))), 'IMPORT_MEMORY');
        notes.add(memory.id);
        const note = { id: memory.id, title: memory.title, body: memory.body, source: memory.source === null ? null : source('legacy', memory.source), currentRevision: { ...source('legacy', own(memory, 'latestSource') ? memory.latestSource : memory.source), number: own(memory, 'latestSource') && memory.latestSource !== memory.source ? 2 : 1 } };
        state.memories.push(note);
        state.recall = MEMORY.importMemory(state.recall, note);
      }
      assert(Array.isArray(snapshot.transcript) && snapshot.transcript.length <= 5000 && snapshot.transcript.every(item => fields(item, ['role', 'text']) && ['user', 'character', 'system'].includes(item.role) && safeText(item.text, 1000)), 'IMPORT_TRANSCRIPT');
      state.transcript = snapshot.transcript.map(item => ({ eventId: 'legacy', ...copy(item) }));
      const declared = {};
      for (const [key, value] of Object.entries(pack.initialFacts)) declared[key] = [value];
      for (const node of pack.nodes) for (const [key, value] of Object.entries(node.sets)) (declared[key] || (declared[key] = [])).push(value);
      assert(plain(snapshot.facts) && Object.keys(snapshot.facts).length <= 128 && Object.entries(snapshot.facts).every(([key, value]) => own(declared, key) && declared[key].includes(value)), 'IMPORT_FACTS');
      Object.assign(state.facts, copy(snapshot.facts));
      for (const key of Object.keys(snapshot.facts)) state.recall = MEMORY.recordDerivation(state.recall, MEMORY.recordIds.fact(key), { sources: [{ eventId: 'legacy', channel: 'legacy' }] });
      for (const node of pack.nodes) if (node.question.kind !== 'consent' && Object.keys(node.sets).length && Object.entries(node.sets).every(([key, value]) => own(snapshot.facts, key) && snapshot.facts[key] === value)) state.story.completed.push(node.id);
      const pending = available(state)[0]; if (pending) state.story.topic = pending.topic;
      state.importedSnapshot = copy(snapshot);
      state.logs.push({ id: 'legacy', kind: 'import', text: 'Imported validated legacy state', eventId: 'legacy', source: null });
      makeContext(state);
      return { ok: true, state: seal(state) };
    } catch (error) { return fail(error.code || 'IMPORT_INVALID', error.path || '$'); }
  }
  return Object.freeze({ create, propose: proposal, commit, commitModel, view, observe, restore, serialize, context, contextBudgetBytes, validatePack: PACKS.validatePack, importLegacy, explicitConsent, constants: freeze({ MAX_INPUT, MAX_EVENTS, MAX_MEMORIES, MAX_OPERATIONS, MAX_CONTEXT_BYTES }) });
});
