const BASE = ''  // Same origin in production, proxied in dev

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const hasBody = opts.body != null && typeof opts.body === 'object' && !(opts.body instanceof FormData)
  const headers: Record<string, string> = hasBody ? { 'Content-Type': 'application/json' } : {}

  const res = await fetch(BASE + '/api' + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string> || {}) },
    body: hasBody ? JSON.stringify(opts.body) : opts.body as BodyInit | null,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export async function healthApi(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(BASE + '/health')
    return await res.json()
  } catch {
    return null
  }
}
