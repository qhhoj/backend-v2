import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Connection as CallbackConnection } from 'mysql2';
import { createPool, Pool } from 'mysql2/promise';

@Injectable()
export class LegacySourceService implements OnModuleDestroy {
  private readonly pool: Pool = createPool({
    uri: process.env.LEGACY_MYSQL_URL,
    timezone: 'Z',
    supportBigNumbers: true,
    connectionLimit: 4,
  });

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params))[0] as T[];
  }

  async *stream<T>(sql: string): AsyncGenerator<T> {
    const connection = await this.pool.getConnection();
    try {
      const callbackConnection =
        connection.connection as unknown as CallbackConnection;
      for await (const row of callbackConnection.query(sql).stream())
        yield row as T;
    } finally {
      connection.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
