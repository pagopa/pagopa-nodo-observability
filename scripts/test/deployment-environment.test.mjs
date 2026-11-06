import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeploymentEnvironment } from '../deployment-environment.mjs';

test('creates a production environment with a normalized API base URL', () => {
  const environment = createDeploymentEnvironment('https://api.example.com/nodo/');

  assert.match(environment, /production: true/);
  assert.match(environment, /apiBaseUrl: "https:\/\/api\.example\.com\/nodo"/);
});

test('rejects API URLs that are not absolute HTTPS URLs', () => {
  assert.throws(() => createDeploymentEnvironment('http://api.example.com'), /HTTPS URL/);
  assert.throws(() => createDeploymentEnvironment('/api'), /HTTPS URL/);
});

test('rejects API URLs containing credentials or query parameters', () => {
  const urlWithCredentials = new URL('https://api.example.com');
  urlWithCredentials.username = 'user';
  assert.throws(
    () => createDeploymentEnvironment(urlWithCredentials.toString()),
    /must not contain/,
  );
  assert.throws(
    () => createDeploymentEnvironment('https://api.example.com?key=value'),
    /must not contain/,
  );
  assert.throws(() => createDeploymentEnvironment('https://api.example.com?'), /must not contain/);
  assert.throws(() => createDeploymentEnvironment('https://api.example.com#'), /must not contain/);
});
