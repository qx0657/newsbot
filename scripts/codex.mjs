import '../src/net.js';
import { chatAllowlist, openDb } from '../src/quota.js';
import { sendCodexCalendar } from '../src/codex-watch.js';

const args = process.argv.slice(2);
const chatIdx = args.indexOf('--chat');
const chatId = chatIdx >= 0 ? String(args[chatIdx + 1] || '').trim() : '';

openDb();
const chats = chatId ? [chatId] : chatAllowlist();
if (!chats.length) {
  console.log('没有目标群。用 --chat oc_xxx 指定，或先在后台打开「开通」。');
  process.exit(0);
}

const result = await sendCodexCalendar(chats);
if (result.failed.length) {
  console.error(result.failed.join('\n'));
  process.exit(1);
}
console.log('ok', result.sent.join(','));
