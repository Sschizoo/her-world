/* Fictional focus is a projection of visible evidence, never model telemetry. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkFocus = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function calculate(view, pack) {
    if (!view || !pack) return [];
    const objects = Array.isArray(view.world?.objects) ? view.world.objects : [];
    const definitions = [...(pack.entities || []).map(item => ({ ...item, object: false })), ...objects.map(item => ({ id: item.id, label: item.label, kind: 'object', object: item }))];
    const seen = new Set(), scores = new Map(), reasons = new Map();
    const add = (id, score, reason) => { seen.add(id); scores.set(id, (scores.get(id) || 0) + score); const list = reasons.get(id) || []; if (!list.includes(reason)) list.push(reason); reasons.set(id, list); };
    const messages = (view.transcript || view.messages || []).filter(item => !item.transient && !item.incomplete && item.role !== 'system' && typeof item.text === 'string').slice(-24);
    messages.forEach((item, index) => {
      for (const definition of definitions) {
        if (definition.label && item.text.includes(definition.label)) add(definition.id, 1.5 * Math.pow(.78, messages.length - index - 1), '最近已显示的对话提及');
      }
    });
    for (const definition of definitions) {
      if (definition.object) add(definition.id, .35, '当前画面中的物件');
      if (definition.kind === 'weather' && view.world?.weather?.intensity > 0 && !view.world.weather.paused) add(definition.id, .8, '当前可见天气');
      const source = definition.object ? definition.object.source : definition.kind === 'weather' ? view.world?.weather?.source : null;
      const eventNumber = Number(String(source?.eventId || '').replace(/^event_/, ''));
      if (Number.isInteger(eventNumber) && eventNumber > 0 && eventNumber <= view.revision) add(definition.id, .8 * Math.pow(.72, view.revision - eventNumber), '已执行的变化（随回合衰减）');
    }
    const pending = (view.pendingQuestions || []).find(item => item.id === view.activeQuestionId);
    if (pending) for (const definition of definitions) if (seen.has(definition.id) && pending.text.includes(definition.label)) add(definition.id, .2, '当前显示的问题');
    const chosen = definitions.filter((item, index) => seen.has(item.id) && definitions.findIndex(other => other.id === item.id) === index)
      .map(item => ({ id: item.id, label: item.label, score: scores.get(item.id), evidence: reasons.get(item.id).slice(0, 3) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 4);
    const total = chosen.reduce((sum, item) => sum + item.score, 0);
    if (!total) return [];
    const values = chosen.map(item => { const exact = item.score / total * 100; return { ...item, percent: Math.floor(exact), fraction: exact % 1 }; });
    let left = 100 - values.reduce((sum, item) => sum + item.percent, 0);
    for (const item of [...values].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id))) if (left-- > 0) item.percent++;
    return values.map(({ fraction, ...item }) => ({ ...item, bar: '|'.repeat(Math.round(item.percent / 5)) + '.'.repeat(20 - Math.round(item.percent / 5)) }));
  }
  return Object.freeze({ calculate });
});
