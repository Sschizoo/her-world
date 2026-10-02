const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../world-state.js');
const context = (scene = S.empty(), options) => S.context(scene, options);
const make = (label = '长椅', evidence = `画一张${label}`, overrides = {}) => ({ type: 'create', object: { label, glyphs: '+----+\n|    |\n|    |', x: 35, y: 42, scale: 1, ...overrides }, evidence });
const bench = () => S.applyEdits(S.empty(), [make()], '画一张长椅');
const update = (evidence = '把长椅移到窗边', target = 'obj_1', changes = { x: 27, y: 43 }) => ({ type: 'update', target, changes, evidence });
const annotation = (text, field = 'meaning', value = '等待', target = 'obj_1') => ({ type: 'annotate', target, field, value, evidence: text });

test('ASCII objects are bounded, source-attributed, isolated and locally identified', () => {
  const before = S.empty(), state = S.applyEdits(before, [make()], '画一张长椅');
  assert.equal(before.objects.length, 0); assert.equal(state.objects[0].id, 'obj_1');
  assert.deepEqual(state.objects[0].source, { createdBy: '画一张长椅', lastChangedBy: '画一张长椅' });
  const moved = S.applyEdits(state, [update()], '把长椅移到窗边');
  assert.equal(moved.objects[0].source.createdBy, '画一张长椅'); assert.equal(moved.objects[0].source.lastChangedBy, '把长椅移到窗边');
  const removed = S.applyEdits(moved, [{ type: 'remove', target: 'obj_1', evidence: '移走长椅' }], '移走长椅');
  const recreated = S.applyEdits(removed, [make()], '画一张长椅');
  assert.equal(recreated.objects[0].id, 'obj_2'); assert.equal(state.objects[0].x, 35);
  const cloned = context(recreated); cloned.objects[0].label = '伪造'; assert.equal(recreated.objects[0].label, '长椅');
});

test('strict complete schemas reject overflow, Unicode glyphs, hidden text and extra authority', () => {
  for (const change of [
    { glyphs: '长椅' }, { glyphs: '' }, { glyphs: '  \n ' }, { glyphs: 'x'.repeat(25) }, { glyphs: 'x\n'.repeat(10) },
    { glyphs: 'x'.repeat(24) + '\n' + 'x'.repeat(24), scale: 4 }, { glyphs: '\t' }, { glyphs: 'a\rb' }, { glyphs: '<think>hidden</think>' },
    { x: -1 }, { x: 100 }, { y: 59 }, { x: 99, scale: 2 }, { scale: 1.5 }, { label: 'x'.repeat(41) }, { color: 'red' }
  ]) assert.equal(S.validateEdits([make('长椅', '画一张长椅', change)], context(), '画一张长椅'), null, JSON.stringify(change));
  const edit = make(); edit.object.id = 'obj_900'; assert.equal(S.validateEdits([edit], context(), '画一张长椅'), null);
  assert.equal(S.validateEdits([{ ...make(), system: true }], context(), '画一张长椅'), null);
  assert.equal(S.context({ ...S.empty(), arbitrary: true }), null);
  assert.equal(S.validateEdits([make()], { ...context(), nextId: 0 }, '画一张长椅'), null);
});

test('multi-edit validation is atomic and caps objects and operations', () => {
  const state = bench(), before = JSON.stringify(state), text = '把长椅移到窗边，同时把它的意义改成等待';
  const valid = [{ ...update(), evidence: text }, annotation(text)];
  assert.equal(S.validateEdits(valid, context(state), text).length, 2);
  const invalid = [valid[0], { ...valid[1], target: 'obj_999' }];
  assert.equal(S.applyEdits(state, invalid, text), null); assert.equal(JSON.stringify(state), before);
  assert.equal(S.validateEdits(Array(4).fill(make()), context(), '画一张长椅'), null);
  let full = S.empty(); for (let i = 0; i < 8; i++) full = S.applyEdits(full, [make()], '画一张长椅');
  assert.equal(full.objects.length, 8); assert.equal(S.applyEdits(full, [make()], '画一张长椅'), null);
});

test('current exact evidence and operation-specific intent reject history, protocols and negation', () => {
  const state = bench();
  for (const text of ['如果把长椅移到窗边会怎样', '昨天我把长椅移到窗边', '他说把长椅移到窗边', '“把长椅移到窗边”', '给个把长椅移到窗边的示例', '长椅的位置为什么变了？', '你刚才把长椅移到哪里了？', '长椅不需要变大', '不要移动长椅']) {
    assert.equal(S.validateEdits([update(text)], context(state), text), null, text);
  }
  assert.equal(S.validateEdits([make('灯', '不需要画一盏灯')], context(), '不需要画一盏灯'), null);
  assert.equal(S.validateEdits([{ type: 'remove', target: 'obj_1', evidence: '别移走长椅' }], context(state), '别移走长椅'), null);
  assert.equal(S.validateEdits([{ ...update(), evidence: '不是原话' }], context(state), '把长椅移到窗边'), null);
  assert(S.validateEdits([update('能不能把长椅移到窗边？')], context(state), '能不能把长椅移到窗边？'));
  assert.equal(S.validateEdits([update('长椅的意义改成自由')], context(state), '长椅的意义改成自由'), null);
});

