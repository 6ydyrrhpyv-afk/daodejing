// 分步练习前端配置（gitignore，不进仓库）。
// 只放「后端访问地址」与「无登录测试入口的限流 token」，绝不放大模型密钥。
// PRACTICE_ACCESS_TOKEN 必须与后端 .env 的 PRACTICE_ACCESS_TOKEN 一致。
export const PRACTICE_ACCESS_TOKEN = 'be92040dc23f3e1b6b38bcdf8e73565c82e8f07598b197c6';
// 后端 API 基址：本地同源留空（走相对 /api/config、/api/practice/next）。
// 生产（GitHub Pages 异域调自有后端）改为你的后端地址，如 'https://api.你的域名'。
export const PRACTICE_API_BASE = 'https://ddj-practice-proxy.8nj5s9sdfd.workers.dev';
