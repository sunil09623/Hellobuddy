import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { Server } from 'socket.io';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN, credentials: true } });
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'] as const;
const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  phoneNumber: true,
  firstName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  relationshipStatus: true,
  avatarData: true,
  avatarColor: true
} as const;
type AuthUser = { id: string; username: string; email: string };
type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean };
const summarizeReactions = (reactions: { emoji: string; userId: string }[], userId: string): ReactionSummary[] => {
  const grouped = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const reaction of reactions) {
    const summary = grouped.get(reaction.emoji) || { count: 0, reactedByMe: false };
    summary.count += 1;
    summary.reactedByMe ||= reaction.userId === userId;
    grouped.set(reaction.emoji, summary);
  }
  return [...grouped.entries()].map(([emoji, summary]) => ({ emoji, ...summary }));
};
const auth = (token?: string): AuthUser | null => {
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as AuthUser; } catch { return null; }
};
const tokenFor = (u: AuthUser) => jwt.sign(u, JWT_SECRET, { expiresIn: '7d' });
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
  const schema = z.object({ email: z.string().email().max(254), username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/), password: z.string().min(10).max(100) });
  const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid registration data' });
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({ data: { email: parsed.data.email.trim().toLowerCase(), username: parsed.data.username.trim(), passwordHash: hash }, select: PROFILE_SELECT });
    const token = tokenFor({ id: user.id, username: user.username, email: user.email }); res.cookie('chat_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 }); res.json({ user, token });
  } catch { res.status(409).json({ error: 'Email or username already exists' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.trim().toLowerCase() }, select: { ...PROFILE_SELECT, passwordHash: true } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password' });
  const { passwordHash: _passwordHash, ...safeUser } = user; const token = tokenFor({ id: user.id, username: user.username, email: user.email });
  res.cookie('chat_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 }); res.json({ user: safeUser, token });
});
const getEmailTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const from = process.env.SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from) return null;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      ...(user && pass ? { auth: { user, pass } } : {})
    })
  };
};
app.post('/api/users/me/email-verification/request', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address' });
  const email = parsed.data.email.toLowerCase();
  if (email === user.email.toLowerCase()) return res.status(400).json({ error: 'Enter a different email address' });
  const transportConfig = getEmailTransport();
  if (!transportConfig) return res.status(503).json({ error: 'Email verification is not configured on the server' });
  const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== user.id) return res.status(409).json({ error: 'That email address is already in use' });
  const previous = await prisma.emailVerification.findUnique({ where: { userId: user.id } });
  const now = new Date();
  if (previous && now.getTime() - previous.lastSentAt.getTime() < 60_000) {
    return res.status(429).json({ error: 'Wait before requesting another verification code' });
  }
  const code = randomInt(100000, 1000000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  try {
    await transportConfig.transport.sendMail({
      from: transportConfig.from,
      to: email,
      subject: 'Your HelloBuddy verification code',
      text: `Your HelloBuddy email verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your HelloBuddy email verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`
    });
    await prisma.emailVerification.upsert({
      where: { userId: user.id },
      create: { userId: user.id, email, codeHash, expiresAt: new Date(now.getTime() + 10 * 60_000), lastSentAt: now },
      update: { email, codeHash, expiresAt: new Date(now.getTime() + 10 * 60_000), lastSentAt: now, attempts: 0, verifiedAt: null, consumedAt: null }
    });
    res.json({ message: 'Verification code sent. It expires in 10 minutes.' });
  } catch (error) {
    console.error('Unable to send email verification code', error);
    res.status(502).json({ error: 'Unable to send the verification email. Try again later.' });
  } finally {
    transportConfig.transport.close();
  }
});
app.post('/api/users/me/email-verification/verify', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({ email: z.string().trim().email().max(254), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the six-digit verification code' });
  const email = parsed.data.email.toLowerCase();
  const record = await prisma.emailVerification.findUnique({ where: { userId: user.id } });
  if (!record || record.email !== email || record.consumedAt || record.expiresAt <= new Date()) {
    return res.status(400).json({ error: 'The verification code is invalid or expired' });
  }
  if (record.attempts >= 5) return res.status(429).json({ error: 'Too many incorrect codes. Request a new code.' });
  if (!(await bcrypt.compare(parsed.data.code, record.codeHash))) {
    await prisma.emailVerification.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
    return res.status(400).json({ error: 'The verification code is incorrect' });
  }
  await prisma.emailVerification.update({ where: { userId: user.id }, data: { verifiedAt: new Date() } });
  res.json({ verified: true });
});
const updateProfile: express.RequestHandler = async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({
    username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).optional(),
    email: z.string().trim().email().max(254).optional(),
    phoneNumber: z.string().trim().max(24).regex(/^\+?[0-9().\-\s]*$/).nullable().optional(),
    firstName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().max(80).nullable().optional(),
    gender: z.enum(['FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable().optional(),
    dateOfBirth: z.string().nullable().optional().refine(value => {
      if (value === undefined || value === null) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= today;
    }),
    relationshipStatus: z.enum(['SINGLE', 'MARRIED', 'HIDDEN']).nullable().optional(),
    avatarData: z.string().max(1_400_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
  }).refine(data => Object.keys(data).length > 0).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter valid profile details' });
  const targetEmail = parsed.data.email?.toLowerCase();
  const emailChanged = targetEmail !== undefined && targetEmail !== user.email.toLowerCase();
  if (emailChanged && !targetEmail) return res.status(400).json({ error: 'Enter a valid email address' });
  try {
    const data: Prisma.UserUpdateInput = {};
    if (parsed.data.username !== undefined) data.username = parsed.data.username;
    if (parsed.data.phoneNumber !== undefined) data.phoneNumber = parsed.data.phoneNumber || null;
    if (parsed.data.firstName !== undefined) data.firstName = parsed.data.firstName || null;
    if (parsed.data.lastName !== undefined) data.lastName = parsed.data.lastName || null;
    if (parsed.data.gender !== undefined) data.gender = parsed.data.gender;
    if (parsed.data.dateOfBirth !== undefined) data.dateOfBirth = parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null;
    if (parsed.data.relationshipStatus !== undefined) data.relationshipStatus = parsed.data.relationshipStatus;
    if (parsed.data.avatarData !== undefined) data.avatarData = parsed.data.avatarData;
    if (parsed.data.avatarColor !== undefined) data.avatarColor = parsed.data.avatarColor;
    if (emailChanged) data.email = targetEmail;
    const updated = await prisma.$transaction(async transaction => {
      if (emailChanged) {
        const verification = await transaction.emailVerification.updateMany({
          where: { userId: user.id, email: targetEmail, verifiedAt: { not: null }, expiresAt: { gt: new Date() }, consumedAt: null },
          data: { consumedAt: new Date() }
        });
        if (verification.count !== 1) throw new Error('EMAIL_VERIFICATION_REQUIRED');
      }
      return transaction.user.update({ where: { id: user.id }, data, select: PROFILE_SELECT });
    });
    res.json({ user: updated, token: tokenFor(updated) });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_VERIFICATION_REQUIRED') return res.status(400).json({ error: 'Verify the new email address before saving' });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return res.status(409).json({ error: 'That username or email address is already in use' });
    console.error('Unable to update profile', err);
    res.status(500).json({ error: 'Unable to update profile' });
  }
};
app.patch('/api/users/me/profile', updateProfile);
app.patch('/api/users/me/username', updateProfile);
app.get('/api/public/users/:username', async (req, res) => {
  const parsed = z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).safeParse(req.params.username);
  if (!parsed.success) return res.status(404).json({ error: 'Profile not found' });
  try {
    const profile = await prisma.user.findUnique({
      where: { username: parsed.data },
      select: { username: true, firstName: true, lastName: true, avatarData: true, avatarColor: true }
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile });
  } catch (error) {
    console.error('Unable to load shared profile', error);
    res.status(500).json({ error: 'Unable to load this profile' });
  }
});
app.get('/api/users', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, ''));
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const q = String(req.query.q || '').slice(0, 50);
  const phoneDigits = /^[+\d().\-\s]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const [users, phoneMatches, blocks, memberships] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { not: user.id },
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } }
        ]
      },
      select: { id: true, username: true },
      take: 50
    }),
    phoneDigits.length >= 3
      ? prisma.$queryRaw<{ id: string; username: string }[]>`
          SELECT "id", "username"
          FROM "User"
          WHERE "id" <> ${user.id}
            AND "phoneNumber" IS NOT NULL
            AND regexp_replace("phoneNumber", '[^0-9]', '', 'g') LIKE ${`%${phoneDigits}%`}
          ORDER BY "username"
          LIMIT 50
        `
      : Promise.resolve([]),
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] } }),
    prisma.conversationMember.findMany({ where: { userId: user.id, deletedAt: null }, select: { conversationId: true } })
  ]);
  const otherMemberIds = await prisma.conversationMember.findMany({
    where: { conversationId: { in: memberships.map(member => member.conversationId) }, userId: { not: user.id } },
    select: { userId: true }
  });
  const existingContacts = new Set(otherMemberIds.map(member => member.userId));
  const blockedContacts = new Set(blocks.map(block => block.blockerId === user.id ? block.blockedId : block.blockerId));
  const matches = new Map([...users, ...phoneMatches].map(person => [person.id, person]));
  res.json([...matches.values()].filter(person => !blockedContacts.has(person.id) || existingContacts.has(person.id)).slice(0, 30));
});
app.post('/api/conversations', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({ recipientId: z.string() }).safeParse(req.body); if (!parsed.success || parsed.data.recipientId === user.id) return res.status(400).json({ error: 'Invalid recipient' });
  const recipient = await prisma.user.findUnique({ where: { id: parsed.data.recipientId } }); if (!recipient) return res.status(404).json({ error: 'User not found' });
  const existing = await prisma.conversation.findFirst({ where: { messages: { some: {} }, members: { every: { userId: { in: [user.id, recipient.id] } } }, OR: [{ request: { is: null } }, { request: { is: { status: 'ACCEPTED' } } }], AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: recipient.id } } }] } });
  if (!existing) {
    const block = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: user.id, blockedId: recipient.id }, { blockerId: recipient.id, blockedId: user.id }] } });
    if (block) return res.status(403).json({ error: 'Messaging is unavailable for this contact' });
    return res.status(409).json({ error: 'Send a conversation request before chatting' });
  }
  const block = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: user.id, blockedId: recipient.id }, { blockerId: recipient.id, blockedId: user.id }] } });
  if (block) return res.status(403).json({ error: 'Messaging is unavailable for this contact' });
  res.json(existing);
});
app.get('/api/conversations', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const convos = await prisma.conversation.findMany({
    where: { members: { some: { userId: user.id } }, messages: { some: {} }, OR: [{ request: { is: null } }, { request: { is: { status: 'ACCEPTED' } } }] },
    include: { members: { include: { user: { select: { id: true, username: true } } } } },
    orderBy: { createdAt: 'desc' }
  });
  const otherIds = convos.flatMap(convo => convo.members.filter(member => member.userId !== user.id).map(member => member.userId));
  const [blocks, unreadCounts] = await Promise.all([
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: user.id, blockedId: { in: otherIds } }, { blockedId: user.id, blockerId: { in: otherIds } }] } }),
    Promise.all(convos.map(convo => {
      const currentMember = convo.members.find(member => member.userId === user.id);
      return prisma.message.count({
        where: {
          conversationId: convo.id,
          senderId: { not: user.id },
          receipts: { some: { userId: user.id, readAt: null } },
          ...(currentMember?.clearedAt ? { createdAt: { gt: currentMember.clearedAt } } : {})
        }
      });
    }))
  ]);
  const blockedIds = new Set(blocks.map(block => block.blockerId === user.id ? block.blockedId : block.blockerId));
  res.json(convos.map((convo, index) => ({
    ...convo,
    unreadCount: unreadCounts[index],
    members: convo.members.map(member => member.userId === user.id ? member : { ...member, clearedAt: null, deletedAt: null }),
    blocked: convo.members.some(member => blockedIds.has(member.userId) && member.userId !== user.id)
  })));
});
app.post('/api/conversations/:id/restore', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const where = { conversationId_userId: { conversationId: req.params.id, userId: user.id } };
  const member = await prisma.conversationMember.findUnique({ where, select: { deletedAt: true } });
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  if (member.deletedAt) {
    await prisma.conversationMember.update({ where, data: { deletedAt: null } });
    io.to(`user:${user.id}`).emit('conversation:restored', { conversationId: req.params.id });
  }
  res.json({ ok: true });
});
app.delete('/api/conversations/:id/messages', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const where = { conversationId_userId: { conversationId: req.params.id, userId: user.id } };
  const member = await prisma.conversationMember.findUnique({ where, select: { conversationId: true } });
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  const clearedAt = new Date();
  await prisma.conversationMember.update({ where, data: { clearedAt } });
  io.to(`user:${user.id}`).emit('conversation:cleared', { conversationId: req.params.id, clearedAt: clearedAt.toISOString() });
  res.json({ ok: true, clearedAt: clearedAt.toISOString() });
});
app.delete('/api/conversations/:id', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const where = { conversationId_userId: { conversationId: req.params.id, userId: user.id } };
  const member = await prisma.conversationMember.findUnique({ where, select: { conversationId: true } });
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  const deletedAt = new Date();
  await prisma.conversationMember.update({ where, data: { deletedAt } });
  io.to(`user:${user.id}`).emit('conversation:deleted', { conversationId: req.params.id, deletedAt: deletedAt.toISOString() });
  res.json({ ok: true, deletedAt: deletedAt.toISOString() });
});
app.get('/api/conversation-requests', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const requests = await prisma.conversationRequest.findMany({
    where: { OR: [{ requesterId: user.id }, { recipientId: user.id }] },
    include: { requester: { select: { id: true, username: true } }, recipient: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(requests.map(request => request.requesterId === user.id && request.status === 'DECLINED' ? { ...request, status: 'PENDING' } : request));
});
app.post('/api/conversation-requests', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({ recipientId: z.string().min(1), initialMessage: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success || parsed.data.recipientId === user.id) return res.status(400).json({ error: 'A recipient and first message are required' });
  const [recipient, block, existingConversation, reverseRequest, existingRequest] = await Promise.all([
    prisma.user.findUnique({ where: { id: parsed.data.recipientId }, select: { id: true } }),
    prisma.userBlock.findFirst({ where: { OR: [{ blockerId: user.id, blockedId: parsed.data.recipientId }, { blockerId: parsed.data.recipientId, blockedId: user.id }] } }),
    prisma.conversation.findFirst({ where: { messages: { some: {} }, OR: [{ request: { is: null } }, { request: { is: { status: 'ACCEPTED' } } }], AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: parsed.data.recipientId } } }] } }),
    prisma.conversationRequest.findUnique({ where: { requesterId_recipientId: { requesterId: parsed.data.recipientId, recipientId: user.id } } }),
    prisma.conversationRequest.findUnique({
      where: { requesterId_recipientId: { requesterId: user.id, recipientId: parsed.data.recipientId } },
      include: { requester: { select: { id: true, username: true } }, recipient: { select: { id: true, username: true } } }
    })
  ]);
  if (!recipient) return res.status(404).json({ error: 'User not found' });
  if (block) return res.status(403).json({ error: 'Messaging is unavailable for this contact' });
  if (existingConversation) return res.status(409).json({ error: 'A conversation already exists' });
  if (reverseRequest?.status === 'PENDING') return res.status(409).json({ error: 'This person has already sent you a conversation request' });
  if (existingRequest) {
    const visibleRequest = existingRequest.status === 'DECLINED' ? { ...existingRequest, status: 'PENDING' } : existingRequest;
    return res.status(409).json({ error: 'A conversation request has already been sent', request: visibleRequest });
  }
  try {
    const request = await prisma.conversationRequest.create({
      data: { requesterId: user.id, recipientId: recipient.id, initialMessage: parsed.data.initialMessage },
      include: { requester: { select: { id: true, username: true } }, recipient: { select: { id: true, username: true } } }
    });
    io.to(`user:${recipient.id}`).emit('request:new', { request });
    res.status(201).json(request);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return res.status(409).json({ error: 'A conversation request has already been sent' });
    console.error('Unable to create conversation request', err);
    res.status(500).json({ error: 'Unable to send conversation request' });
  }
});
app.post('/api/conversation-requests/:id/accept', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const requestInclude = {
      requester: { select: { id: true, username: true } },
      recipient: { select: { id: true, username: true } },
      conversation: {
        include: {
          members: { include: { user: { select: { id: true, username: true } } } },
          messages: { where: { clientMessageId: `request-${req.params.id}` }, include: { receipts: true } }
        }
      }
    } satisfies Prisma.ConversationRequestInclude;
    let request = await prisma.conversationRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!request || request.recipientId !== user.id) return res.status(404).json({ error: 'Conversation request not found' });
    if (request.status === 'DECLINED') return res.status(409).json({ error: 'Conversation request is no longer pending' });
    const clientMessageId = `request-${request.id}`;
    if (request.status === 'ACCEPTED' && request.conversation && request.conversation.messages[0]) {
      return res.json({ request, conversation: request.conversation, message: request.conversation.messages[0] });
    }

    const block = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: request.requesterId, blockedId: user.id }, { blockerId: user.id, blockedId: request.requesterId }] } });
    if (block) return res.status(403).json({ error: 'Messaging is unavailable for this contact' });

    let conversation = request.conversation;
    let message = conversation?.messages[0] || null;
    if (!message) {
      const messageData = {
        clientMessageId,
        senderId: request.requesterId,
        body: request.initialMessage,
        receipts: { create: { userId: user.id } }
      };
      if (conversation) {
        try {
          message = await prisma.message.create({
            data: { ...messageData, conversationId: conversation.id },
            include: { receipts: true }
          });
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
          message = await prisma.message.findUnique({
            where: { senderId_clientMessageId: { senderId: request.requesterId, clientMessageId } },
            include: { receipts: true }
          });
          if (!message) throw err;
        }
      } else {
        try {
          conversation = await prisma.conversation.create({
            data: {
              members: { create: [{ userId: request.requesterId }, { userId: user.id }] },
              messages: { create: messageData }
            },
            include: {
              members: { include: { user: { select: { id: true, username: true } } } },
              messages: { include: { receipts: true } }
            }
          });
          message = conversation.messages[0];
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
          const existingMessage = await prisma.message.findUnique({
            where: { senderId_clientMessageId: { senderId: request.requesterId, clientMessageId } },
            include: { receipts: true, conversation: { include: { members: { include: { user: { select: { id: true, username: true } } } }, messages: { where: { clientMessageId }, include: { receipts: true } } } } }
          });
          if (!existingMessage) throw err;
          message = existingMessage;
          conversation = existingMessage.conversation;
        }
      }
    }
    if (!conversation || !message) return res.status(500).json({ error: 'Unable to create conversation' });

    const accepted = await prisma.conversationRequest.updateMany({
      where: { id: request.id, recipientId: user.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', conversationId: conversation.id }
    });
    if (accepted.count) {
      request = { ...request, status: 'ACCEPTED', conversationId: conversation.id, conversation };
    } else {
      request = await prisma.conversationRequest.findUnique({ where: { id: request.id }, include: requestInclude });
    }
    if (!request || request.status !== 'ACCEPTED' || request.conversationId !== conversation.id) {
      if (accepted.count && request?.conversationId !== conversation.id) await prisma.conversation.delete({ where: { id: conversation.id } });
      return res.status(409).json({ error: 'Conversation request is no longer pending' });
    }
    if (accepted.count) {
      const event = { requestId: request.id, status: 'ACCEPTED', conversationId: conversation.id, message };
      io.to(`user:${request.requesterId}`).emit('request:update', event);
      io.to(`user:${user.id}`).emit('request:update', event);
    }
    res.json({ request, conversation, message });
  } catch (err) {
    console.error('Unable to accept conversation request', err);
    res.status(500).json({ error: 'Unable to accept conversation request' });
  }
});
app.post('/api/conversation-requests/:id/decline', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const request = await prisma.conversationRequest.findUnique({ where: { id: req.params.id } });
  if (!request || request.recipientId !== user.id) return res.status(404).json({ error: 'Conversation request not found' });
  if (request.status !== 'PENDING') return res.status(409).json({ error: 'Conversation request is no longer pending' });
  await prisma.conversationRequest.update({ where: { id: request.id }, data: { status: 'DECLINED' } });
  io.to(`user:${user.id}`).emit('request:update', { requestId: request.id, status: 'DECLINED' });
  io.to(`user:${request.requesterId}`).emit('request:update', { requestId: request.id, status: 'DECLINED' });
  res.json({ ok: true });
});
app.get('/api/blocks', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const blocks = await prisma.userBlock.findMany({ where: { blockerId: user.id }, include: { blocked: { select: { id: true, username: true } } }, orderBy: { createdAt: 'desc' } });
  res.json(blocks);
});
app.post('/api/blocks', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success || parsed.data.userId === user.id) return res.status(400).json({ error: 'Invalid user' });
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: target.id } }, create: { blockerId: user.id, blockedId: target.id }, update: {} });
  await prisma.conversationRequest.updateMany({
    where: { OR: [{ requesterId: user.id, recipientId: target.id }, { requesterId: target.id, recipientId: user.id }], status: 'PENDING' },
    data: { status: 'DECLINED' }
  });
  io.to(`user:${target.id}`).emit('block:update', { userId: user.id, blocked: true });
  io.to(`user:${user.id}`).emit('block:update', { userId: target.id, blocked: true });
  res.json({ ok: true });
});
app.delete('/api/blocks/:userId', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  await prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: req.params.userId } });
  io.to(`user:${req.params.userId}`).emit('block:update', { userId: user.id, blocked: false });
  io.to(`user:${user.id}`).emit('block:update', { userId: req.params.userId, blocked: false });
  res.json({ ok: true });
});
app.get('/api/conversations/:id/messages', async (req, res) => {
  const user = auth(req.headers.authorization?.replace(/^Bearer /, '')); if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const convoId = req.params.id; const allowed = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: convoId, userId: user.id } } }); if (!allowed || allowed.deletedAt) return res.status(403).json({ error: 'Forbidden' });
  const before = req.query.before ? new Date(String(req.query.before)) : undefined; const take = Math.min(Number(req.query.limit || 40), 100);
  const dateFilter = { ...(before ? { lt: before } : {}), ...(allowed.clearedAt ? { gt: allowed.clearedAt } : {}) };
  const messages = await prisma.message.findMany({
    where: { conversationId: convoId, ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    include: { receipts: true, reactions: { select: { emoji: true, userId: true } } }
  });
  res.json(messages.reverse().map(message => ({ ...message, reactions: summarizeReactions(message.reactions, user.id) })));
});

