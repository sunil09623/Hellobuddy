# HeyBuddy

A minimal, one-to-one real-time chat MVP. It excludes group chats, attachments, voice/video calls, and push notifications.

## Prerequisites (Windows)
Install Node.js LTS (npm is bundled) and Docker Desktop. Start Docker Desktop before using the database.

## First-time setup
From the project root, open PowerShell and run:

```powershell
npm install
npm run setup
```

Copy the server environment template:

```powershell
Copy-Item server/.env.example server/.env
```

Start PostgreSQL:
```powershell
docker compose up -d db
```

Create the database tables:
```powershell
cd server
npx prisma db push
cd ..
```

Start both the backend and frontend together:
```powershell
npm run dev
```

Vite will print the web address, usually **http://localhost:5173**. API health check: http://localhost:4000/health.

## Account troubleshooting
- PostgreSQL must be running and the API must be running for signup/login to work.
- Registration requires email, username (3–24 letters/numbers/underscores), and password (at least 10 characters).
- Login requires email and password; username is not required.
- Use a second browser/incognito profile and create another account to test messaging.

## Mobile UI
On narrow screens, the contacts list is shown first. Selecting a contact switches to the chat view; the back arrow returns to contacts. Desktop keeps contacts and chat side-by-side.

## End-to-end encrypted messages

New messages and conversation-request first messages are encrypted in the browser with AES-256-GCM before they are sent to the API. ECDH P-256 and HKDF-SHA-256 derive the shared key. The server stores and relays ciphertext; it does not decrypt message bodies.

Each account has one encryption key pair, generated automatically after login or registration. The private key is wrapped on the client with AES-GCM using a key derived from the user's existing HeyBuddy password (PBKDF2-SHA-256); the server stores only the wrapped ciphertext. Each browser stores a non-exportable local copy in IndexedDB, and a new browser can restore the same account key at login without asking for another passphrase. Because the existing login API receives the password, the server could derive the wrapping key; this protects stored backups from database-only exposure, not from a malicious server. If an account password is reset without access to the old password, its encrypted history cannot be recovered.

Legacy device-only keys are non-exportable and cannot be rewrapped. On rollout, the app automatically creates an account key; existing ciphertext is retained in the database, but old encrypted history cannot be decrypted with the replacement key. Legacy passphrase-wrapped keys are migrated automatically when the login password can unlock them; otherwise they are replaced and their ciphertext is likewise retained but unreadable.

Contact public keys are trusted on first use and pinned locally. A later key change is blocked. First-use keys are supplied by the server, so this does not protect against a malicious server substituting a key during the first exchange. This design also does not provide forward secrecy.

Before deploying the API update to an existing database, run `npx prisma db push` from `server` to add the account-key backup/version columns and widen message storage columns. Confirm that `DATABASE_URL` and `DIRECT_URL` point to the intended database before running it. Deploy the API/schema before the client; otherwise clients cannot initialize secure messaging.

Blocked users can send messages to the person who blocked them, but those messages are queued without delivery/read receipts or notifications until the blocker unblocks them. Deleting a conversation removes it and its request for both users; a new conversation must start with a fresh request.

## Stack
React + TypeScript + Vite, Express + TypeScript, Socket.IO, Prisma, PostgreSQL.\n
## Before public deployment
This starter still needs a security/reliability review and more tests before production use. Configure HTTPS, replace the development JWT secret, set allowed origins and deployment secrets, add rate limits, and review offline-sync and receipt behavior.

## Neon PostgreSQL setup (no local PostgreSQL required)

1. In Neon, create/rotate a database role password if its connection string was exposed.
2. Copy the **pooled** connection string into `server/.env` as `DATABASE_URL`. Keep its pooler host.
3. Copy the **direct** connection string into `server/.env` as `DIRECT_URL` (non-pooler host). Prisma uses this for schema migrations.
4. Generate a strong random `JWT_SECRET` and set it in `server/.env`. Never commit `.env`.
5. From the project root: `npm run setup`.
6. From `server`: run `npx prisma generate` and `npx prisma db push` to synchronize the database schema. This repository does not include a complete Prisma migration history.
7. Run the backend with `npm run dev` from the server directory; run the frontend with `npm run dev` from client.

Do not use the actual database password in source code or in screenshots. For hosted deployment, configure `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET` as host environment variables/secrets, and set `CLIENT_ORIGIN` to the deployed frontend URL.

## Important version note

The server pins both `prisma` and `@prisma/client` to version `6.8.2`. Keep these versions aligned. From the `server` folder, run `npm install` and then `npx prisma generate`. This avoids accidentally running a newer Prisma CLI against this Prisma 6 starter.
