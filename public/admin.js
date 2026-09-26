const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LANES = [
  {
    id: 'attention',
    title: '待处理',
    hint: '未开通就被 @，或机器人已经退群',
    empty: '没有需要处理的群',
    drop: null,
  },
  {
    id: 'idle',
    title: '待命',
    hint: '在群里，开关都还没开',
    empty: '没有待命的群',
    drop: { enabled: false, morning: false },
  },
  {
    id: 'reply',
    title: '问答',
    hint: '群里 @ 才回答',
    empty: '还没有开通问答的群',
    drop: { enabled: true, morning: false },
  },
  {
    id: 'morning',
    title: '早报',
    hint: '时间在设置里改，和开通互相独立',
    empty: '还没有群开早报',
    drop: { morning: true },
  },
];

const VIEWS = {
  home: { title: '首页', sub: '群里的 AI 资讯简报员' },
  board: { title: '群看板', sub: '按开通和早报分列' },
  activity: { title: '动态', sub: '最近问答和今日调用次数' },
  guide: { title: '教程', sub: '从接飞书到群里能问，含权限' },
  settings: { title: '设置', sub: '飞书应用、Grok 订阅、模型、早报时间和私聊' },
};

const INTENT_LABEL = {
  latest: '今日',
  hot: '热点',
  daily: '日报',
  aa: 'AA榜',
  'aa-item': 'AA榜',
  codex: 'Tibo重置',
  'codex-item': 'Tibo重置',
  'codex-push': 'Tibo重置',
  search: '搜索',
  help: '帮助',
  'off-topic': '题外',
  error: '失败',
};

const MODELS = [
  { value: 'grok-4-fast', hint: '快，省周额度' },
  { value: 'grok-4-1-fast', hint: '快，稍新一代' },
  { value: 'grok-4.6', hint: '更强，更耗额度' },
];

const MORNING_SLOTS = (() => {
  const out = [];
  for (let t = 6 * 60; t <= 12 * 60; t += 15) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
})();

const state = {
  view: 'home',
  status: null,
  chats: [],
  chatsError: '',
  query: '',
  filter: 'all',
  selectedId: null,
  saving: new Set(),
  pollTimer: null,
  toastTimer: null,
  pickerOpen: false,
  feishuDirty: false,
  feishuSaving: false,
};

