// 反馈后端配置（前端）。
// 部署 Cloudflare Worker 后，把 apiUrl 填成你的 Worker 地址，例如：
//   window.FEEDBACK_CONFIG = { apiUrl: "https://ai-daily-report-feedback.xxx.workers.dev" };
//
// 注意：
//  - 这里只放 Worker 的公开 URL，不放反馈密钥（FEEDBACK_KEY）。
//  - 密钥由用户在各设备首次使用时输入，仅保存在该浏览器的 localStorage。
//  - apiUrl 留空时，日报页的「加重/减轻」按钮会禁用并提示先部署后端。
window.FEEDBACK_CONFIG = {
  apiUrl: ""
};
