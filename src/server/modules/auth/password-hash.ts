import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { normalizePassword } from "@/server/modules/auth/password-policy";

/**
 * Password hashing with Node's built-in scrypt (ADR-0008, ADR-0013).
 *
 * Stored format: `scrypt$N=<cost>,r=<blockSize>,p=<parallelization>$<salt>$<hash>`
 * (salt and hash in base64url). The parameters travel with the hash, so they
 * can be raised later without breaking existing hashes.
 */
export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
  saltLength: number;
}

/** OWASP-listed scrypt setting: N=2^16, r=8, p=2 (64 MiB per hash). */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 2 ** 16,
  r: 8,
  p: 2,
  keyLength: 32,
  saltLength: 16,
};

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  /**
   * Spends the same work as a real verification. Used when no account matches
   * a login, so response time does not reveal whether an email is registered.
   */
  verifyDummy(password: string): Promise<void>;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // Node rejects the call when 128 * N * r exceeds maxmem.
    maxmem: 256 * params.N * params.r,
  };
  return new Promise((resolve, reject) => {
    scrypt(normalizePassword(password), salt, params.keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const STORED_FORMAT = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function parseStored(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const match = STORED_FORMAT.exec(stored);
  if (!match) {
    return null;
  }
  const salt = Buffer.from(match[4], "base64url");
  const key = Buffer.from(match[5], "base64url");
  return {
    params: {
      N: Number(match[1]),
      r: Number(match[2]),
      p: Number(match[3]),
      keyLength: key.length,
      saltLength: salt.length,
    },
    salt,
    key,
  };
}

export function createScryptHasher(params: ScryptParams = DEFAULT_SCRYPT_PARAMS): PasswordHasher {
  let dummyHash: Promise<string> | undefined;

  const hasher: PasswordHasher = {
    async hash(password) {
      const salt = randomBytes(params.saltLength);
      const key = await derive(password, salt, params);
      return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
    },

    async verify(password, stored) {
      const parsed = parseStored(stored);
      if (!parsed || parsed.key.length === 0) {
        return false;
      }
      const candidate = await derive(password, parsed.salt, parsed.params);
      return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
    },

    async verifyDummy(password) {
      dummyHash ??= hasher.hash(randomBytes(16).toString("base64url"));
      await hasher.verify(password, await dummyHash);
    },
  };
  return hasher;
}
