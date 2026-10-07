'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../framework/memory-policy.js');
const clone = value => JSON.parse(JSON.stringify(value));
const ids = M.recordIds;
const plan = (body, other = {}) => ({ id: 'note_color', title: '颜色', body, kind: 'preference', perspective: 'player_report', ...other });
function rawContext() {
  return {
    schema: 'her-world-context-v1', revision: 0,
    pack: { id: 'test', version: '1', rulesVersion: '3', title: '验证' }, guidance: '自由聊天',
    character: { name: '她', role: '虚构角色', mood: '好奇', stance: '愿意倾听', trust: 3, familiarity: 2, basis: null },
    world: { grid: { cols: 100, rows: 60 }, capacity: 8, landmarks: {}, nextId: 2, objects: [], annotations: {}, weather: { kind: 'rain', name: '夜雨', intensity: 1, paused: false, source: null } },
    entities: [], memories: [], story: { topic: 'rain', completed: ['learned'], deferred: [], answers: {} }, facts: {},
    pendingQuestions: [{ id: 'q_next', text: '接下来呢？', topic: 'rain' }], activeQuestionId: 'q_next',
    topics: [{ id: 'rain', title: '雨' }], capabilities: [], recentTranscript: []
  };
}
function put(policy, raw, eventId, input, operation = plan(input)) {
  const exposure = M.projectContext(raw, policy).exposure;
  const result = M.upsertMemory(policy, operation, { eventId, input, exposure });
  raw.memories = [...raw.memories.filter(note => note.id !== operation.id), result.note];
  return result;
}
const source = (eventId, input, span) => ({ eventId, text: input, ...(span ? { span } : {}) });

test('selective memory uses typed metadata, exact current-input support and an interpretation default', () => {
  const input = '我喜欢雨。';
  const direct = M.validateMemoryMetadata(plan(input), { eventId: 'event_1', input });
  assert.equal(direct.perspective, 'player_report');
  assert.equal(direct.support.quote, input);
  const inferred = M.validateMemoryMetadata({ id: 'note_rain', title: '雨', body: '她觉得雨让这里安静下来' }, { eventId: 'event_1', input });
  assert.equal(inferred.kind, 'note');
  assert.equal(inferred.perspective, 'character_interpretation');
  assert.equal(inferred.support.quote, input);
  assert.deepEqual(M.createPolicy().active, {});
});

test('player reports cannot turn an inference or invented quotation into a sourced fact', () => {
  const input = '今天有点累';
  assert.throws(() => M.validateMemoryMetadata(plan('玩家讨厌社交'), { eventId: 'event_1', input }), /MEMORY_CLAIM_INVALID/);
  assert.throws(() => M.validateMemoryMetadata(plan(input, { support: { start: 0, end: 2, quote: '昨天' } }), { eventId: 'event_1', input }), /MEMORY_SUPPORT_INVALID/);
  assert.throws(() => M.validateMemoryMetadata(plan(input, { perspective: 'known_fact' }), { eventId: 'event_1', input }), /MEMORY_METADATA_INVALID/);
  assert.throws(() => M.validateMemoryMetadata(plan(input, { perspective: 'shared_event' }), { eventId: 'event_1', input }), /MEMORY_SHARED_EVENT_UNVERIFIED/);
  assert.throws(() => M.validateMemoryMetadata(plan(input, { perspective: 'shared_event' }), { eventId: 'event_1', input, sharedEventVerified: true }), /MEMORY_SHARED_EVENT_UNVERIFIED/);
});

test('support spans count Unicode code points and reject empty or out-of-range support', () => {
  const input = '🌧我喜欢雨';
  const value = M.validateMemoryMetadata(plan('我喜欢雨', { support: { start: 1, end: 5, quote: '我喜欢雨' } }), { eventId: 'event_1', input });
  assert.equal(value.support.start, 1);
  assert.equal(value.support.quote, '我喜欢雨');
  assert.throws(() => M.sourceSpan('event_1', input, 1, 1), /MEMORY_SUPPORT_INVALID/);
  assert.throws(() => M.sourceSpan('event_1', input, 0, 6), /MEMORY_SUPPORT_INVALID/);
});

test('projector excludes audit, logs, focus, tombstones, debug and unknown nested dynamic fields', () => {
  const raw = rawContext(), secret = 'AUDIT_ONLY_SENTINEL';
  raw.events = [{ input: secret }]; raw.logs = [secret]; raw.transcript = [secret]; raw.debug = secret; raw.recall = { tombstones: [secret] }; raw.focus = { source: secret };
  raw.character.debug = secret;
  raw.world.objects.push({ id: 'obj_1', label: '灯', glyphs: '*', x: 2, y: 4, scale: 1, debug: secret, source: null });
  const result = M.projectContext(raw, M.createPolicy());
  assert.equal(JSON.stringify(result.context).includes(secret), false);
  assert.deepEqual(result.context.pendingQuestions, raw.pendingQuestions);
  assert.equal(result.context.activeQuestionId, 'q_next');
  assert.ok(Object.isFrozen(result.context.world));
});