const DEMO =
  ['127.0.0.1', 'localhost'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('demo');

function brand() {
  const boot = window.__BRAND__ || {};
  const live = state.status?.brand || {};
  return {
    name: live.name || boot.name || 'AI 资讯',
    nameEn: live.nameEn || boot.nameEn || 'Newsbot',
    short: live.short || boot.short || '群里的 AI 资讯简报员',
  };
}

function applyBrand() {
  const b = brand();
  for (const el of $$('[data-brand="name"]')) el.textContent = b.name;
  for (const el of $$('[data-brand="nameEn"]')) el.textContent = b.nameEn;
  for (const el of $$('[data-brand="short"]')) el.textContent = b.short;
  document.title = state.view === 'home' ? b.name : `${b.name} · ${VIEWS[state.view].title}`;
  if (state.view === 'home') {
    const sub = $('#page-sub');
    if (sub) sub.textContent = b.short;
  }
}

function demoTurns() {
  const now = Date.now();
  return [
    { at: now - 8 * 60_000, chatId: 'oc_demo_reply1', chatName: '产品群', openId: 'ou_demo_1', userName: '林夏', text: '你用的什么模型？', intent: 'search', usedGrok: 1 },
    { at: now - 22 * 60_000, chatId: 'oc_demo_reply1', chatName: '产品群', openId: 'ou_demo_1', userName: '林夏', text: '你的数据来源是什么', intent: 'search', usedGrok: 1 },
    { at: now - 24 * 60_000, chatId: 'oc_demo_reply2', chatName: '产品情报', openId: 'ou_demo_2', userName: '周衡', text: '今日AI热点', intent: 'hot', usedGrok: 1 },
    { at: now - 36 * 60_000, chatId: 'oc_demo_reply1', chatName: '产品群', openId: 'ou_demo_1', userName: '林夏', text: '今日热点', intent: 'hot', usedGrok: 1 },
  ];
}

function demoUsage() {
  return [
    { chatId: 'oc_demo_reply1', chatName: '产品群', count: 5 },
    { chatId: 'oc_demo_reply2', chatName: '产品情报', count: 2 },
  ];
}

function demoChats() {
  return [
    { chatId: 'oc_demo_pending', name: '设计周会', pending: true },
    { chatId: 'oc_demo_missing', name: '已解散的项目群', enabled: true, missing: true },
    { chatId: 'oc_demo_idle1', name: '公司全员群' },
    { chatId: 'oc_demo_idle2', name: 'AI 阅读俱乐部', external: true },
    { chatId: 'oc_demo_reply1', name: '产品群', enabled: true },
    { chatId: 'oc_demo_reply2', name: '产品情报', enabled: true },
    { chatId: 'oc_demo_m1', name: '早报测试群', enabled: true, morning: true },
    { chatId: 'oc_demo_m2', name: '资讯订阅', morning: true },
  ].map((c) => ({
    enabled: false,
    morning: false,
    pending: false,
    missing: false,
    external: false,
    ...c,
  }));
}

async function api(path, opts = {}) {
  const { headers, signal, ...rest } = opts;
  const res = await fetch(path, {
    ...rest,
    headers: { 'content-type': 'application/json', ...headers },
    signal: signal || AbortSignal.timeout(25_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || res.statusText);
  return body;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(v) {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function relTime(v) {
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(sec), 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}

function dayKey(v) {
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function initial(name) {
  const s = String(name || '').trim();
  return s ? s.slice(0, 1) : '群';
}

function toast(msg) {
  const el = $('#toast');
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function canDrag() {
  return window.matchMedia('(pointer: fine)').matches && window.matchMedia('(min-width: 721px)').matches;
}

function laneOf(c) {
  if (c.pending || c.missing) return 'attention';
  if (c.morning) return 'morning';
  if (c.enabled) return 'reply';
  return 'idle';
}

function laneTitle(id) {
  return LANES.find((l) => l.id === id)?.title || id;
}

function denialOf(chatId) {
  return (state.status?.denials || []).find((d) => d.kind === 'chat' && d.id === chatId);
}

function morningSentToday(chatId) {
  const sent = state.status?.settings?.morningSent || {};
  const day = state.status?.quota?.day;
  return Boolean(day && sent[chatId] === day);
}

function morningDueToday(chatId) {
  const armed = Number(state.status?.settings?.morningArmed?.[chatId]);
  if (!Number.isFinite(armed)) return true;
  const day = state.status?.quota?.day;
  const clock = morningDefault();
  if (!day) return true;
  const sendAt = Date.parse(`${day}T${clock}:00+08:00`);
  if (!Number.isFinite(sendAt)) return true;
  return armed <= sendAt;
}

function morningDefault() {
  return state.status?.settings?.morningDefaultTime || '09:00';
}

function shanghaiHmNow() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(/^24:/, '00:');
}

function timeSlotList(extra) {
  const slots = new Set(MORNING_SLOTS);
  if (extra) slots.add(extra);
  return [...slots].sort();
}

function chatById(id) {
  return state.chats.find((c) => c.chatId === id);
}

function chatName(id, stored, chatType) {
  if (stored) return stored;
  if (chatType === 'p2p') return '私聊';
  if (!id) return '私聊';
  if (id === 'cli') return '命令行';
  if (id === 'morning') return '早报';
  if (id === 'codex') return 'Tibo重置';
  const c = chatById(id);
  if (c?.name) return c.name;
  if (id.length > 14) return `群 ${id.slice(0, 6)}…${id.slice(-4)}`;
  return id;
}

function userLabel(t) {
  if (t?.userName) return t.userName;
  if (t?.openId === 'morning') return '早报';
  if (t?.openId === 'codex') return 'Tibo重置';
  if (t?.openId === 'cli') return '命令行';
  if (t?.chatType === 'p2p') return '私聊用户';
  return '群成员';
}

function modelMeta(value) {
  return MODELS.find((m) => m.value === value) || { value, hint: '当前选用' };
}

function visibleChats() {
  const q = state.query.trim().toLowerCase();
  return state.chats.filter((c) => {
    if (state.filter === 'attention' && laneOf(c) !== 'attention') return false;
    if (state.filter === 'external' && !c.external) return false;
    if (!q) return true;
    return `${c.name} ${c.chatId}`.toLowerCase().includes(q);
  });
}

function hashView() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  if (VIEWS[raw]) return raw;
  const q = new URLSearchParams(location.search).get('view');
  return VIEWS[q] ? q : 'home';
}

function setView(view, push = true) {
  state.view = VIEWS[view] ? view : 'home';
  if (push && hashView() !== state.view) location.hash = `#/${state.view}`;
  document.documentElement.dataset.page = state.view;
  $$('[data-view]').forEach((el) => {
    el.hidden = el.dataset.view !== state.view;
  });
  $$('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === state.view);
    if (el.dataset.nav === state.view) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const meta = VIEWS[state.view];
  $('#page-title').textContent = meta.title;
  $('#page-sub').textContent =
    state.view === 'board'
      ? canDrag()
        ? '点开关，或把卡片拖到对应列'
        : '左右滑动看其他列，点卡片上的开通 / 早报'
      : state.view === 'home'
        ? brand().short
        : meta.sub;
  applyBrand();
  renderBanner();
  if (state.view === 'guide') $('#view-guide').scrollTop = 0;
  if (state.view === 'home') renderHome();
  if (state.view === 'board') renderBoard();
  if (state.view === 'activity') renderActivity();
  if (state.view === 'settings') renderSettings();
}

function pill(el, ok, text) {
  el.className = `pill ${ok ? 'ok' : 'bad'}`;
  el.textContent = text;
}

function quotaLabel(q) {
  if (!q?.userCap && !q?.globalCap) return '不限制';
  const parts = [];
  if (q.userCap) parts.push(`每人 ${q.userCap}`);
  if (q.globalCap) parts.push(`全群 ${q.globalCap}`);
  return parts.join(' / ');
}

function ticketMeta(c) {
  if (c.pending) {
    const d = denialOf(c.chatId);
    if (d?.count) return `有人 @ 了 ${d.count} 次${d.lastAt ? ' · ' + relTime(d.lastAt) : ''}`;
    return '有人 @ 过，尚未开通';
  }
  if (c.missing) return '机器人已经不在这个群';
  if (c.morning && morningSentToday(c.chatId)) return `今日 ${morningDefault()} 已发`;
  if (c.morning && !morningDueToday(c.chatId)) return `明日 ${morningDefault()} 再发`;
  if (c.morning) return `今日 ${morningDefault()} 待发`;
  if (c.enabled) return '问答已开';
  return '在群里待命';
}

function ticketTags(c) {
  const tags = [];
  if (c.external) tags.push(['外部', '']);
  if (c.missing) tags.push(['不在群里', 'bad']);
  if (c.pending) tags.push(['待开通', 'warn']);
  if (!c.missing && !c.pending) {
    if (c.enabled && c.morning) tags.push(['问答+早报', 'ok']);
    else if (c.enabled) tags.push(['问答', 'ok']);
    else if (c.morning) tags.push(['仅早报', 'warn']);
  }
  return tags;
}

function renderTicket(c) {
  const tags = ticketTags(c)
    .map(([t, k]) => `<span class="tag ${k}">${escapeHtml(t)}</span>`)
    .join('');
  const saving = state.saving.has(c.chatId);
  const selected = state.selectedId === c.chatId;
  const drag = canDrag() && !c.missing;
  return `<article class="ticket${saving ? ' saving' : ''}${selected ? ' selected' : ''}"
      data-id="${escapeHtml(c.chatId)}" ${drag ? 'draggable="true"' : ''}>
      <div class="avatar" style="background:hsl(${hue(c.chatId)} 32% 28%)">${escapeHtml(initial(c.name))}</div>
      <div>
        <p class="ticket-name">${escapeHtml(c.name)}</p>
        <p class="ticket-meta">${escapeHtml(ticketMeta(c))}</p>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
      <div class="sws">
        <button type="button" class="sw${c.enabled ? ' on' : ''}" data-kind="chat" data-id="${escapeHtml(c.chatId)}" aria-pressed="${c.enabled}">开通</button>
        <button type="button" class="sw${c.morning ? ' on' : ''}" data-kind="morning" data-id="${escapeHtml(c.chatId)}" aria-pressed="${c.morning}">早报</button>
      </div>
    </article>`;
}

function renderBoard() {
  const err = $('#chats-error');
  if (state.chatsError) {
    err.hidden = false;
    err.textContent = state.chatsError;
  } else {
    err.hidden = true;
    err.textContent = '';
  }
  const vis = visibleChats();
  const board = $('#board');
  if (!state.chats.length) {
    board.innerHTML = `<div class="board-empty">
      <h2>看板还是空的</h2>
      <p>在飞书里把 ${escapeHtml(brand().name)} 拉进群，再点刷新。每个群可以单独开「开通」和「早报」。</p>
    </div>`;
    return;
  }
  const filtering = Boolean(state.query.trim() || state.filter !== 'all');
  const lanes = LANES.filter((lane) => {
    if (state.filter === 'attention') return lane.id === 'attention';
    if (filtering) return vis.some((c) => laneOf(c) === lane.id);
    return true;
  });
  if (!lanes.length) {
    board.innerHTML = `<div class="board-empty"><h2>没有匹配的群</h2><p>换个关键词，或清掉筛选。</p></div>`;
    return;
  }
  board.innerHTML = lanes
    .map((lane) => {
      const items = vis.filter((c) => laneOf(c) === lane.id);
      const body = items.length
        ? items.map(renderTicket).join('')
        : `<p class="lane-empty">${escapeHtml(lane.empty)}</p>`;
      return `<section class="lane" data-lane="${lane.id}">
        <div class="lane-head"><h2>${escapeHtml(lane.title)}</h2><span class="lane-count">${items.length}</span></div>
        <p class="lane-hint">${escapeHtml(lane.hint)}</p>
        <div class="lane-list">${body}</div>
      </section>`;
    })
    .join('');
}

function renderHealth() {
  const data = state.status;
  const box = $('#health');
  if (!data) {
    box.innerHTML = '';
    return;
  }
  const grokOk = data.xai.present && !data.xai.expired;
  const aihotDot = data.aihot?.lastError ? 'bad' : data.aihot?.lastOkAt ? 'ok' : '';
  const rows = [
    ['feishu', '飞书', data.feishu.connected ? 'ok' : 'bad'],
    ['grok', 'Grok', grokOk ? 'ok' : 'bad'],
    ['aihot', 'AIHOT', aihotDot],
  ];
  box.innerHTML = rows
    .map(
      ([id, k, tone]) =>
        `<button type="button" data-health="${id}"><span class="k">${k}</span><span class="dot ${tone}"></span></button>`,
    )
    .join('');
}

function renderBanner() {
  const data = state.status;
  const el = $('#banner');
  if (!data) {
    el.hidden = true;
    return;
  }
  const grokOk = data.xai.present && !data.xai.expired;
  if (state.view === 'settings' || state.view === 'home') {
    el.hidden = true;
    return;
  }
  if (!data.feishu.configured) {
    el.hidden = false;
    el.innerHTML = '还没配置飞书应用。<a href="#/settings">去设置里填应用 ID 和密钥</a>';
    return;
  }
  if (!data.feishu.connected && data.feishu.configured) {
    el.hidden = false;
    el.innerHTML = '飞书长连接还没挂上。<a href="#/settings">去飞书应用里重连</a>';
    return;
  }
  if (!grokOk) {
    el.hidden = false;
    el.innerHTML = 'Grok 还没登录，群里暂时写不出简报。<a href="#/settings">去登录</a>';
    return;
  }
  el.hidden = true;
}

function renderChrome() {
  applyBrand();
  const data = state.status;
  if (!data) return;
  const ready = data.feishu.connected && data.xai.present && !data.xai.expired;
  pill($('#ready-pill'), ready, ready ? '就绪' : '未就绪');
  const n = state.chats.filter((c) => laneOf(c) === 'attention').length;
  const badge = $('#nav-attention');
  if (n) {
    badge.hidden = false;
    badge.textContent = String(n);
  } else {
    badge.hidden = true;
  }
  renderHealth();
  renderBanner();
  renderHome();
  const note = $('#rail-note');
  if (note) note.textContent = `每日 ${morningDefault()} 早报 · 额度${quotaLabel(data.quota)}`;
  renderMorningDefault();
}

function morningRows() {
  const data = state.status;
  if (state.chats.length) return state.chats.filter((c) => c.morning);
  return (data?.settings?.morningAllowlist || []).map((id) => ({
    chatId: id,
    name: chatName(id, '', 'group'),
    morning: true,
  }));
}

function renderHome() {
  const root = $('#home-live');
  if (!root) return;
  const data = state.status;
  if (!data) {
    root.innerHTML = '<p class="home-live-wait">加载中</p>';
    return;
  }
  const listed = state.chats.length > 0;
  const replyN = listed
    ? state.chats.filter((c) => c.enabled && !c.missing).length
    : (data.settings?.chatAllowlist || []).length;
  const mornings = morningRows().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  const sentN = mornings.filter((c) => morningSentToday(c.chatId)).length;
  const t = morningDefault();
  const next = sentN < mornings.length ? t : '';
  const attentionN = state.chats.filter((c) => laneOf(c) === 'attention').length;
  const grokOk = data.xai.present && !data.xai.expired;
  const ready = Boolean(data.feishu.connected && grokOk);
  const hm = shanghaiHmNow();

  const stats = [
    { n: String(replyN), k: '问答群', href: '#/board' },
    { n: String(mornings.length), k: '早报群', href: '#/board' },
    {
      n: mornings.length ? `${sentN}/${mornings.length}` : '0',
      k: next && sentN < mornings.length ? `下一封 ${next}` : '今日已发',
      href: '#/board',
    },
    { n: String(data.quota?.global ?? 0), k: '今日调用', href: '#/activity' },
  ];

  const mornBody = mornings.length
    ? `<ul class="home-morn">${mornings
        .map((c) => {
          const sent = morningSentToday(c.chatId);
          let st = '未到点';
          let cls = '';
          if (sent) {
            st = '已发';
            cls = 'ok';
          } else if (!morningDueToday(c.chatId)) {
            st = '明日发';
            cls = '';
          } else if (t <= hm) {
            st = '待发';
            cls = 'warn';
          }
          return `<li>
            <div class="avatar" style="background:hsl(${hue(c.chatId)} 32% 28%)">${escapeHtml(initial(c.name))}</div>
            <div class="morn-copy">
              <p class="name">${escapeHtml(c.name || chatName(c.chatId, '', 'group'))}</p>
              <p class="morn-meta"><span class="tag ${cls}">${escapeHtml(st)}</span></p>
            </div>
          </li>`;
        })
        .join('')}</ul>`
    : '<p class="home-morn-empty">还没有群开早报。<a href="#/board">去看板打开</a>。</p>';

  const ctas = [];
  if (!ready) {
    const miss = [];
    if (!data.feishu.connected) miss.push('飞书');
    if (!grokOk) miss.push('Grok');
    ctas.push(`<a class="home-entry" href="#/settings">
      <span class="home-kicker">还没就绪</span>
      <h2>${escapeHtml(miss.join('、'))} 需要处理</h2>
      <p>群里暂时写不出简报。去设置里接好再回来。</p>
      <span class="home-entry-go">去设置</span>
    </a>`);
  }
  if (attentionN) {
    ctas.push(`<a class="home-entry" href="#/board">
      <span class="home-kicker">待处理</span>
      <h2>${attentionN} 个群需要看一眼</h2>
      <p>有人 @ 了但还没开通，或机器人已经不在群里。</p>
      <span class="home-entry-go">去看板</span>
    </a>`);
  }

  root.innerHTML = `<div class="home-stats">${stats
    .map(
      (s) =>
        `<a class="home-stat" href="${s.href}"><b>${escapeHtml(s.n)}</b><span>${escapeHtml(s.k)}</span></a>`,
    )
    .join('')}</div>
    <section class="home-panel">
      <div class="home-panel-head">
        <h2>今日早报</h2>
        <p>${escapeHtml(morningDefault())} · 上海时区</p>
      </div>
      ${mornBody}
    </section>
    ${ctas.length ? `<div class="home-ctas">${ctas.join('')}</div>` : ''}`;
}

function renderActivity() {
  const data = state.status;
  const turns = $('#turns');
  const usage = $('#usage');
  if (!data) {
    turns.innerHTML = '<li class="empty">加载中</li>';
    usage.innerHTML = '';
    return;
  }
  const rows = data.turns || [];
  if (!rows.length) {
    turns.innerHTML = '<li class="empty">还没有对话。开通一个群，在里面 @ 机器人即可。</li>';
  } else {
    let lastDay = '';
    turns.innerHTML = rows
      .map((t) => {
        const day = dayKey(t.at);
        const head =
          day !== lastDay
            ? `<li class="day-row"><div class="day-label">${escapeHtml(day)}</div></li>`
            : '';
        lastDay = day;
        const who = userLabel(t);
        const where = chatName(t.chatId, t.chatName, t.chatType);
        const intent = INTENT_LABEL[t.intent] || t.intent || '—';
        return `${head}<li class="turn">
          <div class="turn-avatar" style="background:hsl(${hue(t.openId || t.chatId)} 32% 28%)">${escapeHtml(initial(who))}</div>
          <div>
            <div class="turn-top">
              <b>${escapeHtml(who)}</b>
              <span class="chat-pill">${escapeHtml(where)}</span>
              <span class="when">${escapeHtml(fmtTime(t.at))} · ${t.usedGrok ? 'Grok' : '本地'}</span>
            </div>
            <div class="q"><span class="intent${t.intent === 'error' || t.error ? ' error' : ''}">${escapeHtml(intent)}</span>${escapeHtml(t.text || '')}</div>
            ${t.error ? `<div class="err">${escapeHtml(t.error)}</div>` : ''}
          </div>
        </li>`;
      })
      .join('');
  }
  const used = data.usage || [];
  const max = Math.max(1, ...used.map((u) => Number(u.count) || 0));
  $('#usage-hint').textContent = `今日 ${data.quota.global} 次 · 按群累计 · 额度 ${quotaLabel(data.quota)}`;
  usage.innerHTML = used.length
    ? used
        .map((u) => {
          const pct = Math.max(8, Math.round((Number(u.count) / max) * 100));
          const label = chatName(u.chatId, u.chatName, u.chatType);
          return `<li>
            <div class="avatar" style="background:hsl(${hue(u.chatId)} 32% 28%)">${escapeHtml(initial(label))}</div>
            <div class="k">${escapeHtml(label)}</div>
            <b>${u.count}</b>
            <div class="bar"><span style="width:${pct}%"></span></div>
          </li>`;
        })
        .join('')
    : '<li class="empty">今天还没有调用</li>';
}

function aihotLinkLabel(a) {
  if (!a) return '还没有拉过资料';
  if (a.lastOkAt && !a.lastError) return fmtTime(a.lastOkAt);
  if (a.lastError && a.lastOkAt) return `失败 · 上次成功 ${fmtTime(a.lastOkAt)}`;
  if (a.lastError) return `失败 · ${a.lastError}`;
  return '还没有拉过资料';
}

function renderLink() {
  const data = state.status;
  if (!data) return;
  const grok = data.xai.present && !data.xai.expired ? data.xai.email || '已登录' : '未登录';
  const appLabel = data.feishu.appId || '未配置';
  const rows = [
    ['飞书长连接', data.feishu.connected ? '已连接' : data.feishu.lastError || '未连接'],
    ['飞书应用', appLabel],
    ['Grok', grok],
    ['过期', fmtTime(data.xai.expiresAt)],
    ['AIHOT 最近拉取', aihotLinkLabel(data.aihot)],
    ['上次群消息', fmtTime(data.feishu.lastEventAt)],
    ['今日调用', String(data.quota.global)],
    ['额度', quotaLabel(data.quota)],
  ];
  $('#link-dl').innerHTML = rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');
}

function feishuConsoleHref(id) {
  const m = String(id || '').trim();
  if (!/^cli_[a-z0-9]{8,32}$/i.test(m)) return 'https://open.feishu.cn/app';
  return `https://open.feishu.cn/app/${m}`;
}

function feishuSourceLabel(source) {
  if (source === 'file') return '后台已保存';
  if (source === 'env') return '当前来自 .env，保存后改走后台';
  return '还没配置';
}

function updateFeishuChrome() {
  const f = state.status?.feishu || {};
  const idInput = $('#feishu-app-id');
  const typed = idInput ? idInput.value : f.appId;
  const href = feishuConsoleHref(typed || f.appId);
  const link = $('#feishu-console');
  if (link) {
    link.href = href;
    const id = href.match(/cli_[a-z0-9]+$/i);
    const split = window.matchMedia('(max-width: 720px)').matches;
    link.replaceChildren();
    if (split && id && href.startsWith('https://open.feishu.cn/app/')) {
      link.append('https://open.feishu.cn/app/', document.createElement('br'), id[0]);
    } else {
      link.append(href);
    }
  }
  const status = $('#feishu-status');
  if (status) {
    const conn = f.connected ? '长连接已挂上' : f.lastError ? `未连接 · ${f.lastError}` : '长连接未挂上';
    status.textContent = `${conn} · ${feishuSourceLabel(f.source)}`;
  }
  const clearBtn = $('#feishu-clear');
  if (clearBtn) clearBtn.hidden = f.source !== 'file';
  const secret = $('#feishu-app-secret');
  if (secret && document.activeElement !== secret) {
    secret.placeholder = f.secretSet ? '已保存，留空则不改' : '应用密钥 App Secret';
  }
}

function bindFeishuBox() {
  const box = $('#feishu-box');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  box.addEventListener('input', (e) => {
    if (!e.target.closest('#feishu-app-id, #feishu-app-secret')) return;
    state.feishuDirty = true;
    updateFeishuChrome();
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('#feishu-clear')) {
      e.preventDefault();
      clearFeishu();
    }
  });
}

function renderFeishu() {
  const data = state.status;
  const box = $('#feishu-box');
  if (!data || !box) return;
  const f = data.feishu || {};
  if (!box.dataset.ready) {
    box.innerHTML = `<p class="feishu-meta" id="feishu-status"></p>
      <form id="feishu-form" class="form-grid" autocomplete="off">
        <label class="field">应用 ID
          <input id="feishu-app-id" name="appId" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="cli_xxxxxxxx" />
        </label>
        <label class="field">应用密钥
          <input id="feishu-app-secret" name="appSecret" type="password" autocomplete="new-password" placeholder="应用密钥 App Secret" />
        </label>
        <div class="field field-wide">开放平台
          <a id="feishu-console" class="console-link" href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">https://open.feishu.cn/app</a>
        </div>
        <div class="form-actions">
          <button class="primary" id="feishu-save" type="submit">保存并连接</button>
          <button class="ghost" id="feishu-clear" type="button" hidden>清除后台凭据</button>
        </div>
      </form>
      <p class="feishu-note">点链接进飞书开放平台。换应用后，已开通的群不会自动跟着迁。</p>`;
    box.dataset.ready = '1';
    $('#feishu-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveFeishu();
    });
    bindFeishuBox();
  }
  const idInput = $('#feishu-app-id');
  const focused = document.activeElement === idInput || document.activeElement === $('#feishu-app-secret');
  if (idInput && !state.feishuDirty && !focused && !state.feishuSaving) {
    idInput.value = f.appId || '';
  }
  const saveBtn = $('#feishu-save');
  if (saveBtn && !state.feishuSaving) {
    saveBtn.textContent = f.connected ? '保存并重连' : '保存并连接';
  }
  updateFeishuChrome();
}

async function saveFeishu() {
  const appId = $('#feishu-app-id')?.value.trim() || '';
  const appSecret = $('#feishu-app-secret')?.value || '';
  const btn = $('#feishu-save');
  state.feishuSaving = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在校验并连接…';
  }
  try {
    const body = await api('/api/admin/feishu', {
      method: 'POST',
      body: JSON.stringify({ appId, appSecret }),
      signal: AbortSignal.timeout(35_000),
    });
    if (body.feishu) state.status = { ...state.status, feishu: body.feishu };
    $('#feishu-app-secret').value = '';
    state.feishuDirty = false;
    if (body.feishu?.connected) toast('飞书应用已保存，长连接已挂上');
    else toast(body.feishu?.lastError || '已保存，长连接还在连');
    renderChrome();
    renderFeishu();
    refreshChats().catch(() => {});
  } catch (err) {
    toast(err.message);
  } finally {
    state.feishuSaving = false;
    const saveBtn = $('#feishu-save');
    if (saveBtn) saveBtn.disabled = false;
    renderFeishu();
  }
}

async function clearFeishu() {
  if (!confirm('清掉后台保存的飞书凭据。若 .env 里还有，会退回去用 .env；否则长连接会断开。确定？')) return;
  try {
    const body = await api('/api/admin/feishu/clear', {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(35_000),
    });
    if (body.feishu) state.status = { ...state.status, feishu: body.feishu };
    state.feishuDirty = false;
    if ($('#feishu-app-secret')) $('#feishu-app-secret').value = '';
    toast(body.feishu?.configured ? '已退回 .env 里的飞书应用' : '已清除飞书凭据');
    renderChrome();
    renderFeishu();
    refreshChats().catch(() => {});
  } catch (err) {
    toast(err.message);
  }
}

function renderXai() {
  const data = state.status;
  if (!data || state.pollTimer) return;
  const x = data.xai;
  const box = $('#xai-box');
  if (x.present && !x.expired) {
    box.innerHTML = `<p>已登录 <b>${escapeHtml(x.email || '（无邮箱）')}</b></p>
      <p class="hint">下次 ${escapeHtml(fmtTime(x.expiresAt))} · 到期前会自动续</p>
      <button class="ghost" id="xai-logout" type="button">退出并换号</button>`;
    $('#xai-logout').onclick = async () => {
      if (!confirm('清掉生产凭据，群里会暂时答不了。确定？')) return;
      try {
        await api('/api/admin/xai/logout', { method: 'POST', body: '{}' });
        await refresh();
      } catch (err) {
        toast(err.message);
      }
    };
    return;
  }
  const expiredHint = x.lastError
    ? escapeHtml(x.lastError)
    : x.present
      ? '自动续期没成功，需要重新走一次 device-code。'
      : '';
  box.innerHTML = `<p>${x.present ? '凭据已过期' : '还没登录 Grok 订阅'}</p>
    ${expiredHint ? `<p class="hint">${expiredHint}</p>` : ''}
    <button class="primary" id="xai-start" type="button">开始 device-code 登录</button>
    <div id="xai-flow"></div>`;
  $('#xai-start').onclick = startXai;
}

async function startXai() {
  try {
    const started = await api('/api/admin/xai/start', { method: 'POST', body: '{}' });
    const flow = $('#xai-flow');
    flow.innerHTML = `<p>在浏览器打开：<a href="${escapeHtml(started.verificationUrl)}" target="_blank" rel="noreferrer">${escapeHtml(started.verificationUrl)}</a></p>
      <div class="xai-code">${escapeHtml(started.userCode)}</div>
      <p class="hint">确认后这里会自动变成已登录。</p>`;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      try {
        const r = await api('/api/admin/xai/poll', {
          method: 'POST',
          body: JSON.stringify({ deviceCode: started.deviceCode }),
        });
        if (r.status === 'done') {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          await refresh();
        }
      } catch (err) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        flow.insertAdjacentHTML('beforeend', `<p class="hint">${escapeHtml(err.message)}</p>`);
      }
    }, (started.interval || 5) * 1000);
  } catch (err) {
    toast(err.message);
  }
}

