const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Agent, fetch } = require('undici');

const TARGETS_FILE_PATH = path.join(os.homedir(), '.eda-tui', 'targets.json');
const DB_DATA_PATH = '/core/db/v2/data';
const CRD_PATH_PATTERN = /^\/apps\/([^/]+)\/([^/]+)(?:\/namespaces\/\{[^}]+\})?\/([^/]+)$/;
const DB_KEY_NAME_PATTERN = /\{\.name=="([^"]+)"\}/g;
const DB_MINIMAL_RESOURCE_FIELDS = 'apiVersion,kind,metadata.name,metadata.namespace';
const NAMESPACE_PARAM_PATTERN = /^(namespace|nsname)$/i;

const DEFAULT_API_PREFIXES = ['', '/queryapi', '/api', '/ui/main/queryapi', '/ui/main', '/ui'];
const DEFAULT_MINIMUM_RESOURCES = 1200;
const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_STREAM_LIMIT = 0;
const STREAM_ENDPOINT_CACHE_TTL_MS = 5 * 60_000;

const FAST_BOOTSTRAP_STREAMS = [
  'alarms',
  'components',
  'nodeprofiles',
  'defaultbgppeers',
  'fans',
  'queues',
  'forwardingclasss',
  'indexallocationpools',
  'interfaces',
  'defaultinterfaces',
  'powersupplies',
  'topolinks',
  'workflowdefinitions',
  'isls',
  'toponodes',
  'exports',
  'policys',
  'chassis',
  'controlmodules',
  'interfacemodules',
  'defaultrouters',
  'systeminterfaces',
  'ipallocationpools',
  'ipinsubnetallocationpools',
  'subnetallocationpools',
  'httpproxies',
  'defaultroutereflectorclients'
];

const STREAM_EXCLUDE = new Set([
  'resultsummary',
  'v1',
  'eql',
  'nql',
  'current-alarms',
  'summary',
  'directory',
  'file',
  'namespaces'
]);

