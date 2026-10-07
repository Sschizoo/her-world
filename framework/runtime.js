/* A small plot-independent, event-sourced world runtime. No IO, model or DOM access. */
(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./capabilities.js') : root.HerCapabilities, common ? require('./pack-validator.js') : root.HerPackValidator);
  if (common) module.exports = api;
  if (root) root.HerFramework = api;
})(typeof window !== 'undefined' ? window : null, function (CAPS, PACKS) {
  'use strict';
  const MAX_INPUT = 200, MAX_EVENTS = 1000, MAX_MEMORIES = 14, MAX_OPERATIONS = 12, MAX_CONTEXT_BYTES = 80 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const { fields, plain, safeText, identifier } = PACKS;
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const states = new WeakSet(), proposals = new WeakMap();
  const metadata = pack => ({ id: pack.id, version: pack.version, rulesVersion: pack.rulesVersion });
  const fail = (code, path = '$') => ({ ok: false, error: { code, path } });
  const assert = (condition, code, path = '$') => { if (!condition) { const error = new Error(code); error.code = code; error.path = path; throw error; } };
  // Stable content binding is a corruption check, not an authentication signature.
  function stable(value) { return Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value); }
  function digest(value) { const text = stable(value); let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
  const seal = state => { freeze(state); states.add(state); return state; };
  const requireState = state => assert(states.has(state), 'STATE_INVALID');
  const source = (eventId, text) => ({ eventId, text });
  function available(state) { return state.pack.nodes.filter(node => !state.story.completed.includes(node.id) && Object.entries(node.requires).every(([key, value]) => own(state.facts, key) && state.facts[key] === value)); }
  function activeQuestion(state) { const nodes = available(state); return (nodes.find(node => node.topic === state.story.topic && !state.story.deferred.includes(node.question.id)) || nodes.find(node => !state.story.deferred.includes(node.question.id)) || nodes[0])?.question.id || null; }
  function questions(state) { return available(state).map(node => ({ nodeId: node.id, topic: node.topic, ...copy(node.question), deferred: state.story.deferred.includes(node.question.id), completion: copy(node.completion) })); }
  function makeState(pack) {
    return {
      schema: 'her-world-state-v4', pack, revision: 0,
      world: { grid: { cols: 100, rows: 60 }, capacity: pack.world.capacity, landmarks: copy(pack.world.landmarks), nextId: 1, objects: [], annotations: {}, weather: { ...(pack.world.weather || { kind: 'clear', name: 'clear', intensity: 0, paused: false }), source: null } },
      memories: [], character: { ...copy(pack.character), trust: pack.character.trust || 0, familiarity: pack.character.familiarity || 0, basis: null },
      story: { topic: pack.topics[0].id, completed: [], deferred: [], answers: {} }, facts: copy(pack.initialFacts),
      logs: [], transcript: [], events: [], focus: { source: null, operations: [] }, importedSnapshot: null
    };
  }
  function create(pack) { const checked = PACKS.validatePack(pack); assert(checked.ok, checked.error?.code || 'PACK_INVALID', checked.error?.path); const state = makeState(checked.value); makeContext(state); return seal(state); }
  function proposal(state, input) {
    requireState(state);
    assert(fields(input, ['text']) && safeText(input.text, MAX_INPUT), 'INPUT_INVALID', 'text');
    const value = freeze({ schema: 'her-world-proposal-v1', ...metadata(state.pack), packId: state.pack.id, packVersion: state.pack.version, baseRevision: state.revision, baseDigest: digest(state), text: input.text });
    proposals.set(value, state); return value;
  }
  function projection(state, panel = null) {
    return freeze({ revision: state.revision, pack: { ...metadata(state.pack), title: state.pack.title }, world: copy(state.world), memories: copy(state.memories), character: copy(state.character), story: copy(state.story), facts: copy(state.facts), pendingQuestions: questions(state), activeQuestionId: activeQuestion(state), logs: copy(state.logs), transcript: copy(state.transcript), focus: copy(state.focus), panel });
  }
  function view(state, cursor) {
    requireState(state);
    if (cursor === undefined || cursor === null) return projection(state);
    assert(fields(cursor, ['event', 'line']) && Number.isInteger(cursor.event) && cursor.event >= 0 && cursor.event < state.events.length && Number.isInteger(cursor.line), 'CURSOR_INVALID');
    let replay = baseFromSave(state.pack, state.importedSnapshot);
    for (let i = 0; i <= cursor.event; i++) {
      const event = state.events[i];
      if (event.type === 'turn') {
        const result = execute(replay, event.input, event.plan, event.rulesVersion, true);
        assert(result.ok, 'REPLAY_INVALID');
        if (i === cursor.event) { assert(cursor.line >= 0 && cursor.line < result.frames.length, 'CURSOR_INVALID'); return result.frames[cursor.line]; }
        replay = result.state;
      } else replay = observe(replay, { type: event.type, panel: event.panel });
    }
    return projection(replay);
  }
  function makeContext(state) {
    const result = projection(state);
    const snapshot = { schema: 'her-world-context-v1', pack: result.pack, guidance: state.pack.guidance || '', character: result.character, world: result.world, entities: copy(state.pack.entities), memories: result.memories, story: result.story, facts: result.facts, pendingQuestions: result.pendingQuestions, activeQuestionId: result.activeQuestionId, topics: copy(state.pack.topics), capabilities: CAPS.descriptors(state.pack.capabilities), recentTranscript: copy(state.transcript.slice(-12)), revision: state.revision };
    while (snapshot.recentTranscript.length && CAPS.requestContextBytes(snapshot) > MAX_CONTEXT_BYTES) snapshot.recentTranscript.shift();
    assert(CAPS.requestContextBytes(snapshot) <= MAX_CONTEXT_BYTES, 'CONTEXT_CAPACITY');
    return freeze(snapshot);
  }
  function context(state) { requireState(state); return makeContext(state); }
  function dimensions(item) { const rows = item.glyphs.split('\n'); return { width: Math.max(...rows.map(row => row.length)) * item.scale, height: rows.length * item.scale }; }
  function shape(item) {
    if (!fields(item, ['label', 'glyphs', 'x', 'y', 'scale']) || !safeText(item.label, 40) || typeof item.glyphs !== 'string' || !/^[\x20-\x7e\n]+$/u.test(item.glyphs) || !/[\x21-\x7e]/u.test(item.glyphs) || item.glyphs.split('\n').length > 10 || item.glyphs.split('\n').some(row => row.length > 24) || !Number.isInteger(item.scale) || item.scale < 1 || item.scale > 3 || !Number.isInteger(item.x) || !Number.isInteger(item.y)) return false;
    const { width, height } = dimensions(item);
    return item.x >= 0 && item.y >= 0 && item.x + width <= 100 && item.y + height <= 60;
  }
  function placed(item, placement, state, current, env) {
    assert(shape({ ...item, x: 0, y: 0 }), 'GEOMETRY_INVALID');
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
        const landmark = state.world.landmarks[anchor]; assert(landmark, 'PLACEMENT_TARGET');
        assert(width <= landmark.width && (anchor === 'ground' || height <= landmark.height), 'GEOMETRY_INVALID');
        x = center(landmark.x, landmark.width, width);
        y = anchor === 'ground' ? landmark.y + landmark.height - height : center(landmark.y, landmark.height, height);
      }
    } else {
      const fixed = { window_left: 'left_of', window_right: 'right_of', window_below: 'below' };
      let side, target, gap = 2;
      if (own(fixed, anchor)) { assert(fields(placement, ['anchor', 'gap'], ['anchor']), 'PLACEMENT_INVALID'); side = fixed[anchor]; gap = placement.gap ?? 2; target = state.world.landmarks.window; }
      else {
        assert(fields(placement, ['anchor', 'target', 'gap'], ['anchor', 'target']), 'PLACEMENT_INVALID');
        side = anchor; gap = placement.gap ?? 2;
        const object = state.world.objects.find(object => object.id === placement.target);
        assert(!current || placement.target !== current.id, 'PLACEMENT_INVALID');
        target = object ? { x: object.x, y: object.y, ...dimensions(object) } : state.world.landmarks[placement.target];
      }
      assert(target, 'PLACEMENT_TARGET');
      x = center(target.x, target.width, width); y = center(target.y, target.height, height);
      if (side === 'left_of' || side === 'right_of') { x = side === 'left_of' ? target.x - gap - width : target.x + target.width + gap; y = clamp(y, 60 - height); }
      else { y = side === 'above' ? target.y - gap - height : target.y + target.height + gap; x = clamp(x, 100 - width); }
    }
    const result = { ...item, x, y };
    const movableTarget = env?.rulesVersion !== '2' && state.world.objects.some(object => object.id === placement.target && object.source.createdEventId === env?.eventId);
    assert(shape(result), movableTarget ? 'PLACEMENT_CAPACITY' : 'GEOMETRY_INVALID'); return result;
  }
  function overlaps(first, second) {
    const a = dimensions(first), b = dimensions(second);
    return first.x < second.x + b.width && first.x + a.width > second.x && first.y < second.y + b.height && first.y + a.height > second.y;
  }
  function resolvePlacement(item, op, state, current, env) {
    assert(shape(item), 'GEOMETRY_INVALID');
    const occupied = state.world.objects.filter(other => other.id !== current?.id);
    const clear = candidate => !occupied.some(other => overlaps(candidate, other));
    const anchor = op.placement?.anchor;
    if (op.allowOverlap === true) return item;
    // Fixed resize anchors cannot drift to make room. Explicit coordinates can
    // also opt out of automatic search; neither mode moves neighboring objects.
    if (op.placementPolicy === 'exact' || ['keep_center', 'keep_base'].includes(anchor)) { assert(clear(item), 'PLACEMENT_CAPACITY'); return item; }
    if (current && clear(item)) return item;
    const { width, height } = dimensions(item);
    let minX = 0, maxX = 100 - width, minY = 0, maxY = 60 - height;
    if (anchor === 'sky' || anchor === 'ground') {
      const landmark = state.world.landmarks[anchor];
      minX = landmark.x; maxX = landmark.x + landmark.width - width;
      if (anchor === 'sky') { minY = landmark.y; maxY = landmark.y + landmark.height - height; }
      else minY = maxY = item.y;
    } else if (['window_left', 'window_right', 'left_of', 'right_of'].includes(anchor)) minX = maxX = item.x;
    else if (['window_below', 'above', 'below'].includes(anchor)) minY = maxY = item.y;
    const candidates = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      assert(++env.search.work <= 250000, 'PLACEMENT_CAPACITY');
      const candidate = { ...item, x, y };
      if (clear(candidate)) candidates.push(candidate);
    }
    candidates.sort((a, b) => {
      if (!current && env.search.edge === 'top') return a.y - b.y || a.x - b.x;
      if (!current && env.search.edge === 'bottom') return b.y - a.y || a.x - b.x;
      return Number(a.y !== item.y) - Number(b.y !== item.y) || (!current && env.search.edge === 'left' ? a.x - b.x : 0) || ((a.x - item.x) ** 2 + (a.y - item.y) ** 2) - ((b.x - item.x) ** 2 + (b.y - item.y) ** 2) || a.y - b.y || a.x - b.x;
    });
    assert(candidates.length, 'PLACEMENT_CAPACITY');
    if (current) return candidates[0];
    const index = env.search.decisions.length, selected = env.search.choices[index] || 0;
    env.search.decisions.push({ selected, count: candidates.length });
    assert(selected < candidates.length, 'PLACEMENT_CAPACITY');
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
  function complete(state, node, eventId, input, answer) {
    if (state.story.completed.includes(node.id)) return;
    state.story.completed.push(node.id);
    state.story.deferred = state.story.deferred.filter(id => id !== node.question.id);
    Object.assign(state.facts, copy(node.sets));
    if (answer !== undefined) {
      state.facts['answer.' + node.question.id] = answer;
      state.story.answers[node.question.id] = { value: answer, source: source(eventId, input) };
    }
  }
  // Only consent questions use a conservative local language gate; ordinary
  // creative meaning is validated structurally, without matching literal labels.
  function explicitConsent(input) {
    if (/[“”「」『』"‘’？?]|如果|假如|假设|要是|除非|等到|说过|说[：:]|为什么|是否|可不可以|能不能|(?:允许|同意|可以|愿意).{0,20}(?:吗|么|呢)$|\b(?:if|unless|said|asked|whether|why|hypothetical)\b/iu.test(input)) return false;
    if (/(?:不|并非|没有|未曾).{0,8}(?:同意|允许|授权|愿意)|拒绝|反对|撤回|收回|禁止|不要|不想|不希望|不用|不需要|不能|不可以|别.{0,10}(?:记|保留|保存)|\b(?:not|don't|never|refuse|decline|reject|forbid)\b/iu.test(input)) return false;
    if (/(?:昨天|以前|过去|曾经|之前|上次).{0,20}(?:同意|允许|授权)|(?:同意|允许|授权|愿意)过|\b(?:yesterday|previously|earlier|used to)\b/iu.test(input)) return false;
    const text = input.replace(/^\/回答\s+/u, '');
    return /^(?:好|好的|可以|同意|我同意|允许|我允许|愿意|我愿意|是的|确认|yes|okay|ok|i agree|i consent|allow)[。！!]*$/iu.test(text) || /^(?:我(?:同意|允许|愿意)|同意|允许|愿意|你可以|请你?|希望你).{0,60}(?:记住|记得|保留|保存|留下|记录)/u.test(text) || /^(?:记住|记得)我(?:吧|。|！|!|$)/u.test(text) || /^(?:yes[,，]?\s*)?(?:you may|you can|i consent|i agree|please|i want you to)\b.{0,60}\b(?:remember|keep|save|record|retain)\b/iu.test(text);
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
    assert(CAPS.validate(op), 'OPERATION_INVALID');
    if (env.rulesVersion === '2') assert(!own(op, 'placementPolicy') && !own(op, 'allowOverlap'), 'OPERATION_INVALID');
    assert(state.pack.capabilities.includes(op.type), 'CAPABILITY_DISABLED');
    assert(!own(op, 'evidence') || op.evidence === input, 'EVIDENCE_INVALID');
    const ref = source(eventId, input);
    if (op.type === 'world.create') {
      assert(state.world.objects.length < state.world.capacity && state.world.nextId <= 10000, 'WORLD_CAPACITY');
      assert(!own(op, 'placement') || !own(op.object, 'x') && !own(op.object, 'y'), 'PLACEMENT_INVALID');
      let item = own(op, 'placement') ? placed(op.object, op.placement, state, undefined, env) : op.object;
      assert(shape(item), 'GEOMETRY_INVALID');
      if (env.rulesVersion !== '2') {
        assert(!env.replay || !own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
        item = resolvePlacement(item, op, state, undefined, env);
      }
      state.world.objects.push({ id: 'obj_' + state.world.nextId++, ...copy(item), source: { createdBy: input, lastChangedBy: input, createdEventId: eventId, eventId } });
    } else if (op.type === 'world.update') {
      const index = state.world.objects.findIndex(item => item.id === op.target); assert(index >= 0, 'TARGET_MISSING');
      const current = state.world.objects[index];
      assert(Object.keys(op.changes).length > 0 || own(op, 'placement'), 'OPERATION_EMPTY');
      assert(!own(op, 'placement') || !own(op.changes, 'x') && !own(op.changes, 'y'), 'PLACEMENT_INVALID');
      const { id, source: oldSource, ...base } = current;
      const shapeValue = { ...base, ...copy(op.changes) };
      let item = own(op, 'placement') ? placed(shapeValue, op.placement, state, current, env) : shapeValue;
      assert(shape(item), 'GEOMETRY_INVALID');
      if (env.rulesVersion !== '2' && needsPlacement(op, current, item)) {
        assert(!env.replay || !own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
        item = resolvePlacement(item, op, state, current, env);
      }
      state.world.objects[index] = { id, ...item, source: { ...oldSource, lastChangedBy: input, eventId } };
    } else if (op.type === 'world.remove') {
      const index = state.world.objects.findIndex(item => item.id === op.target); assert(index >= 0, 'TARGET_MISSING');
      state.world.objects.splice(index, 1); delete state.world.annotations[op.target];
    } else if (op.type === 'world.annotate') {
      assert(state.world.objects.some(item => item.id === op.target) || state.pack.entities.some(entity => entity.id === op.target), 'TARGET_MISSING');
      assert(op.value === null || safeText(op.value, 120), 'TEXT_INVALID');
      if (!own(state.world.annotations, op.target)) state.world.annotations[op.target] = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
      state.world.annotations[op.target][op.field] = op.value;
      state.world.annotations[op.target].sources[op.field] = ref;
    } else if (op.type === 'weather.set') {
      for (const key of ['kind', 'name']) if (own(op.changes, key)) assert(safeText(op.changes[key], key === 'kind' ? 32 : 40), 'TEXT_INVALID');
      const weather = { ...state.world.weather, ...copy(op.changes), source: ref };
      if (weather.kind === 'clear') {
        assert(!own(op.changes, 'intensity') || op.changes.intensity === 0, 'WEATHER_CONFLICT', 'world.weather');
        weather.intensity = 0;
      }
      assert(PACKS.validWeather(weather), 'WEATHER_CONFLICT', 'world.weather');
      state.world.weather = weather;
    } else if (op.type === 'memory.upsert') {
      assert(safeText(op.title, 60) && safeText(op.body, 240), 'TEXT_INVALID');
      const index = state.memories.findIndex(memory => memory.id === op.id), previous = state.memories[index] || env.noteHistory.get(op.id) || previousMemory(state, op.id);
      assert(index >= 0 || state.memories.length < MAX_MEMORIES, 'MEMORY_CAPACITY');
      const note = { id: op.id, title: op.title, body: op.body, source: previous ? previous.source : ref, currentRevision: { ...ref, number: previous ? previous.currentRevision.number + 1 : 1 } };
      if (index >= 0) state.memories[index] = note; else state.memories.push(note);
      env.noteHistory.set(op.id, note);
    } else if (op.type === 'memory.remove') {
      const index = state.memories.findIndex(memory => memory.id === op.id); assert(index >= 0, 'TARGET_MISSING'); env.noteHistory.set(op.id, state.memories[index]); state.memories.splice(index, 1);
    } else if (op.type === 'story.answer') {
      const node = initialQuestions.find(node => node.question.id === op.questionId);
      assert(node && node.completion.type === 'answer' && !state.story.completed.includes(node.id), 'ANSWER_UNAVAILABLE');
      assert(topic === node.topic && !answered.value, 'ANSWER_BOUNDARY');
      assert(safeText(op.value, 200), 'TEXT_INVALID');
      if (node.question.kind !== 'open') assert(node.question.choices.some(choice => choice.id === op.value), 'CHOICE_INVALID');
      if (node.question.kind === 'consent' && op.value === 'allow') assert(env.activeQuestion === node.question.id && explicitConsent(input), 'CONSENT_REQUIRED');
      complete(state, node, eventId, input, op.value); answered.value = true;
    } else if (op.type === 'story.defer') {
      const node = initialQuestions.find(node => node.question.id === op.questionId);
      assert(node && !state.story.completed.includes(node.id), 'QUESTION_UNAVAILABLE');
      if (!state.story.deferred.includes(node.question.id)) state.story.deferred.push(node.question.id);
    } else if (op.type === 'character.update') {
      for (const key of ['mood', 'stance']) if (own(op.changes, key)) { assert(safeText(op.changes[key], key === 'mood' ? 80 : 160), 'TEXT_INVALID'); state.character[key] = op.changes[key]; }
      for (const key of ['trust', 'familiarity']) if (own(op.changes, key + 'Delta')) {
        env.relationship[key] += op.changes[key + 'Delta']; assert(Math.abs(env.relationship[key]) <= 5, 'RELATIONSHIP_BOUND');
        state.character[key] = Math.max(0, Math.min(100, env.initialRelationship[key] + env.relationship[key]));
      }
      state.character.basis = ref;
    } else if (op.type === 'log.note') {
      assert(safeText(op.text, 160), 'TEXT_INVALID');
      state.logs.push({ id: eventId + '.note.' + state.logs.length, kind: 'character_note', text: op.text, eventId, source: ref });
    } else if (op.type === 'panel.open') return op.panel;
    if (!['story.answer', 'story.defer', 'panel.open'].includes(op.type)) for (const node of available(state)) {
      const c = node.completion;
      if (c.type === 'operation' && c.operation === op.type && (!c.target || c.target === op.target || op.type === 'weather.set' && c.target === state.pack.entities.find(entity => entity.kind === 'weather')?.id)) complete(state, node, eventId, input);
    }
    return null;
  }
  function execute(state, input, plan, rulesVersion = CAPS.RULES_VERSION, replay = false) {
    const search = { choices: [], decisions: [], work: 0, edge: false };
    let attempts = 0;
    while (attempts < 256) {
      const firstAttempt = attempts++ === 0;
      search.decisions = [];
      const result = executeAttempt(state, input, plan, rulesVersion, search, replay);
      if (result.ok || result.error.code !== 'PLACEMENT_CAPACITY' || search.work >= 250000) return result;
      // Dense batches have equivalent dead ends around either central axis.
      // Boundary seeds share the search budget and the same anchor constraints.
      if (firstAttempt && search.decisions.length) {
        for (const edge of ['left', 'top', 'bottom']) {
          const edgeSearch = { choices: [], decisions: [], work: search.work, edge };
          attempts++;
          const packed = executeAttempt(state, input, plan, rulesVersion, edgeSearch, replay);
          search.work = edgeSearch.work;
          if (packed.ok) return packed;
          if (search.work >= 250000) return result;
        }
      }
      let index = search.decisions.length - 1;
      while (index >= 0 && search.decisions[index].selected + 1 >= search.decisions[index].count) index--;
      if (index < 0) return result;
      search.choices = search.decisions.slice(0, index + 1).map(decision => decision.selected);
      search.choices[index]++;
    }
    return fail('PLACEMENT_CAPACITY');
  }
  function executeAttempt(state, input, plan, rulesVersion, search, replay) {
    try {
      assert(['2', CAPS.RULES_VERSION].includes(rulesVersion), 'EVENT_INVALID');
      assert(state.events.length < MAX_EVENTS, 'EVENT_CAPACITY');
      assert(safeText(input, MAX_INPUT), 'INPUT_INVALID');
      assert(fields(plan, ['schema', 'lines', 'beats', 'topic']) && plan.schema === CAPS.SCHEMA, 'PLAN_INVALID');
      assert(validOutput(plan), 'PROTOCOL_TEXT');
      assert(Array.isArray(plan.lines) && plan.lines.length >= 1 && plan.lines.length <= 4 && plan.lines.every(line => safeText(line, 500)), 'LINES_INVALID');
      assert(plan.topic === null || state.pack.topics.some(topic => topic.id === plan.topic), 'TOPIC_INVALID');
      assert(Array.isArray(plan.beats) && plan.beats.length <= 4, 'BEATS_INVALID');
      const lines = new Set(); let count = 0, last = -1;
      for (const beat of plan.beats) {
        assert(fields(beat, ['afterLine', 'operations']) && Number.isInteger(beat.afterLine) && beat.afterLine >= 0 && beat.afterLine < plan.lines.length && beat.afterLine > last && !lines.has(beat.afterLine) && Array.isArray(beat.operations) && beat.operations.length > 0, 'BEATS_INVALID');
        lines.add(beat.afterLine); last = beat.afterLine; count += beat.operations.length;
      }
      assert(count <= MAX_OPERATIONS, 'OPERATION_CAPACITY');
      const next = copy(state), eventId = 'event_' + (state.revision + 1), frames = [], initialQuestions = available(state);
      const event = { id: eventId, type: 'turn', rulesVersion, input, plan: copy(plan) };
      const env = { input, eventId, rulesVersion, search, replay, initialQuestions, topic: plan.topic, answered: { value: false }, relationship: { trust: 0, familiarity: 0 }, initialRelationship: { trust: state.character.trust, familiarity: state.character.familiarity }, noteHistory: new Map(), activeQuestion: activeQuestion(state) };
      next.revision++;
      next.transcript.push({ eventId, role: 'user', text: input });
      let panel = null;
      // Topic movement is staged at the first authored line, never at request time.
      for (let index = 0; index < plan.lines.length; index++) {
        if (index === 0 && plan.topic !== null) {
          next.story.topic = plan.topic;
          next.story.deferred = next.story.deferred.filter(id => !next.pack.nodes.some(node => node.question.id === id && node.topic === plan.topic));
        }
        next.transcript.push({ eventId, role: 'character', text: plan.lines[index], line: index });
        const beat = plan.beats.find(beat => beat.afterLine === index);
        if (beat) {
          const operations = [];
          const storedBeat = event.plan.beats.find(candidate => candidate.afterLine === index);
          for (let operationIndex = 0; operationIndex < beat.operations.length; operationIndex++) {
            const op = beat.operations[operationIndex], previous = op.type === 'world.update' ? next.world.objects.find(item => item.id === op.target) : null;
            const requestedPanel = apply(next, op, env);
            if (requestedPanel) panel = requestedPanel;
            if (rulesVersion !== '2') storedBeat.operations[operationIndex] = normalizeGeometry(op, next, previous);
            operations.push(op.type);
          }
          const nonPanels = operations.filter(type => type !== 'panel.open');
          if (nonPanels.length) next.focus = { source: source(eventId, input), operations: nonPanels };
          next.logs.push({ id: eventId + '.beat.' + index, kind: 'operations', text: 'Validated operations', eventId, source: source(eventId, input), operations });
        }
        frames.push(projection(next, panel));
      }
      next.events.push(event);
      next.logs.push({ id: eventId, kind: 'turn', text: 'Validated turn', eventId, source: source(eventId, input), operations: plan.beats.flatMap(beat => beat.operations.map(op => op.type)) });
      // The last projection includes the locally generated validation receipt.
      frames[frames.length - 1] = projection(next, panel);
      makeContext(next);
      return { ok: true, state: seal(next), frames: freeze(frames), lines: freeze(copy(plan.lines)) };
    } catch (error) { return fail(error.code || 'PLAN_INVALID', error.path || '$'); }
  }
  function commit(state, candidate, plan) {
    if (!states.has(state)) return fail('STATE_INVALID');
    if (!candidate || proposals.get(candidate) !== state || candidate.baseRevision !== state.revision || candidate.baseDigest !== digest(state)) return fail('STALE_PROPOSAL');
    return execute(state, candidate.text, plan);
  }
  function observe(state, event) {
    requireState(state);
    assert(fields(event, ['type', 'panel']) && event.type === 'panel.viewed' && CAPS.panels.includes(event.panel), 'OBSERVATION_INVALID');
    assert(state.events.length < MAX_EVENTS, 'EVENT_CAPACITY');
    const next = copy(state), eventId = 'event_' + (state.revision + 1);
    next.revision++;
    next.events.push({ id: eventId, type: 'panel.viewed', panel: event.panel });
    next.logs.push({ id: eventId, kind: 'ui', text: 'Panel viewed: ' + event.panel, eventId, source: null });
    // A real local observation, never model prose, is the only UI completion path.
    for (const node of available(state)) if (node.completion.type === 'ui' && node.completion.panel === event.panel) complete(next, node, eventId, '', undefined);
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
    'rain-lab': { '1': '402db16c', '2': '362c6f2f' },
    'lantern-lab': { '1': '8dd7d018', '2': '36792093' }
  });
  function migrationBinding(saved, pack) {
    assert(fields(saved, ['id', 'version', 'rulesVersion', 'digest']), 'PACK_MISMATCH');
    if (saved.id === pack.id && saved.version === pack.version && saved.rulesVersion === pack.rulesVersion && saved.digest === digest(pack)) return null;
    const predecessor = RULES_PREDECESSORS[pack.id]?.[saved.rulesVersion];
    assert(predecessor && pack.version === '1.0.0' && pack.rulesVersion === CAPS.RULES_VERSION && saved.id === pack.id && saved.version === pack.version && saved.digest === predecessor && digest({ ...copy(pack), rulesVersion: saved.rulesVersion }) === predecessor, 'PACK_MISMATCH');
    return freeze({ type: 'object-placement-v3', fromRulesVersion: saved.rulesVersion, toRulesVersion: CAPS.RULES_VERSION, fromPackDigest: predecessor, toPackDigest: digest(pack) });
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
      let state = baseFromSave(pack, save.importedSnapshot), currentRulesSeen = false;
      for (const event of save.events) {
        assert(plain(event) && event.id === 'event_' + (state.revision + 1), 'EVENT_INVALID');
        if (event.type === 'turn') {
          assert(fields(event, ['id', 'type', 'rulesVersion', 'input', 'plan'], migration ? ['id', 'type', 'input', 'plan'] : ['id', 'type', 'rulesVersion', 'input', 'plan']), 'EVENT_INVALID');
          const rulesVersion = migration ? '2' : event.rulesVersion;
          assert(!migration || !own(event, 'rulesVersion'), 'EVENT_INVALID');
          // Historical rules form a prefix. An observation does not end that
          // prefix, but current-rule turns can never downgrade replay semantics.
          assert(rulesVersion !== '2' || !currentRulesSeen, 'EVENT_INVALID');
          if (rulesVersion === CAPS.RULES_VERSION) currentRulesSeen = true;
          if (rulesVersion === CAPS.RULES_VERSION) for (const beat of event.plan?.beats || []) for (const op of beat.operations || []) {
            if (op.type === 'world.create' || op.type === 'world.update' && (own(op, 'placement') || ['x', 'y'].some(key => own(op.changes || {}, key)))) assert(!own(op, 'placement') && op.placementPolicy === 'exact', 'EVENT_INVALID');
          }
          const result = execute(state, event.input, event.plan, rulesVersion, true); assert(result.ok, result.error?.code || 'EVENT_INVALID'); state = result.state;
        } else {
          assert(fields(event, ['id', 'type', 'panel']), 'EVENT_INVALID'); state = observe(state, { type: event.type, panel: event.panel });
        }
      }
      return { ok: true, state, ...(migration ? { migration } : {}) };
    } catch (error) { return fail(error.code || 'SAVE_INVALID', error.path || '$'); }
  }
  function importLegacy(snapshot, pack) {
    try {
      const state = copy(create(pack));
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
        state.memories.push({ id: memory.id, title: memory.title, body: memory.body, source: memory.source === null ? null : source('legacy', memory.source), currentRevision: { ...source('legacy', own(memory, 'latestSource') ? memory.latestSource : memory.source), number: own(memory, 'latestSource') && memory.latestSource !== memory.source ? 2 : 1 } });
      }
      assert(Array.isArray(snapshot.transcript) && snapshot.transcript.length <= 5000 && snapshot.transcript.every(item => fields(item, ['role', 'text']) && ['user', 'character', 'system'].includes(item.role) && safeText(item.text, 1000)), 'IMPORT_TRANSCRIPT');
      state.transcript = snapshot.transcript.map(item => ({ eventId: 'legacy', ...copy(item) }));
      const declared = {};
      for (const [key, value] of Object.entries(pack.initialFacts)) declared[key] = [value];
      for (const node of pack.nodes) for (const [key, value] of Object.entries(node.sets)) (declared[key] || (declared[key] = [])).push(value);
      assert(plain(snapshot.facts) && Object.keys(snapshot.facts).length <= 128 && Object.entries(snapshot.facts).every(([key, value]) => own(declared, key) && declared[key].includes(value)), 'IMPORT_FACTS');
      Object.assign(state.facts, copy(snapshot.facts));
      for (const node of pack.nodes) if (node.question.kind !== 'consent' && Object.keys(node.sets).length && Object.entries(node.sets).every(([key, value]) => own(snapshot.facts, key) && snapshot.facts[key] === value)) state.story.completed.push(node.id);
      const pending = available(state)[0]; if (pending) state.story.topic = pending.topic;
      state.importedSnapshot = copy(snapshot);
      state.logs.push({ id: 'legacy', kind: 'import', text: 'Imported validated legacy state', eventId: 'legacy', source: null });
      makeContext(state);
      return { ok: true, state: seal(state) };
    } catch (error) { return fail(error.code || 'IMPORT_INVALID', error.path || '$'); }
  }
  return Object.freeze({ create, propose: proposal, commit, view, observe, restore, serialize, context, validatePack: PACKS.validatePack, importLegacy, explicitConsent, constants: freeze({ MAX_INPUT, MAX_EVENTS, MAX_MEMORIES, MAX_OPERATIONS, MAX_CONTEXT_BYTES }) });
});
