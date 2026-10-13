import { getToken } from './token'

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const ITERATIONS = 100000;

function getKeyMaterial(): string | null {
  return getToken();
}

function getSalt(): Uint8Array<ArrayBuffer> {
  const existing = sessionStorage.getItem('swiftchat_salt');
  if (existing) {
    const parts = existing.split(',');
    return new Uint8Array(parts.map(Number));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  sessionStorage.setItem('swiftchat_salt', Array.from(salt).join(','));
  return salt;
}

async function deriveKey(material: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyData = await crypto.subtle.importKey(
    'raw', enc.encode(material), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyData,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}



export async function encrypt(plaintext: string): Promise<string> {
  try {
    const material = getKeyMaterial();
    if (!material) return '';
    const salt = getSalt();
    const key = await deriveKey(material, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      enc.encode(plaintext)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch {
    return '';
  }
}

export async function decrypt(ciphertext: string): Promise<string> {
  try {
    const material = getKeyMaterial();
    if (!material) return '';
    const salt = getSalt();
    const key = await deriveKey(material, salt);
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return '';
  }
}

export async function encryptStorage<T>(key: string, value: T): Promise<void> {
  try {
    const json = JSON.stringify(value);
    const encrypted = await encrypt(json);
    if (encrypted) sessionStorage.setItem(key, encrypted);
  } catch { /* ignored */ }
}

export async function decryptStorage<T>(key: string): Promise<T | null> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const decrypted = await decrypt(raw);
    if (!decrypted) return null;
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

export function clearEncryptionSalt(): void {
  sessionStorage.removeItem('swiftchat_salt');
}
