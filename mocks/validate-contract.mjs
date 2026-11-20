import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const contractUrl = new URL('../docs/api/openapi.json', import.meta.url);
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

export async function loadContract() {
  return SwaggerParser.dereference(fileURLToPath(contractUrl));
}

export function createAjv() {
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
}

const routeRegex = template =>
  new RegExp(`^${template.split(/(\{[^}]+\})/).map(part => (part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);

export function createResponseValidator(contract) {
  const ajv = createAjv();
  const routes = Object.entries(contract.paths).map(([template, item]) => ({ template, item, regex: routeRegex(template) }));
  const compiled = new Map();
  const compile = (schema, id) => {
    if (!compiled.has(id)) compiled.set(id, ajv.compile(schema));
    return compiled.get(id);
  };
  return function validate(method, path, status, body) {
    const pathname = String(path).split('?')[0];
    const verb = String(method).toLowerCase();
    const route = routes.find(r => r.regex.test(pathname) && r.item[verb]);
    if (!route) throw new Error(`No contract route for ${verb.toUpperCase()} ${pathname}`);
    const response = route.item[verb].responses?.[String(status)] ?? route.item[verb].responses?.default;
    if (!response) throw new Error(`Status ${status} is not declared for ${verb.toUpperCase()} ${route.template}`);
    const content = response.content;
    if (!content) {
      if (body !== undefined && body !== null && body !== '') throw new Error(`${verb.toUpperCase()} ${route.template} ${status} declares no body`);
      return true;
    }
    const media = content['application/json'];
    if (!media) return true;
    const check = compile(media.schema, `${verb} ${route.template} ${status}`);
    if (!check(body)) {
      throw new Error(`${verb.toUpperCase()} ${route.template} ${status} violates contract: ${ajv.errorsText(check.errors)}`);
    }
    return true;
  };
}

export async function validateContract() {
  const file = fileURLToPath(contractUrl);
  await SwaggerParser.validate(file);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  if (!String(raw.openapi).startsWith('3.1')) throw new Error('openapi must be 3.1.x');
  const doc = await SwaggerParser.dereference(file);
  const ajv = createAjv();
  let count = 0;
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    try { ajv.compile(schema); count++; } catch (e) { throw new Error(`Schema ${name} does not compile: ${e.message}`); }
  }
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS.filter(m => item[m])) {
      const operation = item[method];
      if (!operation.operationId) throw new Error(`${method} ${path} lacks operationId`);
      for (const [status, response] of Object.entries(operation.responses)) {
        for (const [type, media] of Object.entries(response.content ?? {})) {
          try { ajv.compile(media.schema); count++; } catch (e) { throw new Error(`${method} ${path} ${status} ${type}: ${e.message}`); }
        }
      }
      for (const parameter of operation.parameters ?? []) ajv.compile(parameter.schema);
      for (const media of Object.values(operation.requestBody?.content ?? {})) ajv.compile(media.schema);
    }
  }
  return { paths: Object.keys(doc.paths).length, schemasCompiled: count };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  validateContract().then(
    result => console.log(`OpenAPI contract valid: ${result.paths} paths, ${result.schemasCompiled} schemas compiled`),
    error => { console.error(error.message); process.exitCode = 1; }
  );
}
