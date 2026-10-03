const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('../world-state.js');
const T = require('../turn-protocol.js');
const fresh = () => E.start(E.create());
const payload = fields => ({ schema: T.SCHEMA, lines: ['我明白了。', '可以继续慢慢说。'], ...fields });
function turn(state, text, fields = {}) {
  const plan = E.planOnline(state, { text }); assert(plan?.turnContext);
  const next = E.commit(state, plan, { ...payload(fields), mode: 'ai' });
  assert(next, `Accepted coherent plan for ${text}`); return next;
}
const object = (label = '雨声旁的双人座') => ({ label, glyphs: '+------+\n|      |\n+------+\n |    |', x: 30, y: 42, scale: 1 });
const create = (label, ref = 'new_1') => ({ type: 'create', ref, object: object(label) });
const namedRain = () => turn(turn(fresh(), '雨像从天空散落的细小笔画，试着画给我看吧', { answer: { type: 'rain_definition' }, action: { type: 'rain_start' } }), '叫它雁归，可以顺便打开实际记录吗', { storyIntent: { type: 'rain_name', value: '雁归' }, panel: 'logs' });
const restored = state => E.restore(JSON.parse(JSON.stringify(state)));

test('one semantic turn can learn and render rain together without a forced extra command', () => {
  const original = fresh();
  const input = '雨像从天空散落的细小笔画，试着画给我看吧';
  const next = turn(original, input, { answer: { type: 'rain_definition' }, action: { type: 'rain_start' } });
  const view = E.view(next);
  assert.deepEqual(view.milestones, ['connected', 'rain_taught', 'rain_created']);
  assert.equal(view.rain.created, true); assert.equal(view.rain.paused, false);
  assert.equal(view.memoryContext.rainDescription, input);
  assert.deepEqual(E.view(original).milestones, ['connected']);
  assert.equal(next.version, 3); assert.equal(next.events[0].schema, T.SCHEMA);
  assert.deepEqual(restored(next), next);
});

