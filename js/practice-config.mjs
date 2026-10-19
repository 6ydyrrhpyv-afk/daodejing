// 分步练习前端配置。本仓库是公开的，故本文件随站点一起公开——
// 这里只放「后端访问地址」与「访问令牌」，绝不放大模型密钥（模型密钥只在 Cloudflare Worker 的 secret 里）。
// 令牌公开不构成密钥泄露，滥用防护靠 Worker 的按 IP 限流（6 次/分钟、30 次/天）。
// 注：本地 .gitignore 仍忽略本文件，改完需由 publish_ddj.sh 显式推送才会上线。
// PRACTICE_ACCESS_TOKEN 必须与后端 .env 的 PRACTICE_ACCESS_TOKEN 一致。
export const PRACTICE_ACCESS_TOKEN = 'be92040dc23f3e1b6b38bcdf8e73565c82e8f07598b197c6';
// 后端 API 基址：本地同源留空（走相对 /api/config、/api/practice/next）。
// 生产（GitHub Pages 异域调自有后端）改为你的后端地址，如 'https://api.你的域名'。
export const PRACTICE_API_BASE = 'https://ddj-practice-proxy.8nj5s9sdfd.workers.dev';
