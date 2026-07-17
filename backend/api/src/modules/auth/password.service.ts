import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_PREFIX = "scrypt";
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function assertPassword(password: string): string {
  if (!password.trim()) {
    throw new Error("PASSWORD_REQUIRED");
  }

  return password;
}

function parseStoredHash(storedHash: string): { salt: string; derived: string } {
  const [scheme, salt, derived] = storedHash.split(":");

  if (
    scheme !== SCRYPT_PREFIX
    || typeof salt !== "string"
    || typeof derived !== "string"
    || !salt
    || !derived
  ) {
    throw new Error("PASSWORD_HASH_INVALID");
  }

  return { salt, derived };
}

export class PasswordService {
  async hashPassword(password: string): Promise<string> {
    const normalized = assertPassword(password);
    const salt = randomBytes(SALT_BYTES).toString("hex");
    const derived = await scrypt(normalized, salt, KEY_LENGTH) as Buffer;

    return `${SCRYPT_PREFIX}:${salt}:${derived.toString("hex")}`;
  }

  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const normalized = assertPassword(password);

    try {
      const { salt, derived } = parseStoredHash(storedHash);
      const actual = await scrypt(normalized, salt, KEY_LENGTH) as Buffer;
      const expected = Buffer.from(derived, "hex");

      if (expected.length !== actual.length) {
        return false;
      }

      return timingSafeEqual(actual, expected);
    } catch (error) {
      if (error instanceof Error && error.message === "PASSWORD_HASH_INVALID") {
        return false;
      }

      throw error;
    }
  }
}