test('references require existing exact IDs or unique labels and clarify multiple pronouns', () => {
  let state = bench();
  assert.equal(S.validateEdits([update('把obj_10移到窗边')], context(state), '把obj_10移到窗边'), null);
  assert(S.validateEdits([update('把obj_1移到窗边')], context(state), '把obj_1移到窗边'));
  assert(S.validateEdits([update('把它移到窗边')], context(state), '把它移到窗边'));
  state = S.applyEdits(state, [make('灯', '画一盏灯')], '画一盏灯');
  assert.equal(state.focusedTarget, 'obj_2');
  assert(S.validateEdits([update('把它移到窗边', 'obj_2')], context(state), '把它移到窗边'));
  state = S.focusAfter(state, '我们聊聊别的事');
  assert.equal(S.validateEdits([update('把它移到窗边')], context(state), '把它移到窗边'), null);
  assert.match(S.offline(context(state), '把它移到窗边').reply.join(''), /哪一个/);
  let same = S.applyEdits(S.empty(), [make('双人长椅', '画一张双人长椅')], '画一张双人长椅');
  assert(S.validateEdits([update()], context(same), '把长椅移到窗边'));
  same = S.applyEdits(same, [make('单人长椅', '画一张单人长椅')], '画一张单人长椅');
  assert.equal(S.validateEdits([update()], context(same), '把长椅移到窗边'), null);
  assert(S.validateEdits([update('把双人长椅移到窗边')], context(same), '把双人长椅移到窗边'));
});

test('meaning and interpretation can be set, revised and independently cleared without changing source facts', () => {
  let state = bench(); const original = state.objects[0].source.createdBy;
  state = S.applyEdits(state, [annotation('长椅代表等待')], '长椅代表等待');
  state = S.applyEdits(state, [annotation('你觉得长椅代表什么？', 'interpretation', '一起停留的位置')], '你觉得长椅代表什么？');
  assert.equal(state.annotations.obj_1.meaning, '等待'); assert.equal(state.annotations.obj_1.interpretation, '一起停留的位置');
  state = S.applyEdits(state, [annotation('长椅的意义改成自由', 'meaning', '自由')], '长椅的意义改成自由');
  state = S.applyEdits(state, [annotation('不要再把长椅理解为孤独', 'interpretation', null)], '不要再把长椅理解为孤独');
  assert.equal(state.annotations.obj_1.meaning, '自由'); assert.equal(state.annotations.obj_1.interpretation, null);
  assert.equal(state.objects[0].source.createdBy, original);
  assert.equal(S.validateEdits([annotation('长椅代表等待', 'meaning', '孤独')], context(state), '长椅代表等待'), null);
  assert.equal(S.validateEdits([annotation('长椅代表什么？', 'meaning', '什么')], context(state), '长椅代表什么？'), null);
  assert.equal(S.validateEdits([annotation('不要再把长椅理解为孤独', 'interpretation', '孤独')], context(state), '不要再把长椅理解为孤独'), null);
  assert.match(S.offline(context(state), '忘掉长椅').reply.join(''), /哪一个|原始对话/);
});

test('first rain annotations need a real rain fact and never overwrite recorded event sources', () => {
  const text = '第一场雨代表自由', edit = annotation(text, 'meaning', '自由', 'first_rain'), original = S.empty();
  assert.equal(S.validateEdits([edit], context(original), text), null);
  const options = { firstRainAvailable: true, firstRainSource: { description: '雨是天空落下的水滴', nameSource: '把雨叫做夜航' } };
  const state = S.applyEdits(original, [edit], text, options); assert(state);
  assert.deepEqual(context(state, options).firstRainSource, options.firstRainSource);
  assert.equal(state.annotations.first_rain.meaning, '自由');
  assert.equal(S.validateEdits([{ ...edit, field: 'source' }], context(state, options), text), null);
});

test('offline bench route has honest generic glyphs, a real window anchor and remembered sources', () => {
  let state = S.empty();
  for (const text of ['帮我画一张能坐两个人的长椅', '把长椅移到窗边', '长椅代表等待', '长椅的意义改成自由']) {
    const result = S.offline(context(state), text); assert(result.handled); assert(result.edits.length);
    state = S.applyEdits(state, result.edits, text); assert(state);
  }
  assert.equal(state.objects[0].label, '长椅'); assert.equal(state.objects[0].x, 27); assert.equal(state.objects[0].y, 43);
  const recalled = S.offline(context(state), '你还记得长椅吗？'); assert.equal(recalled.edits.length, 0); assert.match(recalled.reply.join(''), /自由/); assert.match(recalled.reply.join(''), /能坐两个人/);
  const glyphs = S.offline(context(state), '把长椅的字符改为"[__]\\n|  |"'); assert.equal(glyphs.edits[0].changes.glyphs, '[__]\n|  |');
});

