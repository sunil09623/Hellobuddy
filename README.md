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
npx prisma migrate dev --name init
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
6. From `server`: `npx prisma generate` then `npx prisma migrate deploy` (for an existing migration history). For a fresh development database without committed migrations, use `npx prisma migrate dev --name init`.
7. Run the backend with `npm run dev` from the server directory; run the frontend with `npm run dev` from client.

Do not use the actual database password in source code or in screenshots. For hosted deployment, configure `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET` as host environment variables/secrets, and set `CLIENT_ORIGIN` to the deployed frontend URL.

## Important version note

The server pins both `prisma` and `@prisma/client` to version `6.8.2`. Keep these versions aligned. From the `server` folder, run `npm install` and then `npx prisma generate`. This avoids accidentally running a newer Prisma CLI against this Prisma 6 starter.
