/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual CommonJS SDK loading without a bundler. */
// This runs installed SDK code in an isolated Node process. Cloud transport is replaced
// only at the database request boundary; HTTP checks use a loopback server only.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const installed = createRequire(join(process.argv[2], 'package.json'));
const wxRequire = createRequire(installed.resolve('wx-server-sdk/package.json'));
const sdkRequire = createRequire(
  (process.argv[4] === 'local' ? installed : wxRequire).resolve('@cloudbase/node-sdk/package.json'),
);

async function withServer(work) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url === '/reject') response.statusCode = 403;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        method: request.method,
        body: Buffer.concat(chunks).toString(),
        contentType: request.headers['content-type'],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function paths() {
  const dbRequire = createRequire(sdkRequire.resolve('@cloudbase/database/package.json'));
  const set = dbRequire('lodash.set');
  const unset = dbRequire('lodash.unset');
  assert.equal(typeof set, 'function');
  assert.equal(set.default, set);
  const target = {};
  assert.equal(set(target, 'letters[0].title', '家书'), target);
  set(target, ['letters', '0', 'status'], 'draft');
  assert.deepEqual(target, { letters: [{ title: '家书', status: 'draft' }] });
  assert.equal(unset(target, 'letters[0].status'), true);
  assert.deepEqual(target, { letters: [{ title: '家书' }] });
  for (const malicious of [
    '__proto__.shixuePolluted',
    ['constructor', 'prototype', 'shixuePolluted'],
    'safe.__proto__.shixuePolluted',
  ]) {
    set({}, malicious, true);
    assert.equal(Object.prototype.shixuePolluted, undefined);
  }
  const originalToString = Object.prototype.toString;
  for (const malicious of ['__proto__.toString', ['constructor', 'prototype', 'toString']]) {
    unset({}, malicious);
    assert.equal(Object.prototype.toString, originalToString);
  }
}

async function database() {
  const sdk = sdkRequire('@cloudbase/node-sdk');
  const app = sdk.init({
    env: 'offline-compatibility-only',
    secretId: 'fixture-id',
    secretKey: 'fixture-key',
  });
  const db = app.database();
  const module = sdkRequire('@cloudbase/database');
  const originalRequest = module.Db.reqClass;
  const calls = [];
  module.Db.reqClass = class OfflineRequest {
    async send(action, parameters) {
      calls.push({ action, parameters });
      if (action === 'database.startTransaction')
        return { transactionId: 'offline-tx', requestId: 'fixture-request' };
      if (action === 'database.getDocument')
        return {
          data: { list: [JSON.stringify({ _id: 'fixture-user', role: 'user' })] },
          requestId: 'fixture-request',
        };
      if (action === 'database.insertDocument')
        return { data: { insertedIds: ['fixture-user'] }, requestId: 'fixture-request' };
      if (action === 'database.modifyDocument')
        return { data: { updated: 1 }, requestId: 'fixture-request' };
      if (['database.commitTransaction', 'database.abortTransaction'].includes(action))
        return { requestId: 'fixture-request' };
      throw new Error(`Unexpected cloud method: ${action}`);
    }
  };
  try {
    assert.equal(
      (await db.collection('users').add({ role: 'user', createdAt: db.serverDate() })).id,
      'fixture-user',
    );
    const query = await db.collection('users').where({ openid: 'fixture-openid' }).limit(1).get();
    assert.equal(query.data[0].role, 'user');
    await db
      .collection('users')
      .doc('fixture-user')
      .update({ role: 'super_admin', updatedAt: db.serverDate() });
    const modified = calls.find((item) => item.action === 'database.modifyDocument');
    assert.equal(modified.parameters.merge, true);
    assert.match(modified.parameters.data, /super_admin/);
    assert.match(calls[0].parameters.data[0], /server_date/);
    const result = await db.runTransaction(async (transaction) => {
      const user = await transaction.collection('users').doc('fixture-user').get();
      assert.equal(user.data.role, 'user');
      await transaction.collection('users').doc('fixture-user').update({ role: 'super_admin' });
      await transaction
        .collection('admin_logs')
        .doc('fixture-audit')
        .set({ action: 'bootstrap.super_admin' });
      return 'committed';
    });
    assert.equal(result, 'committed');
    assert.equal(calls.at(-1).action, 'database.commitTransaction');
    assert(calls.filter((item) => item.parameters?.transactionId === 'offline-tx').length >= 4);
    await assert.rejects(
      db.runTransaction(async () => {
        throw new Error('rollback-check');
      }),
      /rollback-check/,
    );
    assert.equal(calls.at(-1).action, 'database.abortTransaction');
  } finally {
    module.Db.reqClass = originalRequest;
  }
  assert.equal(typeof installed('wx-server-sdk').getWXContext, 'function');
}

