import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { decodeUtcDateTime, encodeUtcDateTime } from './date-codec.js';

import type { AuditLogQuery, AuditLogRecord, Page } from './types.js';

type Executor = Pool | PoolConnection;
type SqlValue = string | number | Date;

function validatePage(query: AuditLogQuery): void {
  if (!Number.isInteger(query.page) || query.page < 1) {
    throw new RangeError('page must be an integer greater than or equal to 1');
  }
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    throw new RangeError('pageSize must be an integer between 1 and 100');
  }
}

function matches(record: AuditLogRecord, query: AuditLogQuery): boolean {
  const createdAt = Date.parse(record.createdAt);
  return (
    (query.actorUid === undefined || record.actorUid === query.actorUid) &&
    (query.action === undefined || record.action === query.action) &&
    (query.resourceType === undefined || record.resourceType === query.resourceType) &&
    (query.resourceId === undefined || record.resourceId === query.resourceId) &&
    (query.from === undefined || createdAt >= Date.parse(query.from)) &&
    (query.to === undefined || createdAt <= Date.parse(query.to))
  );
}

export function queryMemoryAuditLogs(
  records: readonly AuditLogRecord[],
  query: AuditLogQuery,
): Page<AuditLogRecord> {
  validatePage(query);
  const matchesQuery = records
    .filter((record) => matches(record, query))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id),
    );
  const offset = (query.page - 1) * query.pageSize;
  return {
    items: structuredClone(matchesQuery.slice(offset, offset + query.pageSize)),
    page: query.page,
    pageSize: query.pageSize,
    total: matchesQuery.length,
  };
}

function buildWhere(query: AuditLogQuery): { where: string; values: SqlValue[] } {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  for (const [property, column] of [
    ['actorUid', 'actor_uid'],
    ['action', 'action'],
    ['resourceType', 'resource_type'],
    ['resourceId', 'resource_id'],
  ] as const) {
    const value = query[property];
    if (value === undefined) continue;
    clauses.push(`${column} = ?`);
    values.push(value);
  }
  if (query.from !== undefined) {
    clauses.push('created_at >= ?');
    const value = encodeUtcDateTime(query.from);
    if (value === null) throw new TypeError('from must be a UTC date-time');
    values.push(value);
  }
  if (query.to !== undefined) {
    clauses.push('created_at <= ?');
    const value = encodeUtcDateTime(query.to);
    if (value === null) throw new TypeError('to must be a UTC date-time');
    values.push(value);
  }
  return {
    where: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`,
    values,
  };
}

function details(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  return {};
}

function decode(row: RowDataPacket): AuditLogRecord {
  return {
    id: String(row.id),
    actorUid: String(row.actor_uid),
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    details: details(row.details),
    status: String(row.status),
    ownerUid: String(row.owner_uid),
    scope: { type: String(row.scope_type), id: String(row.scope_id) },
    createdAt: decodeUtcDateTime(row.created_at),
    updatedAt: decodeUtcDateTime(row.updated_at),
  };
}

export async function queryMySqlAuditLogs(
  executor: Executor,
  query: AuditLogQuery,
): Promise<Page<AuditLogRecord>> {
  validatePage(query);
  const { where, values } = buildWhere(query);
  const [countRows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM audit_logs${where}`,
    values,
  );
  const total = Number(countRows[0]?.total);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('MySQL returned an invalid audit log count');
  }
  const offset = (query.page - 1) * query.pageSize;
  const [rows] = await executor.query<RowDataPacket[]>(
    `SELECT * FROM audit_logs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...values, query.pageSize, offset],
  );
  return {
    items: rows.map(decode),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
