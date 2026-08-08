export type OAuthTransaction = {
  state: string
  verifier: string
  returnTo: string
  createdAt: number
}

export type OAuthTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

export type AuthSession = {
  accessToken: string
  tokenType: string
  expiresAt: number
}
