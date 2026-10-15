// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) GET on node:http /
// node:https (the OpenSprinkler API is GET only, every parameter in the query).
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory controller (test/helpers/fakeOpenSprinkler.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A /ja answer of a 200-station controller with 40 programs stays far below.
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, body: string }>}
 */
export function httpGet(url, { timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: 'GET',
        // The controller serves one client at a time: never keep it busy.
        headers: { accept: 'application/json', connection: 'close' },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end();
  });
}
