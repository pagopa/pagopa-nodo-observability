import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeploymentEnvironment, createEntraConfig } from '../deployment-environment.mjs';

const ENTRA = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
};

test('creates a production environment with a normalized API base URL', () => {
  const environment = createDeploymentEnvironment('https://api.example.com/nodo/', ENTRA);

  assert.match(environment, /production: true/);
  assert.match(environment, /apiBaseUrl: "https:\/\/api\.example\.com\/nodo"/);
});

test('rejects API URLs that are not absolute HTTPS URLs', () => {
  assert.throws(() => createDeploymentEnvironment('http://api.example.com', ENTRA), /HTTPS URL/);
  assert.throws(() => createDeploymentEnvironment('/api', ENTRA), /HTTPS URL/);
});

test('rejects API URLs containing credentials or query parameters', () => {
  const urlWithCredentials = new URL('https://api.example.com');
  urlWithCredentials.username = 'user';
  assert.throws(
    () => createDeploymentEnvironment(urlWithCredentials.toString(), ENTRA),
    /must not contain/,
  );
  assert.throws(
    () => createDeploymentEnvironment('https://api.example.com?key=value', ENTRA),
    /must not contain/,
  );
  assert.throws(() => createDeploymentEnvironment('https://api.example.com?', ENTRA), /must not contain/);
  assert.throws(() => createDeploymentEnvironment('https://api.example.com#', ENTRA), /must not contain/);
});

test('emits the Entra ID settings', () => {
  const environment = createDeploymentEnvironment('https://api.example.com', {
    ...ENTRA,
    redirectUri: ' https://example.com/ui/ ',
    scopes: 'api://nodo/Read, User.Read',
  });
  assert.match(environment, /tenantId: "11111111-2222-3333-4444-555555555555"/);
  assert.match(environment, /clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"/);
  assert.match(environment, /redirectUri: "https:\/\/example\.com\/ui\/"/);
  assert.match(environment, /scopes: \["api:\/\/nodo\/Read","User\.Read"\]/);
  assert.deepEqual(createEntraConfig({ ...ENTRA, tenantId: 'pagopa.it' }).scopes, []);
});

test('rejects missing or malformed Entra ID settings', () => {
  for (const tenantId of [undefined, '', 'REPLACE_WITH_ENTRA_TENANT_ID', 'a"b.it']) {
    assert.throws(() => createEntraConfig({ ...ENTRA, tenantId }), /ENTRA_TENANT_ID/);
  }
  for (const clientId of [undefined, '', 'not-a-guid', 'REPLACE_WITH_ENTRA_CLIENT_ID']) {
    assert.throws(() => createEntraConfig({ ...ENTRA, clientId }), /ENTRA_CLIENT_ID/);
  }
  for (const redirectUri of ['http://example.com/', '/ui/', 'https://example.com/?x=1', 'https://example.com/#a']) {
    assert.throws(() => createEntraConfig({ ...ENTRA, redirectUri }), /ENTRA_REDIRECT_URI/);
  }
  assert.throws(() => createEntraConfig({ ...ENTRA, scopes: 'ok "bad"' }), /ENTRA_SCOPES/);
});