test('novel objects receive bounded online authority while canonical first rain retains its gate', () => {
  const text = '这里缺一座桥，能画出来吗';
  assert(S.isSceneRequest(text, context())); assert(S.allowedEdits(text, context()).includes('create'));
  assert(S.validateEdits([make('桥', text, { glyphs: '/====\\' })], context(), text));
  const state = S.applyEdits(S.empty(), [make('纸风车', '画一个纸风车')], '画一个纸风车');
  assert(S.validateEdits([update('让纸风车再大一点', 'obj_1', { scale: 2 })], context(state), '让纸风车再大一点'));
  for (const text of ['试着画出第一场雨', '先试着把这样的雨画在窗外吧']) {
    assert.deepEqual(S.allowedEdits(text, context()), []);
    assert.equal(S.validateEdits([make('雨', text)], context(), text), null);
  }
});

test('plural, distinct multiple, excluded and relational references never mutate an arbitrary subset', () => {
  let state = bench(); state = S.applyEdits(state, [make('灯', '画一盏灯')], '画一盏灯');
  for (const text of ['把它们移到窗边', '把这些移到窗边', '把所有物件移到窗边', '把长椅和灯移到窗边', '把不是长椅的那个移到窗边', '把长椅旁的灯移到左边', '除了长椅，把那个移到窗边']) {
    for (const target of ['obj_1', 'obj_2']) assert.equal(S.validateEdits([update(text, target)], context(state), text), null, `${text} ${target}`);
  }
  assert(S.validateEdits([update('把它移到窗边', 'obj_2')], context(state), '把它移到窗边'));
  const noFocus = S.focusAfter(state, '换个话题'); assert.equal(noFocus.focusedTarget, null);
  assert.equal(S.validateEdits([update('把它移到窗边', 'obj_2')], context(noFocus), '把它移到窗边'), null);
});

test('declined and clear-only interpretations cannot smuggle replacement annotations and recalls remain read-only', () => {
  let state = S.applyEdits(bench(), [annotation('长椅代表等待')], '长椅代表等待');
  for (const text of ['我不需要你对长椅的解释', '我不想要你对长椅的解释', '请删除你对长椅的解释']) {
    assert.equal(S.validateEdits([annotation(text, 'interpretation', '孤独')], context(state), text), null, text);
    assert(S.validateEdits([annotation(text, 'interpretation', null)], context(state), text), text);
  }
  for (const text of ['长椅代表什么？', '长椅意味着什么？', '你还记得这张长椅的意义吗？', '你记得长椅对我意味着等待吗？']) {
    const reply = S.offline(context(state), text); assert.equal(reply.edits.length, 0); assert.match(reply.reply.join(''), /等待/);
    assert.equal(S.validateEdits([annotation(text, 'meaning', text.includes('等待') ? '等待' : '什么')], context(state), text), null);
  }
});

test('imaginary creative subjects are drawable while hypothetical operations remain unexecuted', () => {
  const text = '画一座想象中的桥'; assert(S.validateEdits([make('桥', text)], context(), text));
  for (const text of ['如果画一座想象中的桥会怎样', '假设画一座桥', '想象画一座桥']) assert.equal(S.validateEdits([make('桥', text)], context(), text), null);
});

test('rain and weather labels are reserved equally for creation and later renaming', () => {
  for (const label of ['雨', '这场雨', '第一场雨', '天气', 'rain', 'weather']) {
    const text = `把长椅的名字改成${label}`;
    assert.equal(S.validateEdits([update(text, 'obj_1', { label })], context(bench()), text), null, label);
    const creation = `画一个${label}`; assert.equal(S.validateEdits([make(label, creation)], context(), creation), null, label);
  }
});

test('illustrative object nouns do not redirect fresh rain descriptions into scene control', () => {
  for (const ctx of [context(), context(bench())]) {
    for (const text of ['雨是落在长椅上的水滴', '雨像敲在长椅上的细碎指尖']) {
      assert.equal(S.isSceneRequest(text, ctx), false, text); assert.deepEqual(S.allowedEdits(text, ctx), []);
    }
    assert.equal(S.isSceneRequest('画一张雨滴落在上面的长椅', ctx), true);
  }
});


test('an explicit character interpretation invitation still reaches the scene annotation path', () => {
  const state = bench(), text = '你觉得长椅像什么？';
  assert(S.isSceneRequest(text, context(state))); assert(S.allowedEdits(text, context(state)).includes('annotate'));
  assert(S.validateEdits([annotation(text, 'interpretation', '一起停留的位置')], context(state), text));
});


test('offline placement prefixes keep the object noun separate from its exact creation source', () => {
  for (const prefix of ['在这里', '在那边', '在这边', '在那里', '这里', '那边', '这边', '那里']) {
    const text = `${prefix}放一张能坐两个人的长椅`, result = S.offline(context(), text);
    assert.equal(result.edits.length, 1, text); assert.equal(result.edits[0].object.label, '长椅', text);
    const state = S.applyEdits(S.empty(), result.edits, text); assert(state);
    assert.equal(state.objects[0].source.createdBy, text); assert.equal(state.objects[0].glyphs.split('\n')[0].length, 18);
  }
});
