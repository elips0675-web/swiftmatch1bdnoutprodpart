export interface EnvConfig {
  apiUrl: string
}

export const config: EnvConfig = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '/api',
}