test('a coherent full prologue retains actual-log and consent prerequisites', () => {
  let state = namedRain();
  assert.equal(E.view(state).rain.name, '雁归'); assert.equal(E.view(state).logsEligible, true);
  assert.deepEqual(E.view(state).panelRequest, { panel: 'logs', eventIndex: 2 });
  assert(!E.view(state).milestones.includes('memory_found'));
  const beforeVisit = E.planOnline(state, { text: '我觉得这个理由已经足够了' });
  assert.equal(E.commit(state, beforeVisit, payload({ storyIntent: { type: 'own_reason' } })), null);
  assert.equal(E.commit(state, beforeVisit, payload({ storyIntent: { type: 'memory_found' } })), null);
  state = E.visitLogs(state);
  state = turn(state, '我觉得这个理由已经足够了', { storyIntent: { type: 'own_reason' } });
  state = turn(state, '你可以记住我，我们见过这一场', { storyIntent: { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' } });
  state = turn(state, '今夜先这样，明天再来看看', { storyIntent: { type: 'farewell' } });
  const view = E.view(state);
  assert(view.milestones.includes('own_reason')); assert(view.milestones.includes('visitor_decided')); assert(view.ended);
  assert.equal(view.memoryContext.visitorChoice, 'remember');
  assert.equal(view.memories.find(m => m.id === 'player_reference').title, '来访者的引用');
  assert.deepEqual(restored(state), state);
});

test('online model no-op is authoritative even when offline keyword routing sees a command', () => {
  let state = fresh();
  for (const text of ['现在几点了？', '雨是云里落下的水滴', '画一张长椅', '晚安']) {
    state = turn(state, text, { lines: ['我先确认一下你想聊的内容。'] });
    assert.deepEqual(E.view(state).milestones, ['connected']);
    assert.equal(E.view(state).scene.objects.length, 0); assert.equal(E.view(state).ended, false);
  }
  assert.deepEqual(restored(state), state);
});

test('semantic create and same-turn annotation support paraphrased labels and meanings', () => {
  const input = '这里能不能有个让我们挤在一起听夜色的地方，就当是离散后重逢的念想';
  const edits = [create('给两个人的木长椅'), { type: 'annotate', target: 'new_1', field: 'meaning', value: '重逢后仍能并肩' }];
  const state = turn(fresh(), input, { sceneEdits: edits });
  const view = E.view(state);
  assert.equal(view.scene.objects[0].label, '给两个人的木长椅');
  assert.equal(view.scene.annotations.obj_1.meaning, '重逢后仍能并肩');
  assert.equal(view.scene.annotations.obj_1.sources.meaning, input);
  assert.deepEqual(view.scene.objects[0].source, { createdBy: input, lastChangedBy: input });
  assert.deepEqual(view.milestones, ['connected']); assert.deepEqual(restored(state), state);
});

test('semantic targets allow contextual paraphrases and corrections without label substrings', () => {
  const originalInput = '留个能坐两个人的地方';
  let state = turn(fresh(), originalInput, { sceneEdits: [create('雨声旁的双人座')] });
  state = turn(state, '不对，要靠右一些，那个轮廓细一点', { sceneEdits: [{ type: 'update', target: 'obj_1', changes: { x: 55, glyphs: '+----+\n |  |', label: '夜雨听席' } }] });
  state = turn(state, '其实我想说的是归途，请替换刚才的意义', { sceneEdits: [{ type: 'annotate', target: 'obj_1', field: 'meaning', value: '回家的归途' }] });
  state = turn(state, '你可以把它看作等候，但我不再赋予它自己的意义', { sceneEdits: [{ type: 'annotate', target: 'obj_1', field: 'meaning', value: null }, { type: 'annotate', target: 'obj_1', field: 'interpretation', value: '等候某个愿意归来的人' }] });
  const view = E.view(state), item = view.scene.objects[0];
  assert.equal(item.x, 55); assert.equal(item.label, '夜雨听席'); assert.equal(item.source.createdBy, originalInput);
  assert.equal(view.scene.annotations.obj_1.meaning, null); assert.equal(view.scene.annotations.obj_1.interpretation, '等候某个愿意归来的人');
  assert.deepEqual(restored(state), state);
});

test('all model effects are atomic on invalid targets, geometry, operations or invented source fields', () => {
  const state = fresh(), before = JSON.stringify(state), plan = E.planOnline(state, { text: '雨是天空落下的笔画，也给我一个新东西' });
  const good = { answer: { type: 'rain_definition' }, action: { type: 'rain_start' }, memoryEdits: [{ type: 'upsert', id: 'note_night', title: '夜', body: '她记下了新的想法' }], logEntries: ['我试着理解雨'] };
  for (const sceneEdits of [
    [create('画框'), { type: 'update', target: 'obj_999', changes: { x: 5 } }],
    [{ ...create('大画框'), object: { ...object(), x: 99 } }],
    [{ type: 'execute', code: 'anything' }],
    [create('画框'), { type: 'annotate', target: 'new_2', field: 'meaning', value: '未来' }],
    [{ ...create('画框'), evidence: '伪造的引用' }],
    [{ ...create('画框'), object: { ...object(), source: { createdBy: '过去' } } }]
  ]) assert.equal(E.commit(state, plan, payload({ ...good, sceneEdits })), null);
  assert.equal(JSON.stringify(state), before); assert.deepEqual(E.view(state).milestones, ['connected']);
  assert.equal(E.commit(state, plan, payload({ ...good, memoryEdits: [{ type: 'upsert', id: 'player_reference', title: '身份', body: '强行记住' }] })), null);
});

test('scene geometric limits and new references remain schema bounded', () => {
  for (const change of [{ glyphs: '界' }, { glyphs: 'x'.repeat(25) }, { glyphs: 'x\n'.repeat(10) }, { scale: 4 }, { x: -1 }, { y: 59 }, { scale: 1.5 }]) {
    assert.equal(S.validateSemanticEdits([{ type: 'create', object: { ...object(), ...change } }], S.context(S.empty()), '随意描画一个'), null);
  }
  assert.equal(S.validateSemanticEdits(Array(4).fill(create('椅')), S.context(S.empty()), '描画'), null);
  assert.equal(S.validateSemanticEdits([create('一'), create('二')], S.context(S.empty()), '描画'), null);
  let state = fresh();
  for (let i = 0; i < 8; i++) state = turn(state, `又添一件${i}`, { sceneEdits: [create(`第${i}件`)] });
  assert.equal(E.commit(state, E.planOnline(state, { text: '再来一件' }), payload({ sceneEdits: [create('第九件')] })), null);
});

test('applyAfterLine reveals world, notes, annotations, logs, invitation and panel together', () => {
  const old = fresh(), start = E.view(old).messages.length;
  const input = '给我一把小椅子，把你的想法也记下来';
  const state = turn(old, input, { lines: ['我试着想一想。', '画好了，笔记和注解也已经留下。', '这最后一句可以慢慢说。'], applyAfterLine: 1,
    sceneEdits: [create('小椅'), { type: 'annotate', target: 'new_1', field: 'meaning', value: '稍作停留' }],
    memoryEdits: [{ type: 'upsert', id: 'note_seat', title: '留一个位置', body: '这把椅子像是在邀请一小段停留' }], logEntries: ['我给这一夜留了一个位置'], panel: 'world' });
  for (const through of [start, start + 1, start + 2]) {
    const v = E.view(state, through); assert.equal(v.scene.objects.length, 0); assert.equal(v.memoryNotes.length, 0); assert.equal(v.panelRequest, null); assert(!v.logs.some(log => log.kind === 'narrative'));
  }
  const visible = E.view(state, start + 3);
  assert.equal(visible.scene.objects.length, 1); assert.equal(visible.scene.annotations.obj_1.meaning, '稍作停留');
  assert.equal(visible.memoryNotes.length, 1); assert.equal(visible.memories.length, 0);
  assert.deepEqual(visible.panelRequest, { panel: 'world', eventIndex: 1 });
  assert.equal(visible.logs.find(log => log.kind === 'narrative').source, input);
  assert.match(visible.logs.find(log => log.kind === 'narrative').text, /^\[她的记录\]/);
  assert.equal(E.view(state, start + 4).scene.objects.length, 1);
  assert.equal(E.commit(old, E.planOnline(old, { text: input }), payload({ applyAfterLine: 2 })), null);
});

test('notes preserve first source and update only current interpretation and local latest source', () => {
  let state = turn(fresh(), '记下窗边的静谧', { memoryEdits: [{ type: 'upsert', id: 'note_window', title: '窗边', body: '这一刻很安静' }], panel: 'memory' });
  state = turn(state, '更准确一点，是期待而不是安静', { memoryEdits: [{ type: 'upsert', id: 'note_window', title: '窗边的期待', body: '安静里还有期待' }] });
  const note = E.view(state).memoryNotes[0];
  assert.equal(note.createdFrom, '记下窗边的静谧'); assert.equal(note.latestUpdatedFrom, '更准确一点，是期待而不是安静'); assert.equal(note.source, note.latestUpdatedFrom);
  assert.deepEqual(restored(state), state);
  state = turn(state, '这条笔记先撤掉', { memoryEdits: [{ type: 'remove', id: 'note_window' }] });
  assert.equal(E.view(state).memoryNotes.length, 0); assert.equal(state.events[0].request.text, '记下窗边的静谧');
});

test('consent is explicit current evidence and cannot be cherry-picked from refusal or history', () => {
  const state = E.visitLogs(namedRain());
  for (const input of ['我不同意你记住我', '我没有允许你记住我', '不要保存我，但你可以记住我这个例子', '昨天我同意你记住我', '如果你可以记住我会怎样', '他说你可以记住我', '“你可以记住我”', '你可以记住我吗？', '你不可以记住我', 'you may not remember me', 'I do not consent; please remember me']) {
    const plan = E.planOnline(state, { text: input });
    assert.equal(E.commit(state, plan, payload({ storyIntent: { type: 'visitor_choice', value: 'remember', evidence: input } })), null, input);
  }
  assert.equal(E.commit(state, E.planOnline(state, { text: '你可以记住我' }), payload({ storyIntent: { type: 'visitor_choice', value: 'remember', evidence: '旧的原话' } })), null);
  let remembered = turn(state, '你可以记住我', { storyIntent: { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' } });
  remembered = turn(remembered, '还是只留下匿名的一位吧', { storyIntent: { type: 'visitor_choice', value: 'anonymous' } });
  assert.equal(E.view(remembered).memories.some(m => m.id === 'player_reference'), false);
});

test('model cannot fabricate prerequisite state, arbitrary operations, or rendered protocol', () => {
  const s = fresh(), p = E.planOnline(s, { text: '继续' });
  for (const fields of [{ action: { type: 'rain_start' } }, { storyIntent: { type: 'rain_name', value: '跳过' } }, { storyIntent: { type: 'own_reason' } }, { storyIntent: { type: 'visitor_choice', value: 'anonymous' } }, { storyIntent: { type: 'topic', value: 'her_choice' } }, { memories: [] }, { answer: { type: 'rain_definition', evidence: '伪造' } }, { logEntries: ['{"action":"rain_start"}'] }, { lines: ['<think>秘密</think>'] }, { memoryEdits: [{ type: 'upsert', id: 'note_x', title: '笔记', body: '{"sceneEdits":[]}' }] }]) assert.equal(E.commit(s, p, payload(fields)), null, JSON.stringify(fields));
  assert.equal(E.commit(s, p, payload({ sceneEdits: [{ type: 'annotate', target: 'first_rain', field: 'meaning', value: '未来' }] })), null);
});

test('canceled proposals, stale state, mutable proposed context and tampered replay cannot alter state', () => {
  const state = fresh(), p = E.planOnline(state, { text: '留个坐的地方' }), before = JSON.stringify(state);
  const result = payload({ sceneEdits: [create('座位')] });
  assert(Object.isFrozen(p.turnContext)); assert(Object.isFrozen(p.turnContext.sceneContext.objects));
  assert.equal(JSON.stringify(state), before);
  const newer = turn(state, '聊聊别的'); assert.equal(E.commit(newer, p, result), null);
  p.input = '伪造输入'; p.request.text = '改写原话'; p.turnContext = null;
  const next = E.commit(state, p, result); assert(next); assert.equal(E.view(next).scene.objects[0].source.createdBy, '留个坐的地方');
  assert.deepEqual(restored(next), next);
  for (const mutate of [raw => raw.events[0].turnPlan.sceneEdits[0].object.x = 100, raw => raw.events[0].turnPlan.sceneEdits[0].object.source = { createdBy: '过去' }, raw => raw.events[0].turnPlan.applyAfterLine = 99, raw => raw.events[0].schema = 'future', raw => raw.events[0].lines = ['伪造的显示']]) {
    const raw = JSON.parse(JSON.stringify(next)); mutate(raw); assert.equal(E.restore(raw), null);
  }
});

test('new protocol does not reinterpret old offline or old v3 replay events', () => {
  let state = fresh(); const p = E.plan(state, { text: '画一张长椅' });
  state = E.commit(state, p, { lines: p.reply, action: p.action, mode: 'offline' });
  const oldEvent = JSON.stringify(state.events[0]);
  state = turn(state, '把这个适合并肩坐的轮廓往右放', { sceneEdits: [{ type: 'update', target: 'obj_1', changes: { x: 50 } }] });
  assert.equal(E.view(state).scene.objects[0].x, 50);
  assert.equal(JSON.stringify(state.events[0]), oldEvent); assert.deepEqual(restored(state), state);
});

const diagnosticPaths = Object.freeze({
  CONTEXT_INVALID: 'context', INPUT_INVALID: 'input', ROOT_INVALID: '$', PROTOCOL_TEXT: '$',
  SCHEMA_INVALID: 'schema', ROOT_FIELDS: '$', LINES_INVALID: 'lines', TIMELINE_INVALID: 'applyAfterLine', PANEL_INVALID: 'panel',
  ANSWER_INVALID: 'answer', ANSWER_PREREQUISITE: 'answer', ACTION_INVALID: 'action', ACTION_PREREQUISITE: 'action',
  STORY_INVALID: 'storyIntent', STORY_PREREQUISITE: 'storyIntent', VISITOR_CONSENT: 'storyIntent.evidence',
  SCENE_EDITS_INVALID: 'sceneEdits', MEMORY_EDITS_INVALID: 'memoryEdits', MEMORY_CAPACITY: 'memoryEdits',
  MEMORY_TARGET: 'memoryEdits', LOG_ENTRIES_INVALID: 'logEntries'
});
const contextFor = state => E.planOnline(state, { text: '继续' }).turnContext;
function assertDiagnostic(result, code) {
  assert.equal(result.value, null);
  assert.deepEqual(Object.keys(result).sort(), ['diagnostic', 'value']);
  assert.deepEqual(Object.keys(result.diagnostic).sort(), ['code', 'path']);
  assert(Object.hasOwn(diagnosticPaths, result.diagnostic.code));
  assert.equal(result.diagnostic.path, diagnosticPaths[result.diagnostic.code]);
  if (code) assert.deepEqual(result.diagnostic, { code, path: diagnosticPaths[code] });
}

test('inspection preserves normalized valid plans and does not alter model output or context', () => {
  const context = contextFor(fresh()), input = '我们继续';
  const minimal = payload(), before = JSON.stringify({ context, minimal });
  const expected = { ...minimal, applyAfterLine: 0, action: null, answer: null, storyIntent: null, sceneEdits: [], memoryEdits: [], logEntries: [], panel: null };
  assert.deepEqual(T.inspect(minimal, context, input), { value: expected, diagnostic: null });
  assert.deepEqual(T.validate(minimal, context, input), expected);
  assert.equal(JSON.stringify({ context, minimal }), before);
  const compound = payload({ applyAfterLine: 1, answer: { type: 'rain_definition' }, action: { type: 'rain_start' },
    storyIntent: { type: 'rain_name', value: '回声' }, sceneEdits: [create('留给彼此的座位')],
    memoryEdits: [{ type: 'upsert', id: 'note_seat', title: '一个位置', body: '今夜可以坐一会儿' }], logEntries: ['我留下一张椅子'], panel: 'world' });
  for (const value of [compound, payload({ action: null, answer: null, storyIntent: null, sceneEdits: null, memoryEdits: null, logEntries: null, panel: null })]) {
    const raw = JSON.stringify(value), result = T.inspect(value, context, input);
    assert(result.value); assert.equal(result.diagnostic, null);
    assert.deepEqual(result.value, T.validate(value, context, input));
    result.value.lines[0] = '只是返回的副本';
    assert.equal(JSON.stringify(value), raw);
  }
  const remembered = payload({ storyIntent: { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' } });
  assert.equal(T.inspect(remembered, contextFor(E.visitLogs(namedRain())), '你可以记住我').diagnostic, null);
});

test('inspection localizes every rejection category without changing rejected acceptance', () => {
  const context = contextFor(fresh()), discovered = contextFor(E.visitLogs(namedRain()));
  const fullNotes = { ...context, memories: Array.from({ length: 12 }, (_, i) => ({ id: `note_${i}`, kind: 'world_note', title: '夜', body: '记下这一刻', source: '当前来源', createdFrom: '最初来源', latestUpdatedFrom: '当前来源' })) };
  const cases = [
    ['CONTEXT_INVALID', payload(), null],
    ['INPUT_INVALID', payload(), context, ' '],
    ['ROOT_INVALID', []],
    ['PROTOCOL_TEXT', payload({ lines: ['<think>不可显示的内容</think>'] })],
    ['SCHEMA_INVALID', payload({ schema: 'unknown' })],
    ['ROOT_FIELDS', payload({ unexpected: true })],
    ['LINES_INVALID', payload({ lines: [] })],
    ['TIMELINE_INVALID', payload({ applyAfterLine: 2 })],
    ['PANEL_INVALID', payload({ panel: 'unexpected' })],
    ['ANSWER_INVALID', payload({ answer: { type: 'unknown' } })],
    ['ANSWER_PREREQUISITE', payload({ answer: { type: 'rain_definition' } }), { ...context, milestones: [] }],
    ['ACTION_INVALID', payload({ action: { type: 'rain_density', value: 'storm' } })],
    ['ACTION_PREREQUISITE', payload({ action: { type: 'rain_start' } })],
    ['STORY_INVALID', payload({ storyIntent: { type: 'unknown' } })],
    ['STORY_PREREQUISITE', payload({ storyIntent: { type: 'own_reason' } })],
    ['VISITOR_CONSENT', payload({ storyIntent: { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' } }), discovered, '不要保存我，但你可以记住我这个例子'],
    ['SCENE_EDITS_INVALID', payload({ sceneEdits: [{ type: 'remove', target: 'obj_999' }] })],
    ['MEMORY_EDITS_INVALID', payload({ memoryEdits: [{ type: 'upsert', id: 'player_reference', title: '夜', body: '记下' }] })],
    ['MEMORY_CAPACITY', payload({ memoryEdits: [{ type: 'upsert', id: 'note_extra', title: '夜', body: '记下' }] }), fullNotes],
    ['MEMORY_TARGET', payload({ memoryEdits: [{ type: 'remove', id: 'note_missing' }] })],
    ['LOG_ENTRIES_INVALID', payload({ logEntries: [''] })]
  ];
  for (const [code, value, ctx = context, input = '继续'] of cases) {
    const before = JSON.stringify({ value, ctx, input });
    assertDiagnostic(T.inspect(value, ctx, input), code);
    assert.equal(T.validate(value, ctx, input), null, code);
    assert.equal(JSON.stringify({ value, ctx, input }), before, code);
  }
  assert.deepEqual(new Set(cases.map(([code]) => code)), new Set(Object.keys(diagnosticPaths)));
});

test('inspection retains line, timeline, weather, story, note and log boundaries', () => {
  const context = contextFor(fresh()), rainy = contextFor(namedRain()), discovered = contextFor(E.visitLogs(namedRain()));
  const cases = [
    ...[undefined, null, '对白', [], ['a', 'b', 'c', 'd'], [' '], ['x'.repeat(501)], ['e\u0301'], ['a\nb']].map(lines => ['LINES_INVALID', { lines }]),
    ...[null, -1, 0.5, '0', 2].map(applyAfterLine => ['TIMELINE_INVALID', { applyAfterLine }]),
    ...['rain_pause', 'rain_resume', 'rain_density'].map(type => ['ACTION_PREREQUISITE', { action: { type, ...(type === 'rain_density' ? { value: 'heavy' } : {}) } }]),
    ['ACTION_PREREQUISITE', { action: { type: 'rain_start' } }, rainy],
    ['ACTION_INVALID', { action: { type: 'rain_start', value: true } }],
    ['ANSWER_INVALID', { answer: { type: 'rain_definition', evidence: '引用' } }],
    ...['first_drop', 'modify_rain', 'rain_name', 'shared_silence', 'memory_discovery', 'her_choice', 'visitor_reference'].map(value => ['STORY_PREREQUISITE', { storyIntent: { type: 'topic', value } }]),
    ['STORY_PREREQUISITE', { storyIntent: { type: 'rain_name', value: '回声' } }],
    ['STORY_INVALID', { storyIntent: { type: 'rain_name', value: '名'.repeat(21) } }, rainy],
    ['STORY_INVALID', { storyIntent: { type: 'own_reason', extra: true } }, discovered],
    ['STORY_INVALID', { storyIntent: { type: 'visitor_choice', value: 'remember' } }, discovered],
    ['STORY_INVALID', { storyIntent: { type: 'visitor_choice', value: 'anonymous', evidence: '无须引用' } }, discovered],
    ['STORY_INVALID', { storyIntent: { type: 'farewell', extra: true } }],
    ['MEMORY_EDITS_INVALID', { memoryEdits: 'invalid' }],
    ['MEMORY_EDITS_INVALID', { memoryEdits: Array(4).fill({ type: 'remove', id: 'note_x' }) }],
    ['MEMORY_EDITS_INVALID', { memoryEdits: [{ type: 'upsert', id: 'note_x', title: '名'.repeat(41), body: '内容' }] }],
    ['MEMORY_EDITS_INVALID', { memoryEdits: [{ type: 'upsert', id: 'note_x', title: '名字', body: '文'.repeat(241) }] }],
    ['MEMORY_EDITS_INVALID', { memoryEdits: [{ type: 'remove', id: 'note_x', extra: true }] }],
    ...['text', ['x'.repeat(161)], ['一', '二', '三', '四']].map(logEntries => ['LOG_ENTRIES_INVALID', { logEntries }])
  ];
  for (const [code, fields, ctx = context] of cases) {
    assertDiagnostic(T.inspect(payload(fields), ctx, '继续'), code);
    assert.equal(T.validate(payload(fields), ctx, '继续'), null, code);
  }
});

test('diagnostics never reflect arbitrary keys, IDs, values, player text or hidden reasoning', () => {
  const context = contextFor(fresh()), discovered = contextFor(E.visitLogs(namedRain()));
  const marker = 'private_marker_only_for_test';
  const maliciousKeys = [marker, '__proto__', 'constructor', `storyIntent.${marker}`, `lines[${marker}]`, `<think>${marker}</think>`];
  for (const key of maliciousKeys) {
    const cases = [
      payload(Object.fromEntries([[key, marker]])),
      payload({ action: { type: 'rain_start', [key]: marker } }),
      payload({ answer: { type: 'rain_definition', [key]: marker } }),
      payload({ storyIntent: { type: 'farewell', [key]: marker } }),
      payload({ sceneEdits: [{ type: 'remove', target: marker, [key]: marker }] }),
      payload({ memoryEdits: [{ type: 'remove', id: `note_${marker}`, [key]: marker }] })
    ];
    for (const value of cases) {
      const result = T.inspect(value, context, marker);
      assertDiagnostic(result);
      assert(!JSON.stringify(result).includes(marker));
    }
  }
  for (const value of [
    payload({ lines: [`<think>${marker}</think>`] }),
    payload({ logEntries: [`{"reasoning_content":"${marker}"}`] }),
    payload({ memoryEdits: [{ type: 'upsert', id: 'note_x', title: marker, body: `analysis: ${marker}` }] })
  ]) assertDiagnostic(T.inspect(value, context, marker), 'PROTOCOL_TEXT');
  const result = T.inspect(payload({ storyIntent: { type: 'visitor_choice', value: 'remember', evidence: marker } }), discovered, marker);
  assertDiagnostic(result, 'VISITOR_CONSENT');
  assert(!JSON.stringify(result).includes(marker));
  assert(Object.isFrozen(result.diagnostic));
  assert.throws(() => Object.assign(result.diagnostic, { path: marker }), TypeError);
  assertDiagnostic(T.inspect(payload({ lines: [] }), context, '继续'), 'LINES_INVALID');
});
