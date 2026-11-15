'use strict';

// Only encrypted academic snapshots are sent to the GitHub data branch.
// Credentials, cookies and browser state are never accepted as snapshot fields.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const BRANCH = 'sync-state';
const FILE = 'state.enc.json';
const HEALTH_FILE = 'health.json';
const HEALTH_SCHEMA = 'jupiter-student-health.v1';
const FORMAT = 'jupiter-student-state.v1';
const {SCHEMA,fingerprint,validateScope,validateStoredState} = require('./state.cjs');
// Contents API returns inline base64 reliably below 1 MiB; fail before publishing a larger file.
const MAX_ENVELOPE = 900 * 1024;
const MAX_CLEAR = 32 * 1024 * 1024;
const SENSITIVE_KEY = /^(?:password\d*|text_password\d*|passwd|pwd|cookie|cookies|token|access_token|refresh_token|authorization|credential|credentials|browser_profile|storage_state|localStorage|sessionStorage|session|session_state|login_state)$/i;

class PersistenceError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'PersistenceError';
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

function checkRepo(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new PersistenceError('repository_invalid');
  }
  const [owner, name] = repo.split('/');
  if (name === '.' || name === '..') throw new PersistenceError('repository_invalid');
  return { owner, name, canonical: repo.toLowerCase() };
}

function checkKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new PersistenceError('state_key_invalid');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new PersistenceError('state_key_invalid');
  return key;
}

function checkSnapshot(value, depth = 0) {
  if (depth > 50) throw new PersistenceError('state_structure_invalid');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const child of value) checkSnapshot(child, depth + 1);
    return;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) throw new PersistenceError('credential_state_rejected');
      checkSnapshot(child, depth + 1);
    }
    return;
  }
  throw new PersistenceError('state_structure_invalid');
}

function aad(repo, scope) {
  validateScope(scope);
  return Buffer.from(`${FORMAT}\0${checkRepo(repo).canonical}\0${fingerprint(scope)}`, 'utf8');
}
function checkBinding(state,scope) {
  validateScope(scope);
  const proof=state?.source?.provenance?.school_identity;
  if(!state||state.schema!==SCHEMA||!state.scope||state.scope_hash!==fingerprint(scope)||fingerprint(state.scope)!==state.scope_hash||
    !/^\d+$/.test(state.school_id||'')||state.coverage?.complete!==true||proof?.verified!==true||
    state.source?.provenance?.school_identity_status?.verified!==true||proof.school_id!==state.school_id||
    proof.scope_hash!==state.scope_hash||proof.school_year!==scope.school_year||
    proof.origin!=='https://login.jupitered.com/'||proof.method!=='authenticated_official_student_route'||
    !Number.isSafeInteger(state.sequence)||state.sequence<1||!Number.isFinite(Date.parse(state.last_success_at)))
    throw new PersistenceError('state_scope_or_verification_invalid');
  try {validateStoredState(state,scope);} catch {throw new PersistenceError('state_structure_invalid');}
}


function encodeState(state, keyValue, repo, scope) {
  checkBinding(state,scope);
  checkSnapshot(state);
  if (!state || Array.isArray(state) || typeof state !== 'object') throw new PersistenceError('state_structure_invalid');
  const clear = Buffer.from(JSON.stringify(state), 'utf8');
  if (clear.length > MAX_CLEAR) throw new PersistenceError('state_too_large');
  const key = checkKey(keyValue);
  try {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(repo, scope));
    const ciphertext = Buffer.concat([cipher.update(zlib.gzipSync(clear)), cipher.final()]);
    const encoded = JSON.stringify({
      format: FORMAT, cipher: 'AES-256-GCM', compression: 'gzip',
      nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }) + '\n';
    if (Buffer.byteLength(encoded) > MAX_ENVELOPE) throw new PersistenceError('state_too_large');
    return encoded;
  } finally {
    key.fill(0);
    clear.fill(0);
  }
}

function base64(value, length) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new PersistenceError('state_envelope_invalid');
  }
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value || (length !== undefined && result.length !== length)) {
    throw new PersistenceError('state_envelope_invalid');
  }
  return result;
}

function decodeState(serialized, keyValue, repo, scope) {
  const key = checkKey(keyValue);
  let clear;
  try {
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_ENVELOPE) throw new Error();
    const envelope = JSON.parse(serialized);
    if (!envelope || envelope.format !== FORMAT || envelope.cipher !== 'AES-256-GCM' || envelope.compression !== 'gzip' ||
        Object.keys(envelope).sort().join(',') !== 'cipher,ciphertext,compression,format,nonce,tag') throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, base64(envelope.nonce, 12));
    decipher.setAAD(aad(repo, scope));
    decipher.setAuthTag(base64(envelope.tag, 16));
    const compressed = Buffer.concat([decipher.update(base64(envelope.ciphertext)), decipher.final()]);
    clear = zlib.gunzipSync(compressed, { maxOutputLength: MAX_CLEAR });
    const state = JSON.parse(clear.toString('utf8'));
    checkSnapshot(state);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error();
    checkBinding(state,scope);
    return state;
  } catch {
    throw new PersistenceError('state_decryption_failed');
  } finally {
    key.fill(0);
    clear?.fill(0);
  }
}

