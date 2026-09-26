import { helpText, OFF_TOPIC_TEXT, isFollowUp, parseIndex, route } from './intent.js';
import { fetchDaily, fetchHot, fetchLatest, fetchSearch, fetchStory, storyIdFromLink } from './aihot.js';
import { grokBrief, mergeDigestItems, parseDigestItems } from './grok.js';
import {
  aaItemMarkdown,
  aaToMarkdown,
  buildAaCard,
  buildCodexCard,
  buildCodexEventCard,
  codexEventMarkdown,
  codexToMarkdown,
  itemsToMarkdown,
} from './card.js';
import { fetchAaIndex } from './aa.js';
import { fetchCodexResets } from './codex.js';
import { consumeQuota } from './quota.js';

/** @type {Map<string, { at: number, evidence: object, items: object[] }>} */
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

function sessionKey(chatId, openId) {
  return `${chatId}:${openId}`;
}

function remember(chatId, openId, evidence) {
  const items = evidence.items || evidence.reports || evidence.models || [];
  sessions.set(sessionKey(chatId, openId), { at: Date.now(), evidence, items });
}

function aaReply(board) {
  return {
    markdown: aaToMarkdown(board),
    card: buildAaCard(board),
    usedGrok: false,
    intent: 'aa',
  };
}

function codexReply(cal) {
  return {
    markdown: codexToMarkdown(cal),
    card: buildCodexCard(cal),
    usedGrok: false,
    intent: 'codex',
  };
}

function recall(chatId, openId) {
  const row = sessions.get(sessionKey(chatId, openId));
  if (!row) return null;
  if (Date.now() - row.at > SESSION_TTL_MS) {
    sessions.delete(sessionKey(chatId, openId));
    return null;
  }
  return row;
}

async function loadEvidence(intent) {
  if (intent.kind === 'hot') return fetchHot();
  if (intent.kind === 'daily') return fetchDaily(intent.date);
  if (intent.kind === 'search') return fetchSearch(intent);
  return fetchLatest({
    window: intent.window || '24h',
    category: intent.category,
    mode: 'selected',
    limit: 8,
  });
}

async function followUpEvidence(text, prev) {
  const n = parseIndex(text);
  if (n && prev.items[n - 1]) {
    const item = prev.items[n - 1];
    const storyId = storyIdFromLink(item.story);
    if (storyId) {
      try {
        return await fetchStory(storyId);
      } catch {
        return { kind: 'item', item, note: '事件页暂不可用，下面是该条本身' };
      }
    }
    return { kind: 'item', item };
  }
  return {
    kind: 'follow-up',
    question: text,
    previous: prev.evidence,
  };
}

/**
 * @returns {Promise<{ markdown: string, usedGrok: boolean }>}
 */
export async function answer({ text, chatId, openId, style = 'chat' }) {
  const intent = route(text);
  if (intent.kind === 'help') return { markdown: helpText(), usedGrok: false, intent: intent.kind };
  if (intent.kind === 'off-topic') return { markdown: OFF_TOPIC_TEXT, usedGrok: false, intent: intent.kind };

  const prev = isFollowUp(text) ? recall(chatId, openId) : null;
  if (intent.kind === 'aa' || (prev?.evidence?.kind === 'aa' && isFollowUp(text))) {
    if (prev?.evidence?.kind === 'aa') {
      const n = parseIndex(text);
      if (n && prev.items[n - 1]) {
        return { markdown: aaItemMarkdown(prev.items[n - 1]), usedGrok: false, intent: 'aa-item' };
      }
      if (intent.kind !== 'aa') return aaReply(prev.evidence);
    }
    const board = await fetchAaIndex();
    remember(chatId, openId, board);
    return aaReply(board);
  }

  if (intent.kind === 'codex' || (prev?.evidence?.kind === 'codex' && isFollowUp(text))) {
    if (prev?.evidence?.kind === 'codex') {
      const n = parseIndex(text);
      if (n && prev.items[n - 1]) {
        const event = prev.items[n - 1];
        return {
          markdown: codexEventMarkdown(event),
          card: buildCodexEventCard(event, prev.evidence),
          usedGrok: false,
          intent: 'codex-item',
        };
      }
      if (intent.kind !== 'codex') return codexReply(prev.evidence);
    }
    const cal = await fetchCodexResets();
    remember(chatId, openId, cal);
    return codexReply(cal);
  }

  let evidence;
  if (isFollowUp(text)) {
    evidence = prev ? await followUpEvidence(text, prev) : await loadEvidence(route(text));
  } else {
    evidence = await loadEvidence(intent);
  }

  consumeQuota(openId);
  remember(chatId, openId, evidence);
  if (style === 'digest') {
    let generated = [];
    let usedGrok = false;
    try {
      generated = parseDigestItems(await grokBrief({ question: text, evidence, style }));
      usedGrok = generated.length > 0;
    } catch (err) {
      console.error(new Date().toISOString(), 'digest grok failed, using source items', err.message || err);
    }
    const items = mergeDigestItems(generated, evidence);
    return {
      markdown: itemsToMarkdown(items),
      items,
      usedGrok,
      intent: intent.kind,
    };
  }
  const markdown = await grokBrief({ question: text, evidence, style });
  return { markdown, usedGrok: true, intent: intent.kind };
}
