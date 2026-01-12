#!/usr/bin/env node

/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools/registration.js';
import pkg from '../package.json' with { type: 'json' };

console.log('GOOGLE_APPLICATION_CREDENTIALS', process.env['GOOGLE_APPLICATION_CREDENTIALS']);

const getServer = (): McpServer => {
  const server = new McpServer({
    name: 'observability-mcp',
    version: pkg.version,
    title: 'Cloud Observability MCP',
  });
  registerTools(server);
  return server;
};

// Map to store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

const main = async () => {
  const MCP_PORT = process.env['MCP_PORT'] ? parseInt(process.env['MCP_PORT'], 10) : 3000;

  const app = createMcpExpressApp();

  // Health check endpoint for Docker/Kubernetes
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'observability-mcp',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check endpoint
  app.get('/ready', (_req: Request, res: Response) => {
    // Check if server is ready to accept requests
    const isReady = Object.keys(transports).length >= 0; // Simple check
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        activeSessions: Object.keys(transports).length,
      });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
  });

  // MCP POST endpoint - handles initialization and tool calls
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId) {
      console.log(`Received MCP request for session: ${sessionId}`);
    } else {
      console.log('New MCP request without session ID');
    }

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId: string) => {
            console.log(`Session initialized with ID: ${newSessionId}`);
            transports[newSessionId] = transport;
          },
        });

        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`Transport closed for session ${sid}, removing from transports map`);
            delete transports[sid];
          }
        };

        // Connect the transport to the MCP server
        const server = getServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request with existing transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  // MCP GET endpoint - handles SSE streams
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
      console.log(`Establishing new SSE stream for session ${sessionId}`);
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // MCP DELETE endpoint - handles session termination
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    console.log(`Received session termination request for session ${sessionId}`);

    try {
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling session termination:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  // Start the HTTP server
  app.listen(MCP_PORT, () => {
    console.log(`🚀 Cloud Observability MCP HTTP Server listening on port ${MCP_PORT}`);
    console.log(`   Endpoint: http://localhost:${MCP_PORT}/mcp`);
  });

  // Handle server shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down server...');

    // Close all active transports
    for (const sessionId in transports) {
      try {
        console.log(`Closing transport for session ${sessionId}`);
        const transport = transports[sessionId];
        if (transport) {
          await transport.close();
          delete transports[sessionId];
        }
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }

    console.log('Server shutdown complete');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');

    for (const sessionId in transports) {
      try {
        const transport = transports[sessionId];
        if (transport) {
          await transport.close();
          delete transports[sessionId];
        }
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error);
      }
    }

    process.exit(0);
  });
};

main().catch((err: unknown) => {
  const error = err instanceof Error ? err : undefined;
  console.error('❌ Unable to start Cloud Observability MCP HTTP server.', error);
  process.exit(1);
});