function client(options) {
  const { repo, token } = options;
  const identity = checkRepo(repo);
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new PersistenceError('github_token_missing');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const prefix = `/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.name)}`;

  async function request(method, suffix = '', body, allow404 = false) {
    // suffix is only constructed from fixed internal paths and validated SHAs.
    if (!suffix.startsWith('/') && suffix !== '') throw new PersistenceError('github_path_invalid');
    const url = new URL('https://api.github.com' + prefix + suffix);
    if (url.origin !== 'https://api.github.com') throw new PersistenceError('github_origin_invalid');
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response;
      try {
        response = await fetchImpl(url.href, {
          method, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs || 15000),
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jupiter-ed-student-sync',
            ...(method === 'GET' ? { 'Cache-Control': 'no-cache' } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        if (attempt + 1 < attempts) { await sleep(500 * 2 ** attempt); continue; }
        throw new PersistenceError('github_network_failed');
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await sleep(500 * 2 ** attempt); continue;
        }
        throw new PersistenceError([409, 422].includes(response.status) ? 'state_conflict' : 'github_request_failed', response.status);
      }
      try { return await response.json(); }
      catch { throw new PersistenceError('github_response_invalid', response.status); }
    }
    throw new PersistenceError('github_network_failed');
  }

  async function verifyRepository() {
    const info = await request('GET');
    if (info.private !== true || String(info.visibility || 'private') !== 'private') throw new PersistenceError('private_repository_required');
    if (String(info.full_name || '').toLowerCase() !== identity.canonical ||
        String(info.owner?.login || '').toLowerCase() !== identity.owner.toLowerCase()) throw new PersistenceError('repository_identity_mismatch');
  }

  async function readContent(path, head, limit) {
    const result = await request('GET', `/contents/${path}?ref=${head}`, undefined, true);
    if (result === null) throw new PersistenceError('state_file_missing');
    if (result.type !== 'file' || result.path !== path || result.encoding !== 'base64' ||
        !/^[a-f0-9]{40}$/.test(result.sha || '') || typeof result.content !== 'string') throw new PersistenceError('state_file_invalid');
    const encoded = result.content.replace(/\n/g, '');
    if (encoded.length > limit * 1.4) throw new PersistenceError('state_too_large');
    const bytes = base64(encoded);
    const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (hash !== result.sha) throw new PersistenceError('state_blob_integrity_failed');
    return { revision: result.sha, text: bytes.toString('utf8') };
  }

  async function currentFile() {
    const ref = await request('GET', `/git/ref/heads/${BRANCH}`, undefined, true);
    if (ref === null) return null;
    if (ref.ref !== `refs/heads/${BRANCH}` || !/^[a-f0-9]{40}$/.test(ref.object?.sha || '')) throw new PersistenceError('state_ref_invalid');
    // Both files are read at the same immutable commit, never two moving branch reads.
    const head=ref.object.sha;
    const file=await readContent(FILE,head,MAX_ENVELOPE);
    const health=await readContent(HEALTH_FILE,head,2048);
    return {...file,head,healthText:health.text,healthRevision:health.revision};
  }

  return { request, verifyRepository, currentFile };
}

function healthFor(state) {
  return {schema:HEALTH_SCHEMA,last_success_at:state.last_success_at,sequence:state.sequence,verified:true};
}
function checkedFile(file,options) {
  const state=decodeState(file.text,options.key,options.repo,options.scope);
  let health;
  try {health=JSON.parse(file.healthText);} catch {throw new PersistenceError('state_health_invalid');}
  const expected=healthFor(state);
  if(!health||Object.keys(health).sort().join(',')!==Object.keys(expected).sort().join(',')||
    Object.entries(expected).some(([key,value])=>health[key]!==value))throw new PersistenceError('state_health_mismatch');
  return state;
}

async function loadState(options) {
  validateScope(options.scope);
  checkKey(options.key).fill(0);
  const api = client(options);
  await api.verifyRepository();
  const file = await api.currentFile();
  if (!file) return { state: null, revision: null, initial: true, branchExists: false };
  return { state: checkedFile(file, options), revision: file.revision,
    initial: false, branchExists: true };
}

