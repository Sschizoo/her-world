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
