import { handleRequest } from "../_shared/handler.js";

// POST /api/feedback -> apply one +1 / -1 delta (X-Feedback-Key).
export const onRequest = (context) => handleRequest(context.request, context.env);
