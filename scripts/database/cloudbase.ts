import CloudBaseManager from '@cloudbase/manager-node';
import cloudbase from '@cloudbase/node-sdk';
import {
  DatabaseScriptError,
  isRecord,
  type DataPort,
  type DocumentData,
  type ManagementPort,
  type TransactionPort,
} from './core';
import { DENY_CLIENT_ACCESS, type IndexDefinition } from './manifest';

export interface CloudBaseConnection {
  environmentId: string;
  appId: string;
  secretId: string;
  secretKey: string;
  sessionToken?: string;
  region?: string;
}

// SDK responses cross an unknown boundary before they enter our domain model.
interface SdkDocument {
  get(): Promise<unknown>;
  set(data: DocumentData): Promise<unknown>;
  update(data: DocumentData): Promise<unknown>;
}
interface SdkTransaction {
  collection(name: string): { doc(id: string): SdkDocument };
}
export interface SdkDatabase extends SdkTransaction {
  collection(name: string): {
    doc(id: string): SdkDocument;
    where(filter: DocumentData): { limit(count: number): { get(): Promise<unknown> } };
  };
  runTransaction<T>(callback: (transaction: SdkTransaction) => Promise<T>): Promise<T>;
  serverDate(): unknown;
}

export function successfulResponse(value: unknown): DocumentData {
  if (!isRecord(value)) throw new DatabaseScriptError('INVALID_SDK_RESPONSE');
  if (value.code || value.Error) throw new DatabaseScriptError('CLOUDBASE_REQUEST_FAILED');
  return value;
}

export function documentFromResponse(value: unknown): DocumentData | null {
  const response = successfulResponse(value);
  if (!('data' in response)) throw new DatabaseScriptError('INVALID_DOCUMENT_RESPONSE');
  if (Array.isArray(response.data) && response.data.length > 1) {
    throw new DatabaseScriptError('INVALID_DOCUMENT_RESPONSE');
  }
  // 1.4.3 returns an object/null inside transactions, an array outside them.
  const data: unknown = Array.isArray(response.data) ? response.data[0] : response.data;
  if (data === null || (Array.isArray(response.data) && response.data.length === 0)) return null;
  if (!isRecord(data)) throw new DatabaseScriptError('INVALID_DOCUMENT_RESPONSE');
  return data;
}

function transactionPort(transaction: SdkTransaction): TransactionPort {
  return {
    async get(collection, id) {
      return documentFromResponse(await transaction.collection(collection).doc(id).get());
    },
    async set(collection, id, data) {
      const result = successfulResponse(await transaction.collection(collection).doc(id).set(data));
      // @cloudbase/database 1.4.3 transaction set returns updated and upserted [{ _id }].
      // A generic object without an applied write cannot establish the permanent receipt.
      const inserted =
        result.updated === 0 &&
        Array.isArray(result.upserted) &&
        result.upserted.length === 1 &&
        isRecord(result.upserted[0]) &&
        result.upserted[0]._id === id;
      if (result.updated !== 1 && !inserted) {
        throw new DatabaseScriptError('DOCUMENT_WRITE_NOT_APPLIED');
      }
    },
    async update(collection, id, data) {
      const result = successfulResponse(
        await transaction.collection(collection).doc(id).update(data),
      );
      if (result.updated !== 1) throw new DatabaseScriptError('USER_UPDATE_NOT_APPLIED');
    },
  };
}

export function createDataPort(connection: CloudBaseConnection): DataPort {
  const database: SdkDatabase = cloudbase
    .init({
      env: connection.environmentId,
      secretId: connection.secretId,
      secretKey: connection.secretKey,
      ...(connection.sessionToken ? { sessionToken: connection.sessionToken } : {}),
      ...(connection.region ? { region: connection.region } : {}),
    })
    .database();
  return dataPortFromDatabase(database);
}

/** Injectable SDK boundary; production always supplies the explicitly configured SDK database. */
export function dataPortFromDatabase(database: SdkDatabase): DataPort {
  return {
    transaction: (work) =>
      database.runTransaction((transaction) => work(transactionPort(transaction))),
    serverDate: () => database.serverDate(),
    async findUsers(filter) {
      const result = successfulResponse(
        await database.collection('users').where(filter).limit(2).get(),
      );
      if (!Array.isArray(result.data) || !result.data.every(isRecord)) {
        throw new DatabaseScriptError('INVALID_USERS_RESPONSE');
      }
      return result.data;
    },
  };
}