test('one deletion excludes a sentinel from every recall channel and keeps observed world/progression', () => {
  const raw = rawContext(), secret = 'FORGOTTEN_SENTINEL';
  let { policy, note } = put(M.createPolicy(), raw, 'event_1', secret);
  raw.character.stance = secret; raw.character.mood = secret; raw.character.basis = source('event_1', secret);
  raw.world.objects.push({ id: 'obj_1', label: '小灯', glyphs: '*', x: 2, y: 4, scale: 1, source: { createdBy: secret, lastChangedBy: secret, createdEventId: 'event_1', eventId: 'event_1' } });
  raw.world.weather.source = source('event_1', secret);
  raw.world.annotations.obj_1 = { meaning: secret, interpretation: secret, sources: { meaning: source('event_1', secret), interpretation: source('event_1', secret) } };
  raw.story.answers.q_rain = { value: secret, source: source('event_1', secret) };
  raw.facts['answer.q_rain'] = secret; raw.facts.learned_meaning = secret;
  raw.recentTranscript = [{ eventId: 'event_1', role: 'user', text: secret }, { eventId: 'event_1', role: 'character', text: secret, line: 0 }, { eventId: 'event_2', role: 'user', text: '忘掉' + secret }];
  policy = M.forgetMemory(policy, note, { eventId: 'event_2' });
  const projected = M.projectContext(raw, policy).context;
  const completePayload = JSON.stringify({ definition: { pack: projected.pack, persona: { name: projected.character.name, role: projected.character.role }, guidance: projected.guidance, topics: projected.topics, capabilities: projected.capabilities }, playerSaid: '继续', context: projected });
  assert.equal(completePayload.includes(secret), false);
  assert.deepEqual(projected.world.objects[0], { id: 'obj_1', label: '小灯', glyphs: '*', x: 2, y: 4, scale: 1, source: { createdBy: null, lastChangedBy: null, createdEventId: null, eventId: null } });
  assert.equal(projected.world.weather.name, '夜雨');
  assert.equal(projected.world.weather.intensity, 1);
  assert.equal(projected.character.trust, 3);
  assert.deepEqual(projected.story.completed, ['learned']);
  assert.deepEqual(projected.pendingQuestions, raw.pendingQuestions);
  assert.equal(raw.memories[0].body, secret, 'audit input stays unchanged');
  assert.equal(JSON.stringify(policy.tombstones).includes(secret), false);
});

test('retrieved dependencies hide a later paraphrase and transitive derivations without string matching', () => {
  const raw = rawContext();
  let { policy, note } = put(M.createPolicy(), raw, 'event_1', '我偏爱海蓝色');
  const exposed = M.projectContext(raw, policy).exposure;
  policy = M.recordDerivation(policy, ids.character('stance'), { sources: [M.sourceSpan('event_2', '你怎么理解')], exposure: exposed });
  raw.character.stance = '那个人会选接近海水的色调'; raw.character.basis = source('event_2', '你怎么理解');
  raw.memories = [];
  const secondExposure = M.projectContext(raw, policy).exposure;
  policy = M.recordDerivation(policy, ids.annotation('obj_1', 'interpretation'), { sources: [M.sourceSpan('event_3', '继续')], exposure: secondExposure });
  raw.world.annotations.obj_1 = { meaning: null, interpretation: '深海是他钟爱的颜色', sources: { meaning: null, interpretation: source('event_3', '继续') } };
  policy = M.forgetMemory(policy, note, { eventId: 'event_4' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.character.stance, null);
  assert.equal(projected.world.annotations.obj_1.interpretation, null);
  assert.equal(JSON.stringify(projected).includes('深海'), false);
});

test('unrelated supported same-turn facts survive, while mixed transcript text is conservatively omitted', () => {
  const raw = rawContext(), first = '我喜欢蓝色。', second = '雨像一封信。', input = first + second;
  const length = [...first].length;
  let { policy, note } = put(M.createPolicy(), raw, 'event_1', input, plan(first, { support: { start: 0, end: length, quote: first } }));
  const other = M.sourceSpan('event_1', input, length, [...input].length);
  policy = M.recordDerivation(policy, ids.answer('q_rain'), { sources: [other] });
  policy = M.recordDerivation(policy, ids.fact('rain_described'), { sources: [other] });
  raw.story.answers.q_rain = { value: second, source: source('event_1', input) };
  raw.facts['answer.q_rain'] = second; raw.facts.rain_described = true;
  raw.recentTranscript = [{ eventId: 'event_1', role: 'user', text: input }];
  policy = M.forgetMemory(policy, note, { eventId: 'event_2' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.story.answers.q_rain.value, second);
  assert.equal(projected.story.answers.q_rain.source.text, second);
  assert.equal(projected.facts['answer.q_rain'], second);
  assert.equal(projected.facts.rain_described, true);
  assert.deepEqual(projected.recentTranscript, []);
  assert.equal(JSON.stringify(projected).includes(first), false);
});

test('unrelated independent notes survive; deleting a derived note does not delete everything it read', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我们等雨停', plan('我们等雨停', { id: 'note_wait', kind: 'promise' }));
  const first = result.note;
  result = put(result.policy, raw, 'event_2', '我喜欢蓝色');
  const policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_3' });
  assert.deepEqual(M.projectContext(raw, policy).context.memories.map(item => M.resolveHandle(policy, item.id)), [first.id]);
});

test('relearning starts a new generation with only the new source and fresh dependencies', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  let policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_2' });
  result = put(policy, raw, 'event_3', '我现在喜欢绿色');
  assert.equal(result.note.generation, 2);
  assert.equal(result.note.currentRevision.number, 1);
  assert.equal(result.note.source.eventId, 'event_3');
  assert.equal(result.note.source.text, '我现在喜欢绿色');
  assert.deepEqual(M.projectContext(raw, result.policy).context.memories.map(item => item.body), ['我现在喜欢绿色']);
  assert.equal(JSON.stringify(M.projectContext(raw, result.policy).context).includes('我喜欢蓝色'), false);
});

