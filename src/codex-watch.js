import { createHash } from 'node:crypto';
import { feishuConfigured } from './config.js';
import { fingerprintOf, fetchCodexResets, newCodexChanges } from './codex.js';
import { buildCodexCard, buildCodexEventCard } from './card.js';
import { chatAllowlist, loadCodexSeen, openDb, recordTurn, saveCodexSeen } from './quota.js';

async function defaultSendCard(...args) {
  const { sendCardToChat } = await import('./feishu.js');
  return sendCardToChat(...args);
}

let chain = Promise.resolve();

export function runCodexWatch(opts = {}) {
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

export function codexUuid(key, chatId) {
  const h = createHash('sha256')
    .update(`${key}:${chatId}`)
    .digest('hex')
    .slice(0, 20);
  return `nb-cx-${h}`;
}

function isDuplicateUuid(err) {
  return Number(err?.code) === 230020 || /uuid.*(duplicate|conflict|exist)/i.test(String(err?.message || ''));
}

function payloadsFor(cal, changes) {
  if (changes.length > 3) {
    const key = changes
      .map(fingerprintOf)
      .sort()
      .join('|');
    return [{ key, card: buildCodexCard(cal), text: `日历更新 ${changes.length} 条` }];
  }
  return changes.map((event) => ({
    key: fingerprintOf(event),
    card: buildCodexEventCard(event, cal),
    text: event.title || event.label,
  }));
}

async function runOnce({
  now = Date.now(),
  sendCard = defaultSendCard,
  chats = null,
} = {}) {
  openDb();
  const cal = await fetchCodexResets({ force: true, now });
  const diff = newCodexChanges(loadCodexSeen(), cal);
  saveCodexSeen(diff.fingerprints);
  if (diff.seed) {
    console.log(new Date().toISOString(), 'codex seeded', diff.fingerprints.length);
    return { skipped: true, seed: true, count: diff.fingerprints.length, sent: [], failed: [] };
  }
  if (!diff.changes.length) {
    return { skipped: true, seed: false, changes: [], sent: [], failed: [] };
  }

  const targets = Array.isArray(chats) ? chats : chatAllowlist();
  if (!targets.length) {
    console.log(new Date().toISOString(), 'codex changes', diff.changes.length, 'no 开通 groups');
    return { skipped: true, seed: false, changes: diff.changes, sent: [], failed: [] };
  }
  if (sendCard === defaultSendCard && !feishuConfigured()) {
    return { skipped: false, seed: false, changes: diff.changes, sent: [], failed: ['飞书未配置'] };
  }

  const payloads = payloadsFor(cal, diff.changes);
  const sent = [];
  const failed = [];
  for (const chatId of targets) {
    for (const payload of payloads) {
      try {
        await sendCard(chatId, payload.card, { uuid: codexUuid(payload.key, chatId) });
        sent.push(chatId);
        recordTurn({
          chatId,
          openId: 'codex',
          text: payload.text,
          intent: 'codex-push',
          usedGrok: false,
          userName: 'Tibo重置',
          chatType: 'group',
        });
        console.log(new Date().toISOString(), 'codex sent', chatId, payload.key);
      } catch (err) {
        if (isDuplicateUuid(err)) {
          sent.push(chatId);
          console.log(new Date().toISOString(), 'codex already sent (uuid)', chatId);
        } else {
          failed.push(`${chatId}: ${err.message || err}`);
          console.error(new Date().toISOString(), 'codex send failed', chatId, err.message || err);
        }
      }
    }
  }
  return {
    skipped: false,
    seed: false,
    changes: diff.changes,
    sent,
    failed,
  };
}

export function startCodexTick(ms = 5 * 60_000) {
  const kick = () => {
    runCodexWatch().catch((err) => {
      console.error(new Date().toISOString(), 'codex tick', err);
    });
  };
  setTimeout(kick, 20_000);
  setInterval(kick, ms);
}

export async function sendCodexCalendar(chatIds, { sendCard = defaultSendCard, now = Date.now() } = {}) {
  const cal = await fetchCodexResets({ force: true, now });
  const card = buildCodexCard(cal);
  const sent = [];
  const failed = [];
  for (const chatId of chatIds) {
    try {
      await sendCard(chatId, card);
      sent.push(chatId);
    } catch (err) {
      failed.push(`${chatId}: ${err.message || err}`);
    }
  }
  return { cal, sent, failed };
}
