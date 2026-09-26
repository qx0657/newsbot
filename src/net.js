/**
 * 必须是入口的第一个 import。本机/香港机没有可用 IPv6，DNS 仍返回 AAAA。
 */
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
