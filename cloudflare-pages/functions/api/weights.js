import { handleRequest } from "../_shared/handler.js";

// GET /api/weights -> current cumulative weights (X-Feedback-Key).
export const onRequest = (context) => handleRequest(context.request, context.env);