export function parseIndexes(value: unknown): readonly IndexDefinition[] {
  const result = successfulResponse(value);
  if (!Array.isArray(result.Indexes)) throw new DatabaseScriptError('INVALID_INDEX_RESPONSE');
  return result.Indexes.map((item: unknown) => {
    if (!isRecord(item) || typeof item.Name !== 'string' || !Array.isArray(item.Keys)) {
      throw new DatabaseScriptError('INVALID_INDEX_RESPONSE');
    }
    if (typeof item.Unique !== 'boolean') throw new DatabaseScriptError('INVALID_INDEX_RESPONSE');
    return {
      name: item.Name,
      unique: item.Unique,
      keys: item.Keys.map((key: unknown) => {
        if (!isRecord(key) || typeof key.Name !== 'string') {
          throw new DatabaseScriptError('INVALID_INDEX_RESPONSE');
        }
        const direction = String(key.Direction);
        if (direction !== '1' && direction !== '-1') {
          throw new DatabaseScriptError('UNSUPPORTED_EXISTING_INDEX');
        }
        return { name: key.Name, direction };
      }),
    };
  });
}

export function verifyDenyRule(value: unknown): void {
  let rule: unknown = value;
  if (typeof value === 'string') {
    try {
      rule = JSON.parse(value) as unknown;
    } catch {
      throw new DatabaseScriptError('INVALID_RULE_RESPONSE');
    }
  }
  if (
    !isRecord(rule) ||
    (rule.read !== false && rule.read !== 'false') ||
    (rule.write !== false && rule.write !== 'false') ||
    Object.keys(rule).some((key) => key !== 'read' && key !== 'write')
  ) {
    throw new DatabaseScriptError('DENY_RULE_NOT_CONFIRMED');
  }
}

export function createManagementPort(connection: CloudBaseConnection): ManagementPort {
  const manager = new CloudBaseManager({
    envId: connection.environmentId,
    secretId: connection.secretId,
    secretKey: connection.secretKey,
    ...(connection.sessionToken ? { token: connection.sessionToken } : {}),
    ...(connection.region ? { region: connection.region } : {}),
  });
  return {
    async listCollectionNames() {
      const names: string[] = [];
      for (let offset = 0; ; offset += 100) {
        const response = successfulResponse(
          await manager.database.listCollections({ MgoLimit: 100, MgoOffset: offset }),
        );
        if (!Array.isArray(response.Collections)) {
          throw new DatabaseScriptError('INVALID_COLLECTION_RESPONSE');
        }
        for (const entry of response.Collections as unknown[]) {
          if (!isRecord(entry) || typeof entry.CollectionName !== 'string') {
            throw new DatabaseScriptError('INVALID_COLLECTION_RESPONSE');
          }
          names.push(entry.CollectionName);
        }
        if (response.Collections.length < 100) break;
      }
      return names;
    },
    async createCollection(name) {
      successfulResponse(await manager.database.createCollection(name));
    },
    async denyStorageAccess() {
      successfulResponse(await manager.storage.setStorageAcl('CUSTOM', DENY_CLIENT_ACCESS));
      const acl = successfulResponse(await manager.storage.getStorageAcl({ withRule: true }));
      if (acl.acl !== 'CUSTOM') throw new DatabaseScriptError('DENY_RULE_NOT_CONFIRMED');
      verifyDenyRule(acl.rule);
    },
    async denyCollectionAccess(name) {
      const parameters = {
        CollectionName: name,
        EnvId: connection.environmentId,
        WxAppId: connection.appId,
      };
      successfulResponse(
        await manager.commonService().call({
          Action: 'ModifySafeRule',
          Param: { ...parameters, AclTag: 'CUSTOM', Rule: JSON.stringify(DENY_CLIENT_ACCESS) },
        }),
      );
      const result = successfulResponse(
        await manager.commonService().call({ Action: 'DescribeSafeRule', Param: parameters }),
      );
      if (result.AclTag !== 'CUSTOM') throw new DatabaseScriptError('DENY_RULE_NOT_CONFIRMED');
      verifyDenyRule(result.Rule);
    },
    async getIndexes(name) {
      return parseIndexes(await manager.database.describeCollection(name));
    },
    async createIndex(collection, index) {
      successfulResponse(
        await manager.database.updateCollection(collection, {
          CreateIndexes: [
            {
              IndexName: index.name,
              MgoKeySchema: {
                MgoIsUnique: index.unique,
                MgoIndexKeys: index.keys.map((key) => ({
                  Name: key.name,
                  Direction: key.direction,
                })),
              },
            },
          ],
        }),
      );
    },
  };
}
