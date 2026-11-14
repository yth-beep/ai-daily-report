import { handleRequest } from "../_shared/handler.js";

// GET /api/feedback-events -> structured per-item feedback events
// (X-Feedback-Key). scripts/sync_feedback.py clusters these into tag weights.
export const onRequest = (context) => handleRequest(context.request, context.env);