function renderSettings() {
  const data = state.status;
  if (!data) return;
  renderFeishu();
  renderXai();
  renderLink();
  const p2p = $('#p2p-open');
  if (p2p && document.activeElement !== p2p) p2p.checked = Boolean(data.settings.p2pOpen);
  renderMorningDefault();
  renderModelPicker();
}

function morningMeta(n) {
  if (n) return `上海时区 · ${n} 个群`;
  return '上海时区 · 还没有群开早报';
}

function renderMorningDefault() {
  const root = $('#morning-clock');
  if (!root) return;
  const current = morningDefault();
  const slots = timeSlotList(current);
  const idx = slots.indexOf(current);
  const n = morningRows().length;
  const open = state.pickerOpen === 'morning';
  const sig = `${current}|${n}|${open}`;
  if (root.dataset.sig === sig) return;
  root.innerHTML = `
    <span class="toggle-copy">
      <b>每天这个点发</b>
      <small>${escapeHtml(morningMeta(n))}</small>
    </span>
    <div class="time-step" id="morning-picker">
      <button type="button" class="time-nudge" data-morning-step="-1" aria-label="提前 15 分钟"${idx <= 0 ? ' disabled' : ''}>−</button>
      <button type="button" class="time-value" id="morning-time-btn" aria-haspopup="listbox" aria-expanded="${open}" aria-label="选择早报时间">
        ${escapeHtml(current)}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>
      </button>
      <button type="button" class="time-nudge" data-morning-step="1" aria-label="推迟 15 分钟"${idx < 0 || idx >= slots.length - 1 ? ' disabled' : ''}>+</button>
      <div class="picker-menu time-menu" role="listbox" ${open ? '' : 'hidden'}>
        ${slots
          .map((t) => {
            const on = t === current;
            return `<button type="button" class="picker-option${on ? ' active' : ''}" role="option"
              data-morning-time="${escapeHtml(t)}" aria-selected="${on}">
              <span class="picker-copy"><b>${escapeHtml(t)}</b></span>
              <span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>
            </button>`;
          })
          .join('')}
      </div>
    </div>`;
  root.dataset.sig = sig;
  if (open) {
    requestAnimationFrame(() => {
      root.querySelector('.picker-option[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  }
}

function nudgeMorningTime(dir) {
  const slots = timeSlotList(morningDefault());
  const next = slots[slots.indexOf(morningDefault()) + dir];
  if (next) saveDefaultMorningTime(next);
}

function renderModelPicker() {
  const root = $('#model-picker');
  if (!root) return;
  const current = state.status?.settings?.xaiModel || 'grok-4-fast';
  const models = MODELS.some((m) => m.value === current) ? MODELS : [...MODELS, modelMeta(current)];
  const selected = modelMeta(current);
  root.innerHTML = `<button type="button" class="picker-btn" id="model-picker-btn"
      aria-haspopup="listbox" aria-expanded="${state.pickerOpen === 'model'}" aria-label="选择模型">
      <span class="picker-copy"><b>${escapeHtml(selected.value)}</b><small>${escapeHtml(selected.hint)}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>
    </button>
    <div class="picker-menu" role="listbox" ${state.pickerOpen === 'model' ? '' : 'hidden'}>
      ${models
        .map((m) => {
          const on = m.value === current;
          return `<button type="button" class="picker-option${on ? ' active' : ''}" role="option"
            data-model="${escapeHtml(m.value)}" aria-selected="${on}">
            <span class="picker-copy"><b>${escapeHtml(m.value)}</b><small>${escapeHtml(m.hint)}</small></span>
            <span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>
          </button>`;
        })
        .join('')}
    </div>`;
}

function setPickerOpen(which) {
  state.pickerOpen = which === 'model' || which === 'morning' ? which : false;
  renderModelPicker();
  const clock = $('#morning-clock');
  if (clock) delete clock.dataset.sig;
  renderMorningDefault();
}

async function saveModel(value) {
  setPickerOpen(false);
  if (!value || value === state.status?.settings?.xaiModel) return;
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ xaiModel: value }) });
    if (state.status?.settings) state.status.settings.xaiModel = value;
    toast(`已切换到 ${value}`);
    renderModelPicker();
  } catch (err) {
    toast(err.message);
  }
}

