import { ProxyAgent } from 'proxy-agent';
import type { Agent as HttpAgent } from 'node:http';

const SUPPORTED = /^(https?|socks5h?|socks4):\/\//;

/**
 * Build an http.Agent for grammY/node-fetch from a proxy URL.
 *
 * Supported schemes:
 *   - http://    - HTTP CONNECT
 *   - https://   - HTTP CONNECT over TLS
 *   - socks5://  - SOCKS5 (DNS resolved by client)
 *   - socks5h:// - SOCKS5 (DNS resolved by proxy)
 *   - socks4://  - SOCKS4
 *
 * Returns null when `url` is empty/undefined → caller should treat that as "no proxy".
 */
export function createTelegramProxyAgent(url: string | undefined): HttpAgent | null {
  if (!url) return null;
  if (!SUPPORTED.test(url)) {
    throw new Error(`Unsupported TELEGRAM_PROXY_URL scheme: ${url}`);
  }
  // proxy-agent's ProxyAgent reads the URL passed via `getProxyForUrl` callback.
  return new ProxyAgent({ getProxyForUrl: () => url }) as unknown as HttpAgent;
}
