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
import { authContextStorage, AuthContext } from './utils/auth_context.js';
import { authMiddleware, tokenGenerationHandler } from './middleware/auth.js';

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
  const PORT = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;

  const app = createMcpExpressApp();

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'observability-mcp',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check endpoint
  app.get('/ready', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ready',
      activeSessions: Object.keys(transports).length,
    });
  });

  // Token generation endpoint (no auth required)
  app.post('/auth/token', tokenGenerationHandler);

  // MCP POST endpoint - handles initialization and tool calls
  app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const credentials = req.credentials;

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

      const context: AuthContext = { credentials };
      await authContextStorage.run(context, async () => {
        await transport.handleRequest(req, res, req.body);
      });
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
  app.get('/mcp', authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const credentials = req.credentials;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    const context: AuthContext = { credentials };
    await authContextStorage.run(context, async () => {
      await transport.handleRequest(req, res);
    });
  });

  // MCP DELETE endpoint - session termination
  app.delete('/mcp', authMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const credentials = req.credentials;

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    try {
      const transport = transports[sessionId];
      const context: AuthContext = { credentials };
      await authContextStorage.run(context, async () => {
        await transport.handleRequest(req, res);
      });
    } catch (error) {
      console.error('Error handling session termination:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`🚀 Cloud Observability MCP HTTP Server listening on port ${PORT}`);
    console.log(`   MCP Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`   Token Endpoint: http://localhost:${PORT}/auth/token`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    for (const sessionId in transports) {
      try {
        await transports[sessionId]?.close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

main().catch((err: unknown) => {
  console.error('❌ Unable to start server:', err instanceof Error ? err : undefined);
  process.exit(1);
});
