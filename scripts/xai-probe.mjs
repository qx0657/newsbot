import '../src/net.js';
import { config } from '../src/config.js';
import { grokBrief } from '../src/grok.js';
import { authStatus } from '../src/xai-token.js';

const status = authStatus();
if (!status.present) {
  console.error('还没登录。先 npm run xai:login');
  process.exit(1);
}

const text = await grokBrief({
  question: '用一句话说明你只能做 AI 资讯简报。',
  evidence: { items: [] },
  maxTokens: 80,
});
console.log('model:', config.xaiModel);
console.log('email:', status.email);
console.log('reply:', text);