io.use((socket, next) => { const token = socket.handshake.auth?.token; const user = auth(token); if (!user) return next(new Error('Unauthorized')); socket.data.user = user; next(); });
io.on('connection', socket => {
  const user = socket.data.user as AuthUser; socket.join(`user:${user.id}`);
  socket.on('conversation:join', async ({ conversationId }) => { const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: user.id } } }); if (member) socket.join(`conversation:${conversationId}`); });
  socket.on('message:send', async (payload, ack) => {
    const data = z.object({ clientMessageId: z.string().uuid(), conversationId: z.string(), body: z.string().trim().min(1).max(4000) }).safeParse(payload);
    if (!data.success) return ack?.({ ok: false, error: 'Invalid message' });
    const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: data.data.conversationId, userId: user.id } } }); if (!member) return ack?.({ ok: false, error: 'Forbidden' });
    try {
      const members = await prisma.conversationMember.findMany({ where: { conversationId: data.data.conversationId } });
      const peerIds = members.filter(member => member.userId !== user.id).map(member => member.userId);
      const block = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: user.id, blockedId: { in: peerIds } }, { blockedId: user.id, blockerId: { in: peerIds } }] } });
      if (block) return ack?.({ ok: false, error: 'Messaging is unavailable for this contact' });
      const message = await prisma.message.upsert({ where: { senderId_clientMessageId: { senderId: user.id, clientMessageId: data.data.clientMessageId } }, update: {}, create: { clientMessageId: data.data.clientMessageId, conversationId: data.data.conversationId, senderId: user.id, body: data.data.body, receipts: { create: peerIds.map(userId => ({ userId })) } }, include: { receipts: true } });
      const restored = await prisma.conversationMember.updateMany({
        where: { conversationId: message.conversationId, deletedAt: { not: null } },
        data: { deletedAt: null }
      });
      if (restored.count) {
        for (const member of members) io.to(`user:${member.userId}`).emit('conversation:restored', { conversationId: message.conversationId });
      }
      ack?.({ ok: true, message });
      io.to(`conversation:${message.conversationId}`).emit('message:new', message);
      for (const member of members) io.to(`user:${member.userId}`).emit('message:new', message);
    } catch (err) {
      console.error('Unable to persist message', err);
      ack?.({ ok: false, error: 'Unable to persist message' });
    }
  });
  socket.on('reaction:toggle', async (payload, ack) => {
    const data = z.object({ messageId: z.string().min(1), emoji: z.enum(REACTION_EMOJIS) }).safeParse(payload);
    if (!data.success) return ack?.({ ok: false, error: 'Invalid reaction' });
    try {
      const message = await prisma.message.findFirst({
        where: { id: data.data.messageId, conversation: { members: { some: { userId: user.id } } } },
        select: { id: true, conversationId: true, createdAt: true }
      });
      if (!message) return ack?.({ ok: false, error: 'Message not found' });
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId: user.id } },
        select: { clearedAt: true, deletedAt: true }
      });
      if (!member || member.deletedAt || (member.clearedAt && message.createdAt <= member.clearedAt)) return ack?.({ ok: false, error: 'Message not found' });

      const where = { messageId_userId_emoji: { messageId: message.id, userId: user.id, emoji: data.data.emoji } };
      const existing = await prisma.messageReaction.deleteMany({ where: where.messageId_userId_emoji });
      if (!existing.count) {
        try {
          await prisma.messageReaction.create({ data: { messageId: message.id, userId: user.id, emoji: data.data.emoji } });
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
        }
      }
      const [reactions, members] = await Promise.all([
        prisma.messageReaction.findMany({ where: { messageId: message.id }, select: { emoji: true, userId: true } }),
        prisma.conversationMember.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })
      ]);
      for (const conversationMember of members) {
        io.to(`user:${conversationMember.userId}`).emit('reaction:update', {
          messageId: message.id,
          reactions: summarizeReactions(reactions, conversationMember.userId)
        });
      }
      ack?.({ ok: true });
    } catch (err) {
      console.error('Unable to update message reaction', err);
      ack?.({ ok: false, error: 'Unable to update reaction' });
    }
  });
  socket.on('receipt:delivered', async payload => {
    const data = z.object({ messageId: z.string().min(1) }).safeParse(payload);
    if (!data.success) return;
    try {
      const receipt = await prisma.messageReceipt.update({
        where: { messageId_userId: { messageId: data.data.messageId, userId: user.id }, deliveredAt: null },
        data: { deliveredAt: new Date() },
        include: { message: { select: { senderId: true, conversationId: true } } }
      });
      const update = { messageId: data.data.messageId, conversationId: receipt.message.conversationId, userId: user.id, deliveredAt: receipt.deliveredAt?.toISOString() || null, readAt: receipt.readAt?.toISOString() || null };
      io.to(`user:${receipt.message.senderId}`).emit('receipt:update', update);
      io.to(`user:${user.id}`).emit('receipt:update', update);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return;
      console.error('Unable to update delivery receipt', err);
    }
  });
  socket.on('receipt:read', async payload => {
    const parsed = z.object({ messageIds: z.array(z.string().min(1)).max(100) }).safeParse(payload);
    if (!parsed.success) return;
    try {
      const messages = await prisma.message.findMany({
        where: {
          id: { in: parsed.data.messageIds },
          senderId: { not: user.id },
          conversation: { members: { some: { userId: user.id } } },
          receipts: { some: { userId: user.id, readAt: null } }
        },
        select: { id: true, senderId: true, conversationId: true }
      });
      if (!messages.length) return;
      const readAt = new Date();
      await prisma.messageReceipt.updateMany({
        where: { messageId: { in: messages.map(message => message.id) }, userId: user.id, readAt: null },
        data: { readAt, deliveredAt: readAt }
      });
      const update = { userId: user.id, deliveredAt: readAt.toISOString(), readAt: readAt.toISOString() };
      for (const message of messages) {
        const receiptUpdate = { ...update, messageId: message.id, conversationId: message.conversationId };
        io.to(`user:${message.senderId}`).emit('receipt:update', receiptUpdate);
        io.to(`user:${user.id}`).emit('receipt:update', receiptUpdate);
      }
    } catch (err) {
      console.error('Unable to update read receipts', err);
    }
  });
});
server.listen(Number(process.env.PORT || 4000), () => console.log(`HelloBuddy API listening on ${process.env.PORT || 4000}`));