test('deletion covers all note revision support, including an intermediate revision', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  result = put(result.policy, raw, 'event_2', '现在喜欢黄色');
  result = put(result.policy, raw, 'event_3', '后来喜欢绿色');
  assert.equal(result.note.currentRevision.number, 3);
  raw.recentTranscript = [{ eventId: 'event_2', role: 'user', text: '现在喜欢黄色' }];
  const policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_4' });
  assert.deepEqual(M.projectContext(raw, policy).context.recentTranscript, []);
});

test('derived memory records inherit actual retrieval exposure and cannot accept a forged list', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  const first = result.note;
  result = put(result.policy, raw, 'event_2', '你怎么看', plan('她把海色与来访者联系起来', { id: 'note_view', perspective: 'character_interpretation' }));
  const policy = M.forgetMemory(result.policy, first, { eventId: 'event_3' });
  assert.deepEqual(M.projectContext(raw, policy).context.memories, []);
  assert.throws(() => M.recordDerivation(policy, 'test:record', { exposure: { records: [], sources: [] } }), /RECALL_EXPOSURE_INVALID/);
  assert.throws(() => M.recordDerivation(policy, 'test:record', { exposure: clone(M.projectContext(raw, policy).exposure) }), /RECALL_EXPOSURE_INVALID/);
});

test('policy updates are immutable and a failed operation leaves the original suitable for rollback', () => {
  const raw = rawContext(), original = M.createPolicy(), before = JSON.stringify(original);
  assert.throws(() => M.upsertMemory(original, plan('他害怕下雨'), { eventId: 'event_1', input: '我喜欢雨' }), /MEMORY_CLAIM_INVALID/);
  assert.equal(JSON.stringify(original), before);
  const result = put(original, raw, 'event_1', '我喜欢雨');
  const saved = JSON.stringify(result.policy);
  assert.throws(() => M.forgetMemory(result.policy, result.note, { eventId: 'not an event' }), /MEMORY_REMOVE_INVALID/);
  assert.equal(JSON.stringify(result.policy), saved);
  const removed = M.forgetMemory(result.policy, result.note, { eventId: 'event_2' });
  assert.equal(result.policy.tombstones.length, 0);
  assert.equal(removed.tombstones.length, 1);
  assert.ok(Object.isFrozen(removed.tombstones));
});

test('JSON roundtrip preserves filtering and generation state without persisting exposure tokens', () => {
  const raw = rawContext();
  const result = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  const policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_2' });
  const restored = clone(policy);
  assert.doesNotThrow(() => M.validatePolicy(restored));
  assert.deepEqual(M.projectContext(raw, restored).context, M.projectContext(raw, policy).context);
  assert.equal(M.upsertMemory(restored, plan('我喜欢绿色'), { eventId: 'event_3', input: '我喜欢绿色', exposure: M.projectContext(raw, restored).exposure }).note.generation, 2);
});

