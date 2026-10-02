/* Fictional conversation focus, derived from visible game evidence only.
 * This is a deterministic narrative UI, never neural attention or emotion data.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFocus = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const ENTITIES = [
    { id: 'rain', label: '雨', pattern: /雨|雨滴|水滴|降水|\brain(?:fall)?\b|\bweather\b/i },
    { id: 'window', label: '窗', pattern: /窗|窗边|窗外|\bwindow(?:s)?\b/i },
    { id: 'name', label: '名字', pattern: /名字|命名|起名|取名|编号以外|\bnam(?:e|es|ed|ing)\b/i },
    { id: 'player', label: '来访者', pattern: /来访者|访客|一起|陪伴|\bvisitor\b|\btogether\b/i },
    { id: 'unfinished', label: '未完成', pattern: /未完成|没完成|没有完成|还没完成|未完|没做完|没有做完|没写完|没有写完|没有贴图|以后再写|空白|未实现|待办|不完整|不太完整|\bunfinished\b|\bincomplete\b/i }
  ];
  const TOPICS = {
    unfinished: 'unfinished', teach_rain: 'rain', rain: 'rain', first_drop: 'rain',
    modify_rain: 'rain', rain_name: 'name', name: 'name', window: 'window',
    shared_silence: 'player', visitor_reference: 'player', first_memory: 'rain',
    memory_discovery: 'rain', her_choice: 'rain', goodbye: 'player', parting: 'player'
  };
  const DECAY = .72;
  const TURN_CAP = 2.4;
  const BAR_WIDTH = 20;
  const validText = value => typeof value === 'string' ? value : '';

  function completedMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.filter(message => message && typeof message === 'object'
      && ['user', 'her', 'assistant'].includes(message.role)
      && !message.transient && !message.pending && !message.incomplete
      && message.complete !== false && message.completed !== false
      && validText(message.text).trim());
  }

  // The engine gives all lines of an event the same index. For external callers
  // without indices, a user line begins a turn and its replies remain in that turn.
  function dialogueTurns(messages) {
    const turns = [];
    let previousIndex, previousWasIndexed = false;
    messages.forEach(message => {
      const indexed = Number.isInteger(message.index) && message.index >= 0;
      const newTurn = !turns.length || (indexed
        ? !previousWasIndexed || message.index !== previousIndex
        : previousWasIndexed || message.role === 'user');
      if (newTurn) turns.push([]);
      turns[turns.length - 1].push(message);
      previousIndex = message.index;
      previousWasIndexed = indexed;
    });
    return turns;
  }

  function hasMilestone(milestones, id) {
    // Use exact completed IDs, never counts, future scene definitions or prompts.
    return Array.isArray(milestones) ? milestones.includes(id)
      : Boolean(milestones && typeof milestones === 'object' && milestones[id] === true);
  }

  function calculate(input = {}) {
    if (!input || typeof input !== 'object') return [];
    const messages = completedMessages(input.messages);
    const turns = dialogueTurns(messages);
    const visibleObjects = Array.isArray(input.scene?.objects) ? input.scene.objects.slice(0, 8).filter(item => item && /^obj_[1-9][0-9]{0,2}$/.test(item.id) && typeof item.label === 'string' && item.label && [...item.label].length <= 40) : [];
    const objects = visibleObjects.filter((item, index) => visibleObjects.findIndex(other => other.id === item.id) === index);
    const entities = ENTITIES.concat(objects.map(item => ({ id: `object:${item.id}`, label: [...item.label].slice(0, 8).join(''), object: item })));
    const encountered = new Set();
    const scores = Object.fromEntries(entities.map(entity => [entity.id, 0]));
    const actualName = validText(input.name).trim();
    const named = Boolean(actualName && actualName !== '未命名的雨');
    const namedMilestone = hasMilestone(input.milestones, 'rain_name')
      || hasMilestone(input.milestones, 'rain_named');
    const last = messages[messages.length - 1];

    turns.forEach((turn, index) => {
      const age = turns.length - 1 - index;
      const evidence = Object.fromEntries(entities.map(entity => [entity.id, 0]));
      turn.forEach(message => {
        const text = message.text;
        const question = message === last && message.role !== 'user' && /[?？]\s*$/.test(text);
        const weight = question ? .55 : 1.5;
        entities.forEach(entity => {
          let mentioned = entity.object ? text.includes(entity.object.label) || text === entity.object.source?.createdBy || text === entity.object.source?.lastChangedBy || new RegExp(`\\b${entity.object.id}\\b`).test(text) : entity.pattern.test(text);
          // Quoting the assigned name is earned evidence even without saying 名字.
          if (entity.id === 'name' && named && text.includes(actualName)) mentioned = true;
          // Only pronouns that refer to the player count, not the player's 你 (= her).
          if (entity.id === 'player' && message.role !== 'user' && /你|\byou(?:r)?\b/i.test(text)) mentioned = true;
          if (mentioned) {
            encountered.add(entity.id);
            evidence[entity.id] += weight;
          }
        });
        // A completed player utterance establishes presence without letting a
        // generic greeting outweigh the actual subjects being discussed.
        if (message.role === 'user') {
          encountered.add('player');
          evidence.player += .25;
          if (/我(?:给|起|取|来|的)|\bI\b/.test(text) && /名|记得|来过|\bname\b/i.test(text)) evidence.player += .55;
        }
      });
      entities.forEach(entity => {
        scores[entity.id] += Math.min(TURN_CAP, evidence[entity.id]) * Math.pow(DECAY, age);
      });
    });

    // Only executed, already-visible state can introduce an entity. The caller
    // MUST pass HerEngine.view(state, through), never the full future state.
    const rain = input.rain;
    if (rain && typeof rain === 'object' && rain.created === true) {
      encountered.add('rain');
      scores.rain += rain.paused === true ? .7 : rain.density === 'heavy' ? 1.4 : 1;
    }
    if (named || namedMilestone) {
      encountered.add('name');
      scores.name += .55;
    }
    if (hasMilestone(input.milestones, 'visitor_decided')) {
      encountered.add('player');
      scores.player += .2;
    }
    for (const item of objects) { encountered.add(`object:${item.id}`); scores[`object:${item.id}`] += .4; }
    const topicEntity = TOPICS[input.topic];
    if (encountered.has(topicEntity)) scores[topicEntity] += .2;

    const selected = entities.map((entity, order) => ({
      id: entity.id,
      label: entity.label,
      // A tiny persistent floor records an encounter without erasing history.
      score: Math.round(Math.min(12, scores[entity.id] + .08) * 1000000) / 1000000,
      order
    })).filter(entity => encountered.has(entity.id))
      .sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 4);
    if (!selected.length) return [];

    const total = selected.reduce((sum, entity) => sum + entity.score, 0);
    const allocations = selected.map(entity => {
      const exact = entity.score / total * 100;
      return { ...entity, percent: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let spare = 100 - allocations.reduce((sum, entity) => sum + entity.percent, 0);
    const remainderOrder = [...allocations].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
    for (let i = 0; i < spare; i++) remainderOrder[i].percent++;
    return allocations.map(({ id, label, score, percent }) => {
      const filled = Math.round(percent / 100 * BAR_WIDTH);
      return { id, label, score, percent, bar: '-'.repeat(filled) + '.'.repeat(BAR_WIDTH - filled) };
    });
  }

  return Object.freeze({ calculate });
});
