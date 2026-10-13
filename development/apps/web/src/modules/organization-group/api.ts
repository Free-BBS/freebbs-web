import type { RequestOptions } from '../../core/api/client.js';
export function jsonOptions(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestOptions {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