const streamEndpointCache = new Map();
const dbTableCache = new Map();

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(value) {
  let normalized = String(value || '').trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizePrefix(prefix) {
  const trimmed = String(prefix || '').trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseNonNegativeInt(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function createAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 240)}`);
  }

  if (!text) {
    return undefined;
  }

  return JSON.parse(text);
}

function resolveTargetConfig(targetOverride) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(TARGETS_FILE_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${TARGETS_FILE_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(raw)) {
    throw new Error('Invalid targets.json structure. Expected an object.');
  }

  const targetUrls = Object.keys(raw).filter((key) => key.startsWith('http://') || key.startsWith('https://'));
  if (targetUrls.length === 0) {
    throw new Error('No EDA targets found in targets.json');
  }

  const normalizedOverride = toNonEmptyString(targetOverride);
  const lastTargetUrl = toNonEmptyString(raw.__lastTargetUrl);

  let selectedTargetUrl;
  if (normalizedOverride && targetUrls.includes(normalizedOverride)) {
    selectedTargetUrl = normalizedOverride;
  } else if (lastTargetUrl && targetUrls.includes(lastTargetUrl)) {
    selectedTargetUrl = lastTargetUrl;
  } else {
    selectedTargetUrl = targetUrls[0];
  }

  const rawTargetEntry = raw[selectedTargetUrl];
  const targetEntry = typeof rawTargetEntry === 'string'
    ? { context: rawTargetEntry }
    : (isRecord(rawTargetEntry) ? rawTargetEntry : {});

  const credentialsStore = isRecord(raw.__credentials__) ? raw.__credentials__ : {};
  const credentialsRef = toNonEmptyString(targetEntry.credentialsRef);
  const rawCredentials = credentialsRef && isRecord(credentialsStore[credentialsRef])
    ? credentialsStore[credentialsRef]
    : {};

  const clientSecret = toNonEmptyString(targetEntry.clientSecret)
    || toNonEmptyString(targetEntry.client_secret)
    || toNonEmptyString(rawCredentials.client_secret)
    || toNonEmptyString(rawCredentials.clientSecret);

  if (!clientSecret) {
    throw new Error(`Missing client secret for target ${selectedTargetUrl}`);
  }

  return {
    targetUrl: normalizeBaseUrl(selectedTargetUrl),
    clientId: toNonEmptyString(targetEntry.clientId) || 'eda',
    clientSecret,
    edaUsername: toNonEmptyString(targetEntry.edaUsername)
      || toNonEmptyString(targetEntry.eda_username)
      || 'admin',
    edaPassword: toNonEmptyString(targetEntry.edaPassword)
      || toNonEmptyString(targetEntry.eda_password)
      || toNonEmptyString(rawCredentials.eda_password)
      || toNonEmptyString(rawCredentials.edaPassword)
      || 'admin',
    coreNamespace: toNonEmptyString(targetEntry.coreNamespace)
      || toNonEmptyString(targetEntry.core_namespace)
      || 'eda-system',
    skipTlsVerify: toBoolean(targetEntry.skipTlsVerify)
  };
}

async function endpointExists(baseUrl, dispatcher) {
  const probeUrl = `${baseUrl}/core/httpproxy/v1/keycloak/realms/eda/protocol/openid-connect/token`;
  const response = await fetch(probeUrl, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'probe' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher
  });
  return response.status !== 404;
}

async function resolveApiBaseUrl(targetUrl, dispatcher, explicitPrefix) {
  const baseUrl = normalizeBaseUrl(targetUrl);
  const prefixes = [
    explicitPrefix,
    ...DEFAULT_API_PREFIXES
  ].filter((value, index, list) => {
    if (value === undefined || value === null || value === '') {
      return index === list.indexOf(value);
    }
    return list.indexOf(value) === index;
  });

  for (const prefix of prefixes) {
    const candidate = `${baseUrl}${normalizePrefix(prefix)}`;
    try {
      if (await endpointExists(candidate, dispatcher)) {
        return candidate;
      }
    } catch {
      // Try next prefix.
    }
  }

  throw new Error(`Could not detect EDA API base URL for ${baseUrl}`);
}

async function fetchAccessToken(apiBaseUrl, target, dispatcher) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: target.clientId,
    client_secret: target.clientSecret,
    username: target.edaUsername,
    password: target.edaPassword,
    scope: 'openid'
  });

  const data = await fetchJson(
    `${apiBaseUrl}/core/httpproxy/v1/keycloak/realms/eda/protocol/openid-connect/token`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      dispatcher
    }
  );

  const token = isRecord(data) ? toNonEmptyString(data.access_token) : undefined;
  if (!token) {
    throw new Error('Authentication succeeded without an access token');
  }
  return token;
}

function extractServerRelativeURL(info) {
  if (!isRecord(info)) {
    return undefined;
  }
  if (toNonEmptyString(info.serverRelativeURL)) {
    return info.serverRelativeURL;
  }
  const ext = info['x-eda-nokia-com'];
  if (isRecord(ext) && toNonEmptyString(ext.serverRelativeURL)) {
    return ext.serverRelativeURL;
  }
  return undefined;
}

function extractPathPlaceholders(pathTemplate) {
  const placeholders = [];
  let searchFrom = 0;

  while (searchFrom < pathTemplate.length) {
    const open = pathTemplate.indexOf('{', searchFrom);
    if (open === -1) {
      break;
    }
    const close = pathTemplate.indexOf('}', open + 1);
    if (close === -1) {
      break;
    }
    const name = pathTemplate.slice(open + 1, close).trim();
    if (name) {
      placeholders.push(name);
    }
    searchFrom = close + 1;
  }

  return placeholders;
}

function collectStreamEndpoints(spec) {
  if (!isRecord(spec) || !isRecord(spec.paths)) {
    return [];
  }

  const endpoints = [];

  for (const [endpointPath, methods] of Object.entries(spec.paths)) {
    if (!isRecord(methods)) {
      continue;
    }

    const getOp = methods.get;
    if (!isRecord(getOp)) {
      continue;
    }

    const parameters = Array.isArray(getOp.parameters)
      ? getOp.parameters.filter(isRecord)
      : [];

    const names = parameters
      .map((param) => toNonEmptyString(param.name))
      .filter(Boolean);

    const requiredNames = parameters
      .filter((param) => param.required === true)
      .map((param) => toNonEmptyString(param.name))
      .filter(Boolean);

    const hasUnsupportedRequiredParams = requiredNames.some((name) => (
      name !== 'eventclient' && name !== 'stream' && !NAMESPACE_PARAM_PATTERN.test(name)
    ));

    if (hasUnsupportedRequiredParams) {
      continue;
    }

    const placeholders = extractPathPlaceholders(endpointPath);
    const hasUnsupportedPlaceholders = placeholders.some((name) => !NAMESPACE_PARAM_PATTERN.test(name));
    if (hasUnsupportedPlaceholders) {
      continue;
    }

    if (!names.includes('eventclient') || !names.includes('stream')) {
      continue;
    }

    const stream = endpointPath.split('/').filter(Boolean).pop() || 'unknown';
    const namespaceParam = placeholders.find((name) => NAMESPACE_PARAM_PATTERN.test(name));

    endpoints.push({
      path: endpointPath,
      stream,
      namespaced: placeholders.length > 0,
      namespaceParam
    });
  }

  return endpoints;
}

function deduplicateEndpoints(endpoints) {
  const selected = new Map();

  for (const endpoint of endpoints) {
    const existing = selected.get(endpoint.stream);
    if (!existing) {
      selected.set(endpoint.stream, endpoint);
      continue;
    }

    const existingHasPathParams = existing.path.includes('{');
    const endpointHasPathParams = endpoint.path.includes('{');

    if (!existingHasPathParams && endpointHasPathParams) {
      selected.set(endpoint.stream, endpoint);
      continue;
    }

    if (
      existingHasPathParams === endpointHasPathParams
      && !existing.path.startsWith('/apps')
      && endpoint.path.startsWith('/apps')
    ) {
      selected.set(endpoint.stream, endpoint);
    }
  }

  return Array.from(selected.values());
}

function streamGroupFromPath(apiPath) {
  const parts = apiPath.split('/').filter(Boolean);
  const category = parts[0] || 'core';
  const nameSegment = category === 'apps' ? parts[1] : category;
  const token = (nameSegment || 'core').split('.')[0];
  return token || 'core';
}

async function fetchStreamEndpoints(apiBaseUrl, token, dispatcher) {
  const cached = streamEndpointCache.get(apiBaseUrl);
  if (cached && (Date.now() - cached.loadedAt) < STREAM_ENDPOINT_CACHE_TTL_MS) {
    return cached.endpoints;
  }

  const rootSpec = await fetchJson(`${apiBaseUrl}/openapi/v3`, {
    headers: createAuthHeaders(token),
    dispatcher
  });

  const rootPaths = isRecord(rootSpec) && isRecord(rootSpec.paths) ? rootSpec.paths : {};
  const streamSpecs = [];

  for (const info of Object.values(rootPaths)) {
    const relUrl = extractServerRelativeURL(info);
    if (!relUrl) {
      continue;
    }

    try {
      const spec = await fetchJson(`${apiBaseUrl}${relUrl}`, {
        headers: createAuthHeaders(token),
        dispatcher
      });
      streamSpecs.push(spec);
    } catch {
      // Ignore individual spec failures.
    }
  }

  const endpoints = deduplicateEndpoints(streamSpecs.flatMap(collectStreamEndpoints));
  streamEndpointCache.set(apiBaseUrl, {
    loadedAt: Date.now(),
    endpoints
  });

  return endpoints;
}

function extractResourceName(item, metadata) {
  if (toNonEmptyString(metadata.name)) {
    return metadata.name;
  }
  if (toNonEmptyString(item.name)) {
    return item.name;
  }
  return undefined;
}

function normalizeQueryRows(rows) {
  const normalized = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    if (isRecord(row.data)) {
      normalized.push(row.data);
    } else {
      normalized.push(row);
    }
  }
  return normalized;
}

function queryRowsFromOps(holder) {
  const opsValue = holder.op || holder.Op;
  let candidates = [];

  if (Array.isArray(opsValue)) {
    candidates = opsValue.filter(isRecord);
  } else if (
    isRecord(holder.insert_or_modify)
    || isRecord(holder.Insert_or_modify)
    || isRecord(holder.insertOrModify)
    || isRecord(holder.InsertOrModify)
  ) {
    candidates = [holder];
  }

  const rows = [];
  for (const candidate of candidates) {
    const insertOrModify = candidate.insert_or_modify
      || candidate.Insert_or_modify
      || candidate.insertOrModify
      || candidate.InsertOrModify;
    if (!isRecord(insertOrModify)) {
      continue;
    }

    const opRows = insertOrModify.rows || insertOrModify.Rows;
    if (!Array.isArray(opRows)) {
      continue;
    }

    for (const row of opRows) {
      if (!isRecord(row)) {
        continue;
      }
      rows.push(isRecord(row.data) ? row.data : row);
    }
  }

  return rows;
}

function queryRowsFromUpdates(holder) {
  const updates = holder.updates || holder.Updates;
  if (!Array.isArray(updates)) {
    return [];
  }

  const rows = [];
  for (const update of updates) {
    if (!isRecord(update)) {
      continue;
    }
    rows.push(isRecord(update.data) ? update.data : update);
  }

  return rows;
}

function queryRowsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const holders = [payload.msg, payload];
  for (const holder of holders) {
    if (!isRecord(holder)) {
      continue;
    }

    const directRows = holder.data || holder.Data;
    if (Array.isArray(directRows)) {
      const normalized = normalizeQueryRows(directRows);
      if (normalized.length > 0) {
        return normalized;
      }
    } else if (isRecord(directRows)) {
      return [directRows];
    }

    const opRows = queryRowsFromOps(holder);
    if (opRows.length > 0) {
      return opRows;
    }

    const updateRows = queryRowsFromUpdates(holder);
    if (updateRows.length > 0) {
      return updateRows;
    }
  }

  return [];
}

function payloadMayContainRows(payload) {
  return (
    'items' in payload
    || 'results' in payload
    || 'Results' in payload
    || 'updates' in payload
    || 'Updates' in payload
    || 'msg' in payload
    || 'op' in payload
    || 'Op' in payload
  );
}

function resourceNounCandidatesFromPlural(plural) {
  const noun = String(plural || '').trim().toLowerCase();
  if (!noun) {
    return [];
  }

  const candidates = [];
  const push = (candidate) => {
    if (candidate.length > 0 && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (noun.endsWith('sis')) {
    push(noun);
  } else if (noun.endsWith('ies') && noun.length > 3) {
    push(`${noun.slice(0, -3)}y`);
  } else if (
    (noun.endsWith('xes') || noun.endsWith('zes') || noun.endsWith('ches') || noun.endsWith('shes'))
    && noun.length > 2
  ) {
    push(noun.slice(0, -2));
  } else if (noun.endsWith('ses') && noun.length > 3) {
    push(noun.slice(0, -1));
    push(noun.slice(0, -2));
  } else if (noun.endsWith('s') && noun.length > 1) {
    push(noun.slice(0, -1));
  }

  push(noun);
  return candidates;
}

function kindFromPlural(plural) {
  const firstCandidate = resourceNounCandidatesFromPlural(plural)[0] || plural;
  return String(firstCandidate)
    .split(/[._-]/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

function dbTableCandidatesForEndpoint(endpoint) {
  const match = endpoint.path.match(CRD_PATH_PATTERN);
  if (!match) {
    return [];
  }

  const groupToken = match[1].replace(/\./g, '_');
  const version = match[2];
  const plural = match[3];

  return resourceNounCandidatesFromPlural(plural).map(
    (noun) => `.namespace.resources.cr.${groupToken}.${version}.${noun}`
  );
}

function resourceFromDbEntry(endpoint, entryKey, entryValue, coreNamespace) {
  const pathMatch = endpoint.path.match(CRD_PATH_PATTERN);
  const fallbackApiVersion = pathMatch ? `${pathMatch[1]}/${pathMatch[2]}` : '';
  const fallbackKind = pathMatch ? kindFromPlural(pathMatch[3]) : '';

  const metadataRaw = entryValue.metadata;
  const metadata = isRecord(metadataRaw) ? metadataRaw : {};

  let name = toNonEmptyString(metadata.name) || toNonEmptyString(entryValue.name);
  let namespace = toNonEmptyString(metadata.namespace)
    || toNonEmptyString(entryValue['namespace.name'])
    || toNonEmptyString(entryValue.namespace);

  const keyNames = Array.from(String(entryKey).matchAll(DB_KEY_NAME_PATTERN))
    .map((match) => match[1])
    .filter((candidate) => candidate.length > 0);

  if (!namespace && keyNames.length >= 2) {
    namespace = keyNames[0];
  }

  if (!name && keyNames.length > 0) {
    name = keyNames[keyNames.length - 1];
  }

  if (!name) {
    return undefined;
  }

  return {
    name,
    namespace: namespace || coreNamespace,
    kind: toNonEmptyString(entryValue.kind) || fallbackKind,
    apiVersion: toNonEmptyString(entryValue.apiVersion) || fallbackApiVersion
  };
}

function mergeResourceBucket(targetMap, entries, endpoint) {
  let totalAdded = 0;
  const group = streamGroupFromPath(endpoint.path);

  for (const entry of entries) {
    if (!entry.name || !entry.namespace) {
      continue;
    }
    const key = `${endpoint.stream}|${entry.namespace}|${entry.name}`;
    if (targetMap.has(key)) {
      continue;
    }

    targetMap.set(key, {
      namespace: entry.namespace,
      group,
      stream: endpoint.stream,
      name: entry.name,
      kind: entry.kind,
      apiVersion: entry.apiVersion
    });
    totalAdded += 1;
  }

  return totalAdded;
}

function itemsFromPayload(payload) {
  if (isRecord(payload)) {
    if (Array.isArray(payload.items)) {
      return payload.items.filter(isRecord);
    }

    const rows = payload.results || payload.Results;
    if (Array.isArray(rows)) {
      return rows
        .filter(isRecord)
        .map((row) => (isRecord(row.data) ? row.data : row));
    }
  }

  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  return [];
}

function extractResourceIdentity(item, fallbackNamespace, coreNamespace) {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const name = extractResourceName(item, metadata);
  if (!name) {
    return undefined;
  }

  const namespace = toNonEmptyString(metadata.namespace)
    || toNonEmptyString(fallbackNamespace)
    || coreNamespace;

  return {
    name,
    namespace,
    kind: toNonEmptyString(item.kind),
    apiVersion: toNonEmptyString(item.apiVersion)
  };
}

async function loadDbEntriesForEndpoint(apiBaseUrl, token, dispatcher, endpoint, coreNamespace) {
  const cacheKey = `${apiBaseUrl}|${endpoint.stream}`;
  const cachedTable = dbTableCache.get(cacheKey);

  const tableCandidates = [];
  if (cachedTable) {
    tableCandidates.push(cachedTable);
  }

  for (const candidate of dbTableCandidatesForEndpoint(endpoint)) {
    if (!tableCandidates.includes(candidate)) {
      tableCandidates.push(candidate);
    }
  }

  if (tableCandidates.length === 0) {
    return undefined;
  }

  for (const tableName of tableCandidates) {
    try {
      const query = new URLSearchParams({
        fields: DB_MINIMAL_RESOURCE_FIELDS,
        jsPath: tableName
      });

      const payload = await fetchJson(`${apiBaseUrl}${DB_DATA_PATH}?${query.toString()}`, {
        headers: createAuthHeaders(token),
        dispatcher
      });

      let rows = [];
      if (isRecord(payload)) {
        const directRows = Object.entries(payload)
          .filter(([, value]) => isRecord(value))
          .map(([entryKey, value]) => ({ entryKey, row: value }));

        if (directRows.length > 0) {
          rows = directRows;
        } else if (payloadMayContainRows(payload)) {
          rows = queryRowsFromPayload(payload).map((row) => ({ entryKey: '', row }));
        }
      } else if (Array.isArray(payload)) {
        rows = payload.filter(isRecord).map((row) => ({ entryKey: '', row }));
      }

      const entries = [];
      for (const { entryKey, row } of rows) {
        const resource = resourceFromDbEntry(endpoint, entryKey, row, coreNamespace);
        if (!resource) {
          continue;
        }

        entries.push(resource);
      }

      dbTableCache.set(cacheKey, tableName);
      return entries;
    } catch {
      // Try next table candidate.
    }
  }

  if (cachedTable) {
    dbTableCache.delete(cacheKey);
  }

  return undefined;
}

async function loadApiEntriesForEndpoint(apiBaseUrl, token, dispatcher, endpoint, namespaces, coreNamespace) {
  const entries = [];

  if (endpoint.namespaced) {
    const namespaceToken = `{${endpoint.namespaceParam || 'namespace'}}`;

    for (const namespace of namespaces) {
      const resolvedPath = endpoint.path.replace(namespaceToken, encodeURIComponent(namespace));
      if (resolvedPath.includes('{')) {
        continue;
      }

      const payload = await fetchJson(`${apiBaseUrl}${resolvedPath}`, {
        headers: createAuthHeaders(token),
        dispatcher
      });

      const items = itemsFromPayload(payload);
      for (const item of items) {
        const identity = extractResourceIdentity(item, namespace, coreNamespace);
        if (identity) {
          entries.push(identity);
        }
      }
    }

    return entries;
  }

  const payload = await fetchJson(`${apiBaseUrl}${endpoint.path}`, {
    headers: createAuthHeaders(token),
    dispatcher
  });

  const items = itemsFromPayload(payload);
  for (const item of items) {
    const identity = extractResourceIdentity(item, undefined, coreNamespace);
    if (identity) {
      entries.push(identity);
    }
  }

  return entries;
}

async function listNamespaces(apiBaseUrl, token, dispatcher, coreNamespace) {
  try {
    const payload = await fetchJson(`${apiBaseUrl}/api/v1/namespaces`, {
      headers: createAuthHeaders(token),
      dispatcher
    });

    const namespaceSet = new Set();
    if (isRecord(payload) && Array.isArray(payload.items)) {
      for (const item of payload.items) {
        if (!isRecord(item) || !isRecord(item.metadata)) {
          continue;
        }
        const name = toNonEmptyString(item.metadata.name);
        if (name) {
          namespaceSet.add(name);
        }
      }
    }

    namespaceSet.add(coreNamespace);
    return Array.from(namespaceSet).sort((a, b) => a.localeCompare(b));
  } catch {
    return [coreNamespace];
  }
}

async function loadEndpointEntries(apiBaseUrl, token, dispatcher, endpoint, namespaces, coreNamespace) {
  const dbEntries = await loadDbEntriesForEndpoint(
    apiBaseUrl,
    token,
    dispatcher,
    endpoint,
    coreNamespace
  );

  if (dbEntries !== undefined) {
    return dbEntries;
  }

  try {
    return await loadApiEntriesForEndpoint(apiBaseUrl, token, dispatcher, endpoint, namespaces, coreNamespace);
  } catch {
    return [];
  }
}

function countByResourceMap(resourceMap) {
  return resourceMap.size;
}

async function loadFastBootstrapResources(apiBaseUrl, token, dispatcher, endpoints, namespaces, options) {
  const endpointByStream = new Map();

  for (const endpoint of endpoints) {
    if (!endpoint.stream || endpoint.stream.startsWith('_') || STREAM_EXCLUDE.has(endpoint.stream)) {
      continue;
    }
    endpointByStream.set(endpoint.stream, endpoint);
  }

  let availableStreams = Array.from(endpointByStream.keys()).sort((a, b) => a.localeCompare(b));
  if (options.streamLimit > 0) {
    availableStreams = availableStreams.slice(0, options.streamLimit);
  }

  const prioritizedStreams = FAST_BOOTSTRAP_STREAMS.filter((stream) => availableStreams.includes(stream));
  const remainingStreams = availableStreams.filter((stream) => !prioritizedStreams.includes(stream));

  const loadedStreams = new Set();
  const resources = new Map();

  const loadStream = async (stream) => {
    const endpoint = endpointByStream.get(stream);
    if (!endpoint) {
      return;
    }

    const entries = await loadEndpointEntries(
      apiBaseUrl,
      token,
      dispatcher,
      endpoint,
      namespaces,
      options.coreNamespace
    );

    if (entries.length > 0) {
      mergeResourceBucket(resources, entries, endpoint);
    }

    loadedStreams.add(stream);
  };

  for (const stream of prioritizedStreams) {
    await loadStream(stream);
    if (countByResourceMap(resources) >= options.minimumResources) {
      return {
        resources: Array.from(resources.values()),
        loadedStreams: Array.from(loadedStreams)
      };
    }
  }

  for (let index = 0; index < remainingStreams.length; index += options.batchSize) {
    const batch = remainingStreams.slice(index, index + options.batchSize);
    await Promise.all(batch.map(async (stream) => {
      await loadStream(stream);
    }));

    if (countByResourceMap(resources) >= options.minimumResources) {
      break;
    }
  }

  return {
    resources: Array.from(resources.values()),
    loadedStreams: Array.from(loadedStreams)
  };
}

async function buildExplorerSnapshotPayload(query) {
  const target = resolveTargetConfig(query.target);
  const minimumResources = parsePositiveInt(query.minResources, DEFAULT_MINIMUM_RESOURCES);
  const batchSize = parsePositiveInt(query.batchSize, DEFAULT_BATCH_SIZE);
  const streamLimit = parseNonNegativeInt(query.streamLimit, DEFAULT_STREAM_LIMIT);
  const explicitApiPrefix = toNonEmptyString(query.apiPrefix);

  const dispatcher = target.skipTlsVerify
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  const startedAt = Date.now();

  try {
    const apiBaseUrl = await resolveApiBaseUrl(target.targetUrl, dispatcher, explicitApiPrefix);
    const token = await fetchAccessToken(apiBaseUrl, target, dispatcher);
    const namespaces = await listNamespaces(apiBaseUrl, token, dispatcher, target.coreNamespace);
    const endpoints = await fetchStreamEndpoints(apiBaseUrl, token, dispatcher);

    const bootstrap = await loadFastBootstrapResources(
      apiBaseUrl,
      token,
      dispatcher,
      endpoints,
      namespaces,
      {
        coreNamespace: target.coreNamespace,
        minimumResources,
        batchSize,
        streamLimit
      }
    );

    return {
      targetUrl: target.targetUrl,
      apiBaseUrl,
      resources: bootstrap.resources,
      stats: {
        minimumResources,
        batchSize,
        streamLimit,
        discoveredStreams: endpoints.length,
        loadedStreams: bootstrap.loadedStreams.length,
        namespaces: namespaces.length,
        resourceCount: bootstrap.resources.length,
        durationMs: Date.now() - startedAt
      }
    };
  } finally {
    if (dispatcher) {
      await dispatcher.close();
    }
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function createRealEdaDevMiddleware() {
  return async function realEdaMiddleware(req, res, next) {
    if (!req.url || !req.url.startsWith('/__eda/explorer-snapshot')) {
      next();
      return;
    }

    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const payload = await buildExplorerSnapshotPayload(Object.fromEntries(requestUrl.searchParams.entries()));
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

module.exports = {
  createRealEdaDevMiddleware
};