test('unknown legacy provenance is conservative and current visible labels stay observable', () => {
  const raw = rawContext(), input = '旧记忆';
  const note = { id: 'note_old', title: '旧事', body: input, source: { eventId: 'legacy', text: input }, currentRevision: { eventId: 'legacy', text: input, number: 1 } };
  raw.memories = [note, { id: 'note_unknown', title: '不明', body: '可能引用旧事', source: null, currentRevision: null }];
  raw.recentTranscript = [{ eventId: 'legacy', role: 'user', text: '不完整的旧记录' }];
  raw.world.objects = [{ id: 'obj_1', label: input, glyphs: '*', x: 1, y: 1, scale: 1, source: { createdBy: input, lastChangedBy: input, createdEventId: 'legacy', eventId: 'legacy' } }];
  const policy = M.forgetMemory(M.createPolicy(), note, { eventId: 'event_1' });
  const projected = M.projectContext(raw, policy).context;
  assert.deepEqual(projected.memories, []);
  assert.deepEqual(projected.recentTranscript, []);
  assert.equal(projected.world.objects[0].label, input, 'still-visible labels are observations, not erased recollections');
  assert.equal(projected.world.objects[0].source.createdBy, null);
});

test('unregistered generated answers and annotations do not become trusted merely by having a later input source', () => {
  const raw = rawContext();
  const result = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  raw.world.annotations.obj_1 = { meaning: '他喜爱海水的颜色', interpretation: '蓝色代表他', sources: { meaning: source('event_2', '你还记得吗'), interpretation: source('event_2', '你还记得吗') } };
  raw.story.answers.q_color = { value: '海蓝', source: source('event_2', '你还记得吗') };
  raw.facts['answer.q_color'] = '海蓝';
  const policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_3' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.world.annotations.obj_1.meaning, null);
  assert.equal(projected.world.annotations.obj_1.interpretation, null);
  assert.equal(projected.story.answers.q_color, undefined);
  assert.equal(projected.facts['answer.q_color'], undefined);
});

test('entirely unknown legacy note provenance suppresses legacy recall but permits a fresh current input', () => {
  const raw = rawContext();
  const note = { id: 'note_unknown', title: '旧事', body: '未知来源', source: null, currentRevision: null };
  raw.memories = [note];
  raw.recentTranscript = [{ eventId: 'legacy', role: 'user', text: '未知来源' }, { eventId: 'event_2', role: 'user', text: '现在重新告诉你' }];
  const policy = M.forgetMemory(M.createPolicy(), note, { eventId: 'event_1' });
  assert.deepEqual(M.projectContext(raw, policy).context.recentTranscript.map(item => item.text), ['现在重新告诉你']);
});

test('a stale old-generation note cannot remove a newly learned generation', () => {
  const raw = rawContext();
  const first = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  const removed = M.forgetMemory(first.policy, first.note, { eventId: 'event_2' });
  const next = put(removed, raw, 'event_3', '我喜欢绿色');
  assert.throws(() => M.forgetMemory(next.policy, first.note, { eventId: 'event_4' }), /MEMORY_STALE_GENERATION/);
  assert.equal(next.policy.active.note_color.generation, 2);
});

test('validated legacy import preserves original attribution through a correction and resets it after forgetting', () => {
  const raw = rawContext();
  const old = { id: 'note_color', title: '颜色', body: '旧解释', source: { eventId: 'legacy', text: '旧来源' }, currentRevision: { eventId: 'legacy', text: '后来修正', number: 2 } };
  raw.memories = [old];
  let policy = M.importMemory(M.createPolicy(), old);
  let result = put(policy, raw, 'event_1', '我喜欢绿色');
  assert.deepEqual(result.note.source, old.source);
  assert.equal(result.note.currentRevision.number, 3);
  policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_2' });
  result = put(policy, raw, 'event_3', '我现在喜欢黄色');
  assert.equal(result.note.generation, 2);
  assert.equal(result.note.source.eventId, 'event_3');
  assert.equal(result.note.currentRevision.number, 1);
  assert.throws(() => M.importMemory(policy, old), /MEMORY_IMPORT_INVALID/);
});

