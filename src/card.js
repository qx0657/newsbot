export function morningHeaderDate(day) {
  const at = new Date(`${day}T12:00:00+08:00`);
  const week = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(at);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const month = parts.find((p) => p.type === 'month')?.value;
  const date = parts.find((p) => p.type === 'day')?.value;
  return `${month}月${date}日 ${week}`;
}

function escapeMd(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/([*_~`])/g, '\\$1');
}

function escapeLinkText(text) {
  return escapeMd(text).replace(/\]/g, '');
}

export function clipText(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const stop = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('，'));
  const base = stop >= Math.min(16, max / 3) ? window.slice(0, stop) : window;
  return `${base.replace(/[，、；:：]+$/, '')}…`;
}

export function itemMarkdown(item) {
  const title = escapeMd(item.title || '').trim();
  const summary = escapeMd(clipText(item.summary || '', 72)).trim();
  const source = escapeLinkText(item.source || '来源') || '来源';
  const url = String(item.url || '').trim();
  const link = /^https?:\/\//i.test(url) ? `[${source}](${url})` : escapeMd(source);
  const desc = summary ? `<font color='grey'>${summary}</font>` : '';
  const body = [desc, link].filter(Boolean).join(' ');
  return `**${title}**\n${body}`;
}

export function shanghaiStamp(iso) {
  const at = iso ? new Date(iso) : new Date();
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick('month')}月${pick('day')}日 ${pick('hour')}:${pick('minute')}`;
}

function clipLabel(text, max = 22) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function aaToMarkdown(board) {
  const models = board?.models || [];
  const ver = board?.version ? ` v${board.version}` : '';
  const lines = models.map((m) => {
    const who = m.creator ? ` · ${m.creator}` : '';
    const open = m.openWeights ? ' · 开源' : '';
    const link = m.url ? `[${m.label}](${m.url})` : m.label;
    return `${m.rank}. **${m.score}** ${link}${who}${open}`;
  });
  const head = `**AA Intelligence Index${ver}**`;
  const note = `[打开榜单](${board?.sourceUrl || 'https://artificialanalysis.ai/#artificial-analysis-intelligence-index'})`;
  return [head, '', ...lines, '', note].join('\n');
}

export function aaItemMarkdown(item) {
  const who = item.creator ? `${item.creator} · ` : '';
  const open = item.openWeights ? '开源权重' : '闭源';
  const title = item.label || item.name;
  const link = item.url ? `[${title}](${item.url})` : `**${title}**`;
  return `**第 ${item.rank} 名** ${link}\n${who}Intelligence Index **${item.score}** · ${open}`;
}

/** 飞书卡片 2.0：官网首页 Intelligence Index 默认对比组。 */
export function buildAaCard(board) {
  const models = board?.models || [];
  const lead = models[0];
  const when = shanghaiStamp(board?.fetchedAt);

  const colorDomain = [];
  const colorRange = [];
  for (const m of models) {
    const name = m.creator || 'Other';
    if (colorDomain.includes(name)) continue;
    colorDomain.push(name);
    colorRange.push(m.color || '#1456F0');
  }

  // 飞书横向柱状图第一项在最上方。models 已按分数降序，保持原序即高分在上。
  const chartValues = models.map((m) => ({
    model: clipLabel(m.label),
    score: m.score,
    creator: m.creator || 'Other',
  }));

  const chart = {
    tag: 'chart',
    element_id: 'aaChart',
    height: `${Math.min(999, Math.max(360, models.length * 30 + 48))}px`,
    preview: true,
    margin: '0px 0px 12px 0px',
    chart_spec: {
      type: 'bar',
      direction: 'horizontal',
      data: { values: chartValues },
      xField: 'score',
      yField: 'model',
      seriesField: 'creator',
      legends: { visible: false },
      label: { visible: true, interactive: false },
      color: { type: 'ordinal', domain: colorDomain, range: colorRange },
      select: { enable: false },
      hover: { enable: true },
      crosshair: { xField: { visible: false }, yField: { visible: false } },
      barBackground: { visible: false },
      bar: {
        state: {
          hover: {
            stroke: '#ffffff',
            strokeOpacity: 1,
            lineWidth: 2,
            zIndex: 100,
          },
          dimension_hover: {
            stroke: '#ffffff',
            strokeOpacity: 1,
            lineWidth: 2,
            zIndex: 100,
          },
        },
      },
    },
  };

  const button = {
    tag: 'button',
    element_id: 'aaOpen',
    type: 'primary_filled',
    width: 'fill',
    text: { tag: 'plain_text', content: '打开完整榜单' },
    behaviors: [
      {
        type: 'open_url',
        default_url: board?.sourceUrl || 'https://artificialanalysis.ai/#artificial-analysis-intelligence-index',
      },
    ],
  };

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'fill',
      summary: { content: `Artificial Analysis Intelligence Index · ${lead?.label || ''} ${lead?.score ?? ''}`.trim() },
    },
    header: {
      title: { tag: 'plain_text', content: 'Artificial Analysis Intelligence Index' },
      subtitle: { tag: 'plain_text', content: when },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'myai_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '0px',
      elements: [chart, button],
    },
  };
}

