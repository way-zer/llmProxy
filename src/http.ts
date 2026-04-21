// ─── Shared HTTP helpers ───────────────────────────────────

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
} as const;

/** JSON response with CORS headers */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** Error JSON response */
export function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** Safely parse JSON body from a Request, returning an error Response on failure */
export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T | Response> {
  try {
    return (await req.json()) as T;
  } catch {
    return err('Invalid JSON body');
  }
}
