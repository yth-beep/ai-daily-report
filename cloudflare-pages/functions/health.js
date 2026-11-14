import { handleRequest } from "./_shared/handler.js";

// GET /health -> { ok, version }. No key required.
export const onRequest = (context) => handleRequest(context.request, context.env);