async function saveState(options) {
  const { state, revision } = options;
  if(revision===null&&options.initialize!==true)throw new PersistenceError('explicit_initialization_required');
  if (revision !== null && !/^[a-f0-9]{40}$/.test(revision || '')) throw new PersistenceError('state_revision_invalid');
  const serialized = encodeState(state, options.key, options.repo, options.scope);
  const api = client(options);
  await api.verifyRepository();
  const previous = await api.currentFile();
  if ((previous?.revision || null) !== revision) throw new PersistenceError('state_conflict');
  if (previous) {
    // Authenticate both old files before writes; never reset foreign/corrupt state.
    const oldState=checkedFile(previous,options);
    if(state.sequence!==oldState.sequence+1||!Number.isFinite(Date.parse(state.last_success_at))||Date.parse(state.last_success_at)<Date.parse(oldState.last_success_at))
      throw new PersistenceError('state_sequence_regression');
  } else if(state.sequence!==1)throw new PersistenceError('initial_state_sequence_invalid');

  // Publish state and non-personal health metadata in ONE commit. No state branch
  // ever contains application source, credentials, account scope or clear assignments.
  const blob=await api.request('POST','/git/blobs',{content:serialized,encoding:'utf-8'});
  if(!/^[a-f0-9]{40}$/.test(blob.sha||''))throw new PersistenceError('github_response_invalid');
  // Before exposing verified:true, verify the uploaded encrypted blob by exact SHA.
  const blobReadback=await api.request('GET',`/git/blobs/${blob.sha}`);
  if(blobReadback.encoding!=='base64'||typeof blobReadback.content!=='string')throw new PersistenceError('state_blob_integrity_failed');
  const readBytes=base64(blobReadback.content.replace(/\n/g,''));
  const blobHash=crypto.createHash('sha1').update(`blob ${readBytes.length}\0`).update(readBytes).digest('hex');
  if(blobHash!==blob.sha||readBytes.toString('utf8')!==serialized)throw new PersistenceError('state_blob_integrity_failed');
  decodeState(readBytes.toString('utf8'),options.key,options.repo,options.scope);
  const healthText=JSON.stringify(healthFor(state))+'\n';
  const healthBlob=await api.request('POST','/git/blobs',{content:healthText,encoding:'utf-8'});
  if(!/^[a-f0-9]{40}$/.test(healthBlob.sha||''))throw new PersistenceError('github_response_invalid');
  const tree=await api.request('POST','/git/trees',{tree:[
    {path:FILE,mode:'100644',type:'blob',sha:blob.sha},
    {path:HEALTH_FILE,mode:'100644',type:'blob',sha:healthBlob.sha},
  ]});
  if(!/^[a-f0-9]{40}$/.test(tree.sha||''))throw new PersistenceError('github_response_invalid');
  const commit=await api.request('POST','/git/commits',{
    message:previous?'Update encrypted source snapshot':'Initialize encrypted source snapshot',
    tree:tree.sha,parents:previous?[previous.head]:[],
  });
  if(!/^[a-f0-9]{40}$/.test(commit.sha||''))throw new PersistenceError('github_response_invalid');
  if(previous) {
    // New commit's parent is the observed head. Fast-forward-only update refuses
    // a concurrent writer's sibling commit; never force or retry an uncertain write.
    await api.request('PATCH',`/git/refs/heads/${BRANCH}`,{sha:commit.sha,force:false});
  } else {
    await api.request('POST','/git/refs',{ref:`refs/heads/${BRANCH}`,sha:commit.sha});
  }
  const expectedRevision=blob.sha,expectedHead=commit.sha;
  // GitHub may briefly serve a pre-write ref/Contents response. Retry reads only;
  // a write with an uncertain response must never be replayed automatically.
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const delays = [0, 500, 1500, 3000, 6000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    let readback;
    try {
      readback = await api.currentFile();
    } catch (error) {
      // A new ref can become visible before its Contents endpoint. All other
      // corruption, authorization and exhausted transport failures remain fatal.
      if (error.code !== 'state_file_missing') throw error;
      readback = null;
    }
    if (readback?.revision === expectedRevision) {
      if (readback.head!==expectedHead||readback.text!==serialized||readback.healthText!==healthText) throw new PersistenceError('state_readback_mismatch');
      checkedFile(readback,options);
      return { revision: expectedRevision, head:expectedHead, branch: BRANCH, path: FILE, health_path:HEALTH_FILE, verified: true, readback_attempts: attempt + 1 };
    }
    // Only the previously observed revision or temporary invisibility may be
    // retried. A third revision means another writer intervened, not a cache hit.
    if (readback && (readback.revision!==revision||readback.head!==previous?.head)) throw new PersistenceError('state_readback_conflict');
  }
  throw new PersistenceError('state_readback_stale');
}

module.exports = { loadState, saveState, encodeState, decodeState, PersistenceError, BRANCH, FILE, HEALTH_FILE, HEALTH_SCHEMA, client };
