import {createHash, createHmac} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';

const hash = data => createHash('sha256').update(data).digest('hex');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const checkedUrl = value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Cloudflare returned an unsafe transfer URL.');
    return url;
};
const retryingFetch = (fetchImpl, sleep) => async (url, options) => {
    for (let attempt = 0; ; attempt++) {
        const response = await fetchImpl(url, options);
        if (response.status !== 429 || attempt >= 7) return response;
        const seconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60000) : 60000);
    }
};

// fetch transparently decompresses HTTP content-encoding but retains that
// metadata. Backups require the original object bytes, so use Node's raw stream
// for R2 downloads. Production calls always receive the fixed R2 HTTPS URL;
// loopback HTTP is accepted solely for injectable local transport tests.
export async function rawObjectDownload(value, options = {}) {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== 'https:'
        && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Unsafe object download URL.');
    if ((options.method && options.method !== 'GET') || options.body != null) throw new Error('Raw object transport only supports GET.');
    return new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {method: 'GET', headers: options.headers, signal: options.signal}, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('aborted', () => reject(new Error('Object download ended before completion.')));
            response.on('end', () => {
                const headers = new Headers();
                for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
                const status = response.statusCode;
                const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
                resolve(new Response(body, {status, headers}));
            });
        });
        request.on('error', reject); request.end();
    });
}

export class CloudflareApi {
    constructor({accountId, token, fetchImpl = fetch, sleep = pause}) {
        if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !token) throw new Error('An account ID and Cloudflare API token are required.');
        this.accountId = accountId; this.token = token; this.fetch = retryingFetch(fetchImpl, sleep); this.sleep = sleep;
    }
    async request(path, options = {}) {
        const response = await this.fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/${path}`, {
            ...options, headers: {...options.headers, Authorization: `Bearer ${this.token}`}, redirect: 'error', signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) {
            const error = new Error(`Cloudflare API failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        const json = await response.json();
        if (json.success !== true || json.result?.success === false) throw new Error('Cloudflare API rejected the operation.');
        return json;
    }
    async json(path, body) { return this.request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); }
}

export class CloudflareD1 {
    constructor(api, databaseId) {
        if (!/^[a-f0-9-]{36}$/i.test(databaseId || '')) throw new Error('A D1 database UUID is required.');
        this.api = api; this.path = `d1/database/${databaseId}`; this.identity = `${api.accountId}/d1/${databaseId}`;
    }
    async exportSql() {
        let bookmark;
        for (let attempt = 0; attempt < 600; attempt++) {
            const {result} = await this.api.json(`${this.path}/export`, {output_format: 'polling', ...(bookmark ? {current_bookmark: bookmark} : {})});
            if (result.status === 'error') throw new Error('D1 SQL export failed.');
            if (result.status === 'complete') {
                const response = await this.api.fetch(checkedUrl(result.result?.signed_url), {redirect: 'error', signal: AbortSignal.timeout(300000)});
                if (!response.ok) throw new Error(`D1 SQL download failed (${response.status}).`);
                return response.text();
            }
            bookmark = result.at_bookmark;
            if (!bookmark) throw new Error('D1 export did not return a polling bookmark.');
            await this.api.sleep(1000);
        }
        throw new Error('D1 SQL export timed out.');
    }
    async assertEmpty() {
        const {result} = await this.api.json(`${this.path}/query`, {sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"});
        if (!Array.isArray(result) || result.some(item => item.success === false) || result.flatMap(item => item.results || []).length) throw new Error('Restore requires an empty D1 database.');
    }
    async importSql(sql) {
        const etag = createHash('md5').update(sql).digest('hex');
        const init = (await this.api.json(`${this.path}/import`, {action: 'init', etag})).result;
        if (init.upload_url) {
            const response = await this.api.fetch(checkedUrl(init.upload_url), {method: 'PUT', body: sql, redirect: 'error', signal: AbortSignal.timeout(300000)});
            if (!response.ok) throw new Error(`D1 SQL upload failed (${response.status}).`);
        }
        if (!init.filename) throw new Error('D1 import did not return a filename.');
        let result = (await this.api.json(`${this.path}/import`, {action: 'ingest', etag, filename: init.filename})).result;
        for (let attempt = 0; attempt < 600; attempt++) {
            if (result.status === 'complete') return;
            if (result.status === 'error' || !result.at_bookmark) throw new Error('D1 SQL import failed; keep the target offline and restore to fresh resources.');
            await this.api.sleep(1000);
            result = (await this.api.json(`${this.path}/import`, {action: 'poll', current_bookmark: result.at_bookmark})).result;
        }
        throw new Error('D1 SQL import timed out; keep the target offline.');
    }
}

export class CloudflareKv {
    constructor(api, namespaceId) {
        if (!/^[a-f0-9]{32}$/i.test(namespaceId || '')) throw new Error('A KV namespace ID is required.');
        this.api = api; this.path = `storage/kv/namespaces/${namespaceId}`; this.kind = 'kv'; this.identity = `${api.accountId}/kv/${namespaceId}`;
    }
    async list(cursor) {
        const query = new URLSearchParams({limit: '1000', ...(cursor ? {cursor} : {})});
        const result = await this.api.request(`${this.path}/keys?${query}`);
        if (!Array.isArray(result.result)) throw new Error('Invalid KV list response.');
        return {entries: result.result.map(entry => ({key: entry.name, metadata: entry.metadata ?? null, expiration: entry.expiration ?? null})), cursor: result.result_info?.cursor || null};
    }
    async get(key) {
        const response = await this.api.fetch(`https://api.cloudflare.com/client/v4/accounts/${this.api.accountId}/${this.path}/values/${encode(key)}`, {
            headers: {Authorization: `Bearer ${this.api.token}`}, redirect: 'error', signal: AbortSignal.timeout(120000),
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`KV value read failed (${response.status}).`);
        // Metadata is supplied by the complete inventory captured before reads.
        return {data: Buffer.from(await response.arrayBuffer())};
    }
    async getMetadata(key) { return (await this.api.request(`${this.path}/metadata/${encode(key)}`)).result ?? null; }
    async putIfAbsent(key, object) {
        if (object.data.length > 25 * 1024 * 1024) throw new Error('Object exceeds the KV 25 MiB value limit.');
        // KV has no conditional put. Callers enforce a dedicated offline target
        // and check it before each write; concurrent writers are unsupported.
        if (await this.get(key)) throw new Error('KV target changed before write; no value was overwritten.');
        const form = new FormData();
        form.append('value', new Blob([object.data]));
        if (object.metadata != null) form.append('metadata', JSON.stringify(object.metadata));
        const query = object.expiration ? `?expiration=${object.expiration}` : '';
        await this.api.request(`${this.path}/values/${encode(key)}${query}`, {method: 'PUT', body: form});
    }
}

const xml = value => value.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_, hex, dec, name) => hex || dec ? String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)) : ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"})[name.toLowerCase()]);
const tag = (source, name) => source.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1];
const HTTP_HEADERS = {contentType: 'content-type', contentDisposition: 'content-disposition', cacheControl: 'cache-control', contentEncoding: 'content-encoding', contentLanguage: 'content-language', expires: 'expires'};

