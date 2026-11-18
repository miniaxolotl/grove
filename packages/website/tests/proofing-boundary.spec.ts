import { expect, test } from '@playwright/test';
import { proofingRoute, boundedProofingBody } from '../src/lib/writing/bff';

test('proofing methods and streamed payloads are explicitly bounded', async () => {
  expect(proofingRoute('proofing/check', 'POST')).toBe(true);
  expect(proofingRoute('proofing/consent', 'GET')).toBe(true);
  expect(proofingRoute('proofing/consent', 'PUT')).toBe(true);
  for (const [path, method] of [['proofing/check', 'GET'], ['proofing/check/next', 'POST'], ['proofing/consent', 'POST']])
    expect(proofingRoute(path!, method!)).toBe(false);
  const oversized = new Response(new Uint8Array(16385));
  expect(await boundedProofingBody(oversized.body)).toBe(null);
  expect(await boundedProofingBody(new Response('short').body)).toBe('short');
});