function newestPost(event) {
  return (event?.posts || [])[0] || null;
}

function statusLabel(event) {
  return event?.status === 'announced' ? '预告' : '已完成';
}

function statusTagColor(event) {
  return event?.status === 'announced' ? 'orange' : 'green';
}

function scheduleLine(event) {
  const label = String(event?.schedule?.label || '').trim();
  if (label) return label;
  if (event?.occurredOn) return `发生日 ${event.occurredOn}`;
  if (event?.confirmedAt) {
    const stamp = shanghaiStamp(event.confirmedAt);
    return stamp ? `确认帖 ${stamp}` : '';
  }
  const stamp = shanghaiStamp(event?.createdAt);
  return stamp ? `记录于 ${stamp}` : '';
}

function quoteLine(event, max = 72) {
  const text = newestPost(event)?.text || '';
  return clipText(text, max);
}

function percentLabel(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 0.01) return '<1';
  return String(Math.round(100 * n));
}

function forecastMarkdown(forecast) {
  if (!forecast?.probabilities?.length) return '';
  const days = forecast.probabilities
    .map((row) => {
      const [, m, d] = String(row.day).split('-').map(Number);
      return `${m}月${d}日 ${percentLabel(row.probability)}%`;
    })
    .join(' · ');
  return [
    '**重置预测**（历史估计，仅供参考）',
    `${days} · 更晚 ${percentLabel(forecast.laterProbability)}%`,
    `从 ${shanghaiStamp(forecast.asOf)} 起算 · 历史 ${forecast.sampleCount} 次确认`,
  ].join('\n');
}

export function codexToMarkdown(cal) {
  const hero = cal?.hero;
  const lines = [];
  if (cal?.pending) {
    lines.push(`**未确认预告** ${cal.pending.label} · ${escapeMd(cal.pending.title)}`);
    const when = scheduleLine(cal.pending);
    if (when) lines.push(escapeMd(when));
  } else if (cal?.forecast) {
    lines.push(forecastMarkdown(cal.forecast));
    if (cal.latestConfirmed) {
      const when = scheduleLine(cal.latestConfirmed) || shanghaiStamp(cal.latestConfirmed.createdAt);
      lines.push(
        `最近一次${cal.latestConfirmed.label}：${escapeMd(cal.latestConfirmed.title)}${when ? ` · ${escapeMd(when)}` : ''}`,
      );
    }
  } else {
    lines.push('**目前没有未确认的预告**。');
    if (cal?.latestConfirmed) {
      const when = scheduleLine(cal.latestConfirmed) || shanghaiStamp(cal.latestConfirmed.createdAt);
      lines.push(
        `最近一次${cal.latestConfirmed.label}：${escapeMd(cal.latestConfirmed.title)}${when ? ` · ${escapeMd(when)}` : ''}`,
      );
    }
  }
  const items = cal?.items || [];
  if (items.length) {
    lines.push('');
    items.forEach((event, i) => {
      const when = scheduleLine(event);
      lines.push(`${i + 1}. **${event.label} · ${statusLabel(event)}** ${escapeMd(event.title)}${when ? `\n${escapeMd(when)}` : ''}`);
    });
  }
  lines.push('', `[打开日历](${cal?.sourceUrl || 'https://aihot.news/codex-reset'})`);
  return lines.join('\n');
}

export function codexEventMarkdown(event) {
  const when = scheduleLine(event);
  const quote = quoteLine(event, 160);
  const post = newestPost(event);
  const lines = [
    `**${event.label} · ${statusLabel(event)}** ${escapeMd(event.title)}`,
    event.scope ? `范围：${escapeMd(event.scope)}` : '',
    when ? escapeMd(when) : '',
    quote ? `\n${escapeMd(quote)}` : '',
    post?.url ? `\n[原帖](${post.url})` : `[打开日历](${event.url || 'https://aihot.news/codex-reset'})`,
  ];
  return lines.filter(Boolean).join('\n');
}

