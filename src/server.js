import './net.js';
import http from 'node:http';
import { brandConfig, config, feishuConfigured } from './config.js';
import { handleHttp } from './admin.js';
import { startMorningTick } from './morning.js';
import { startCodexTick } from './codex-watch.js';
import { openDb } from './quota.js';
import { startFeishu } from './feishu.js';
import { startTokenKeeper } from './xai-token.js';

openDb();

const server = http.createServer((req, res) => {
  handleHttp(req, res).catch((err) => {
    console.error('http', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('error');
    }
  });
});

server.listen(config.port, config.host, () => {
  console.log(new Date().toISOString(), `${brandConfig().name} http://${config.host}:${config.port}/`);
});

if (feishuConfigured()) {
  startFeishu().catch((err) => {
    console.error('feishu start failed', err);
  });
} else {
  console.log(
    new Date().toISOString(),
    '飞书未配置：在后台填写应用 ID 和密钥，或写 FEISHU_APP_ID / FEISHU_APP_SECRET。后台仍可开。',
  );
}

startMorningTick();
startCodexTick();
startTokenKeeper();
