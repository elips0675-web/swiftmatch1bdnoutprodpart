import { config } from './env'
import { getToken } from './token'
import { refreshAuthToken, notifyUnauthorized } from './auth-refresh'

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  timeout?: number
  retries?: number
}

interface ApiError {
  message: string
  status: number
  code?: string
}

class ApiClient {
  private baseUrl: string
  private defaultTimeout: number
  private maxRetries: number

  constructor() {
    this.baseUrl = config.apiUrl
    this.defaultTimeout = 10000
    this.maxRetries = 3
  }

  private getToken(): string | null {
    return getToken()
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      })
    }
    return url.toString()
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      body,
      params,
      timeout = this.defaultTimeout,
      retries = this.maxRetries,
      headers: extraHeaders,
      ...rest
    } = options

    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders as Record<string, string>),
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      ...rest,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }

    let refreshed = false
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(this.buildUrl(path, params), fetchOptions)

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}))
          const error: ApiError = {
            message: errorBody.message || `HTTP ${response.status}`,
            status: response.status,
            code: errorBody.code,
          }

          if (response.status === 401 && !refreshed) {
            refreshed = true
            const newToken = await refreshAuthToken()
            if (newToken) {
              headers['Authorization'] = `Bearer ${newToken}`
              continue
            }
            const { clearToken } = await import('./token')
            clearToken()
            notifyUnauthorized()
          }

          throw error
        }

        const data = await response.json()
        return data as T
      } catch (error) {
        const isLastAttempt = attempt === retries

        if (error instanceof DOMException && error.name === 'AbortError') {
          throw { message: 'Request timed out', status: 408 } as ApiError
        }

        if (!isLastAttempt) {
          const delay = Math.min(1000 * 2 ** attempt, 5000)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }

        throw error
      } finally {
        clearTimeout(timeoutId)
      }
    }

    throw { message: 'Unexpected error', status: 500 } as ApiError
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body })
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, { ...options, body })
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body })
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options)
  }
}

export const api = new ApiClient()
export type { ApiError }
