import '../src/net.js';
import { config } from '../src/config.js';
import { authStatus, pollDeviceAuth, startDeviceAuth } from '../src/xai-token.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const existing = authStatus();
if (existing.present && !existing.expired) {
  console.log(`已经登录过了：${existing.email || '(未知账号)'}`);
  console.log(`凭据文件：${config.paths.xaiAuth}`);
  console.log('要换账号就先删掉这个文件再跑。不要和其他项目共用这份 xai-auth.json。');
  process.exit(0);
}

console.log('正在向 auth.x.ai 申请配对码…\n');
const { userCode, deviceCode, verificationUrl, interval } = await startDeviceAuth();

console.log('  在浏览器打开：', verificationUrl);
console.log('  配对码：      ', userCode);
console.log('\n等待确认…');

let waited = 0;
const TIMEOUT_S = 300;
let step = interval;

while (waited < TIMEOUT_S) {
  await sleep(step * 1000);
  waited += step;
  const result = await pollDeviceAuth({ deviceCode });
  if (result.status === 'done') {
    const status = authStatus();
    console.log(`\n✓ 登录成功：${status.email || '(未返回邮箱)'}`);
    console.log(`  凭据已写入 ${config.paths.xaiAuth}`);
    console.log(`  过期时间 ${status.expiresAt}（临近会自动刷新）`);
    process.exit(0);
  }
  if (result.slowDown) step += 5;
  process.stdout.write('.');
}

console.error('\n✗ 超时，配对码已失效。重新跑一次即可。');
process.exit(1);
