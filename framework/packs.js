/* Small functional fixtures. Story content is data, never executable rules. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkPacks = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const capabilities = ['world.create', 'world.update', 'world.remove', 'world.annotate', 'weather.set', 'memory.upsert', 'memory.remove', 'story.answer', 'story.defer', 'character.update', 'log.note', 'panel.open'];
  const world = { capacity: 8, landmarks: { sky: { x: 4, y: 3, width: 92, height: 14 }, window: { x: 30, y: 29, width: 13, height: 12 }, ground: { x: 0, y: 46, width: 100, height: 1 } }, weather: { kind: 'rain', name: '未命名的雨', intensity: 0, paused: true } };
  const character = { name: '她', role: '一个和你共同理解字符世界的程序', mood: 'curious', stance: '愿意听，也允许话题暂时没有答案', trust: 0, familiarity: 0 };
  const packs = [
    {
      id: 'rain-lab', version: '1.0.0', rulesVersion: '4', title: '雨与记忆 · 功能验证',
      character, world, capabilities,
      guidance: '这是功能验证场景，不是完整剧本。自由交谈优先，不按消息数推进。回应当前真实问题可以提交 story.answer；岔开话题保持问题未完成。可以随时造物、改天气或记笔记。问题问名字时，正式命名可在同一句同时提交 weather.set 的 name 与 story.answer。访问日志必须实际显示后才能完成。不要替玩家同意保存来访者引用。',
      topics: [{ id: 'rain', title: '雨' }, { id: 'naming', title: '名字' }, { id: 'records', title: '留下什么' }, { id: 'visitor', title: '关于你' }],
      entities: [{ id: 'rain', label: '雨', kind: 'weather' }, { id: 'window', label: '窗', kind: 'landmark' }, { id: 'visitor', label: '来访者', kind: 'person' }],
      initialFacts: {},
      nodes: [
        { id: 'describe', topic: 'rain', requires: {}, question: { id: 'q_rain', text: '你会怎样描述一场雨？也可以先聊别的。', kind: 'open' }, completion: { type: 'answer' }, sets: { rain_described: true } },
        { id: 'name', topic: 'naming', requires: { rain_described: true }, question: { id: 'q_name', text: '如果给这场雨一个名字，你想叫它什么？', kind: 'open' }, completion: { type: 'answer' }, sets: { rain_named: true } },
        { id: 'read', topic: 'records', requires: { rain_named: true }, question: { id: 'q_read', text: '可以打开运行日志，看看刚才实际发生了哪些变化。', kind: 'open' }, completion: { type: 'ui', panel: 'logs' }, sets: { records_seen: true } },
        { id: 'visitor', topic: 'visitor', requires: { records_seen: true }, question: { id: 'q_visitor', text: '你愿意留下来访者引用吗？可以同意、拒绝，或先不决定。', kind: 'consent', choices: [{ id: 'allow', label: '我同意留下引用' }, { id: 'decline', label: '只保留场景' }] }, completion: { type: 'answer' }, sets: { visitor_decided: true } }
      ]
    },
    {
      id: 'lantern-lab', version: '1.0.0', rulesVersion: '4', title: '窗边工坊 · 功能验证',
      character: { ...character, role: '一个和你一起整理窗边工坊的程序', stance: '先理解你的用途，再一起修改它' },
      world: { ...world, weather: { kind: 'rain', name: '窗外天气', intensity: 0, paused: true } }, capabilities,
      guidance: '这是独立的工坊功能场景，不询问雨的定义，也不使用雨序章路线。先讨论玩家想在窗边做什么；实际创建一个物件后，可以邀请查看世界面板。选择留在工坊或探索别处会打开不同问题。分支不关闭自由聊天，创造与改记忆不必等主线。不要把拒绝或不确定当作完成当前问题。',
      topics: [{ id: 'purpose', title: '想做什么' }, { id: 'making', title: '一起造物' }, { id: 'place', title: '看一看' }, { id: 'route', title: '下一件事' }, { id: 'stay', title: '留在这里' }, { id: 'explore', title: '看向远处' }],
      entities: [{ id: 'window', label: '窗', kind: 'landmark' }, { id: 'workshop', label: '工坊', kind: 'place' }, { id: 'visitor', label: '来访者', kind: 'person' }],
      initialFacts: {},
      nodes: [
        { id: 'purpose', topic: 'purpose', requires: {}, question: { id: 'q_purpose', text: '你想把窗边变成一个可以做什么的地方？', kind: 'open' }, completion: { type: 'answer' }, sets: { purpose_known: true } },
        { id: 'make', topic: 'making', requires: { purpose_known: true }, question: { id: 'q_make', text: '可以直接告诉我，要在这里添上什么。', kind: 'open' }, completion: { type: 'operation', operation: 'world.create' }, sets: { object_made: true } },
        { id: 'inspect', topic: 'place', requires: { object_made: true }, question: { id: 'q_inspect', text: '打开世界面板，可以看到物件、位置和它的来源。', kind: 'open' }, completion: { type: 'ui', panel: 'world' }, sets: { world_seen: true } },
        { id: 'route', topic: 'route', requires: { world_seen: true }, question: { id: 'q_route', text: '接下来想留在这里，还是想象窗外更远的地方？', kind: 'choice', choices: [{ id: 'stay', label: '留在这里' }, { id: 'explore', label: '看看远处' }] }, completion: { type: 'answer' }, sets: { route_chosen: true } },
        { id: 'stay', topic: 'stay', requires: { 'answer.q_route': 'stay' }, question: { id: 'q_stay', text: '留在这里时，你最想保留哪个细节？', kind: 'open' }, completion: { type: 'answer' }, sets: { route_expressed: true } },
        { id: 'explore', topic: 'explore', requires: { 'answer.q_route': 'explore' }, question: { id: 'q_explore', text: '你想象窗外最远的地方有什么？', kind: 'open' }, completion: { type: 'answer' }, sets: { route_expressed: true } }
      ]
    }
  ];
  const copy = value => JSON.parse(JSON.stringify(value));
  return Object.freeze({ list: () => packs.map(copy), get: id => { const pack = packs.find(item => item.id === id); return pack ? copy(pack) : null; } });
});
