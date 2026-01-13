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

import { Request, Response, NextFunction } from 'express';
import {
  verifyAccessToken,
  extractBearerToken,
  generateAccessToken,
  GcpCredentials,
} from '../utils/auth.js';

// Extend Express Request to include credentials
declare global {
  namespace Express {
    interface Request {
      credentials: GcpCredentials;
    }
  }
}

/**
 * Middleware to handle token generation.
 */
export function tokenGenerationHandler(req: Request, res: Response): void {
  try {
    const credentials = req.body as GcpCredentials;

    // Validate required fields
    if (
      !credentials.type ||
      !credentials.project_id ||
      !credentials.private_key ||
      !credentials.client_email
    ) {
      res.status(400).json({
        error: 'Invalid credentials: missing required fields',
        required: ['type', 'project_id', 'private_key', 'client_email'],
      });
      return;
    }

    // Validate type field
    if (credentials.type !== 'service_account') {
      res.status(400).json({
        error: 'Invalid credentials: type must be "service_account"',
      });
      return;
    }

    const token = generateAccessToken(credentials);

    res.status(200).json({
      access_token: token,
      token_type: 'Bearer',
    });
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({
      error: 'Failed to generate access token',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Middleware to authenticate MCP requests.
 * Requires Bearer token in Authorization header for every request.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] as string | undefined;
  const token = extractBearerToken(authHeader);

  if (!token) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized: Authorization header with Bearer token is required',
      },
      id: null,
    });
    return;
  }

  try {
    const credentials = verifyAccessToken(token);
    req.credentials = credentials;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `Unauthorized: ${error instanceof Error ? error.message : 'Invalid token'}`,
      },
      id: null,
    });
  }
}