function codexHeroBlock(event, { last = false } = {}) {
  const pending = event.status === 'announced';
  const quote = quoteLine(event);
  const when = scheduleLine(event);
  const post = newestPost(event);
  const scope = event.scope ? `<font color='grey'>${escapeMd(event.scope)}</font>` : '';
  const lines = [
    `<text_tag color='${statusTagColor(event)}'>${statusLabel(event)}</text_tag> <text_tag color='neutral'>${event.label}</text_tag>`,
    `**${escapeMd(event.title)}**`,
    when ? `<font color='grey'>${escapeMd(when)}</font>` : '',
    scope,
    quote ? escapeMd(quote) : '',
  ].filter(Boolean);
  return {
    tag: 'interactive_container',
    element_id: 'cxHero',
    width: 'fill',
    has_border: true,
    border_color: pending ? 'orange-100' : 'green-100',
    corner_radius: '8px',
    background_style: pending ? 'orange-50' : 'green-50',
    padding: '12px 12px 12px 12px',
    vertical_spacing: '4px',
    margin: last ? '0px' : '0px 0px 12px 0px',
    behaviors: [
      {
        type: 'open_url',
        default_url: post?.url || event.url || 'https://aihot.news/codex-reset',
      },
    ],
    elements: [
      {
        tag: 'markdown',
        element_id: 'cxHeroMd',
        content: lines.join('\n'),
      },
    ],
  };
}

function codexTimeline(items, start = 2) {
  const rows = (items || []).map((event, i) => {
    const when = scheduleLine(event);
    return `${start + i}. **${event.label} · ${statusLabel(event)}** ${escapeMd(event.title)}${when ? `\n<font color='grey'>${escapeMd(when)}</font>` : ''}`;
  });
  return {
    tag: 'markdown',
    element_id: 'cxList',
    text_size: 'notation',
    margin: '0px 0px 12px 0px',
    content: `**最近记录**\n${rows.join('\n')}`,
  };
}

function codexOpenButton(url, { id = 'cxOpen', text = '打开日历' } = {}) {
  return {
    tag: 'button',
    element_id: id,
    type: 'primary_filled',
    width: 'fill',
    text: { tag: 'plain_text', content: text },
    behaviors: [{ type: 'open_url', default_url: url }],
  };
}

function codexHeader(cal, event) {
  const pending = Boolean(cal?.pending || event?.status === 'announced');
  const forecast = !pending && cal?.forecast;
  const when = shanghaiStamp(forecast?.asOf || cal?.checkedAt);
  return {
    title: { tag: 'plain_text', content: 'Tibo 重置日历' },
    subtitle: {
      tag: 'plain_text',
      content: forecast ? `历史估计 · 从 ${when} 起算` : when ? `最近核对 ${when}` : 'Tibo 重置记录',
    },
    template: pending ? 'orange' : forecast ? 'blue' : 'green',
    icon: { tag: 'standard_icon', token: 'calendar_colorful' },
    text_tag_list: [
      {
        tag: 'text_tag',
        text: { tag: 'plain_text', content: pending ? '有预告' : forecast ? '历史估计' : '无未确认预告' },
        color: pending ? 'orange' : forecast ? 'blue' : 'green',
      },
    ],
  };
}

function forecastBlock(forecast, calendarUrl) {
  const columns = (forecast.probabilities || []).map((row, i) => {
    const [, month, day] = String(row.day).split('-').map(Number);
    return {
      tag: 'column',
      width: 'weighted',
      weight: 1,
      padding: '4px 0px 0px 0px',
      vertical_spacing: '2px',
      elements: [
        {
          tag: 'markdown',
          element_id: `cxP${i}`,
          text_align: 'center',
          content: `## ${percentLabel(row.probability)}%`,
        },
        {
          tag: 'markdown',
          element_id: `cxPd${i}`,
          text_align: 'center',
          text_size: 'notation',
          content: `<font color='grey'>${month}月${day}日</font>`,
        },
      ],
    };
  });
  return {
    tag: 'interactive_container',
    element_id: 'cxPred',
    width: 'fill',
    has_border: true,
    border_color: 'blue-100',
    corner_radius: '8px',
    background_style: 'blue-50',
    padding: '12px 12px 12px 12px',
    vertical_spacing: '8px',
    margin: '0px 0px 12px 0px',
    behaviors: [{ type: 'open_url', default_url: calendarUrl }],
    elements: [
      {
        tag: 'markdown',
        element_id: 'cxPredH',
        content: "**重置预测** <font color='grey'>历史估计 · 仅供参考</font>",
      },
      {
        tag: 'column_set',
        element_id: 'cxPredC',
        flex_mode: 'trisect',
        horizontal_spacing: '8px',
        columns,
      },
      {
        tag: 'markdown',
        element_id: 'cxPredF',
        text_size: 'notation',
        content: `<font color='grey'>更晚 ${percentLabel(forecast.laterProbability)}% · 历史 ${forecast.sampleCount} 次确认</font>`,
      },
    ],
  };
}

