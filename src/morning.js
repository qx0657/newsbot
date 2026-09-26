import { createHash } from 'node:crypto';
import { feishuConfigured } from './config.js';
import { answer } from './brief.js';
import { buildMorningCard } from './card.js';
import { sendCardToChat } from './feishu.js';
import {
  claimMorningChats,
  markMorningSent,
  MORNING_BRIEF_VERSION,
  morningBriefCache,
  openDb,
  recordTurn,
  releaseMorningClaim,
  saveMorningBriefCache,
  shanghaiDay,
} from './quota.js';

let chain = Promise.resolve();

export function runMorning(opts = {}) {
  const job = chain.then(
    () => runOnce(opts),
    () => runOnce(opts),
  );
  chain = job.then(
    () => {},
    () => {},
  );
  return job;
}

let lastBriefFailAt = 0;

export function morningUuid(day, chatId) {
  const h = createHash('sha256')
    .update(`${MORNING_BRIEF_VERSION}:${day}:${chatId}`)
    .digest('hex')
    .slice(0, 16);
  return `nb-v${MORNING_BRIEF_VERSION}-${day}-${h}`;
}

async function loadBrief(day) {
  const hit = morningBriefCache(day);
  if (hit) return { ...hit, cached: true };
  if (Date.now() - lastBriefFailAt < 15 * 60 * 1000) {
    throw new Error('早报生成刚失败过，15 分钟内不重试');
  }
  try {
    const { markdown, items, usedGrok, intent } = await answer({
      text: '今天',
      chatId: 'morning',
      openId: 'morning',
      style: 'digest',
    });
    if (!items?.length) throw new Error('早报条目为空');
    const row = {
      day,
      markdown,
      items,
      usedGrok: Boolean(usedGrok),
      intent: intent || 'latest',
      at: Date.now(),
    };
    saveMorningBriefCache(row);
    return { ...row, cached: false };
  } catch (err) {
    lastBriefFailAt = Date.now();
    throw err;
  }
}

function isDuplicateUuid(err) {
  return Number(err?.code) === 230020 || /uuid.*(duplicate|conflict|exist)/i.test(String(err?.message || ''));
}

async function runOnce({ now = new Date(), sendCard = sendCardToChat } = {}) {
  openDb();
  const day = shanghaiDay(now);
  const chats = claimMorningChats(day, now);
  if (!chats.length) {
    return { skipped: true, day, sent: [], failed: [], cached: false };
  }
  console.log(new Date().toISOString(), 'morning claimed', chats.join(','));
  if (!feishuConfigured()) {
    releaseMorningClaim(chats, day);
    return { skipped: false, day, sent: [], failed: ['飞书未配置'], cached: false };
  }

  let brief;
  try {
    brief = await loadBrief(day);
  } catch (err) {
    releaseMorningClaim(chats, day);
    throw err;
  }

  const card = buildMorningCard({ day, items: brief.items });
  const failed = [];
  const sentIds = [];
  for (const chatId of chats) {
    try {
      await sendCard(chatId, card, { uuid: morningUuid(day, chatId) });
      markMorningSent([chatId], day);
      sentIds.push(chatId);
      console.log(new Date().toISOString(), 'morning sent', chatId);
    } catch (err) {
      if (isDuplicateUuid(err)) {
        markMorningSent([chatId], day);
        sentIds.push(chatId);
        console.log(new Date().toISOString(), 'morning already sent (uuid)', chatId);
      } else {
        releaseMorningClaim(chatId, day);
        failed.push(`${chatId}: ${err.message || err}`);
        console.error(new Date().toISOString(), 'morning send failed', chatId, err.message || err);
      }
    }
  }

  for (const chatId of sentIds) {
    recordTurn({
      chatId,
      openId: 'morning',
      text: '早报',
      intent: brief.intent || 'latest',
      usedGrok: brief.usedGrok,
      userName: '早报',
      chatType: 'group',
    });
  }
  return {
    skipped: false,
    day,
    sent: sentIds,
    failed,
    cached: Boolean(brief.cached),
  };
}

export function startMorningTick(ms = 60_000) {
  const kick = () => {
    runMorning().catch((err) => {
      console.error(new Date().toISOString(), 'morning tick', err);
    });
  };
  setTimeout(kick, 15_000);
  setInterval(kick, ms);
}