function openDrawer(id) {
  const c = chatById(id);
  state.selectedId = id;
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  if (!c) {
    drawer.hidden = true;
    scrim.hidden = true;
    return;
  }
  $('#drawer-lane').textContent = laneTitle(laneOf(c));
  $('#drawer-title').textContent = c.name;
  const d = denialOf(c.chatId);
  const turns = (state.status?.turns || []).filter((t) => t.chatId === c.chatId).slice(0, 6);
  const turnHtml = turns.length
    ? `<h3>最近在这个群</h3><ul class="feed">${turns
        .map((t) => {
          const who = userLabel(t);
          return `<li><div class="when">${escapeHtml(fmtTime(t.at))} · ${escapeHtml(who)}</div><div class="q">${escapeHtml(t.text || '')}</div></li>`;
        })
        .join('')}</ul>`
    : '<p class="hint">最近 30 条全局对话里，还没有这个群。</p>';
  $('#drawer-body').innerHTML = `
    <p class="mono">${escapeHtml(c.chatId)} <button type="button" class="copy" data-copy="${escapeHtml(c.chatId)}">复制</button></p>
    <p class="hint">${escapeHtml(ticketMeta(c))}</p>
    <div class="sws">
      <button type="button" class="sw${c.enabled ? ' on' : ''}" data-kind="chat" data-id="${escapeHtml(c.chatId)}" aria-pressed="${c.enabled}">开通</button>
      <button type="button" class="sw${c.morning ? ' on' : ''}" data-kind="morning" data-id="${escapeHtml(c.chatId)}" aria-pressed="${c.morning}">早报</button>
    </div>
    ${d && !c.pending ? `<p class="hint">未开通时被 @ ${d.count} 次，最近 ${escapeHtml(relTime(d.lastAt))}</p>` : ''}
    ${turnHtml}`;
  drawer.hidden = false;
  scrim.hidden = false;
  renderBoard();
}