async function http() {
  const sdk = sdkRequire('@cloudbase/node-sdk');
  const app = sdk.init({
    env: 'offline-compatibility-only',
    secretId: 'fixture-id',
    secretKey: 'fixture-key',
  });
  await withServer(async (url) => {
    const received = await app.requestClient.get({
      url,
      method: 'POST',
      data: { title: '校园' },
      proxy: false,
      timeout: 1000,
    });
    assert.equal(received.status, 200);
    assert.deepEqual(JSON.parse(received.data.body), { title: '校园' });
    await assert.rejects(
      app.requestClient.get({ url: `${url}/reject`, proxy: false, timeout: 1000 }),
      (error) => error.response?.status === 403,
    );
    const axios = sdkRequire('axios');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(axios.get(url, { signal: controller.signal, proxy: false }), (error) =>
      axios.isCancel(error),
    );
  });
}

async function developerTools() {
  const directory = await mkdtemp(join(tmpdir(), 'shixue-dependency-compat-'));
  try {
    const cosRequire = createRequire(installed.resolve('cos-nodejs-sdk-v5/package.json'));
    const util = cosRequire('./sdk/util');
    const xmlObject = {
      CompleteMultipartUpload: {
        Part: [
          { PartNumber: '1', ETag: 'etag-1' },
          { PartNumber: '2', ETag: 'etag-2' },
        ],
      },
    };
    assert.deepEqual(util.xml2json(util.json2xml(xmlObject)), xmlObject);
    const text = { Message: '校园 & <正文> ]]> <!-- 注释 -->' };
    assert.deepEqual(util.xml2json(util.json2xml(text)), text);
    const Jimp = installed('jimp');
    const image = new Jimp(2, 2, 0xff9966ff);
    const output = join(directory, 'nested', 'image.jpg');
    await new Promise((resolve, reject) =>
      image.write(output, (error) => (error ? reject(error) : resolve())),
    );
    const decoded = await Jimp.read(await readFile(output));
    assert.equal(decoded.bitmap.width, 2);
    assert.equal(decoded.bitmap.height, 2);
    const tar = installed('tar-stream');
    async function tarBuffer(name) {
      const pack = tar.pack();
      const chunks = [];
      const finished = new Promise((resolve, reject) => {
        pack.on('data', (chunk) => chunks.push(chunk));
        pack.on('end', () => resolve(Buffer.concat(chunks)));
        pack.on('error', reject);
      });
      pack.entry({ name }, Buffer.from('fixture'));
      pack.finalize();
      return finished;
    }
    const toolboxRequire = createRequire(installed.resolve('@cloudbase/toolbox/package.json'));
    const decompress = toolboxRequire('decompress');
    const out = join(directory, 'extract');
    await mkdir(out);
    const entries = await decompress(await tarBuffer('inside.txt'), out, {
      filter: (entry) => entry.path.endsWith('.txt'),
    });
    assert.equal(entries.length, 1);
    assert.equal(await readFile(join(out, 'inside.txt'), 'utf8'), 'fixture');
    await assert.rejects(decompress(await tarBuffer('../outside.txt'), out));
    await assert.rejects(readFile(join(directory, 'outside.txt')));
    await withServer(async (url) => {
      const request = cosRequire('request');
      const body = await new Promise((resolve, reject) =>
        request.post(
          {
            url,
            formData: {
              title: '校园',
              file: {
                value: Buffer.from('letter'),
                options: { filename: 'note.txt', contentType: 'text/plain' },
              },
            },
          },
          (error, response, body) => (error ? reject(error) : resolve(body)),
        ),
      );
      const received = JSON.parse(body);
      assert.match(received.contentType, /^multipart\/form-data; boundary=/);
      assert.match(received.body, /校园/);
      assert.match(received.body, /filename="note.txt"/);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const suites = { paths, database, http, developerTools };
const suite = suites[process.argv[3]];
if (!suite) throw new Error('Select a known dependency compatibility suite');
suite()
  .then(() =>
    console.log(JSON.stringify({ suite: process.argv[3], passed: true, cloudContacted: false })),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
