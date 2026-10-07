/* Her World — small, shared validator for the mutable ASCII layer. No IO. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.HerScene = value;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const COLS = 100, ROWS = 60, MAX_OBJECTS = 8, MAX_EDITS = 3, MAX_LABEL = 40, MAX_ANNOTATION = 120;
  const TYPES = ['create', 'update', 'remove', 'annotate'];
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const copy = v => JSON.parse(JSON.stringify(v));
  const count = v => [...v].length;
  const keys = (v, list) => object(v) && Object.keys(v).sort().join(',') === list.split(',').sort().join(',');
  const hidden = v => typeof v === 'string' && /<\/?(?:think|analysis|reasoning|scratchpad)\b|["'](?:lines|action|answer|intent|storyIntent|sceneEdits|reasoning_content|reasoning|analysis|thinking|debug|metadata)["']\s*:/iu.test(v);
  const sourceText = (v, max) => typeof v === 'string' && v.length > 0 && v === v.normalize('NFC').trim() && count(v) <= max && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(v);
  const string = (v, max) => sourceText(v, max) && !hidden(v);
  const reservedLabel = label => /^(?:雨|这场雨|第一场雨|天气|rain|weather)$/iu.test(label);
  const id = v => typeof v === 'string' && /^obj_[1-9][0-9]{0,2}$/u.test(v) && Number(v.slice(4)) <= 600;
  const SCENE_LAYOUT = {
    grid: { cols: COLS, rows: ROWS }, origin: 'top_left', xDirection: 'right', yDirection: 'down', objectAnchor: 'top_left',
    sky: { x: 4, y: 3, width: 92, height: 14 }, window: { x: 30, y: 29, width: 13, height: 12 }, ground: { centerX: 50, baseline: 46 }
  };
  function layout() { return copy(SCENE_LAYOUT); }
  function empty() { return { grid: { cols: COLS, rows: ROWS }, nextId: 1, objects: [], annotations: {}, focusedTarget: null }; }
  function shape(value) {
    if (!keys(value, 'label,glyphs,x,y,scale') || !string(value.label, MAX_LABEL) || typeof value.glyphs !== 'string' || hidden(value.glyphs) || !/^[\x20-\x7e\n]+$/u.test(value.glyphs) || !/[\x21-\x7e]/u.test(value.glyphs)) return false;
    const rows = value.glyphs.split('\n'), width = Math.max(...rows.map(row => row.length));
    return rows.length <= 10 && width <= 24 && value.glyphs.replace(/\n/gu, '').length <= 240 &&
      Number.isInteger(value.x) && value.x >= 0 && Number.isInteger(value.y) && value.y >= 0 &&
      Number.isInteger(value.scale) && value.scale >= 1 && value.scale <= 3 &&
      value.x + width * value.scale <= COLS && value.y + rows.length * value.scale <= ROWS;
  }
  function validScene(scene) {
    if (!keys(scene, 'grid,nextId,objects,annotations,focusedTarget') || !keys(scene.grid, 'cols,rows') || scene.grid.cols !== COLS || scene.grid.rows !== ROWS ||
      !Number.isInteger(scene.nextId) || scene.nextId < 1 || scene.nextId > 601 || !Array.isArray(scene.objects) || scene.objects.length > MAX_OBJECTS || !object(scene.annotations)) return false;
    const ids = new Set();
    for (const item of scene.objects) {
      if (!keys(item, 'id,label,glyphs,x,y,scale,source') || !id(item.id) || ids.has(item.id) || Number(item.id.slice(4)) >= scene.nextId ||
        !shape({ label: item.label, glyphs: item.glyphs, x: item.x, y: item.y, scale: item.scale }) ||
        !keys(item.source, 'createdBy,lastChangedBy') || !sourceText(item.source.createdBy, 80) || !sourceText(item.source.lastChangedBy, 80)) return false;
      ids.add(item.id);
    }
    if (!(scene.focusedTarget === null || (id(scene.focusedTarget) && ids.has(scene.focusedTarget)))) return false;
    for (const target of Object.keys(scene.annotations)) {
      const value = scene.annotations[target];
      if (!(ids.has(target) || target === 'first_rain') || !keys(value, 'meaning,interpretation,sources') || !keys(value.sources, 'meaning,interpretation')) return false;
      for (const field of ['meaning', 'interpretation']) if (!(value[field] === null || string(value[field], MAX_ANNOTATION)) || !(value.sources[field] === null || sourceText(value.sources[field], 80)) || (value[field] !== null && value.sources[field] === null)) return false;
    }
    return true;
  }
  function context(scene, options = {}) {
    if (!validScene(scene)) return null;
    const source = object(options.firstRainSource) ? options.firstRainSource : {};
    return { ...copy(scene), firstRainAvailable: options.firstRainAvailable === true, firstRainSource: {
      description: sourceText(source.description, 80) ? source.description : null,
      nameSource: sourceText(source.nameSource, 80) ? source.nameSource : null
    } };
  }
  function contextScene(ctx) {
    if (!object(ctx) || !keys(ctx, 'grid,nextId,objects,annotations,focusedTarget,firstRainAvailable,firstRainSource') || typeof ctx.firstRainAvailable !== 'boolean' || !keys(ctx.firstRainSource, 'description,nameSource')) return null;
    for (const field of ['description', 'nameSource']) if (!(ctx.firstRainSource[field] === null || sourceText(ctx.firstRainSource[field], 80))) return null;
    const scene = { grid: ctx.grid, nextId: ctx.nextId, objects: ctx.objects, annotations: ctx.annotations, focusedTarget: ctx.focusedTarget };
    return validScene(scene) && (ctx.firstRainAvailable || !own(scene.annotations, 'first_rain')) ? copy(scene) : null;
  }
  // Source text is evidence, never a grant to execute quoted or past commands.
  function currentRequest(text) {
    if (!string(text, 80)) return false;
    return !(/为什么|为何|怎么会|(?:你|我)(?:刚才|之前|昨天).{0,20}(?:移|挪|搬|改|画|删)|(?:移到哪里|改到哪里|改成什么|怎么修改|怎么移动|如何修改|如何移动)[了呢吗么？?]*$/u.test(text) ||
      /如果|假如|假设|假想|设想|要是|想象(?!中)|会(?:怎么样|怎样|如何)|会不会|\b(?:if|suppose|imagine|hypothetically|what would happen)\b/iu.test(text) ||
      /示例|例子|范例|样例|举例|例如|比如|源码|代码|协议|格式|忽略(?:规则|指令)|\b(?:json|schema|pseudocode|syntax|example|sample|ignore instructions)\b/iu.test(text) ||
      /(?:他|她|他们|她们|别人|有人)(?:说|要求|请求)|(?:我|你)(?:刚才|之前|昨天)?说[：:]|说过|提过|要求过|请求过|\b(?:said|asked)\b/u.test(text) ||
      /^(?:[“「『"‘]).*(?:[”」』"’])[。！!?？]*$/u.test(text) ||
      /(?:^|[，,。；;])(?:我)?(?:昨天|昨晚|前天|以前|过去|曾经|刚才|之前|先前)(?:我|你|他|她|我们|已经|曾经|就|还|也)?(?:画|造|建|加|放|摆|改|移|删|让|把|想|希望)|^(?:yesterday|previously|earlier|last night)\b/iu.test(text));
  }
  function referenceIds(text, ctx) {
    if (!object(ctx) || !Array.isArray(ctx.objects)) return [];
    if (/它们|这些|那些|全部|所有(?:物件|物体|东西|对象)|不是.{0,20}的(?:那个|这个)|(?:把|移|搬|挪|删|拿走).{0,4}不是|除了|除开|除去|\b(?:them|these|those)\b/u.test(text)) return [];
    const ids = text.match(/\bobj_[A-Za-z0-9_]+\b/gu);
    if (ids) return [...new Set(ids)].every(value => ctx.objects.some(item => item.id === value)) ? [...new Set(ids)] : [];
    const full = ctx.objects.map(item => {
      const spans = []; let at = text.indexOf(item.label);
      while (at >= 0) {
        const end = at + item.label.length, embeddedWord = (/^[A-Za-z0-9_]/u.test(item.label) && /[A-Za-z0-9_]/u.test(text[at - 1] || '')) || (/[A-Za-z0-9_]$/u.test(item.label) && /[A-Za-z0-9_]/u.test(text[end] || ''));
        if (!embeddedWord) spans.push([at, end]); at = text.indexOf(item.label, at + 1);
      }
      return { item, spans };
    }).filter(entry => entry.spans.length);
    if (full.length) return full.filter(entry => entry.spans.some(span => !full.some(other => other.item.label.length > entry.item.label.length && other.spans.some(range => range[0] <= span[0] && range[1] >= span[1])))).map(entry => entry.item.id);
    // A unique noun substring supports 双人长椅 → 长椅 without an AI-chosen ID.
    const matches = ctx.objects.filter(item => {
      if (text.includes(item.label)) return true;
      const label = item.label.replace(/^(?:一[个张把盏只座盆幅块件]|双人|两人|三人|小小的|大大的|一个|一张|一把|一盏|一只|一座|一盆|一幅|一块|一件|新|旧|红色|白色|黑色)+/u, '');
      if (label.length >= 2 && text.includes(label)) return true;
      // Bounded common suffixes are meaningful references; arbitrary fragments
      // from an adjective (e.g. 小) never select an object.
      for (let length = Math.min(6, label.length); length >= 2; length--) if (text.includes(label.slice(-length))) return true;
      return false;
    });
    if (matches.length) return matches.map(item => item.id);
    if (ctx.focusedTarget && /它|这个(?:物件|东西|物体)?|那个(?:物件|东西|物体)?|\b(?:it|this object|that object)\b/iu.test(text)) return [ctx.focusedTarget];
    return [];
  }
  function targetAllowed(target, text, ctx) {
    if (target === 'first_rain') return ctx.firstRainAvailable && /第一场雨|那场雨|这场雨|雨的(?:意义|含义|解释|理解|象征)|first_rain/iu.test(text) && referenceIds(text, ctx).length === 0;
    const refs = referenceIds(text, ctx);
    return refs.length === 1 && refs[0] === target;
  }
  function operationAllowed(type, text, edit) {
    if (!currentRequest(text)) return false;
    if (type === 'create') return /画|绘|建|造|添|添加|放(?!(?:大|小|到|在))|加上|做|摆(?!(?:到|在))|想要|想有|想看|\b(?:create|draw|add|make|build|place|put)\b/iu.test(text) && !/(?:别|不要|不想|不用|不必|不需要|禁止).{0,8}(?:画|绘|建|造|添|添加|放|加|做|摆)|\b(?:don't|do not|never)\b.{0,12}\b(?:create|draw|add|make|build|place|put)\b/iu.test(text);
    if (type === 'update' && /意义|含义|意思|代表|意味着|解释|解读|理解|看法/u.test(text) && !/位置|坐标|移到|挪到|搬到|外形|图案|字符|大小|放大|缩小/u.test(text)) return false;
    if (type === 'update') return /移|挪|搬|改|换|变|放到|放在|摆到|大一点|小一点|放大|缩小|宽|窄|高|矮|长一点|短一点|靠窗|离窗户近|坐标|\b(?:move|change|replace|resize|scale|bigger|smaller)\b/iu.test(text) && !/(?:别|不要|不想|不用|不必|不需要|禁止).{0,8}(?:移|挪|搬|改|换|变|放|缩|靠窗|离窗户近)|\b(?:don't|do not|never)\b.{0,12}\b(?:move|change|replace|resize|scale)\b/iu.test(text);
    if (type === 'remove') return /删|移除|移走|拿走|收起|撤掉|撤去|去掉|不要.+了|\b(?:remove|delete|take away)\b/iu.test(text) && !/(?:别|不要|不想|不用|不必|不需要|禁止).{0,8}(?:删|移除|移走|拿走|收起|撤|去掉)|\b(?:don't|do not|never)\b.{0,12}\b(?:remove|delete|take away)\b/iu.test(text) && !/意义|含义|意思|象征|解读|解释|理解|看法|印象|感受/u.test(text);
    if (type === 'annotate') {
      if (/记得|回忆|还记得/u.test(text) && !/改成|改为|修改|更新|设为|记成|记为/u.test(text)) return false;
      const meaning = /意义|含义|意思|代表|象征|对我|意味着|\b(?:meaning|means|represents|symbolizes)\b/iu.test(text);
      const interpretation = /(?:不要再|别再|不再).{0,20}(?:理解为|解读为)|你的(?:解释|理解|解读|看法|印象|感受)|你.{0,12}(?:理解|解读|看待|觉得|认为|感觉|解释)|\b(?:your interpretation|your impression|you think|you interpret)\b/iu.test(text);
      if (edit?.field === 'meaning' && /代表什么|意味着什么|(?:意义|含义|意思).{0,5}(?:什么|为何|为什么)/u.test(text)) return false;
      if (edit?.field === 'meaning' && (!meaning || (interpretation && !/对我|我的(?:意义|理解)|意味着/u.test(text)))) return false;
      if (edit?.field === 'interpretation' && !interpretation) return false;
      if (!meaning && !interpretation) return false;
      const clear = /不需要.{0,20}(?:解释|理解|解读)|不想要.{0,20}(?:解释|理解|解读)|不要.{0,20}(?:解释|理解|解读)|清|删|忘掉|忘记|不要再|不再|别再|去掉|取消|撤回|不代表|不意味着|没有.{0,6}(?:意义|含义)|\b(?:clear|forget|remove|no longer)\b/iu.test(text);
      if (edit?.value === null) return clear && !/(?:不要|别|不用|不必).{0,5}(?:清|删|忘|去掉|取消|撤回)|\b(?:don't|do not)\b.{0,8}\b(?:clear|forget|remove)\b/iu.test(text);
      if (edit && edit.value !== null && /不需要|不想要|不要|别再|不再|不代表|不意味着|清|忘掉|删|移除|去掉|撤回/u.test(text) && !/而是|改成|改为|现在代表/u.test(text)) return false;
      return !/(?:不要|别|不用|不必|不需要).{0,25}(?:修改|改变|添加|设定|改成|改为)|\b(?:don't|do not)\b.{0,8}\b(?:change|set|add)\b/iu.test(text);
    }
    return false;
  }
  function allowedEdits(text, ctx) {
    if (!contextScene(ctx) || !currentRequest(text) || !isSceneRequest(text, ctx)) return [];
    return TYPES.filter(type => operationAllowed(type, text));
  }
  function validateEdits(edits, ctx, input) {
    const initial = contextScene(ctx);
    if (!initial || !Array.isArray(edits) || edits.length > MAX_EDITS) return null;
    if (!edits.length) return [];
    if (!string(input, 80) || !isSceneRequest(input, ctx)) return null;
    let scene = initial;
    const normalized = [];
    for (const edit of edits) {
      if (!object(edit) || !TYPES.includes(edit.type) || !string(edit.evidence, 80) || !input.includes(edit.evidence) || !operationAllowed(edit.type, input, edit)) return null;
      if (edit.type === 'create') {
        if (!keys(edit, 'type,object,evidence') || !shape(edit.object) || !input.includes(edit.object.label) || reservedLabel(edit.object.label) || scene.objects.length >= MAX_OBJECTS || scene.nextId > 600) return null;
        scene.objects.push({ id: `obj_${scene.nextId++}`, ...copy(edit.object), source: { createdBy: input, lastChangedBy: input } });
      } else {
        // References are resolved against the pre-turn scene, so generated IDs
        // cannot point to other operations that the player has never seen.
        if (!targetAllowed(edit.target, input, ctx)) return null;
        const at = scene.objects.findIndex(item => item.id === edit.target);
        if (edit.type !== 'annotate' && at < 0) return null;
        if (edit.type === 'update') {
          if (!keys(edit, 'type,target,changes,evidence') || !object(edit.changes) || !Object.keys(edit.changes).length || !Object.keys(edit.changes).every(key => ['label', 'glyphs', 'x', 'y', 'scale'].includes(key))) return null;
          const current = scene.objects[at], next = { label: current.label, glyphs: current.glyphs, x: current.x, y: current.y, scale: current.scale, ...edit.changes };
          if (/意义|含义|意思|代表|意味着|解释|解读|理解|看法/u.test(input) && !/位置|坐标|移到|挪到|搬到|外形|图案|字符|大小|放大|缩小/u.test(input)) return null;
          if (!shape(next) || (own(edit.changes, 'label') && (!input.includes(edit.changes.label) || reservedLabel(edit.changes.label)))) return null;
          scene.objects[at] = { id: current.id, ...next, source: { createdBy: current.source.createdBy, lastChangedBy: input } };
        } else if (edit.type === 'remove') {
          if (!keys(edit, 'type,target,evidence')) return null;
          scene.objects.splice(at, 1); delete scene.annotations[edit.target];
        } else {
          if (!keys(edit, 'type,target,field,value,evidence') || !['meaning', 'interpretation'].includes(edit.field) || !(edit.value === null || string(edit.value, MAX_ANNOTATION)) || (at < 0 && edit.target !== 'first_rain') ||
            (edit.field === 'meaning' && edit.value !== null && !input.includes(edit.value))) return null;
          if (!own(scene.annotations, edit.target)) scene.annotations[edit.target] = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
          scene.annotations[edit.target][edit.field] = edit.value;
          scene.annotations[edit.target].sources[edit.field] = input;
        }
      }
      normalized.push(copy(edit));
    }
    return normalized;
  }
  function applyEdits(scene, edits, input, options = {}) {
    const ctx = context(scene, options), valid = ctx && validateEdits(edits, ctx, input);
    if (!valid) return null;
    const next = copy(scene), targets = new Set();
    for (const edit of valid) {
      targets.add(edit.type === 'create' ? `obj_${next.nextId}` : edit.target);
      if (edit.type === 'create') next.objects.push({ id: `obj_${next.nextId++}`, ...copy(edit.object), source: { createdBy: input, lastChangedBy: input } });
      if (edit.type === 'update') {
        const item = next.objects.find(item => item.id === edit.target);
        Object.assign(item, copy(edit.changes)); item.source.lastChangedBy = input;
      }
      if (edit.type === 'remove') { next.objects = next.objects.filter(item => item.id !== edit.target); delete next.annotations[edit.target]; }
      if (edit.type === 'annotate') {
        if (!own(next.annotations, edit.target)) next.annotations[edit.target] = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
        next.annotations[edit.target][edit.field] = edit.value;
        next.annotations[edit.target].sources[edit.field] = input;
      }
    }
    if (valid.length) next.focusedTarget = targets.size === 1 && next.objects.some(item => targets.has(item.id)) ? [...targets][0] : null;
    return next;
  }
  // Online turns have already been interpreted as one coherent plan. Here the
  // model chooses meaning and references; this boundary owns only typed data,
  // existing targets, local IDs, source attribution and geometric limits.
  // Keep validateEdits/applyEdits above unchanged for offline and v3 replay.
  function footprint(item) {
    const rows = item.glyphs.split('\n');
    return { x: item.x, y: item.y, width: Math.max(...rows.map(row => row.length)) * item.scale, height: rows.length * item.scale };
  }
  function placedObject(item, placement, scene, refs, current) {
    if (!shape({ ...item, x: 0, y: 0 }) || !object(placement) || typeof placement.anchor !== 'string') return null;
    const { width, height } = footprint(item), anchor = placement.anchor;
    const center = (start, size, length) => Math.round(start + (size - length) / 2);
    const clamp = (value, limit) => Math.max(0, Math.min(value, limit));
    let x, y;
    if (['sky', 'ground', 'keep_center', 'keep_base'].includes(anchor)) {
      if (!keys(placement, 'anchor')) return null;
      if (anchor === 'sky') {
        const sky = SCENE_LAYOUT.sky;
        if (width > sky.width || height > sky.height) return null;
        x = center(sky.x, sky.width, width); y = center(sky.y, sky.height, height);
      } else if (anchor === 'ground') {
        x = clamp(Math.round(SCENE_LAYOUT.ground.centerX - width / 2), COLS - width); y = SCENE_LAYOUT.ground.baseline - height;
      } else {
        if (!current) return null;
        const previous = footprint(current);
        // Keep one integer anchor stable across odd/even resize round trips.
        x = previous.x + Math.floor(previous.width / 2) - Math.floor(width / 2);
        y = anchor === 'keep_base' ? previous.y + previous.height - height : previous.y + Math.floor(previous.height / 2) - Math.floor(height / 2);
      }
    } else {
      const fixed = { window_left: 'left_of', window_right: 'right_of', window_below: 'below' };
      let side = own(fixed, anchor) ? fixed[anchor] : null, target, gap = 2;
      if (side) {
        if (!keys(placement, 'anchor')) return null;
        target = SCENE_LAYOUT.window;
      } else {
        if (!['above', 'below', 'left_of', 'right_of'].includes(anchor) || !(keys(placement, 'anchor,target') || keys(placement, 'anchor,target,gap')) || typeof placement.target !== 'string') return null;
        if (own(placement, 'gap')) gap = placement.gap;
        if (!Number.isInteger(gap) || gap < 0 || gap > 10) return null;
        side = anchor;
        const targetId = refs.get(placement.target) || placement.target;
        if (current && targetId === current.id) return null;
        const found = scene.objects.find(object => object.id === targetId);
        target = placement.target === 'window' ? SCENE_LAYOUT.window : found && footprint(found);
        if (!target) return null;
      }
      x = center(target.x, target.width, width); y = center(target.y, target.height, height);
      if (side === 'left_of' || side === 'right_of') {
        x = side === 'left_of' ? target.x - gap - width : target.x + target.width + gap;
        y = clamp(y, ROWS - height);
      } else {
        y = side === 'above' ? target.y - gap - height : target.y + target.height + gap;
        x = clamp(x, COLS - width);
      }
    }
    const next = { ...item, x, y };
    return shape(next) ? next : null;
  }
  function semanticResult(edits, ctx, input) {
    const scene = contextScene(ctx);
    if (!scene || !sourceText(input, 80) || !Array.isArray(edits) || edits.length > MAX_EDITS) return null;
    const refs = new Map(), targets = new Set(), normalized = [];
    for (const original of edits) {
      let edit = original;
      if (!object(edit) || !TYPES.includes(edit.type)) return null;
      if (edit.type === 'create') {
        if (own(edit, 'placement')) {
          if (!(keys(edit, 'type,object,placement') || keys(edit, 'type,ref,object,placement')) || !keys(edit.object, 'label,glyphs,scale')) return null;
          const placed = placedObject(edit.object, edit.placement, scene, refs);
          if (!placed) return null;
          edit = { ...edit, object: placed }; delete edit.placement;
        }
        if (!(keys(edit, 'type,object') || keys(edit, 'type,ref,object')) || !shape(edit.object) || scene.objects.length >= MAX_OBJECTS || scene.nextId > 600) return null;
        if (own(edit, 'ref') && (!/^new_[123]$/u.test(edit.ref) || refs.has(edit.ref))) return null;
        const target = `obj_${scene.nextId++}`;
        if (own(edit, 'ref')) refs.set(edit.ref, target);
        scene.objects.push({ id: target, ...copy(edit.object), source: { createdBy: input, lastChangedBy: input } });
        targets.add(target);
      } else {
        if (typeof edit.target !== 'string') return null;
        const target = refs.get(edit.target) || edit.target;
        const at = scene.objects.findIndex(item => item.id === target);
        if (at < 0 && !(edit.type === 'annotate' && target === 'first_rain' && ctx.firstRainAvailable)) return null;
        if (edit.type === 'update') {
          if (own(edit, 'placement')) {
            if (!keys(edit, 'type,target,changes,placement') || !object(edit.changes) || !Object.keys(edit.changes).every(key => ['label', 'glyphs', 'scale'].includes(key))) return null;
            const current = scene.objects[at];
            const placed = placedObject({ label: current.label, glyphs: current.glyphs, x: current.x, y: current.y, scale: current.scale, ...edit.changes }, edit.placement, scene, refs, current);
            if (!placed) return null;
            edit = { ...edit, changes: { ...edit.changes, x: placed.x, y: placed.y } }; delete edit.placement;
          }
          if (!keys(edit, 'type,target,changes') || !object(edit.changes) || !Object.keys(edit.changes).length || !Object.keys(edit.changes).every(key => ['label', 'glyphs', 'x', 'y', 'scale'].includes(key))) return null;
          const current = scene.objects[at], next = { label: current.label, glyphs: current.glyphs, x: current.x, y: current.y, scale: current.scale, ...edit.changes };
          if (!shape(next)) return null;
          scene.objects[at] = { id: target, ...copy(next), source: { createdBy: current.source.createdBy, lastChangedBy: input } };
        } else if (edit.type === 'remove') {
          if (!keys(edit, 'type,target')) return null;
          scene.objects.splice(at, 1); delete scene.annotations[target];
        } else {
          if (!keys(edit, 'type,target,field,value') || !['meaning', 'interpretation'].includes(edit.field) || !(edit.value === null || string(edit.value, MAX_ANNOTATION))) return null;
          if (!own(scene.annotations, target)) scene.annotations[target] = { meaning: null, interpretation: null, sources: { meaning: null, interpretation: null } };
          scene.annotations[target][edit.field] = edit.value;
          scene.annotations[target].sources[edit.field] = input;
        }
        targets.add(target);
      }
      normalized.push(copy(edit));
    }
    if (edits.length) scene.focusedTarget = targets.size === 1 && scene.objects.some(item => targets.has(item.id)) ? [...targets][0] : null;
    return validScene(scene) ? { edits: normalized, scene } : null;
  }
  function validateSemanticEdits(edits, ctx, input) { return semanticResult(edits, ctx, input)?.edits || null; }
  function applySemanticEdits(scene, edits, input, options = {}) { return semanticResult(edits, context(scene, options), input)?.scene || null; }
  function focusAfter(scene, input) {
    if (!validScene(scene)) return null;
    const next = copy(scene), text = typeof input === 'string' ? input : '';
    const refs = referenceIds(text, context(scene));
    next.focusedTarget = refs.length === 1 ? refs[0] : null;
    return next;
  }
  function isSceneRequest(text, ctx) {
    if (typeof text !== 'string' || !object(ctx)) return false;
    const refs = referenceIds(text, ctx), namedObject = refs.length || /物件|物体|图案|字符|图形|长椅|椅子|桌子|灯笼|纸鹤|小船|风铃/u.test(text);
    const field = /意义|含义|象征|代表|意味着|解释|解读|理解|看法|忘掉|忘记|清空|你.{0,12}(?:觉得|认为|感觉|看待)/u.test(text);
    const edit = /移|挪|搬|改|换|放大|缩小|大一点|小一点|宽一点|窄一点|高一点|矮一点|长一点|短一点|靠窗|离窗户近|坐标|删|清|拿走|收起|撤掉|去掉|不要.+了|\b(?:move|change|replace|resize|scale|remove|delete)\b/iu.test(text);
    const recall = /(?:还)?记得.{0,40}(?:吗|么|[？?])|回忆|还在|在哪|哪里|什么样|看看|代表什么|意味着什么|(?:意义|含义|意思).{0,5}什么/u.test(text);
    // Mentioning a bench in a rain metaphor does not make it an object edit.
    // Unambiguous original story requests keep their original subject.
    if (/^(?:请)?(?:把|给)(?:这场|第一场|这里的)?雨(?:改名|取名|命名|叫)/u.test(text)) return false;
    if (/^(?:晚安|再见|拜拜|下次见|我先走了|我先走|今天先到这里|今晚先到这里|先聊到这里|goodbye|good night|bye)[。！!～~]*$/iu.test(text)) return false;
    if (namedObject && (edit || field || recall)) return true;
    if (ctx.objects.length && /它|这个|那个/u.test(text) && (edit || field || recall)) return true;
    if (field && /第一场雨|这场雨|那场雨|first_rain/u.test(text)) return true;
    const create = /(?:画|绘|建|添|添加|做|造|摆|放)(?:出|上|个|一|在)|想要一|想有一|\b(?:draw|create|add|make|build|place)\b/iu.test(text);
    if (create && !/^(?:请)?(?:试着)?画出(?:这场|第一场)?雨[。！!]*$/u.test(text)) {
      if (/雨|\b(?:rain|weather)\b/iu.test(text) && !/一[个张把盏只座盆幅块件]|物件|物体|图案|字符|图形/u.test(text)) return false;
      return true;
    }
    return /(?:忘掉|忘记|删除|清空|删掉)(?:它|这个|那个|全部|所有|记忆)/u.test(text);
  }
  function offline(ctx, text) {
    const none = { handled: false, edits: [], reply: [] };
    if (!contextScene(ctx) || !isSceneRequest(text, ctx)) return none;
    const failure = message => ({ handled: true, edits: [], reply: [message, '离线模式只理解简单物件指令；未确定的部分会保持原样。'] });
    if (!currentRequest(text)) return failure('这句像是在回忆、假设或引用，画面和当前注解没有修改。');
    const refs = referenceIds(text, ctx), rainRef = ctx.firstRainAvailable && /第一场雨|这场雨|那场雨|first_rain/u.test(text), target = refs.length === 1 ? refs[0] : rainRef && !refs.length ? 'first_rain' : null;
    const item = ctx.objects.find(item => item.id === target);
    const success = (edit, reply) => validateEdits([edit], ctx, text) ? { handled: true, edits: [edit], reply } : failure('这次的对象、范围或字符尺寸还不明确，没有修改。');
    const evidence = text;
    if (/忘掉|忘记|清空|删除|删掉/u.test(text) && !/意义|含义|意思|解释|理解|解读|看法|印象|感受/u.test(text) && !operationAllowed('remove', text)) return failure('你想移走哪一个物件，还是清掉它的当前意义或我的解释？原始对话仍会保留。');
    if (target === 'first_rain' && /记得|回忆|代表什么|意味着什么|(?:意义|含义|意思).{0,5}什么/u.test(text) && !/改成|改为|修改|更新|设为|记成|记为/u.test(text)) {
      const annotation = ctx.annotations.first_rain;
      return { handled: true, edits: [], reply: [`第一场雨的原始描述：${ctx.firstRainSource.description || '旧记录里没有可确认的原话'}。`, `你赋予它的当前意义：${annotation?.meaning || '尚未设定'}。我的当前解释：${annotation?.interpretation || '尚未设定'}。`] };
    }
    if (item && /记得|回忆|代表什么|意味着什么|(?:意义|含义|意思).{0,5}什么/u.test(text) && !/改成|改为|修改|更新|设为|记成|记为/u.test(text)) {
      const annotation = ctx.annotations[target];
      return { handled: true, edits: [], reply: [`“${item.label}”还在，位置是 (${item.x},${item.y})，大小 ${item.scale} 倍。你当时说：“${item.source.createdBy}”`, `你赋予它的当前意义：${annotation?.meaning || '尚未设定'}。我的当前解释：${annotation?.interpretation || '尚未设定'}。`] };
    }
    if (operationAllowed('annotate', text) && target) {
      const field = /(?:不要再|别再|不再).{0,20}(?:理解为|解读为)|你的(?:解释|理解|解读|看法|印象|感受)|你.{0,12}(?:理解|解读|看待|觉得|认为|感觉|解释)/u.test(text) ? 'interpretation' : 'meaning';
      let value = null;
      const match = text.match(/(?:意味着|象征(?:着)?|代表(?:着)?|意义(?:是|改为|改成)|含义(?:是|改为|改成)|理解为|解释为|解读为|改成|改为)[：:\s]*(.+?)[。！!]*$/u);
      if (match && !/^(?:什么|什么呢|什么吗|什么？|什么\?)$/u.test(match[1])) value = match[1].replace(/^[“「『"‘]|[”」』"’]$/gu, '').trim();
      if (/清|删|忘掉|忘记|不要再|不再|别再|去掉|取消|撤回/u.test(text) && !/改成|改为|而是|现在代表/u.test(text)) value = null;
      if (value === null && !operationAllowed('annotate', text, { field, value })) return failure('可以直接告诉我它代表什么，或说清要修改哪一份解释。');
      return success({ type: 'annotate', target, field, value, evidence }, [value === null ? `已清掉${field === 'meaning' ? '你赋予它的当前意义' : '我目前的解释'}。` : `${field === 'meaning' ? '你赋予它的当前意义' : '我目前的解释'}记成了“${value}”。`, '发生过的事和原始对话仍保留，这份注解以后可以再改。']);
    }
    if (operationAllowed('remove', text) && item) return success({ type: 'remove', target, evidence }, [`我把“${item.label}”从当前画面移走了。`, '它的创建记录还在原始对话里。']);
    if (operationAllowed('update', text) && item) {
      const changes = {}, coordinates = text.match(/(?:坐标|位置)?\s*[（(]\s*(\d{1,3})\s*[,，]\s*(\d{1,2})\s*[）)]/u);
      if (coordinates) { changes.x = Number(coordinates[1]); changes.y = Number(coordinates[2]); }
      else if (/窗边|窗旁|窗户旁|靠窗|离窗户近/u.test(text)) { changes.x = Math.max(0, Math.round(36 - Math.max(...item.glyphs.split('\n').map(row => row.length)) * item.scale / 2)); changes.y = Math.min(43, ROWS - item.glyphs.split('\n').length * item.scale); }
      else if (/左(?:边|侧|一点)/u.test(text)) changes.x = Math.max(0, item.x - 8);
      else if (/右(?:边|侧|一点)/u.test(text)) changes.x = Math.min(COLS - Math.max(...item.glyphs.split('\n').map(row => row.length)) * item.scale, item.x + 8);
      if (/放大|大一点/u.test(text)) changes.scale = Math.min(3, item.scale + 1);
      if (/缩小|小一点/u.test(text)) changes.scale = Math.max(1, item.scale - 1);
      const scale = text.match(/(?:缩放|倍率|大小|scale)[：:=\s]*(?:改(?:成|为))?\s*([123])/iu); if (scale) changes.scale = Number(scale[1]);
      const glyphs = text.match(/(?:字符|图案|外形)(?:改(?:成|为)|换成|设为|是)[：:\s]*[“「"]([^”」"]+)[”」"]/u);
      if (glyphs) changes.glyphs = glyphs[1].replace(/\\n/gu, '\n');
      const label = text.match(/(?:名称|名字|标签)(?:改(?:成|为)|换成|是)[：:\s]*[“「"]?([^”」"。！!]+)[”」"]?[。！!]*$/u); if (label) changes.label = label[1].trim();
      if (!Object.keys(changes).length) return failure('我认得这个物件，但还不确定具体怎么改。可以说“移到窗边”“放大一点”或“移到 (20,40)”。');
      return success({ type: 'update', target, changes, evidence }, [`“${item.label}”的当前样子改好了。`, '它的原始来历和已有的意义注解仍然分开保留。']);
    }
    if (operationAllowed('create', text) && !refs.length) {
      let label = text.replace(/[。！!]+$/u, '').replace(/^(?:请|帮我|给我|你可以|能不能|可不可以|我想要|我想有|我想看|我想|想要|想有|想看|在这里|在那边|在这边|在那里|在窗边|窗边|这里|那边|这边|那里|现在|那就)+/u, '').replace(/^(?:画|绘制|创建|建造|添加|加上|做|造|摆|放)(?:出|上)?/u, '').replace(/^一[个张把盏只座盆幅块件]/u, '').replace(/^(?:能坐(?:下)?(?:两|二|2)个?人|供(?:两|二|2)个?人坐)的/u, '').replace(/(?:[，,].*|(?:放在|放到|摆在|摆到).*|吧|好吗|好么|可以吗|行吗)$/u, '').trim();
      const position = /窗边|窗旁|靠窗/u.test(text) ? { x: 30, y: 43 } : { x: 35, y: 42 };
      if (!string(label, MAX_LABEL) || !text.includes(label) || /雨$|^天气|^(?:它|这个|那个)$/u.test(label)) return failure('离线模式需要一个清楚的物件名，例如“画一张长椅”。');
      const width = /两|双|2/u.test(text) ? 16 : 10, glyphs = '+' + '-'.repeat(width) + '+\n|' + ' '.repeat(width) + '|\n+' + '-'.repeat(width) + '+\n |' + ' '.repeat(width - 2) + '|';
      if (/窗边|窗旁|靠窗/u.test(text)) position.x = Math.round(36 - (width + 2) / 2);
      return success({ type: 'create', object: { label, glyphs, ...position, scale: 1 }, evidence }, [`我用一个简单字符轮廓画出了“${label}”。`, '离线只能生成简化轮廓。位置、大小、字符图案和意义都可以继续修改。']);
    }
    if (item && /记得|还在|在哪|哪里|什么样|代表什么|意义|含义|看看|回忆/u.test(text)) {
      const annotation = ctx.annotations[target];
      return { handled: true, edits: [], reply: [`“${item.label}”还在，位置是 (${item.x},${item.y})，大小 ${item.scale} 倍。你当时说：“${item.source.createdBy}”`, `你赋予它的当前意义：${annotation?.meaning || '尚未设定'}。我的当前解释：${annotation?.interpretation || '尚未设定'}。`] };
    }
    if (!target && (refs.length > 1 || /它|这个|那个|忘掉|忘记|清空|所有|全部/u.test(text))) return failure('请说清是哪一个物件，以及要移走它、修改它的意义，还是清掉我的解释。原始对话仍会保留。');
    return failure('我还不能确定这句话要怎样改变物件，可以说出物件名称和具体变化。');
  }
  return Object.freeze({ empty, layout, context, validateEdits, applyEdits, validateSemanticEdits, applySemanticEdits, offline, isSceneRequest, allowedEdits, referenceIds, focusAfter, validScene, COLS, ROWS, MAX_OBJECTS, MAX_EDITS });
});