function closeDrawer() {
  state.selectedId = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  renderBoard();
}

async function setFlag(chat, kind, on) {
  const key = kind === 'morning' ? 'morning' : 'enabled';
  const prev = chat[key];
  if (prev === on) return;
  chat[key] = on;
  if (kind === 'chat' && on) chat.pending = false;
  state.saving.add(chat.chatId);
  renderBoard();
  if (state.selectedId === chat.chatId) openDrawer(chat.chatId);
  try {
    await api('/api/admin/allowlist', {
      method: 'POST',
      body: JSON.stringify({ kind, id: chat.chatId, op: on ? 'add' : 'remove' }),
    });
  } catch (err) {
    chat[key] = prev;
    toast(err.message);
  } finally {
    state.saving.delete(chat.chatId);
    renderBoard();
    renderChrome();
    if (state.selectedId === chat.chatId) openDrawer(chat.chatId);
  }
}

async function saveDefaultMorningTime(value) {
  if (!value || value === morningDefault()) {
    if (state.pickerOpen === 'morning') setPickerOpen(false);
    return;
  }
  const prev = morningDefault();
  if (state.status?.settings) state.status.settings.morningDefaultTime = value;
  if (state.pickerOpen === 'morning') state.pickerOpen = false;
  const clock = $('#morning-clock');
  if (clock) delete clock.dataset.sig;
  renderMorningDefault();
  try {
    const body = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ morningDefaultTime: value }),
    });
    if (body.settings && state.status) state.status.settings = body.settings;
    toast(`早报时间 ${morningDefault()}`);
    renderChrome();
    renderBoard();
    if (state.selectedId) openDrawer(state.selectedId);
  } catch (err) {
    if (state.status?.settings) state.status.settings.morningDefaultTime = prev;
    toast(err.message);
    if (clock) delete clock.dataset.sig;
    renderMorningDefault();
  }
}