test('a validated bench operation can support only its canonical shared-event summary', () => {
  const input = '放一张长椅';
  const sharedEvent = M.sharedEventFromOperation('event_1', 0, { type: 'world.create', target: 'obj_1', label: '长椅' });
  const valid = plan(sharedEvent.summary, { kind: 'experience', perspective: 'shared_event' });
  const metadata = M.validateMemoryMetadata(valid, { eventId: 'event_1', input, sharedEvent });
  assert.deepEqual(metadata.eventSupport, { eventId: 'event_1', index: 0, type: 'world.create', target: 'obj_1' });
  assert.throws(() => M.validateMemoryMetadata({ ...valid, body: '我们一起去了巴黎' }, { eventId: 'event_1', input, sharedEvent }), /MEMORY_SHARED_EVENT_UNVERIFIED/);
  assert.throws(() => M.validateMemoryMetadata(valid, { eventId: 'event_2', input, sharedEvent }), /MEMORY_SHARED_EVENT_UNVERIFIED/);
  assert.throws(() => M.validateMemoryMetadata(valid, { eventId: 'event_1', input, sharedEvent: clone(sharedEvent) }), /MEMORY_SHARED_EVENT_UNVERIFIED/);
});

test('source-free registered pack facts survive deletion without changing the pending route', () => {
  const raw = rawContext(); raw.facts.pack_ready = true;
  let policy = M.recordDerivation(M.createPolicy(), ids.fact('pack_ready'), { sources: [] });
  const result = put(policy, raw, 'event_1', '我喜欢蓝色');
  policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_2' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.facts.pack_ready, true);
  assert.equal(projected.activeQuestionId, raw.activeQuestionId);
});

test('updating a logical field keeps old dependent records bound to the old provenance node', () => {
  const raw = rawContext();
  let { policy, note } = put(M.createPolicy(), raw, 'event_1', '我喜欢蓝色');
  policy = M.recordDerivation(policy, ids.character('stance'), { sources: [M.sourceSpan('event_2', '想一想')], exposure: M.projectContext(raw, policy).exposure });
  raw.character.stance = '联想到海色'; raw.character.basis = source('event_2', '想一想');
  policy = M.recordDerivation(policy, ids.annotation('obj_1', 'interpretation'), { sources: [M.sourceSpan('event_3', '说下去')], exposure: M.projectContext(raw, policy).exposure });
  raw.world.annotations.obj_1 = { meaning: null, interpretation: '他偏爱的颜色在海里', sources: { meaning: null, interpretation: source('event_3', '说下去') } };
  policy = M.forgetMemory(policy, note, { eventId: 'event_4' });
  policy = M.recordDerivation(policy, ids.character('stance'), { sources: [M.sourceSpan('event_5', '重新开始')] });
  raw.character.stance = '听新的故事'; raw.character.basis = source('event_5', '重新开始');
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.character.stance, '听新的故事');
  assert.equal(projected.world.annotations.obj_1.interpretation, null);
});

test('1000 repeated turns retain a linear direct-dependency graph with bounded per-record references', () => {
  const raw = rawContext();
  let policy = M.createPolicy(), halfway = 0;
  for (let index = 1; index <= 1000; index++) {
    const eventId = 'event_' + index, input = '继续第' + index + '回';
    const exposure = M.projectContext(raw, policy).exposure;
    policy = M.recordDerivation(policy, ids.character('stance'), { sources: [M.sourceSpan(eventId, input)], exposure });
    policy = M.recordDerivation(policy, ids.transcript(eventId, 'character', 0), { sources: [M.sourceSpan(eventId, input)], exposure });
    raw.character.stance = '继续听'; raw.character.basis = source(eventId, input);
    raw.recentTranscript.push({ eventId, role: 'user', text: input }, { eventId, role: 'character', text: '继续听', line: 0 });
    raw.recentTranscript = raw.recentTranscript.slice(-12);
    if (index === 500) halfway = JSON.stringify(policy).length;
  }
  const records = Object.values(policy.records);
  assert.equal(records.length, 1000, 'identical stance/line provenance shares one immutable node per turn');
  assert.ok(records.every(record => record.ownSources.length === 1 && record.sources.length <= 6 && record.dependencies.length <= 7));
  assert.ok(records.reduce((sum, record) => sum + record.sources.length + record.dependencies.length, 0) < 26000);
  assert.ok(JSON.stringify(policy).length < halfway * 2.2);
  assert.ok(JSON.stringify(policy).length < 1600000);
  assert.doesNotThrow(() => M.validatePolicy(clone(policy)));
});

test('quote-only support resolves a unique substring and requires explicit offsets for repetition', () => {
  const input = '🌧我喜欢雨，尤其喜欢小雨';
  const metadata = M.validateMemoryMetadata(plan('我喜欢雨', { support: { quote: '我喜欢雨' } }), { eventId: 'event_1', input });
  assert.deepEqual(metadata.support, { eventId: 'event_1', channel: 'player', start: 1, end: 5, quote: '我喜欢雨' });
  assert.throws(() => M.validateMemoryMetadata(plan('雨', { support: { quote: '雨' } }), { eventId: 'event_1', input }), /MEMORY_SUPPORT_AMBIGUOUS/);
  assert.throws(() => M.validateMemoryMetadata(plan('雨', { support: { quote: '雨', start: 4 } }), { eventId: 'event_1', input }), /MEMORY_SUPPORT_INVALID/);
  assert.equal(M.validateMemoryMetadata(plan('雨', { support: { quote: '雨', start: 4, end: 5 } }), { eventId: 'event_1', input }).support.start, 4);
});

