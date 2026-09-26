import { brandConfig } from './config.js';

export class AppError extends Error {
  constructor(code, status = 400, message = '') {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export const CODES = {
  XAI_AUTH_REQUIRED: 'XAI_AUTH_REQUIRED',
  XAI_QUOTA_EXHAUSTED: 'XAI_QUOTA_EXHAUSTED',
  XAI_DEVICE_FAILED: 'XAI_DEVICE_FAILED',
  XAI_DEVICE_RATE_LIMITED: 'XAI_DEVICE_RATE_LIMITED',
  XAI_UPSTREAM: 'XAI_UPSTREAM',
  AIHOT_FAILED: 'AIHOT_FAILED',
  AA_FAILED: 'AA_FAILED',
  CODEX_FAILED: 'CODEX_FAILED',
  QUOTA_USER: 'QUOTA_USER',
  QUOTA_GLOBAL: 'QUOTA_GLOBAL',
  NOT_ALLOWED: 'NOT_ALLOWED',
  BUSY: 'BUSY',
  INVALID_INPUT: 'INVALID_INPUT',
};

export function userMessage(err) {
  const code = err instanceof AppError ? err.code : '';
  switch (code) {
    case CODES.XAI_AUTH_REQUIRED:
      return 'Grok 订阅登录失效，需要站主重新跑一次 device-code。';
    case CODES.XAI_QUOTA_EXHAUSTED:
      return '这会儿 Grok 周额度紧，稍后再问。';
    case CODES.XAI_UPSTREAM:
      return 'Grok 暂时没回上，稍后再试。';
    case CODES.AIHOT_FAILED:
      return '资讯暂时没查到，过一两分钟再试。';
    case CODES.AA_FAILED:
      return 'AA 榜这会儿没拉到，过一两分钟再试。';
    case CODES.CODEX_FAILED:
      return 'Tibo 重置日历这会儿没拉到，过一两分钟再试。';
    case CODES.QUOTA_USER:
      return '你今天的询问次数用完了，明天再来。';
    case CODES.QUOTA_GLOBAL:
      return '今天全群额度用完了，留给站主自己的 Grok 用。';
    case CODES.NOT_ALLOWED:
      return denyHint('group');
    case CODES.BUSY:
      return '上一条还在查，等我回完再问。';
    default:
      return '刚才没查成，换个问法，或问「今天」「热点」「日报」「Tibo重置」。';
  }
}

/** 未开通时的提示。不走 Grok。 */
export function denyHint(chatType) {
  if (chatType === 'p2p') {
    return '私聊还没开通。请到已开通的群里 @ 我提问。';
  }
  if (chatType === 'group' || chatType === 'topic_group') {
    return `这个群还没开通。站主在 ${brandConfig().name} 后台打开对应开关即可。`;
  }
  return '';
}