async function applyLane(chat, laneId) {
  const lane = LANES.find((l) => l.id === laneId);
  if (!lane?.drop) {
    toast('待处理不能拖入。打开「开通」，或把机器人拉回群。');
    return;
  }
  if (chat.missing) {
    toast('机器人不在这个群，先把它拉回去。');
    return;
  }
  const next = { enabled: chat.enabled, morning: chat.morning, ...lane.drop };
  if (next.enabled !== chat.enabled) await setFlag(chat, 'chat', next.enabled);
  if (next.morning !== chat.morning) await setFlag(chat, 'morning', next.morning);
}

async function refresh() {
  const data = await api('/api/admin/status');
  if (DEMO) {
    data.turns = demoTurns();
    data.usage = demoUsage();
    data.quota = { ...(data.quota || {}), global: 7, userCap: 0, globalCap: 0 };
    data.settings = {
      ...(data.settings || {}),
      morningDefaultTime: '09:00',
      morningSent: { oc_demo_m1: data.quota?.day },
      morningAllowlist: ['oc_demo_m1', 'oc_demo_m2'],
      chatAllowlist: ['oc_demo_reply1', 'oc_demo_reply2', 'oc_demo_m1'],
    };
    data.feishu = {
      ...(data.feishu || {}),
      appId: data.feishu?.appId || 'cli_demoapp00000001',
      consoleUrl: data.feishu?.consoleUrl || 'https://open.feishu.cn/app/cli_demoapp00000001',
      secretSet: true,
      source: data.feishu?.source === 'env' ? 'env' : 'file',
    };
  }
  state.status = data;
  renderChrome();
  if (state.view === 'activity') renderActivity();
  if (state.view === 'settings') renderSettings();
  if (state.selectedId) {
    openDrawer(state.selectedId);
  }
}