test('historical replay preserves note projection and remove/revive provenance before modern forgetting', () => {
  const raw = rawContext(), firstSource = { eventId: 'event_1', text: '最早的原话' };
  const first = { id: 'note_color', title: '颜色', body: '旧笔记', source: firstSource, currentRevision: { ...firstSource, number: 1 } };
  const firstJSON = JSON.stringify(first);
  let policy = M.trackHistoricalMemory(M.createPolicy(), first, { eventId: 'event_1', input: firstSource.text, exposure: M.projectContext(raw, M.createPolicy()).exposure });
  assert.equal(JSON.stringify(first), firstJSON);
  policy = M.dropHistoricalMemory(policy, first.id);
  assert.deepEqual(policy.tombstones, []);
  const revived = { ...first, body: '重新留下的旧笔记', currentRevision: { eventId: 'event_3', text: '又回来了', number: 2 } };
  policy = M.trackHistoricalMemory(policy, revived, { eventId: 'event_3', input: '又回来了' });
  assert.deepEqual(policy.active.note_color.origin, firstSource);
  assert.equal(policy.active.note_color.revision, 2);
  policy = M.forgetMemory(policy, revived, { eventId: 'event_4' });
  raw.memories = [revived];
  assert.deepEqual(M.projectContext(raw, policy).context.memories, []);
  const modern = put(policy, raw, 'event_5', '现在的新记忆');
  assert.equal(modern.note.generation, 2);
  assert.equal(modern.note.source.eventId, 'event_5');
});

test('an independent player quotation cannot leak a forgotten source through its freely generated title', () => {
  const raw = rawContext(), secret = 'FORGOTTEN_TITLE_SECRET';
  const first = put(M.createPolicy(), raw, 'event_1', secret);
  const second = put(first.policy, raw, 'event_2', '现在喜欢绿色', plan('现在喜欢绿色', { id: 'note_green', title: secret }));
  const policy = M.forgetMemory(second.policy, first.note, { eventId: 'event_3' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.memories.length, 1);
  assert.equal(projected.memories[0].body, '现在喜欢绿色');
  assert.equal(projected.memories[0].title, '偏好');
  assert.equal(JSON.stringify(projected).includes(secret), false);
});

test('fresh exact evidence rehabilitates a hidden note while old origin and revision sources stay separately controlled', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我喜欢红茶');
  const original = result.note;
  result = put(result.policy, raw, 'event_2', '根据这件事写个总结', plan('他偏爱红茶', { id: 'note_view', title: '理解', perspective: 'character_interpretation' }));
  const hidden = result.note;
  let policy = M.forgetMemory(result.policy, original, { eventId: 'event_3' });
  assert.deepEqual(M.projectContext(raw, policy).context.memories, []);
  result = put(policy, raw, 'event_4', '我现在喜欢绿茶', plan('我现在喜欢绿茶', { id: hidden.id, title: '偏好' }));
  let projected = M.projectContext(raw, result.policy).context;
  assert.equal(projected.memories.length, 1);
  assert.equal(projected.memories[0].body, '我现在喜欢绿茶');
  assert.equal(projected.memories[0].source, null);
  assert.equal(projected.memories[0].currentRevision.eventId, 'event_4');
  assert.equal(result.note.currentRevision.number, 2);
  assert.equal(result.note.source.eventId, 'event_2', 'audit origin remains untouched');
  policy = M.forgetMemory(result.policy, result.note, { eventId: 'event_5' });
  raw.recentTranscript = [{ eventId: 'event_2', role: 'user', text: '根据这件事写个总结' }, { eventId: 'event_4', role: 'user', text: '我现在喜欢绿茶' }];
  projected = M.projectContext(raw, policy).context;
  assert.deepEqual(projected.memories, []);
  assert.deepEqual(projected.recentTranscript, [], 'future removal still traverses all audit revisions');
});

