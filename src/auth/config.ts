export const oauthConfig = {
  clientId: 'fe-web',
  redirectUri: 'https://fe-web.lastudio.cc/auth/callback',
  authorizeUrl: 'https://auth.lastudio.cc/oauth/authorize',
  tokenUrl: 'https://api.lastudio.cc/oauth/token',
  apiUrl: 'https://api.lastudio.cc',
  scope: 'profile homework',
  logoutUrl: 'https://auth.lastudio.cc/logout',
} as const

export const oauthTransactionStorageKey = 'fe-web.oauth-transaction'
export const oauthTransactionMaxAgeMs = 10 * 60 * 1000
