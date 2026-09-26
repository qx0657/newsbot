# newsbot

飞书群里的 AI 资讯机器人，管理后台和机器人在同一个进程里。

资料来自 [AIHOT](https://aihot.virxact.com) 的公开只读接口。Grok 订阅把结果收成中文简报。问 **AA榜** 或 **Tibo重置** 时直接发卡片，不经过 Grok。

这是一份可以自己部署的模板。名字、英文名和一句话介绍写在 `.env`，后台标题和群里的自我介绍会跟着变。

## 它会做什么

- 已开通的群里，@ 机器人才回答
- 每个群可以单独订早报，全站同一个时间
- 问今天、热点、日报，或某个公司、模型
- 问 AA榜 / 模型榜，发 [Artificial Analysis](https://artificialanalysis.ai/) 首页默认对比组的卡片
- 问 Tibo重置 / Codex 额度，发重置日历卡片；新预告推到已开通的群

它不是通用助手，不写代码，不闲聊，也不替你搜索网页。

## 跑起来

需要 Node.js 24 或更新。

```bash
cp .env.example .env
chmod 600 .env
npm install
npm test
npm run xai:login
npm start
```

后台在 `http://127.0.0.1:3520/`。飞书还没填时后台可以开，长连接不会启动。

本地看界面样例：`http://127.0.0.1:3520/?demo`

## 配置

字段见 `.env.example`。

- `BOT_NAME`、`BOT_NAME_EN`、`BOT_TAGLINE`：对外名称
- 飞书应用 ID 和密钥可以写在 `.env`，也可以在后台「设置」里保存。后台保存的写到 `data/feishu-auth.json`，优先于环境变量
- Grok 登录写到 `data/xai-auth.json`。这是官方 device-code，不是 `XAI_API_KEY`

`.env`、`data/` 和这两份凭据都不要提交。

飞书侧建一个企业自建应用，打开机器人，用长连接订阅 `im.message.receive_v1`，并发布这些权限：

- `im:message.group_at_msg:readonly`
- `im:message:send_as_bot`
- `im:chat:read`（后台要列出群名）
- `im:message.p2p_msg:readonly`（要用私聊时）

改完权限要重新发一版。头像和文案见 [`brand/README.md`](brand/README.md)。

## Docker

```bash
docker compose up -d --build
```

端口绑在 `127.0.0.1:3520`。管理后台没有自带登录，里面可以改飞书密钥和群开关。给别人访问之前，在前面加你自己的 HTTPS 反代和访问控制。

## 许可

[MIT](LICENSE)