test('precise removal support preserves independent same-turn reports in either operation order, but quarantines withdrawn quotes and dialogue', () => {
  for (const removeFirst of [true, false]) {
    const raw = rawContext();
    let first = put(M.createPolicy(), raw, 'event_1', '我喜欢红茶');
    first = put(first.policy, raw, 'event_2', '我后来喜欢咖啡');
    const input = '忘记我喜欢红茶，同时我现在喜欢绿茶';
    const exposure = M.projectContext(raw, first.policy).exposure;
    let policy = first.policy;
    const remove = () => { policy = M.forgetMemory(policy, first.note, { eventId: 'event_3', input, support: { quote: '忘记我喜欢红茶' } }); };
    if (removeFirst) remove();
    const green = M.upsertMemory(policy, plan('我现在喜欢绿茶', { id: 'note_green', title: '偏好', support: { quote: '我现在喜欢绿茶' } }), { eventId: 'event_3', input, exposure });
    policy = green.policy;
    const withdrawn = M.upsertMemory(policy, plan('我喜欢红茶', { id: 'note_withdrawn', title: '偏好', support: { quote: '我喜欢红茶' } }), { eventId: 'event_3', input, exposure });
    policy = withdrawn.policy;
    if (!removeFirst) remove();
    policy = M.recordDerivation(policy, ids.character('stance'), { sources: [M.sourceSpan('event_3', input)], exposure });
    raw.memories = [green.note, withdrawn.note];
    raw.character.stance = '他从前偏爱红茶'; raw.character.basis = source('event_3', input);
    raw.recentTranscript = [{ eventId: 'event_3', role: 'user', text: input }, { eventId: 'event_3', role: 'character', text: '已经忘记红茶了', line: 0 }];
    const projected = M.projectContext(raw, policy).context;
    assert.deepEqual(projected.memories.map(note => note.body), ['我现在喜欢绿茶']);
    assert.equal(projected.character.stance, null);
    assert.deepEqual(projected.recentTranscript, []);
    assert.equal(JSON.stringify(projected).includes('红茶'), false);
  }
});

test('missing removal support remains conservative and invalid scope cannot mutate policy', () => {
  const raw = rawContext(), first = put(M.createPolicy(), raw, 'event_1', '我喜欢红茶');
  const before = JSON.stringify(first.policy), input = '忘记旧的偏好，同时我现在喜欢绿茶';
  assert.throws(() => M.forgetMemory(first.policy, first.note, { eventId: 'event_2', input, support: { quote: '不在原文中' } }), /MEMORY_SUPPORT_INVALID/);
  assert.equal(JSON.stringify(first.policy), before);
  const removed = M.forgetMemory(first.policy, first.note, { eventId: 'event_2', input });
  const green = put(removed, raw, 'event_2', input, plan('我现在喜欢绿茶', { id: 'note_green', title: '偏好', support: { quote: '我现在喜欢绿茶' } }));
  assert.deepEqual(M.projectContext(raw, green.policy).context.memories, []);
});

test('opaque generation handles prevent authored IDs from leaking and old handles never resolve after relearning', () => {
  const raw = rawContext();
  let result = put(M.createPolicy(), raw, 'event_1', '我喜欢红茶');
  const first = result.note, oldHandle = M.projectContext(raw, result.policy).context.memories[0].id;
  result = put(result.policy, raw, 'event_2', '这是新的独立事实', plan('这是新的独立事实', { id: 'note_red_tea_secret', title: '笔记', kind: 'note' }));
  let policy = M.forgetMemory(result.policy, first, { eventId: 'event_3' });
  const projected = M.projectContext(raw, policy).context;
  assert.equal(projected.memories[0].id, 'memory_2');
  assert.equal(JSON.stringify(projected).includes('note_red_tea_secret'), false);
  assert.equal(M.resolveHandle(policy, 'memory_2'), 'note_red_tea_secret');
  assert.equal(M.resolveHandle(policy, oldHandle), null);
  result = put(policy, raw, 'event_4', '我现在喜欢绿茶');
  const newHandle = M.projectContext(raw, result.policy).context.memories.find(note => note.body === '我现在喜欢绿茶').id;
  assert.equal(newHandle, 'memory_3');
  assert.equal(M.resolveHandle(result.policy, oldHandle), null);
  assert.equal(M.resolveHandle(result.policy, newHandle), first.id);
  assert.equal(M.resolveHandle(clone(result.policy), newHandle), first.id);
});

test('wide sourced fact contexts remain requestable and identical direct provenance is interned', () => {
  for (const distinctSources of [false, true]) {
    const raw = rawContext(); let policy = M.createPolicy();
    for (let index = 0; index < 640; index++) {
      const key = 'fact_' + index, eventId = distinctSources ? 'event_' + (index + 1) : 'event_1';
      policy = M.recordDerivation(policy, ids.fact(key), { sources: [M.sourceSpan(eventId, '同一轮完成的事实')] });
      raw.facts[key] = true;
    }
    const projected = M.projectContext(raw, policy);
    assert.equal(Object.keys(projected.context.facts).length, 640);
    assert.equal(Object.keys(policy.records).length, distinctSources ? 640 : 1);
    assert.doesNotThrow(() => M.recordDerivation(policy, ids.transcript('event_641', 'character', 0), { sources: [M.sourceSpan('event_641', '继续')], exposure: projected.exposure }));
  }
});

