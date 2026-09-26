import '../src/net.js';
import { runMorning } from '../src/morning.js';

const result = await runMorning();
if (result.skipped) {
  console.log('没有待发早报的群（未打开早报，未到点，或今日已发过），跳过。');
  process.exit(0);
}
if (!result.sent.length) process.exit(1);
if (result.failed.length) process.exit(1);
console.log('ok', result.day, result.sent.length);