async function refreshChats() {
  const btn = $('#chats-refresh');
  if (btn) btn.disabled = true;
  try {
    const groups = await api('/api/admin/groups');
    state.chats = DEMO ? demoChats() : groups.chats || [];
    state.chatsError = DEMO ? '' : groups.error || '';
  } catch (err) {
    state.chatsError = DEMO ? '' : err.message;
    if (DEMO) state.chats = demoChats();
  } finally {
    if (btn) btn.disabled = false;
    renderBoard();
    renderChrome();
    if (state.view === 'activity') renderActivity();
    if (state.selectedId && chatById(state.selectedId)) openDrawer(state.selectedId);
  }
}

function bind() {
  window.addEventListener('hashchange', () => setView(hashView(), false));
  $('#board-q').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderBoard();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      setView('board');
      $('#board-q').focus();
    }
    if (e.key === 'Escape') {
      if (state.pickerOpen) {
        setPickerOpen(false);
        return;
      }
      closeDrawer();
    }
  });
  document.body.addEventListener('click', (e) => {
    const modelOpt = e.target.closest('[data-model]');
    if (modelOpt) {
      saveModel(modelOpt.dataset.model);
      return;
    }
    const morningOpt = e.target.closest('[data-morning-time]');
    if (morningOpt) {
      saveDefaultMorningTime(morningOpt.dataset.morningTime);
      return;
    }
    const morningStep = e.target.closest('[data-morning-step]');
    if (morningStep) {
      nudgeMorningTime(Number(morningStep.dataset.morningStep));
      return;
    }
    if (e.target.closest('#morning-time-btn')) {
      setPickerOpen(state.pickerOpen === 'morning' ? false : 'morning');
      return;
    }
    if (e.target.closest('#model-picker-btn')) {
      setPickerOpen(state.pickerOpen === 'model' ? false : 'model');
      return;
    }
    if (state.pickerOpen === 'model' && !e.target.closest('#model-picker')) setPickerOpen(false);
    if (state.pickerOpen === 'morning' && !e.target.closest('#morning-picker')) setPickerOpen(false);
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      const go = () => document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (state.view !== 'guide') {
        setView('guide');
        requestAnimationFrame(go);
      } else {
        go();
      }
      return;
    }
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filter = chip.dataset.filter;
      $$('[data-filter]').forEach((el) => el.classList.toggle('on', el === chip));
      renderBoard();
      return;
    }
    const health = e.target.closest('[data-health]');
    if (health) {
      setView('settings');
      location.hash = '#/settings';
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(
        () => toast('已复制群 ID'),
        () => toast(copy.dataset.copy),
      );
      return;
    }
    const sw = e.target.closest('.sw[data-kind]');
    if (sw) {
      e.preventDefault();
      e.stopPropagation();
      const chat = chatById(sw.dataset.id);
      if (!chat) return;
      const on = !chat[sw.dataset.kind === 'morning' ? 'morning' : 'enabled'];
      setFlag(chat, sw.dataset.kind, on);
      return;
    }
    const ticket = e.target.closest('.ticket');
    if (ticket) {
      openDrawer(ticket.dataset.id);
    }
  });
  $('#chats-refresh').onclick = () => refreshChats();
  $('#drawer-close').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#p2p-open').onchange = async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    try {
      await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ p2pOpen: on }) });
      toast(on ? '已允许私聊' : '已关闭私聊');
    } catch (err) {
      e.target.checked = !on;
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  };

  const board = $('#board');
  board.addEventListener('dragstart', (e) => {
    const ticket = e.target.closest('.ticket');
    if (!ticket || !canDrag()) return;
    e.dataTransfer.setData('text/plain', ticket.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    ticket.classList.add('dragging');
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.ticket')?.classList.remove('dragging');
    $$('.lane').forEach((l) => l.classList.remove('over'));
  });
  board.addEventListener('dragover', (e) => {
    const lane = e.target.closest('.lane');
    if (!lane) return;
    e.preventDefault();
    $$('.lane').forEach((l) => l.classList.toggle('over', l === lane));
  });
  board.addEventListener('drop', (e) => {
    const lane = e.target.closest('.lane');
    if (!lane) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const chat = chatById(id);
    $$('.lane').forEach((l) => l.classList.remove('over'));
    if (chat) applyLane(chat, lane.dataset.lane);
  });
}

try {
  bind();
  setView(hashView(), false);
} catch (err) {
  pill($('#ready-pill'), false, err.message || '页面脚本出错');
}
refresh().catch((err) => {
  pill($('#ready-pill'), false, err.message || '加载失败');
});
refreshChats().then(() => {
  const open = new URLSearchParams(location.search).get('open');
  if (open && chatById(open)) openDrawer(open);
});
setInterval(() => refresh().catch(() => {}), 15000);