export class CloudflareR2 {
    constructor({accountId, bucket, accessKeyId, secretAccessKey, fetchImpl = fetch, downloadImpl, now = () => new Date(), sleep = pause}) {
        if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '') || !accessKeyId || !secretAccessKey) throw new Error('R2 account, bucket and S3 credentials are required.');
        this.base = `https://${accountId}.r2.cloudflarestorage.com`; this.bucket = bucket; this.accessKeyId = accessKeyId;
        this.secret = secretAccessKey; this.fetch = retryingFetch(fetchImpl, sleep); this.now = now; this.kind = 'r2'; this.identity = `${accountId}/r2/${bucket}`;
        this.download = retryingFetch(downloadImpl || (fetchImpl === fetch ? rawObjectDownload : fetchImpl), sleep);
    }
    async request(method, key, {query = {}, headers = {}, body, raw = false} = {}) {
        if (key?.split('/').some(part => part === '.' || part === '..')) throw new Error('R2 object keys containing dot path segments are unsupported.');
        const path = `/${encode(this.bucket)}${key == null ? '' : '/' + key.split('/').map(encode).join('/')}`;
        const queryString = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
        const date = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const allHeaders = {...headers, host: new URL(this.base).host, 'x-amz-date': date, 'x-amz-content-sha256': hash(body || '')};
        const names = Object.keys(allHeaders).sort();
        const canonicalHeaders = names.map(name => `${name}:${String(allHeaders[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
        const request = [method, path, queryString, canonicalHeaders, names.join(';'), allHeaders['x-amz-content-sha256']].join('\n');
        const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
        const hmac = (secret, value) => createHmac('sha256', secret).update(value).digest();
        const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secret}`, date.slice(0, 8)), 'auto'), 's3'), 'aws4_request');
        allHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(request)}`).toString('hex')}`;
        return (raw ? this.download : this.fetch)(`${this.base}${path}${queryString ? '?' + queryString : ''}`, {method, headers: allHeaders, body, redirect: 'error', signal: AbortSignal.timeout(300000)});
    }
    async list(cursor) {
        const response = await this.request('GET', null, {query: {'list-type': '2', 'encoding-type': 'url', 'max-keys': '1000', ...(cursor ? {'continuation-token': cursor} : {})}});
        if (!response.ok) throw new Error(`R2 list failed (${response.status}).`);
        const text = await response.text();
        if (!text.includes('<ListBucketResult')) throw new Error('Invalid R2 list response.');
        const entries = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(match => ({key: decodeURIComponent(xml(tag(match[1], 'Key') || '')), size: Number(tag(match[1], 'Size'))}));
        const next = tag(text, 'NextContinuationToken');
        if (tag(text, 'IsTruncated') === 'true' && !next) throw new Error('R2 omitted a continuation token.');
        return {entries, cursor: tag(text, 'IsTruncated') === 'true' ? xml(next) : null};
    }
    async get(key) {
        const response = await this.request('GET', key, {raw: true});
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`R2 read failed (${response.status}).`);
        const metadata = {httpMetadata: {}, customMetadata: {}};
        for (const [name, header] of Object.entries(HTTP_HEADERS)) if (response.headers.has(header)) metadata.httpMetadata[name] = response.headers.get(header);
        for (const [name, value] of response.headers) if (name.startsWith('x-amz-meta-')) metadata.customMetadata[name.slice(11)] = value;
        return {data: Buffer.from(await response.arrayBuffer()), metadata};
    }
    async putIfAbsent(key, object) {
        const headers = {'if-none-match': '*'};
        for (const [name, header] of Object.entries(HTTP_HEADERS)) if (object.metadata?.httpMetadata?.[name] != null) headers[header] = object.metadata.httpMetadata[name];
        for (const [name, value] of Object.entries(object.metadata?.customMetadata || {})) headers[`x-amz-meta-${name.toLowerCase()}`] = value;
        const response = await this.request('PUT', key, {headers, body: object.data});
        if (response.status === 412) throw new Error('R2 target changed before write; no object was overwritten.');
        if (!response.ok) throw new Error(`R2 write failed (${response.status}).`);
    }
}
