import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { isRecord } from '../../shared';
import type { SafetyResult } from './content-safety';

export interface CallbackConfig {
  appId: string;
  token: string;
  encodingAESKey: string;
}
export interface MediaSafetyEvent {
  appId: string;
  traceId: string;
  createdAt: Date;
  result: SafetyResult;
}
export interface SafetyCallbackRequest {
  method: string;
  query: unknown;
  body?: string;
}
export interface SafetyCallbackResponse {
  statusCode: number;
  body: string;
}

/** Internal port must atomically bind the event to a previously persisted job. */
export interface MediaSafetySink {
  accept(event: MediaSafetyEvent): Promise<void>;
}

const invalid = () => new Error('Invalid safety callback');
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw invalid();
  return value;
}
function utf8(value: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}
function checkSignature(value: unknown, parts: string[]): void {
  const signature = string(value, 40);
  if (!/^[a-f0-9]{40}$/.test(signature)) throw invalid();
  const expected = createHash('sha1').update(parts.sort().join('')).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) throw invalid();
}
function decodePayload(encrypted: string, key: Buffer, appId: string): unknown {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encrypted))
    throw invalid();
  const cipher = Buffer.from(encrypted, 'base64');
  if (!cipher.length || cipher.length % 16 !== 0) throw invalid();
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(cipher), decipher.final()]);
  const padding = padded[padded.length - 1];
  if (!padding || padding > 32 || padded.length < padding + 20) throw invalid();
  if (!padded.subarray(-padding).every((byte) => byte === padding)) throw invalid();
  const payload = padded.subarray(0, -padding);
  const length = payload.readUInt32BE(16);
  if (!length || length > payload.length - 20) throw invalid();
  if (utf8(payload.subarray(20 + length)) !== appId) throw invalid();
  const value: unknown = JSON.parse(utf8(payload.subarray(20, 20 + length)));
  return value;
}

function parseMediaEvent(value: unknown, appId: string, now: Date): MediaSafetyEvent {
  if (
    !isRecord(value) ||
    value.MsgType !== 'event' ||
    value.Event !== 'wxa_media_check' ||
    value.version !== 2 ||
    value.appid !== appId ||
    typeof value.errcode !== 'number' ||
    !Number.isSafeInteger(value.errcode) ||
    typeof value.CreateTime !== 'number' ||
    !Number.isSafeInteger(value.CreateTime) ||
    value.CreateTime <= 0 ||
    value.CreateTime * 1000 > now.getTime() + 300000
  )
    throw invalid();
  const traceId = string(value.trace_id, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(traceId)) throw invalid();
  const result: SafetyResult = {
    decision: 'review',
    status: 'unavailable',
    provider: 'wechat-v2',
    checkedAt: now,
    labels: [],
    traceIds: [traceId],
  };
  if (value.errcode === 0) {
    const parse = (raw: unknown): { label: number; decision: SafetyResult['decision'] } => {
      if (
        !isRecord(raw) ||
        typeof raw.label !== 'number' ||
        !Number.isSafeInteger(raw.label) ||
        raw.label < 0
      )
        throw invalid();
      if (raw.suggest !== 'pass' && raw.suggest !== 'review' && raw.suggest !== 'risky')
        throw invalid();
      return {
        label: raw.label,
        decision: raw.suggest === 'risky' ? ('reject' as const) : raw.suggest,
      };
    };
    const first = parse(value.result);
    result.decision = first.decision;
    result.status = 'complete';
    result.labels.push(first.label);
    if (value.detail !== undefined) {
      if (!Array.isArray(value.detail) || value.detail.length > 100) throw invalid();
      for (const raw of value.detail) {
        if (!isRecord(raw) || raw.errcode !== 0) throw invalid();
        const item = parse(raw);
        if (
          item.decision === 'reject' ||
          (item.decision === 'review' && result.decision !== 'reject')
        )
          result.decision = item.decision;
        result.labels.push(item.label);
      }
    }
    result.labels = [...new Set(result.labels)];
  }
  return { appId, traceId, createdAt: new Date(value.CreateTime * 1000), result };
}

/** Safe-mode JSON only. No HTTP source header or client OpenID is accepted as authentication. */
export function createSafetyCallback(
  config: CallbackConfig,
  sink: MediaSafetySink,
  now: () => Date = () => new Date(),
) {
  if (
    !/^wx[a-fA-F0-9]{16}$/.test(config.appId) ||
    !/^[A-Za-z0-9]{3,32}$/.test(config.token) ||
    !/^[A-Za-z0-9+/]{43}$/.test(config.encodingAESKey)
  )
    throw new Error('Invalid safety callback configuration');
  const key = Buffer.from(config.encodingAESKey + '=', 'base64');
  if (key.length !== 32 || key.toString('base64').slice(0, -1) !== config.encodingAESKey)
    throw new Error('Invalid safety callback configuration');
  return async (request: SafetyCallbackRequest): Promise<SafetyCallbackResponse> => {
    let event: MediaSafetyEvent;
    try {
      if (!isRecord(request.query)) throw invalid();
      const query = request.query;
      const timestamp = string(query.timestamp, 12),
        nonce = string(query.nonce, 128);
      const current = now();
      if (
        !/^\d{1,12}$/.test(timestamp) ||
        !Number.isFinite(current.getTime()) ||
        Math.abs(Number(timestamp) * 1000 - current.getTime()) > 300000
      )
        throw invalid();
      if (request.method === 'GET') {
        checkSignature(query.signature, [config.token, timestamp, nonce]);
        return { statusCode: 200, body: string(query.echostr, 1024) };
      }
      if (
        request.method !== 'POST' ||
        query.encrypt_type !== 'aes' ||
        typeof request.body !== 'string' ||
        Buffer.byteLength(request.body, 'utf8') > 65536
      )
        throw invalid();
      const body: unknown = JSON.parse(request.body);
      if (!isRecord(body)) throw invalid();
      const encrypted = string(body.Encrypt, 60000);
      checkSignature(query.msg_signature, [config.token, timestamp, nonce, encrypted]);
      event = parseMediaEvent(decodePayload(encrypted, key, config.appId), config.appId, current);
    } catch {
      return { statusCode: 403, body: 'forbidden' };
    }
    try {
      await sink.accept(event);
      return { statusCode: 200, body: 'success' };
    } catch {
      // Do not acknowledge a failed transaction: allow platform retry. Never log raw payload.
      return { statusCode: 503, body: 'retry' };
    }
  };
}
