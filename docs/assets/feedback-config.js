// 反馈后端配置（前端）。
//
// 后端由 Cloudflare Pages Functions 提供（见 cloudflare-pages/）。
// 部署之后把地址填到 apiUrl，例如：
//   window.FEEDBACK_CONFIG = { apiUrl: "https://ai-daily-report-feedback.pages.dev" };
//
// 注意：
//  - 这里只放后端的公开地址，不放反馈密钥（FEEDBACK_KEY）。
//  - 密钥由用户在各设备首次点击「加重/减轻」时输入，仅保存在该浏览器的 localStorage。
//  - apiUrl 留空时，日报页的按钮会禁用并提示先部署后端。
window.FEEDBACK_CONFIG = {
  apiUrl: "https://ai-daily-report-feedback.pages.dev"
};
