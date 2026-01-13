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

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

// GCP Service Account credentials structure
export interface GcpCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

interface EncryptedPayload {
  iv: string;
  data: string;
  tag: string;
}

interface JwtPayload {
  enc: EncryptedPayload;
  iat?: number;
  exp?: number;
}

// Environment variables validation
const JWT_SECRET = process.env['JWT_SECRET'];
const JWT_EXPIRES_IN = process.env['JWT_EXPIRES_IN'] || '1h';
const ENCRYPTION_KEY = process.env['ENCRYPTION_KEY'];
const ENCRYPTION_SALT = process.env['ENCRYPTION_SALT'];

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY or JWT_SECRET environment variable is required');
}

if (!ENCRYPTION_SALT) {
  throw new Error('ENCRYPTION_SALT environment variable is required');
}

// Encryption options
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Get encryption key.
 */
function getEncryptionKey(): Buffer {
  return scryptSync(ENCRYPTION_KEY!, ENCRYPTION_SALT!, 32);
}

/**
 * Encrypt credentials using AES-256-GCM.
 */
function encryptCredentials(credentials: GcpCredentials): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const jsonData = JSON.stringify(credentials);
  let encrypted = cipher.update(jsonData, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    data: encrypted,
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt credentials from encrypted payload.
 */
function decryptCredentials(payload: EncryptedPayload): GcpCredentials {
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(payload.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as GcpCredentials;
}

/**
 * Generate a JWT access token with encrypted GCP credentials.
 */
export function generateAccessToken(credentials: GcpCredentials): string {
  const encryptedPayload = encryptCredentials(credentials);

  const options: jwt.SignOptions = {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  };

  return jwt.sign({ enc: encryptedPayload }, JWT_SECRET!, options);
}

/**
 * Verify and decode a JWT access token.
 */
export function verifyAccessToken(token: string): GcpCredentials {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    if (!decoded.enc) {
      throw new Error('Invalid token payload: missing encrypted credentials');
    }

    return decryptCredentials(decoded.enc);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Access token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error(`Invalid access token: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1] || null;
}
