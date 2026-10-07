/* Honest local command adapter. It emits the same typed plans as the model. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkOffline = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const HELP = ['/新建 长椅', '/移动 obj_1 30 38', '/放大 obj_1 2', '/含义 obj_1 一起等天亮', '/理解 obj_1 一个可以停留的地方', '/清除理解 obj_1', '/删除 obj_1', '/天气 雨', '/天气 雪', '/天气 雾', '/天气 晴', '/天气 停', '/天气 恢复', '/天气 强度 2', '/命名 叶信', '/记住 note_visit 来访 | 今天在窗边聊过', '/忘记 note_visit', '/忘记 memory_1', '/回答 你的回答', '/稍后', '/打开 世界'];
  const reply = (text, operations = [], topic = null) => ({ schema: 'her-world-turn-v2', lines: [text], beats: operations.length ? [{ afterLine: 0, operations }] : [], topic });
  function question(context) { const pending = context.pendingQuestions || []; return pending.find(item => item.topic === context.story?.topic && !item.deferred) || pending.find(item => !item.deferred) || pending[0] || null; }
  function respond(context, input) {
    const text = String(input || '').normalize('NFC').trim();
    const pending = question(context);
    let match;
    const selected = pending?.choices?.find(choice => choice.label === text);
    if (selected) return reply('我会按你对当前问题的明确选择记录。', [{ type: 'story.answer', questionId: pending.id, value: selected.id }], pending.topic);
    if ((match = text.match(/^\/新建\s+(.+)$/u))) {
      const label = match[1].trim();
      return reply('我放下一幅简单的占位字符图案。离线模式不会生成复杂的新外观。', [{ type: 'world.create', object: { label, glyphs: '+--------+\n|        |\n+--------+', x: 45, y: 43, scale: 1 } }]);
    }
    if ((match = text.match(/^\/移动\s+(obj_\d+)\s+(\d+)\s+(\d+)$/u))) return reply('物件将移到指定的逻辑坐标。', [{ type: 'world.update', target: match[1], changes: { x: Number(match[2]), y: Number(match[3]) }, placementPolicy: 'exact' }]);
    if ((match = text.match(/^\/放大\s+(obj_\d+)\s+([123])$/u))) return reply('物件的倍率已按这次要求更新。', [{ type: 'world.update', target: match[1], changes: { scale: Number(match[2]) } }]);
    if ((match = text.match(/^\/删除\s+(obj_\d+)$/u))) return reply('这个物件会从当前画面移除；原来的对话仍保留。', [{ type: 'world.remove', target: match[1] }]);
    if ((match = text.match(/^\/(含义|理解)\s+(\S+)\s+(.+)$/u))) return reply(match[1] === '含义' ? '你赋予的意义已更新，和我的理解分开记录。' : '这份记录标明是我的理解，可以随时改。', [{ type: 'world.annotate', target: match[2], field: match[1] === '含义' ? 'meaning' : 'interpretation', value: match[3] }]);
    if ((match = text.match(/^\/清除(含义|理解)\s+(\S+)$/u))) return reply('当前这项注解已清除；这不等于删除原始聊天。', [{ type: 'world.annotate', target: match[2], field: match[1] === '含义' ? 'meaning' : 'interpretation', value: null }]);
    if ((match = text.match(/^\/天气\s+(雨|雪|雾|晴)$/u))) return reply('天气已切换到你明确选择的类型。', [{ type: 'weather.set', changes: { kind: { 雨: 'rain', 雪: 'snow', 雾: 'mist', 晴: 'clear' }[match[1]], intensity: match[1] === '晴' ? 0 : 1, paused: false } }]);
    if ((match = text.match(/^\/天气\s+(停|恢复|强度\s+[0-3])$/u))) {
      if (context.world?.weather?.kind === 'clear' && (match[1] === '恢复' || /[1-3]$/u.test(match[1]))) return reply('现在是晴天。想让雨、雪还是雾出现？可以用“/天气 雨”等明确选择。');
      const changes = match[1] === '停' ? { paused: true } : match[1] === '恢复' ? { paused: false, intensity: context.world?.weather?.intensity || 1 } : { intensity: Number(match[1].slice(-1)), paused: match[1].slice(-1) === '0' };
      return reply('天气设置已按这次明确操作更新。', [{ type: 'weather.set', changes }]);
    }
    if ((match = text.match(/^\/命名\s+(.+)$/u))) return reply('天气的名字已更新；只有相关问题也得到回答时，剧情节点才会完成。', [{ type: 'weather.set', changes: { name: match[1] } }]);
    if ((match = text.match(/^\/记住\s+((?:note_[a-z0-9_]{1,32}|memory_[1-9][0-9]{0,4}))\s+([^|]+)\|(.+)$/u))) return reply('这条可修改笔记已经记下，并保留本轮输入作为来源。', [{ type: 'memory.upsert', id: match[1], title: match[2].trim(), body: match[3].trim() }]);
    if ((match = text.match(/^\/忘记\s+((?:note_[a-z0-9_]{1,32}|memory_[1-9][0-9]{0,4}))$/u))) return reply('当前笔记已从后续回应的回忆中移除。原始聊天仍保留；眼前的物件不会因此消失。', [{ type: 'memory.remove', id: match[1] }]);
    if ((match = text.match(/^\/打开\s+(世界|记忆|日志|角色)$/u))) return reply('可以在打开的面板里查看目前已经确认的内容。', [{ type: 'panel.open', panel: { 世界: 'world', 记忆: 'memory', 日志: 'logs', 角色: 'character' }[match[1]] }]);
    if ((match = text.match(/^\/回答\s+(.+)$/u))) {
      if (!pending?.id) return reply('目前没有等待回答的问题，可以继续聊天或修改世界。');
      let value = match[1].trim();
      if (pending.choices) value = pending.choices.find(choice => choice.id === value || choice.label === value)?.id || value;
      return reply('这份回答会交给当前问题的完成规则检查。', [{ type: 'story.answer', questionId: pending.id, value }], pending.topic);
    }
    if (/^\/稍后$/u.test(text)) return pending?.id ? reply('这个问题先放在一边。你可以继续聊，之后再回来。', [{ type: 'story.defer', questionId: pending.id }]) : reply('这里没有需要赶着回答的问题。');
    if (/^(?:停雨|让雨停下|雨先停一下)[吧。！!]*$/u.test(text)) return reply('雨先停在这里，密度仍然保留。', [{ type: 'weather.set', changes: { paused: true } }]);
    if (/^(?:恢复下雨|让雨继续|继续下雨)[吧。！!]*$/u.test(text)) return reply('雨继续落下。', [{ type: 'weather.set', changes: { kind: 'rain', paused: false, intensity: context.world?.weather?.intensity || 1 } }]);
    return reply('离线模式只识别少量明确操作，刚才这句话没有改变世界或问题进度。可以继续写，或使用下方的功能测试示例。');
  }
  return Object.freeze({ respond, help: () => HELP.slice() });
});