/** 飞书卡片 2.0：当前预告或历史估计 + 最近记录。 */
export function buildCodexCard(cal) {
  const hero = cal?.hero;
  const rest = (cal?.items || []).filter((event) => event.id !== hero?.id);
  const calendarUrl = cal?.sourceUrl || 'https://aihot.news/codex-reset';
  const elements = [];
  if (cal?.forecast && !cal.pending) elements.push(forecastBlock(cal.forecast, calendarUrl));
  if (hero) elements.push(codexHeroBlock(hero));
  if (rest.length) elements.push(codexTimeline(rest, 2));
  elements.push(codexOpenButton(calendarUrl));
  const lead = cal?.pending || hero;
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      summary: { content: `Tibo 重置 · ${lead?.title || '日历'}`.trim() },
    },
    header: codexHeader(cal, hero),
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '0px',
      elements,
    },
  };
}

/** 单条重置事件卡片，用于推送和「第 N 条」。 */
export function buildCodexEventCard(event, cal = {}) {
  const pending = event?.status === 'announced';
  const post = newestPost(event);
  const calendarUrl = cal?.sourceUrl || event?.url || 'https://aihot.news/codex-reset';
  const buttons = [
    {
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [codexOpenButton(post?.url || calendarUrl, { id: 'cxPost', text: post?.url ? '打开原帖' : '打开日历' })],
    },
  ];
  if (post?.url) {
    buttons.push({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [
        {
          tag: 'button',
          element_id: 'cxCal',
          type: 'default',
          width: 'fill',
          text: { tag: 'plain_text', content: '打开日历' },
          behaviors: [{ type: 'open_url', default_url: calendarUrl }],
        },
      ],
    });
  }
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      summary: { content: `${event.label} · ${event.title}` },
    },
    header: {
      title: { tag: 'plain_text', content: event.title || event.label },
      subtitle: { tag: 'plain_text', content: scheduleLine(event) || shanghaiStamp(event.createdAt) },
      template: pending ? 'orange' : 'green',
      icon: { tag: 'standard_icon', token: 'calendar_colorful' },
      text_tag_list: [
        {
          tag: 'text_tag',
          text: { tag: 'plain_text', content: `${event.label} · ${statusLabel(event)}` },
          color: pending ? 'orange' : 'green',
        },
      ],
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '0px',
      elements: [
        codexHeroBlock(event, { last: true }),
        {
          tag: 'column_set',
          flex_mode: 'bisect',
          horizontal_spacing: '8px',
          margin: '12px 0px 0px 0px',
          columns: buttons,
        },
      ],
    },
  };
}

export function itemsToMarkdown(items) {
  return (items || [])
    .map((it, i) => `${i + 1}. **${it.title}**\n${it.summary || ''} ${it.url ? `[${it.source || '来源'}](${it.url})` : ''}`.trim())
    .join('\n\n');
}

/** 飞书卡片 2.0：图1 的结构（标题 / 简介 / 来源），来源文案用资料里的名字，不改成「来源」。 */
export function buildMorningCard({ day, items }) {
  const list = (items || []).slice(0, 8);
  const elements = list.map((it, i) => ({
    tag: 'markdown',
    element_id: `item${i}`,
    content: itemMarkdown(it),
  }));
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      summary: { content: `AI 资讯 · 早报 ${day}` },
    },
    header: {
      title: { tag: 'plain_text', content: 'AI 资讯 · 早报' },
      subtitle: { tag: 'plain_text', content: morningHeaderDate(day) },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'myai_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '12px',
      elements,
    },
  };
}
