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

const placed = (placement, overrides = {}) => ({ type: 'create', object: { label: '新物件', glyphs: '[][]\n||||', scale: 1, ...overrides }, placement });
const position = item => ({ x: item.x, y: item.y });

test('layout is a serializable independent map of the renderer coordinate system', () => {
  const expected = {
    grid: { cols: 100, rows: 60 }, origin: 'top_left', xDirection: 'right', yDirection: 'down', objectAnchor: 'top_left',
    sky: { x: 4, y: 3, width: 92, height: 14 }, window: { x: 30, y: 29, width: 13, height: 12 }, ground: { centerX: 50, baseline: 46 }
  };
  const layout = S.layout(); assert.deepEqual(JSON.parse(JSON.stringify(layout)), expected);
  layout.grid.cols = 1; layout.sky.x = 99; layout.window.width = 0; layout.ground.baseline = 0;
  assert.deepEqual(S.layout(), expected);
});

test('sky and ground placement use the full scaled footprint including blank padding', () => {
  const clouds = placed({ anchor: 'sky' }, { label: '地上的云', glyphs: '  __  \n(____)\n      ', scale: 2 });
  const bench = placed({ anchor: 'ground' }, { label: '天空长椅', glyphs: '+----+\n |  | ', scale: 2 });
  const edits = S.validateSemanticEdits([clouds, bench], context(), '按指定位置画出来');
  assert.deepEqual(position(edits[0].object), { x: 44, y: 7 });
  assert.deepEqual(position(edits[1].object), { x: 44, y: 42 });
  assert.equal(edits[0].object.glyphs, clouds.object.glyphs);
  assert.deepEqual(Object.keys(edits[0]).sort(), ['object', 'type']);
  assert.deepEqual(Object.keys(edits[0].object).sort(), ['glyphs', 'label', 'scale', 'x', 'y']);
  assert.equal(S.applySemanticEdits(S.empty(), [clouds, bench], '按指定位置画出来').objects[1].y + 4, S.layout().ground.baseline);
});

test('window sides have a two-cell gap and orthogonal center alignment', () => {
  for (const [anchor, expected] of [['window_left', { x: 24, y: 34 }], ['window_right', { x: 45, y: 34 }], ['window_below', { x: 35, y: 43 }]]) {
    const edit = S.validateSemanticEdits([placed({ anchor })], context(), '把物件放在窗边')[0];
    assert.deepEqual(position(edit.object), expected, anchor);
  }
  for (const [anchor, expected] of [['above', { x: 35, y: 25 }], ['below', { x: 35, y: 43 }], ['left_of', { x: 24, y: 34 }], ['right_of', { x: 45, y: 34 }]]) {
    const edit = S.validateSemanticEdits([placed({ anchor, target: 'window' })], context(), '按窗户的位置摆放')[0];
    assert.deepEqual(position(edit.object), expected, anchor);
  }
});

test('relative placement uses existing objects and earlier new refs in batch order', () => {
  const state = bench();
  const edits = [
    { ...placed({ anchor: 'left_of', target: 'obj_1', gap: 1 }), ref: 'new_1' },
    { ...placed({ anchor: 'above', target: 'new_1', gap: 0 }, { glyphs: '<>' }), ref: 'new_2' },
    { type: 'update', target: 'new_1', changes: {}, placement: { anchor: 'below', target: 'new_2', gap: 3 } }
  ];
  const normalized = S.validateSemanticEdits(edits, context(state), '按顺序摆放这些物件');
  assert.deepEqual(position(normalized[0].object), { x: 30, y: 43 });
  assert.deepEqual(position(normalized[1].object), { x: 31, y: 42 });
  assert.deepEqual(normalized[2], { type: 'update', target: 'new_1', changes: { x: 30, y: 46 } });
  const next = S.applySemanticEdits(state, edits, '按顺序摆放这些物件');
  assert.deepEqual(position(next.objects[1]), { x: 30, y: 46 });
  assert.deepEqual(position(next.objects[2]), { x: 31, y: 42 });
});

