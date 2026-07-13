import test from 'node:test';
import assert from 'node:assert/strict';

import { pickCrewRoute } from '../src/crew-router.mjs';

test('crew filters incompatible routes and deterministically prefers a warm local route', () => {
  const picked = pickCrewRoute([
    { id: 'remote', lifecycle: 'running', locality: 'remote', status: 'online', capabilities: ['text', 'tools'], active: 0, maxConcurrency: 2, latencyMs: 20 },
    { id: 'paused', lifecycle: 'paused', locality: 'cloud', status: 'paused', capabilities: ['text', 'tools'], active: 0, maxConcurrency: 2, latencyMs: 10 },
    { id: 'local', lifecycle: 'running', locality: 'local', status: 'online', capabilities: ['text', 'tools'], active: 1, maxConcurrency: 4, latencyMs: 40 },
    { id: 'no-tools', lifecycle: 'running', locality: 'local', status: 'online', capabilities: ['text'], active: 0, maxConcurrency: 4, latencyMs: 1 },
  ], { capabilities: ['text', 'tools'] });
  assert.equal(picked.id, 'local');
});

test('crew excludes saturated and offline routes then uses priority before load', () => {
  const picked = pickCrewRoute([
    { id: 'offline', lifecycle: 'running', locality: 'local', status: 'offline', capabilities: ['text'], active: 0, maxConcurrency: 4, priority: 99 },
    { id: 'full', lifecycle: 'running', locality: 'local', status: 'online', capabilities: ['text'], active: 2, maxConcurrency: 2, priority: 99 },
    { id: 'priority', lifecycle: 'running', locality: 'remote', status: 'online', capabilities: ['text'], active: 1, maxConcurrency: 2, priority: 5 },
    { id: 'idle', lifecycle: 'running', locality: 'local', status: 'online', capabilities: ['text'], active: 0, maxConcurrency: 2, priority: 0 },
  ], { capabilities: ['text'] });
  assert.equal(picked.id, 'priority');
});

test('crew returns null when no route satisfies the request', () => {
  assert.equal(pickCrewRoute([{ id: 'text', status: 'online', lifecycle: 'running', capabilities: ['text'], active: 0, maxConcurrency: 1 }], { capabilities: ['vision'] }), null);
});

test('crew can route to a busy daemon when it still advertises spare concurrency', () => {
  const picked = pickCrewRoute([
    { id: 'busy', status: 'busy', lifecycle: 'running', capabilities: ['text'], active: 1, maxConcurrency: 3 },
  ], { capabilities: ['text'] });
  assert.equal(picked?.id, 'busy');
});
