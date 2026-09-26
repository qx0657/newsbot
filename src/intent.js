import { brandConfig } from './config.js';

const CATEGORIES = [
  { key: 'paper', re: /论文|\bpaper\b|arxiv/i },
  { key: 'ai-models', re: /模型|大模型|\bllm\b|\bmodels?\b/i },
  { key: 'ai-products', re: /产品|\bproducts?\b/i },
  { key: 'industry', re: /行业|\bindustry\b/i },
  { key: 'tip', re: /技巧|教程|\btips?\b/i },
];

const FILLER =
  /请|麻烦|帮我|一下|看看|查查|查询|搜索|搜一下|告诉我|我想问|请问/g;

const TIME_NOISE = /今天|过去\s*24\s*小时|24\s*小时|最近一周|这一周|本周|最近|热点|热榜|日报|资讯|新闻|动态|简报|有什么|发生了什么|最新|现在/g;

export function helpText() {
  const brand = brandConfig();
  return `我是 **${brand.name}**，${brand.short}。

可以直接问：
- **今天** / 过去 24 小时
- **热点**
- **日报**（或 \`日报 2026-09-01\`）
- **AA榜** / 模型榜 / 哪个模型最强
- **Tibo重置** / Codex 额度 / 重置卡 / 重置预测
- 某个公司、模型、产品（例如 \`OpenAI\`、\`论文 transformer\`）

群里 @ 我再问。我不是通用助手，不写代码、不闲聊。

引用数字、政策或原话时，请点开原文核对。`;
}

export const OFF_TOPIC_TEXT =
  '我只做 AI 资讯简报，不写代码、不闲聊。问「今天」「热点」「日报」「AA榜」「模型榜」「Tibo重置」，或丢一个公司 / 模型名就行。';

export function normalizeText(raw) {
  return String(raw || '')
    .replace(/@_user_\d+/g, ' ')
    .replace(/<at[^>]*>[^<]*<\/at>/gi, ' ')
    .replace(/@[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIndex(text) {
  const m = String(text).match(/第\s*(\d{1,2})\s*[条名个]?/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 20 ? n : null;
}

export function isFollowUp(text) {
  const t = String(text).trim();
  if (parseIndex(t)) return true;
  return /^(这个|这条|那个|刚才|上面|展开|详细说说|详细点|来龙去脉|后续进展|为什么入选)/.test(t);
}

export function isOffTopic(text) {
  const t = String(text).trim();
  return (
    /^(帮我写|写一个|写段|改代码|debug|帮我改|怎么部署|作诗|讲个笑话|翻译下面|sudo |ssh )/i.test(t) ||
    /写(python|javascript|代码|脚本|正则)/i.test(t)
  );
}

export function isCodexReset(text) {
  const t = String(text || '');
  if (/重置卡|banked\s*resets?|全员重置|tibo\s*重置|蒂博\s*重置/i.test(t)) return true;
  if (/重置预测|下一次重置|下次重置/.test(t)) return true;
  if (/\b(tibo|thsottiaux|蒂博)\b/i.test(t) && /重置|发卡|额度/i.test(t)) return true;
  if (/\bcodex\b/i.test(t) && /重置|额度|发卡|calendar|预测/i.test(t)) return true;
  if (/额度重置|usage\s*resets?/i.test(t) && /codex|tibo|chatgpt\s*work|astra/i.test(t)) return true;
  return false;
}

export function isAaBoard(text) {
  const t = String(text || '');
  if (
    /aa\s*榜|aa榜单|aa\s*指数|aa\s*排行榜?|artificial\s*analysis|intelligence\s*index|\baa\s*index\b|\baa\s*leaderboard\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/(大?模型|llm)\s*(榜|排行榜?|排名)|模型榜|大模型榜|\bllm\s*(board|leaderboard|ranking)s?\b/i.test(t)) {
    return true;
  }
  if (/(最强|最强的|排名最(?:前|高)).{0,12}(模型|llm)|(哪个|什么)模型最强|现在.{0,6}模型最强/i.test(t)) {
    return true;
  }
  return false;
}

function categoryOf(text) {
  for (const c of CATEGORIES) {
    if (c.re.test(text)) return c.key;
  }
  return null;
}

function windowOf(text) {
  if (/今天|24\s*小时|过去一天|\btoday\b|\b24h\b/i.test(text)) return '24h';
  if (/本周|这一周|最近一周|7\s*天|\bweek\b/i.test(text)) return '7d';
  return null;
}

function searchQuery(text) {
  return text
    .replace(FILLER, ' ')
    .replace(TIME_NOISE, ' ')
    .replace(/论文|产品|模型|行业|技巧|大模型/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function route(text) {
  const t = normalizeText(text);
  if (!t) return { kind: 'help' };
  if (/^(帮助|help|你好|您好|hi|hello|你是谁|能做什么)[?？!！。.\s]*$/i.test(t)) {
    return { kind: 'help' };
  }
  if (isOffTopic(t)) return { kind: 'off-topic' };

  if (isAaBoard(t)) return { kind: 'aa' };
  if (isCodexReset(t)) return { kind: 'codex' };

  const date = (t.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  if (/日报|\bdaily\b/i.test(t)) {
    return date ? { kind: 'daily', date } : { kind: 'daily' };
  }
  if (/热点|热榜|最热|在爆|\btrending\b|\bhot topics?\b/i.test(t)) {
    return { kind: 'hot' };
  }

  const category = categoryOf(t);
  const window = windowOf(t);
  const q = searchQuery(t);
  const broad = /有什么|资讯|新闻|动态|简报|发生了什么|最新|^今天$|^最近$|^本周$/.test(t);

  if (q.length >= 2 && q.length <= 200) {
    return {
      kind: 'search',
      q,
      window: window || (broad ? '24h' : '7d'),
      category,
      mode: 'selected',
    };
  }

  return { kind: 'latest', window: window || '24h', category };
}
