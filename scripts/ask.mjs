import '../src/net.js';
import { openDb } from '../src/quota.js';
import { answer } from '../src/brief.js';

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('用法：npm run ask -- 今天有什么');
  process.exit(1);
}
openDb();
const { markdown, card, usedGrok } = await answer({ text, chatId: 'cli', openId: 'cli' });
console.log(usedGrok ? '(grok)' : '(local)');
if (card) console.log('(card)');
console.log(markdown);