test('scale and glyph changes retain the prior center or bottom-center when requested', () => {
  const state = S.applySemanticEdits(S.empty(), [{ type: 'create', object: { label: '画框', glyphs: '+----+\n+----+', x: 10, y: 20, scale: 1 } }], '放一个画框');
  for (const [anchor, changes, expected] of [
    ['keep_center', { scale: 3 }, { x: 4, y: 18 }], ['keep_base', { scale: 3 }, { x: 4, y: 16 }],
    ['keep_center', { glyphs: ' [] \n [] \n [] \n [] ', scale: 2 }, { x: 9, y: 17 }],
    ['keep_base', { glyphs: ' [] \n [] \n [] \n [] ', scale: 2 }, { x: 9, y: 14 }]
  ]) {
    const edit = { type: 'update', target: 'obj_1', changes, placement: { anchor } };
    const next = S.applySemanticEdits(state, [edit], '改一下画框的大小');
    assert.deepEqual(position(next.objects[0]), expected, anchor);
    assert.equal(next.objects[0].source.createdBy, '放一个画框');
  }
  const raw = S.applySemanticEdits(state, [{ type: 'update', target: 'obj_1', changes: { scale: 3 } }], '改一下画框的大小');
  assert.deepEqual(position(raw.objects[0]), { x: 10, y: 20 });
});

test('retained integer anchors do not drift across repeated odd/even glyph and scale round trips', () => {
  const dimensions = item => ({ width: Math.max(...item.glyphs.split('\n').map(row => row.length)) * item.scale, height: item.glyphs.split('\n').length * item.scale });
  const retained = (item, anchor) => {
    const { width, height } = dimensions(item);
    return { x: item.x + Math.floor(width / 2), y: item.y + (anchor === 'keep_base' ? height : Math.floor(height / 2)) };
  };
  for (const anchor of ['keep_center', 'keep_base']) {
    for (const [original, resized] of [
      [{ glyphs: '@', scale: 1 }, { glyphs: '@', scale: 2 }],
      [{ glyphs: '# #\n # \n# #', scale: 1 }, { glyphs: '####\n####', scale: 2 }],
      [{ glyphs: '####\n####', scale: 1 }, { glyphs: '# #\n # \n# #', scale: 3 }],
      [{ glyphs: '[]', scale: 2 }, { glyphs: '[]', scale: 3 }]
    ]) {
      let state = S.applySemanticEdits(S.empty(), [{ type: 'create', object: { label: '轮廓', x: 40, y: 20, ...original } }], '画一个轮廓');
      const fixed = retained(state.objects[0], anchor);
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const changes of [resized, original]) {
          const edits = [{ type: 'update', target: 'obj_1', changes, placement: { anchor } }];
          const normalized = S.validateSemanticEdits(edits, context(state), '调整大小');
          const next = S.applySemanticEdits(state, edits, '调整大小');
          assert(next); assert.deepEqual(retained(next.objects[0], anchor), fixed);
          assert.deepEqual(S.applySemanticEdits(state, normalized, '调整大小'), next);
          state = next;
        }
        assert.deepEqual(position(state.objects[0]), { x: 40, y: 20 }, `${anchor} cycle ${cycle}`);
      }
    }
    const edge = S.applySemanticEdits(S.empty(), [{ type: 'create', object: { label: '边角', glyphs: '@', x: 0, y: 0, scale: 1 } }], '放在边角');
    assert.equal(S.applySemanticEdits(edge, [{ type: 'update', target: 'obj_1', changes: { scale: 2 }, placement: { anchor } }], '放大'), null);
  }
});

test('relative placement clamps only its free axis and rejects impossible requested sides', () => {
  const raw = (x, y) => S.applySemanticEdits(S.empty(), [{ type: 'create', object: { label: '参照', glyphs: '@', x, y, scale: 1 } }], '放一个参照');
  const topLeft = raw(0, 0), bottomRight = raw(99, 59), large = { glyphs: 'x'.repeat(24) + '\n' + 'x'.repeat(24), scale: 3 };
  for (const [state, anchor, expected] of [
    [topLeft, 'below', { x: 0, y: 3 }], [topLeft, 'right_of', { x: 3, y: 0 }],
    [bottomRight, 'above', { x: 28, y: 51 }], [bottomRight, 'left_of', { x: 25, y: 54 }]
  ]) {
    const edits = S.validateSemanticEdits([placed({ anchor, target: 'obj_1' }, large)], context(state), '紧挨参照摆放');
    assert.deepEqual(position(edits[0].object), expected, anchor);
  }
  for (const [state, anchor] of [[topLeft, 'above'], [topLeft, 'left_of'], [bottomRight, 'below'], [bottomRight, 'right_of']]) {
    assert.equal(S.applySemanticEdits(state, [placed({ anchor, target: 'obj_1' })], '紧挨参照摆放'), null, anchor);
  }
  assert.equal(S.validateSemanticEdits([placed({ anchor: 'window_left' }, large)], context(), '放在左边'), null);
  assert.equal(S.validateSemanticEdits([placed({ anchor: 'window_below' }, { glyphs: Array(10).fill('x').join('\n'), scale: 3 })], context(), '放在下面'), null);
  const edge = S.applySemanticEdits(S.empty(), [{ type: 'create', object: { label: '边缘', glyphs: 'xxxx', x: 95, y: 1, scale: 1 } }], '放在边缘');
  for (const anchor of ['keep_center', 'keep_base']) assert.equal(S.applySemanticEdits(edge, [{ type: 'update', target: 'obj_1', changes: { scale: 3 }, placement: { anchor } }], '放大'), null);
});

