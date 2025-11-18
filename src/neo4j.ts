/**
 * Neo4j connection module for Cloudflare Workers
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import { Env } from './types';

/**
 * Create a Neo4j driver instance
 * Note: In Cloudflare Workers, we create a new driver for each request
 * due to the stateless nature of edge functions
 */
export function createDriver(env: Env): Driver {
  return neo4j.driver(
    env.NEO4J_URI,
    neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD),
    {
      maxConnectionLifetime: 30 * 60 * 1000, // 30 minutes
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
    }
  );
}

/**
 * Execute a query with automatic driver lifecycle management
 */
export async function executeQuery<T = any>(
  env: Env,
  query: string,
  params: Record<string, any> = {}
): Promise<{ records: any[]; summary: any }> {
  const driver = createDriver(env);
  try {
    const result = await driver.executeQuery(query, params, {
      database: env.NEO4J_DATABASE,
    });
    return {
      records: result.records,
      summary: result.summary,
    };
  } finally {
    await driver.close();
  }
}