test('a full 14-slot inventory exposes only current withheld handles and does not retrieve their provenance', () => {
  const raw = rawContext(), secret = 'HIDDEN_SLOT_SECRET';
  let result = put(M.createPolicy(), raw, 'event_1', secret, plan(secret, { id: 'note_source', title: secret }));
  const origin = result.note;
  for (let index = 1; index <= 13; index++) result = put(result.policy, raw, 'event_' + (index + 1), '请继续解释第' + index + '次', plan(secret + '的解释' + index, { id: 'note_hidden_' + index, title: secret, perspective: 'character_interpretation' }));
  let policy = M.forgetMemory(result.policy, origin, { eventId: 'event_15' });
  raw.memories = raw.memories.filter(note => note.id !== origin.id);
  result = put(policy, raw, 'event_16', '我现在喜欢绿茶', plan('我现在喜欢绿茶', { id: 'note_visible', title: '偏好' }));
  policy = result.policy;
  const projected = M.projectContext(raw, policy), inventory = projected.context.memoryCapacity;
  assert.equal(inventory.limit, 14);
  assert.equal(inventory.used, 14);
  assert.equal(inventory.withheld.length, 13);
  assert.equal(projected.context.memories.length, 1);
  assert.ok(inventory.withheld.every(item => Object.keys(item).length === 1 && /^memory_[1-9][0-9]*$/u.test(item.id)));
  assert.ok(inventory.withheld.every(item => M.resolveHandle(policy, item.id)?.startsWith('note_hidden_')));
  assert.equal(inventory.withheld.some(item => item.id === 'memory_1'), false, 'deleted source handle is not inventory');
  assert.equal(JSON.stringify(projected.context).includes(secret), false);
  assert.equal(JSON.stringify(projected.context).includes('note_hidden_'), false);
  const hiddenNodes = raw.memories.filter(note => note.id.startsWith('note_hidden_')).map(note => policy.bindings[ids.memory(note.id, note.generation)]);
  policy = M.recordDerivation(policy, ids.character('mood'), { sources: [M.sourceSpan('event_17', '说说现在')], exposure: projected.exposure });
  const moodRecord = policy.records[policy.bindings[ids.character('mood')]];
  assert.ok(hiddenNodes.every(id => !moodRecord.dependencies.includes(id)), 'inventory handles never become retrieval dependencies');
  raw.character.mood = '愿意听新的事情'; raw.character.basis = source('event_17', '说说现在');
  assert.equal(M.projectContext(raw, policy).context.character.mood, '愿意听新的事情');
  const old = raw.memories.find(note => note.id === 'note_hidden_1');
  const oldHandle = policy.handles[ids.memory(old.id, old.generation)];
  policy = M.forgetMemory(policy, old, { eventId: 'event_18' });
  raw.memories = raw.memories.filter(note => note.id !== old.id);
  result = put(policy, raw, 'event_19', '我现在重新介绍自己', plan('我现在重新介绍自己', { id: old.id, title: '笔记', kind: 'note' }));
  const final = M.projectContext(raw, result.policy).context.memoryCapacity;
  assert.equal(final.used, 14);
  assert.equal(final.withheld.length, 12);
  assert.equal(final.withheld.some(item => item.id === oldHandle), false, 'old generation handles do not survive relearning');
  assert.equal(M.resolveHandle(result.policy, oldHandle), null);
});

test('discarded interning branches cannot change deduplication, rollback or replay of an identical state', () => {
  const seed = M.createPolicy(), narrow = M.sourceSpan('event_1', '甲乙', 0, 1), wide = M.sourceSpan('event_1', '甲乙', 0, 2);
  const a = M.recordDerivation(seed, 'a', { sources: [narrow] });
  const original = JSON.stringify(a);
  const before = M.recordDerivation(a, 'a', { sources: [narrow] });
  const b = M.recordDerivation(seed, 'b', { sources: [wide] });
  M.recordDerivation(b, 'a', { sources: [narrow] });
  const after = M.recordDerivation(a, 'a', { sources: [narrow] });
  assert.equal(JSON.stringify(a), original);
  assert.equal(Object.keys(before.records).length, 1);
  assert.equal(Object.keys(after.records).length, 1);
  assert.equal(before.nextRecord, 2);
  assert.equal(after.nextRecord, 2);
  assert.deepEqual(after, before);
  const replayed = M.recordDerivation(clone(a), 'a', { sources: [narrow] });
  assert.deepEqual(replayed, before, 'serialized replay agrees with the untouched and speculative branches');
});
