/**
 * Provider factory. Returns the correct OAuthProvider implementation
 * based on the provider name stored in oauth_accounts.
 */
export type { OAuthProvider, OAuthProviderType, CalendarEvent, Email, OAuthTokens, RefreshedToken } from './types.js';
export { GoogleProvider } from './google.js';
export { MicrosoftProvider } from './microsoft.js';

import type { OAuthProvider } from './types.js';
import { GoogleProvider } from './google.js';
import { MicrosoftProvider } from './microsoft.js';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getProvider(
  provider: 'google' | 'microsoft',
  config: ProviderConfig,
): OAuthProvider {
  switch (provider) {
    case 'google':
      return new GoogleProvider(config);
    case 'microsoft':
      return new MicrosoftProvider(config);
    default:
      throw new Error(`Unknown OAuth provider: ${provider}`);
  }
}
