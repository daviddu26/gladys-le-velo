// -----------------------------------------------------------------------------
// HTTP access to the Le Vélo open data.
//
// Every request goes through `fetchJson`: a timeout (an API that hangs must
// not hold a poll or a button past what Gladys waits for), and a User-Agent
// naming the integration, so that the data producer can tell who is reading
// and how to reach the maintainer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const USER_AGENT = `gladys-le-velo/${pkg.version} (+https://github.com/daviddu26/gladys-le-velo)`;

// Gladys waits 15 s for an action: a request must give up well before, so the
// caller still has time to say why.
const TIMEOUT_MS = 10_000;

/**
 * Error raised when the Le Vélo API does not answer what was expected. It
 * carries the bilingual explanation shown to the user (action messages,
 * connection status).
 */
export class VeloApiError extends Error {
  /**
   * @param {string} message technical message, for the logs
   * @param {{ status?: number, userMessage?: { en: string, fr: string } }} [details]
   */
  constructor(message, { status, userMessage } = {}) {
    super(message);
    this.name = 'VeloApiError';
    this.status = status;
    this.userMessage = userMessage ?? {
      en: 'The Le Vélo real-time service does not answer right now: try again in a few minutes.',
      fr: 'Le service temps réel Le Vélo ne répond pas pour l’instant : réessayez dans quelques minutes.',
    };
  }
}

/**
 * GET a JSON document.
 * @param {string} url
 * @returns {Promise<unknown>}
 * @throws {VeloApiError}
 */
export async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new VeloApiError(`Le Vélo API unreachable: ${err.message}`);
  }
  if (!response.ok) {
    throw new VeloApiError(`Le Vélo API answered HTTP ${response.status}`, {
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (err) {
    throw new VeloApiError(`Le Vélo API answered something that is not JSON: ${err.message}`);
  }
}

/**
 * GET a binary document (a map tile).
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 * @throws {VeloApiError}
 */
export async function fetchBuffer(url, { timeoutMs = TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new VeloApiError(`${new URL(url).host} unreachable: ${err.message}`);
  }
  if (!response.ok) {
    throw new VeloApiError(`${new URL(url).host} answered HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return Buffer.from(await response.arrayBuffer());
}