test('invalid placement schemas, targets and oversized sky objects reject an entire batch without mutation', () => {
  const state = bench(), before = JSON.stringify(state), good = { type: 'update', target: 'obj_1', changes: {}, placement: { anchor: 'ground' } };
  const invalid = [
    placed({ anchor: 'unknown' }), placed({ anchor: 'toString' }), placed({ anchor: {} }), placed({ anchor: 'ground', gap: 2 }),
    placed({ anchor: 'sky', target: 'window' }), placed({ anchor: 'keep_center' }), placed({ anchor: 'keep_base' }),
    placed({ anchor: 'above' }), placed({ anchor: 'above', target: 'obj_999' }), placed({ anchor: 'above', target: 'new_1' }),
    placed({ anchor: 'above', target: 'window', gap: -1 }), placed({ anchor: 'above', target: 'window', gap: 11 }),
    placed({ anchor: 'above', target: 'window', gap: 0.5 }), placed({ anchor: 'above', target: 'window', extra: true }),
    placed({ anchor: 'sky' }, { glyphs: Array(5).fill('x').join('\n'), scale: 3 }),
    placed({ anchor: 'ground' }, { x: 10 }), placed({ anchor: 'ground' }, { y: 10 }), placed({ anchor: 'ground' }, { color: 'red' }),
    { ...good, changes: { x: 1 } }, { ...good, changes: { y: 1 } }, { ...good, changes: { source: 'invented' } },
    { ...good, placement: { anchor: 'above', target: 'obj_1' } },
    { ...good, placement: { anchor: 'ground' }, extra: true }
  ];
  for (const bad of invalid) {
    const edits = [good, bad], original = JSON.stringify(edits), ctx = context(state), oldContext = JSON.stringify(ctx);
    assert.equal(S.validateSemanticEdits(edits, ctx, '调整摆放'), null, JSON.stringify(bad));
    assert.equal(S.applySemanticEdits(state, edits, '调整摆放'), null, JSON.stringify(bad));
    assert.equal(JSON.stringify(edits), original); assert.equal(JSON.stringify(ctx), oldContext); assert.equal(JSON.stringify(state), before);
  }
  const forward = [{ ...placed({ anchor: 'above', target: 'new_2' }), ref: 'new_1' }, { ...placed({ anchor: 'ground' }), ref: 'new_2' }];
  assert.equal(S.validateSemanticEdits(forward, context(), '按顺序摆放'), null);
  assert.equal(S.validateSemanticEdits([{ type: 'remove', target: 'obj_1' }, placed({ anchor: 'above', target: 'obj_1' })], context(state), '换掉参照'), null);
});

test('placement normalization revalidates and replays identically without changing legacy edits', () => {
  const input = '画好以后放大并写下注解', state = S.empty(), ctx = context(state);
  const edits = [{ ...placed({ anchor: 'ground' }), ref: 'new_1' }, { type: 'update', target: 'new_1', changes: { scale: 2 }, placement: { anchor: 'keep_base' } }, { type: 'annotate', target: 'new_1', field: 'meaning', value: '一起停留' }];
  const before = JSON.stringify({ state, ctx, edits }), normalized = S.validateSemanticEdits(edits, ctx, input);
  assert.deepEqual(S.validateSemanticEdits(normalized, ctx, input), normalized);
  assert.deepEqual(S.applySemanticEdits(state, normalized, input), S.applySemanticEdits(state, edits, input));
  assert(!JSON.stringify(normalized).includes('placement'));
  assert.equal(JSON.stringify({ state, ctx, edits }), before);
  const raw = [{ type: 'create', object: { label: '云', glyphs: '.--.', x: 10, y: 50, scale: 1 } }];
  assert.deepEqual(S.validateSemanticEdits(raw, context(), '画朵云'), raw);
  assert.deepEqual(position(S.applySemanticEdits(state, raw, '画朵云').objects[0]), { x: 10, y: 50 });
  assert.equal(S.validateEdits([{ ...placed({ anchor: 'ground' }), evidence: '画一张新物件' }], context(), '画一张新物件'), null);
  const offline = S.offline(context(), '画一张长椅');
  assert.deepEqual(S.validateEdits(offline.edits, context(), '画一张长椅'), offline.edits);
  assert.deepEqual(position(offline.edits[0].object), { x: 35, y: 42 });
});
