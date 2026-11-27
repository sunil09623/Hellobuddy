const DATABASE_NAME = 'hellobuddy-encryption';
const DATABASE_VERSION = 1;
const IDENTITY_STORE = 'identities';
const PEER_KEY_STORE = 'peer-keys';
export const ENCRYPTED_MESSAGE_PREFIX = 'hb-e2ee:v1:';
const encoder = new TextEncoder();

export type EncryptionPublicKey = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

export type EncryptionIdentity = {
  userId: string;
  privateKey: CryptoKey;
  publicKey: EncryptionPublicKey;
};

export type EncryptionContext =
  | { kind: 'message'; conversationId: string; clientMessageId: string; senderId: string; recipientId: string }
  | { kind: 'request'; requestId: string; requesterId: string; recipientId: string };

type StoredPeerKey = { id: string; publicKey: EncryptionPublicKey };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) database.createObjectStore(IDENTITY_STORE, { keyPath: 'userId' });
      if (!database.objectStoreNames.contains(PEER_KEY_STORE)) database.createObjectStore(PEER_KEY_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local encryption storage'));
    request.onblocked = () => reject(new Error('Local encryption storage is blocked by another browser tab'));
  });
}

function readRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    let result: T | undefined;
    transaction.objectStore(storeName).get(key).onsuccess = event => {
      result = (event.target as IDBRequest<T | undefined>).result;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to read local encryption storage'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Local encryption storage read was interrupted'));
    };
  }));
}

function writeRecord(storeName: string, value: object): Promise<void> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to write local encryption storage'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Local encryption storage write was interrupted'));
    };
  }));
}

function deleteRecord(storeName: string, key: string): Promise<void> {
  return openDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Unable to update local encryption storage'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Local encryption storage update was interrupted'));
    };
  }));
}

export function parseEncryptionPublicKey(value: unknown): EncryptionPublicKey {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid encryption public key');
  const key = value as Record<string, unknown>;
  if (key.kty !== 'EC' || key.crv !== 'P-256' ||
      typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
      typeof key.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.y)) {
    throw new Error('Invalid encryption public key');
  }
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
}

function samePublicKey(a: EncryptionPublicKey, b: EncryptionPublicKey) {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

export async function loadLocalIdentity(userId: string) {
  return readRecord<EncryptionIdentity>(IDENTITY_STORE, userId);
}

export async function createLocalIdentity(userId: string): Promise<EncryptionIdentity> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = parseEncryptionPublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey));
  return { userId, privateKey: pair.privateKey, publicKey };
}

export async function saveLocalIdentity(identity: EncryptionIdentity) {
  await writeRecord(IDENTITY_STORE, identity);
}

export async function removeLocalIdentity(userId: string) {
  await deleteRecord(IDENTITY_STORE, userId);
}

export async function pinPeerPublicKey(ownerId: string, peerId: string, value: unknown) {
  const publicKey = parseEncryptionPublicKey(value);
  const id = `${ownerId}:${peerId}`;
  const saved = await readRecord<StoredPeerKey>(PEER_KEY_STORE, id);
  if (saved && !samePublicKey(saved.publicKey, publicKey)) {
    throw new Error("This contact's encryption key changed. Verify their identity before continuing.");
  }
  if (!saved) await writeRecord(PEER_KEY_STORE, { id, publicKey } satisfies StoredPeerKey);
  return publicKey;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encrypted message');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function contextData(context: EncryptionContext) {
  if (context.kind === 'request') {
    return `${ENCRYPTED_MESSAGE_PREFIX}request:${context.requestId}:${context.requesterId}:${context.recipientId}`;
  }
  return `${ENCRYPTED_MESSAGE_PREFIX}message:${context.conversationId}:${context.senderId}:${context.recipientId}:${context.clientMessageId}`;
}

async function deriveMessageKey(identity: EncryptionIdentity, peerKey: EncryptionPublicKey, senderId: string, recipientId: string) {
  if (identity.userId !== senderId && identity.userId !== recipientId) throw new Error('Encryption identity does not match the message participants');
  const publicKey = await crypto.subtle.importKey('jwk', peerKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, identity.privateKey, 256);
  const keyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const participants = [senderId, recipientId].sort().join(':');
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode('HelloBuddy E2EE salt v1'),
    info: encoder.encode(`${ENCRYPTED_MESSAGE_PREFIX}${participants}`)
  }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(plaintext: string, identity: EncryptionIdentity, peerKey: EncryptionPublicKey, context: EncryptionContext) {
  const senderId = context.kind === 'request' ? context.requesterId : context.senderId;
  const key = await deriveMessageKey(identity, peerKey, senderId, context.recipientId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encoder.encode(contextData(context)),
    tagLength: 128
  }, key, encoder.encode(plaintext));
  return `${ENCRYPTED_MESSAGE_PREFIX}${encodeBase64Url(iv)}:${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptText(envelope: string, identity: EncryptionIdentity, peerKey: EncryptionPublicKey, context: EncryptionContext) {
  if (!envelope.startsWith(ENCRYPTED_MESSAGE_PREFIX)) return envelope;
  const [prefix, version, encodedIv, encodedCiphertext, extra] = envelope.split(':');
  if (prefix !== 'hb-e2ee' || version !== 'v1' || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new Error('Invalid encrypted message');
  }
  const senderId = context.kind === 'request' ? context.requesterId : context.senderId;
  const key = await deriveMessageKey(identity, peerKey, senderId, context.recipientId);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: decodeBase64Url(encodedIv),
    additionalData: encoder.encode(contextData(context)),
    tagLength: 128
  }, key, decodeBase64Url(encodedCiphertext));
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}
