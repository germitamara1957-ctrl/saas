/**
 * Authenticated fetch wrapper.
 *
 * Uses credentials: "include" to send the httpOnly auth_token cookie
 * automatically. No need to read or manage tokens in JavaScript.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
