/**
 * GraphDB Gateway Worker
 * Cloudflare Worker gateway to Neo4j graph database
 *
 * Entry point - delegates to router for request handling
 */

import { handleRequest } from './router';
import { Env } from './types';

/**
 * Cloudflare Worker entry point
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
