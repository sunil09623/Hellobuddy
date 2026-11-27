import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, Ban, Check, Eraser, MessageCircle, MoreVertical, Search, Send, Share2, ShieldCheck, Smile, Trash2, UserRoundX, X } from 'lucide-react';
import { API } from '../config';
import type { User } from '../types';
import { ProfileEditor } from './ProfileEditor';

type Receipt = { userId: string; deliveredAt: string | null; readAt: string | null };
type Reaction = { emoji: string; count: number; reactedByMe: boolean };
type Message = { id: string; clientMessageId: string; conversationId: string; senderId: string; body: string; createdAt: string; receipts?: Receipt[]; reactions?: Reaction[] };
type ReceiptUpdate = { messageId: string; conversationId: string; userId: string; deliveredAt: string | null; readAt: string | null };
type Conversation = { id: string; unreadCount: number; members: { userId: string; user: User; clearedAt?: string | null; deletedAt?: string | null }[]; blocked: boolean };
type ConversationRequest = {
  id: string;
  requesterId: string;
  recipientId: string;
  initialMessage: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  conversationId: string | null;
  requester: User;
  recipient: User;
};
type Block = { blocked: User };
type ChatMode = 'new' | 'incoming' | 'outgoing' | 'chat';
type SidebarView = 'chats' | 'requests' | 'blocked';
type DashboardProps = {
  user: User;
  token: string;
  onUserChange: (user: User) => void;
  onTokenChange: (token: string) => void;
  onLogout: () => void;
};
const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'];

export function Dashboard({ user, token, onUserChange, onTokenChange, onLogout }: DashboardProps) {
  const [people, setPeople] = useState<User[]>([]);
  const [active, setActive] = useState<User | null>(null);
  const [conversation, setConversation] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [requests, setRequests] = useState<ConversationRequest[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>('chats');
  const [chatMode, setChatMode] = useState<ChatMode>('new');
  const [selectedRequest, setSelectedRequest] = useState<ConversationRequest | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [search, setSearch] = useState('');
  const [requestSearch, setRequestSearch] = useState('');
  const [blockedSearch, setBlockedSearch] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileShareLink, setProfileShareLink] = useState('');
  const [profileShareMessage, setProfileShareMessage] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const activeConversationRef = useRef('');
  const recentIncomingMessageIdsRef = useRef(new Set<string>());
  const selectedRequestRef = useRef<ConversationRequest | null>(null);
  const searchRef = useRef(search);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollToBottomAfterSendRef = useRef(false);
  const draftInputRef = useRef<HTMLInputElement>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const profileShareInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  const loadConversations = useCallback(async () => {
    const response = await fetch(`${API}/api/conversations`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json() as Conversation[] | { error?: string };
    if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) ? data.error || 'Unable to load conversations' : 'Unable to load conversations');
    setConversations(data);
    return data;
  }, [token]);

  const loadRequests = useCallback(async () => {
    const response = await fetch(`${API}/api/conversation-requests`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json() as ConversationRequest[] | { error?: string };
    if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) ? data.error || 'Unable to load requests' : 'Unable to load requests');
    setRequests(data);
    return data;
  }, [token]);

  const loadBlocks = useCallback(async () => {
    const response = await fetch(`${API}/api/blocks`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json() as Block[] | { error?: string };
    if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) ? data.error || 'Unable to load blocked users' : 'Unable to load blocked users');
    setBlocks(data);
    return data;
  }, [token]);

  const loadPeople = useCallback(async (query: string, signal?: AbortSignal) => {
    const response = await fetch(`${API}/api/users?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    const data = await response.json() as User[] | { error?: string };
    if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) ? data.error || 'Unable to load contacts' : 'Unable to load contacts');
    setPeople(data);
  }, [token]);

  useEffect(() => {
    activeConversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    selectedRequestRef.current = selectedRequest;
  }, [selectedRequest]);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useLayoutEffect(() => {
    if (!scrollToBottomAfterSendRef.current) return;
    scrollToBottomAfterSendRef.current = false;
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const textarea = draftTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 160;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('focusin', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('focusin', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!emojiPickerOpen && !reactionPickerFor) return;
    const closeOnOutsideInteraction = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node;
      if (emojiPickerOpen && !emojiPickerRef.current?.contains(target)) setEmojiPickerOpen(false);
      if (reactionPickerFor && !reactionPickerRef.current?.contains(target)) setReactionPickerFor(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEmojiPickerOpen(false);
        setReactionPickerFor(null);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('focusin', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('focusin', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [emojiPickerOpen, reactionPickerFor]);

  useEffect(() => {
    void Promise.all([loadConversations(), loadRequests(), loadBlocks()])
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load your chats'));
  }, [loadBlocks, loadConversations, loadRequests]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPeople(search, controller.signal).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load contacts');
    });
    return () => controller.abort();
  }, [loadPeople, search]);

  useEffect(() => {
    const s = io(API, { auth: { token }, reconnection: true });
    setSocket(s);
    s.on('connect_error', () => setError('Live connection interrupted. Retrying automatically…'));
    s.on('connect', () => setError(''));
    s.on('message:new', (message: Message) => {
      if (message.senderId !== user.id) {
        s.emit('receipt:delivered', { messageId: message.id });
        const recentMessageIds = recentIncomingMessageIdsRef.current;
        const isNewMessage = !recentMessageIds.has(message.id);
        if (isNewMessage) {
          recentMessageIds.add(message.id);
          if (recentMessageIds.size > 500) {
            const oldestMessageId = recentMessageIds.values().next().value;
            if (oldestMessageId !== undefined) recentMessageIds.delete(oldestMessageId);
          }
        }
        const conversationIsVisible = message.conversationId === activeConversationRef.current && document.visibilityState === 'visible';
        if (isNewMessage && !conversationIsVisible) {
          setConversations(prev => prev.map(item => item.id === message.conversationId
            ? { ...item, unreadCount: item.unreadCount + 1 }
            : item));
        }
      }
      if (message.conversationId !== activeConversationRef.current) return;
      setMessages(prev => prev.some(item => item.id === message.id || item.clientMessageId === message.clientMessageId)
        ? prev
        : [...prev, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    });
    s.on('receipt:update', (update: ReceiptUpdate) => {
      if (update.userId === user.id && update.readAt) {
        setConversations(prev => prev.map(item => item.id === update.conversationId
          ? { ...item, unreadCount: Math.max(0, item.unreadCount - 1) }
          : item));
      }
      setMessages(prev => prev.map(item => {
        if (item.id !== update.messageId) return item;
        const receipts = item.receipts || [];
        const hasReceipt = receipts.some(receipt => receipt.userId === update.userId);
        return {
          ...item,
          receipts: hasReceipt
            ? receipts.map(receipt => receipt.userId === update.userId ? { ...receipt, deliveredAt: update.deliveredAt, readAt: update.readAt } : receipt)
            : [...receipts, { userId: update.userId, deliveredAt: update.deliveredAt, readAt: update.readAt }]
        };
      }));
    });
    s.on('reaction:update', (update: { messageId: string; reactions: Reaction[] }) => {
      setMessages(prev => prev.map(message => message.id === update.messageId
        ? { ...message, reactions: update.reactions }
        : message));
    });
    s.on('conversation:cleared', (event: { conversationId: string }) => {
      setConversations(prev => prev.map(item => item.id === event.conversationId ? { ...item, unreadCount: 0 } : item));
      if (activeConversationRef.current === event.conversationId) setMessages([]);
    });
    s.on('conversation:deleted', (event: { conversationId: string; deletedAt: string }) => {
      setConversations(prev => prev.map(item => item.id !== event.conversationId ? item : {
        ...item,
        members: item.members.map(member => member.userId === user.id ? { ...member, deletedAt: event.deletedAt } : member)
      }));
      if (activeConversationRef.current === event.conversationId) {
        setActive(null);
        setConversation('');
        setMessages([]);
        setSelectedRequest(null);
      }
      setMoreOpen(false);
    });
    s.on('conversation:restored', () => {
      void loadConversations().catch(err => setError(err instanceof Error ? err.message : 'Unable to refresh conversations'));
    });
    s.on('request:new', (event: { request: ConversationRequest }) => {
      setRequests(prev => [event.request, ...prev.filter(request => request.id !== event.request.id)]);
    });
    s.on('request:update', (update: { requestId: string; status: string; conversationId?: string; message?: Message }) => {
      const requestStatus = update.status === 'DECLINED' ? 'DECLINED' : update.status as ConversationRequest['status'];
      setRequests(prev => prev.map(request => request.id === update.requestId
        ? { ...request, status: requestStatus === 'DECLINED' && request.requesterId === user.id ? 'PENDING' : requestStatus, conversationId: update.conversationId || request.conversationId }
        : request));
      const request = selectedRequestRef.current;
      if (request?.id !== update.requestId) return;
      if (update.status === 'ACCEPTED' && update.conversationId) {
        setSelectedRequest({ ...request, status: 'ACCEPTED', conversationId: update.conversationId });
        const person = request.requesterId === user.id ? request.recipient : request.requester;
        void showConversation(person, update.conversationId, update.message ? [update.message] : undefined);
      } else if (update.status === 'DECLINED' && request.requesterId === user.id) {
        setSelectedRequest({ ...request, status: 'PENDING' });
      } else if (update.status === 'DECLINED') {
        setSelectedRequest(null);
        setChatMode('new');
      }
    });
    s.on('block:update', () => {
      void Promise.all([loadBlocks(), loadConversations(), loadPeople(searchRef.current)])
        .catch(err => setError(err instanceof Error ? err.message : 'Unable to refresh blocked users'));
    });
    return () => { s.disconnect(); setSocket(null); };
  }, [loadBlocks, loadConversations, loadPeople, loadRequests, token, user.id]);

  async function restoreConversation(conversationId: string) {
    try {
      const response = await fetch(`${API}/api/conversations/${conversationId}/restore`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to restore conversation');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore conversation');
      return false;
    }
  }

  async function showConversation(person: User, conversationId: string, prefetchedMessages?: Message[]) {
    setActive(person);
    setChatMode('chat');
    setSelectedRequest(null);
    setConversation(conversationId);
    setReactionPickerFor(null);
    setEmojiPickerOpen(false);
    setError('');
    setConversations(prev => [{
      id: conversationId,
      unreadCount: 0,
      members: [{ userId: user.id, user }, { userId: person.id, user: person }],
      blocked: false
    }, ...prev.filter(item => item.id !== conversationId)]);
    socket?.emit('conversation:join', { conversationId });
    if (prefetchedMessages) {
      setMessages(prefetchedMessages);
      return;
    }
    setMessages([]);
    try {
      const historyResponse = await fetch(`${API}/api/conversations/${conversationId}/messages`, { headers: authHeaders() });
      const historyData = await historyResponse.json() as Message[] | { error?: string };
      if (!historyResponse.ok || !Array.isArray(historyData)) throw new Error(!Array.isArray(historyData) ? historyData.error || 'Unable to load chat history' : 'Unable to load chat history');
      setMessages(historyData);
      const unread = historyData.filter(message => message.senderId !== user.id && !(message.receipts || []).find(receipt => receipt.userId === user.id)?.readAt).map(message => message.id);
      if (unread.length) socket?.emit('receipt:read', { messageIds: unread });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat load failed');
    }
  }

  async function openChat(person: User) {
    setActive(person);
    setMessages([]);
    setConversation('');
    setSelectedRequest(null);
    setDraft('');
    setError('');
    const existing = conversations.find(item => item.members.some(member => member.userId === person.id));
    if (existing) {
      const currentMember = existing.members.find(member => member.userId === user.id);
      if (currentMember?.deletedAt && !(await restoreConversation(existing.id))) return;
      await showConversation(person, existing.id);
      return;
    }
    const request = requests.find(item =>
      (item.requesterId === user.id && item.recipientId === person.id) ||
      (item.requesterId === person.id && item.recipientId === user.id)
    );
    if (request?.status === 'ACCEPTED' && request.conversationId) {
      if (!(await restoreConversation(request.conversationId))) return;
      await showConversation(person, request.conversationId);
    } else if (request?.status === 'PENDING' && request.recipientId === user.id) {
      setSelectedRequest(request);
      setChatMode('incoming');
    } else if (request) {
      setSelectedRequest(request);
      setChatMode('outgoing');
    } else {
      setChatMode('new');
    }
  }

  async function openRequest(request: ConversationRequest) {
    const person = request.requesterId === user.id ? request.recipient : request.requester;
    setSidebarView('requests');
    setActive(person);
    setSelectedRequest(request);
    if (request.status === 'ACCEPTED' && request.conversationId) {
      if (!(await restoreConversation(request.conversationId))) return;
      await showConversation(person, request.conversationId);
    } else {
      setConversation('');
      setMessages([]);
      setChatMode(request.recipientId === user.id ? 'incoming' : 'outgoing');
    }
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !draft.trim() || requestBusy) return;
    setRequestBusy(true);
    try {
      const response = await fetch(`${API}/api/conversation-requests`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: active.id, initialMessage: draft.trim() })
      });
      const data = await response.json() as ConversationRequest | { error?: string; request?: ConversationRequest };
      if (!response.ok || !('id' in data)) throw new Error(!('id' in data) ? data.error || 'Unable to send conversation request' : 'Unable to send conversation request');
      setSelectedRequest(data);
      setRequests(prev => [data, ...prev.filter(request => request.id !== data.id)]);
      setChatMode('outgoing');
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send conversation request');
    } finally {
      setRequestBusy(false);
    }
  }

  async function acceptRequest() {
    if (!selectedRequest || !active || requestBusy) return;
    const requestId = selectedRequest.id;
    const person = active;
    setRequestBusy(true);
    try {
      const response = await fetch(`${API}/api/conversation-requests/${requestId}/accept`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await response.json() as { conversation?: { id: string }; message?: Message; error?: string };
      if (!response.ok || !data.conversation) {
        const [latestRequests, latestConversations] = await Promise.all([loadRequests(), loadConversations()]);
        const existingConversation = latestConversations.find(item => item.members.some(member => member.userId === person.id));
        if (existingConversation) {
          await showConversation(person, existingConversation.id);
          return;
        }
        if (!latestRequests.some(request => request.id === requestId && request.status === 'PENDING')) {
          setSelectedRequest(null);
          setChatMode('new');
          setError(data.error === 'Conversation request not found' ? 'This conversation request is no longer available.' : data.error || 'Conversation request is no longer pending.');
          return;
        }
        throw new Error(data.error || 'Unable to accept conversation request');
      }
      if (data.message) {
        setRequests(prev => prev.map(request => request.id === requestId
          ? { ...request, status: 'ACCEPTED', conversationId: data.conversation!.id }
          : request));
      }
      await showConversation(person, data.conversation.id, data.message ? [data.message] : undefined);
      void Promise.all([loadRequests(), loadConversations()])
        .catch(err => setError(err instanceof Error ? err.message : 'Unable to refresh conversations'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept conversation request');
    } finally {
      setRequestBusy(false);
    }
  }

  async function declineRequest() {
    if (!selectedRequest || requestBusy) return;
    setRequestBusy(true);
    try {
      const response = await fetch(`${API}/api/conversation-requests/${selectedRequest.id}/decline`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to decline conversation request');
      setRequests(prev => prev.map(request => request.id === selectedRequest.id
        ? { ...request, status: request.requesterId === user.id ? 'PENDING' : 'DECLINED' }
        : request));
      setSelectedRequest(null);
      setChatMode('new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decline conversation request');
    } finally {
      setRequestBusy(false);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || !active || !conversation || !socket || isBlocked) return;
    const body = draft.trim(), clientMessageId = crypto.randomUUID();
    const optimistic: Message = { id: `temp-${clientMessageId}`, clientMessageId, conversationId: conversation, senderId: user.id, body, createdAt: new Date().toISOString() };
    scrollToBottomAfterSendRef.current = true;
    setMessages(prev => [...prev, optimistic]); setDraft('');
    socket.emit('message:send', { clientMessageId, conversationId: conversation, body }, (ack: { ok: boolean; message?: Message; error?: string }) => {
      if (ack.ok && ack.message) setMessages(prev => prev.map(message => message.clientMessageId === clientMessageId ? ack.message! : message));
      else { setMessages(prev => prev.filter(message => message.clientMessageId !== clientMessageId)); setError(ack.error || 'Message failed. Please retry.'); setDraft(body); }
    });
  }

  const activeConversation = conversations.find(item => item.id === conversation);
  const isBlockedByMe = active ? blocks.some(block => block.blocked.id === active.id) : false;
  const isBlocked = Boolean(active && (isBlockedByMe || activeConversation?.blocked));

  async function clearChat() {
    if (!conversation || requestBusy || !window.confirm('Clear this chat from your account? The other person will keep their messages.')) return;
    setRequestBusy(true);
    try {
      const response = await fetch(`${API}/api/conversations/${conversation}/messages`, { method: 'DELETE', headers: authHeaders() });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to clear chat');
      setMessages([]);
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear chat');
    } finally {
      setRequestBusy(false);
    }
  }

  async function deleteChat() {
    if (!conversation || requestBusy || !window.confirm('Delete this chat from your account? The other person will keep their chat.')) return;
    const conversationId = conversation;
    setRequestBusy(true);
    try {
      const response = await fetch(`${API}/api/conversations/${conversationId}`, { method: 'DELETE', headers: authHeaders() });
      const data = await response.json() as { deletedAt?: string; error?: string };
      if (!response.ok || !data.deletedAt) throw new Error(data.error || 'Unable to delete chat');
      setConversations(prev => prev.map(item => item.id !== conversationId ? item : {
        ...item,
        members: item.members.map(member => member.userId === user.id ? { ...member, deletedAt: data.deletedAt } : member)
      }));
      setActive(null);
      setConversation('');
      setMessages([]);
      setSelectedRequest(null);
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete chat');
    } finally {
      setRequestBusy(false);
    }
  }

  function toggleReaction(messageId: string, emoji: string) {
    if (!socket) return;
    setReactionPickerFor(null);
    socket.emit('reaction:toggle', { messageId, emoji }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) setError(ack.error || 'Unable to update reaction');
    });
  }

  function insertEmoji(emoji: string) {
    const input = draftTextareaRef.current ?? draftInputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    if (draft.length - (end - start) + emoji.length > 4000) return;
    setDraft(value => value.slice(0, start) + emoji + value.slice(end));
    setEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function toggleBlock() {
    if (!active || requestBusy) return;
    setRequestBusy(true);
    try {
      const response = await fetch(isBlockedByMe ? `${API}/api/blocks/${encodeURIComponent(active.id)}` : `${API}/api/blocks`, {
        method: isBlockedByMe ? 'DELETE' : 'POST',
        headers: isBlockedByMe ? authHeaders() : { ...authHeaders(), 'Content-Type': 'application/json' },
        ...(!isBlockedByMe ? { body: JSON.stringify({ userId: active.id }) } : {})
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || (isBlockedByMe ? 'Unable to unblock user' : 'Unable to block user'));
      await Promise.all([loadBlocks(), loadConversations(), loadRequests(), loadPeople(search)]);
      setMoreOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update block settings');
    } finally {
      setRequestBusy(false);
    }
  }

  async function unblock(person: User) {
    try {
      const response = await fetch(`${API}/api/blocks/${encodeURIComponent(person.id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to unblock user');
      await Promise.all([loadBlocks(), loadConversations(), loadPeople(search)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to unblock user');
    }
  }

  async function shareProfile() {
    const url = new URL(window.location.origin);
    url.searchParams.set('profile', user.username);
    const link = url.toString();
    const localOnly = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!localOnly && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${user.firstName || user.username} on HelloBuddy`, text: 'Connect with me on HelloBuddy.', url: link });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    setProfileShareLink(link);
    setProfileShareMessage(localOnly ? 'This localhost link only works on this device.' : '');
  }

  async function copyProfileLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(profileShareLink);
      const localOnly = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      setProfileShareMessage(localOnly ? 'Copied. This localhost link only works on this device.' : 'Profile link copied.');
    } catch {
      profileShareInputRef.current?.focus();
      profileShareInputRef.current?.select();
      setProfileShareMessage('Select and copy the link to share it.');
    }
  }

  useEffect(() => {
    if (!active || !conversation || document.visibilityState !== 'visible') return;
    const markRead = () => {
      if (document.visibilityState !== 'visible') return;
      const ids = messages.filter(message => message.conversationId === conversation && message.senderId !== user.id && !(message.receipts || []).find(receipt => receipt.userId === user.id)?.readAt).map(message => message.id);
      if (ids.length) socket?.emit('receipt:read', { messageIds: ids });
    };
    markRead(); document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [active, conversation, messages, socket, user.id]);

  const incomingRequests = requests.filter(request => request.recipientId === user.id && request.status === 'PENDING');
  const outgoingRequests = requests.filter(request => request.requesterId === user.id);
  const requestQuery = requestSearch.trim().toLowerCase();
  const filteredIncomingRequests = incomingRequests.filter(request => request.requester.username.toLowerCase().includes(requestQuery));
  const filteredOutgoingRequests = outgoingRequests.filter(request => request.recipient.username.toLowerCase().includes(requestQuery));
  const blockedQuery = blockedSearch.trim().toLowerCase();
  const filteredBlocks = blocks.filter(block => block.blocked.username.toLowerCase().includes(blockedQuery));
  const knownContactIds = new Set([
    ...conversations
      .filter(item => !item.members.find(member => member.userId === user.id)?.deletedAt)
      .flatMap(item => item.members.filter(member => member.userId !== user.id).map(member => member.userId)),
    ...outgoingRequests.filter(request => request.status === 'PENDING').map(request => request.recipientId)
  ]);
  const visibleContacts = search.trim() ? people : people.filter(person => knownContactIds.has(person.id));
  const status = (message: Message) => {
    if (message.senderId !== user.id) return null;
    const receipts = message.receipts || [];
    if (receipts.some(receipt => receipt.readAt)) return <span className="ticks read" title="Read">✓✓</span>;
    if (receipts.some(receipt => receipt.deliveredAt)) return <span className="ticks" title="Delivered">✓✓</span>;
    return <span className="ticks" title="Sent">✓</span>;
  };

  if (profileEditorOpen) return <ProfileEditor user={user} token={token} onCancel={() => setProfileEditorOpen(false)} onUserChange={onUserChange} onTokenChange={onTokenChange}/>;

  return (
    <main className={`layout ${active ? 'mobile-chat-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><MessageCircle size={29} strokeWidth={2.6}/></span><b>HelloBuddy</b></div>
        <div className="profile-row">
          <button type="button" className="avatar profile-avatar profile-avatar-trigger" style={{ backgroundColor: user.avatarColor || '#5524c8' }} aria-label="Edit profile" title="Edit profile" onClick={() => setProfileEditorOpen(true)}>
            {user.avatarData ? <img src={user.avatarData} alt=""/> : `${user.firstName?.trim().charAt(0) || ''}${user.lastName?.trim().charAt(0) || ''}`.toUpperCase() || user.username[0]?.toUpperCase()}
          </button>
          <div className="profile-info"><strong>{user.username}</strong><small><i className="online-dot"/>Online</small></div>
          <button type="button" className="profile-share-icon" aria-label="Share profile" title="Share profile" onClick={() => void shareProfile()}><Share2 size={17}/></button>
        </div>
        {profileShareLink && <div className="profile-share-panel" role="dialog" aria-label="Share your profile">
          <div className="profile-share-heading">
            <strong>Share your profile</strong>
            <button type="button" aria-label="Close share profile" onClick={() => {setProfileShareLink('');setProfileShareMessage('');}}><X size={16}/></button>
          </div>
          <p>Anyone with this link can view your username, name, and profile photo.</p>
          {['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && <small className="profile-share-warning">Open HelloBuddy using a shared URL before sending this link to other devices.</small>}
          <div className="profile-share-copy-row">
            <input ref={profileShareInputRef} aria-label="Profile link" title="Click to copy your profile link" value={profileShareLink} readOnly onFocus={event => event.currentTarget.select()} onClick={() => void copyProfileLink()}/>
            <button type="button" onClick={() => void copyProfileLink()}>Copy</button>
          </div>
          {profileShareMessage && <small role="status">{profileShareMessage}</small>}
        </div>}
        <div className="sidebar-nav">
          <button className={sidebarView === 'chats' ? 'nav-active' : 'nav-button'} onClick={() => setSidebarView('chats')}><MessageCircle size={18}/> Chats</button>
          <button className={sidebarView === 'requests' ? 'nav-active' : 'nav-button'} onClick={() => setSidebarView('requests')}><UserRoundX size={18}/> Requests{incomingRequests.length > 0 && <span className="nav-badge">{incomingRequests.length}</span>}</button>
          <button className={`nav-blocked ${sidebarView === 'blocked' ? 'selected' : ''}`} onClick={() => setSidebarView('blocked')}><Ban size={18}/> Blocked users</button>
        </div>
        {sidebarView === 'chats' ? <>
          <label className="search-box">
            <Search size={17} aria-hidden="true"/>
            <input className="search" aria-label="Search contacts" placeholder="Search by name, phone, or email…" value={search} onChange={event => setSearch(event.target.value)}/>
          </label>
          <div className="contacts-heading"><span>Contacts</span><span className="contact-count">{visibleContacts.length}</span></div>
          <div className="people">
            {visibleContacts.map((person, index) => {
              const personConversation = conversations.find(item => item.members.some(member => member.userId === person.id));
              const unreadCount = personConversation?.unreadCount || 0;
              return <button className={`person ${active?.id === person.id ? 'selected' : ''}`} key={person.id} onClick={() => void openChat(person)}>
                <div className={`avatar avatar-tone-${index % 4}`}>{person.username[0]?.toUpperCase()}</div>
                <div className="person-text"><strong>{person.username}</strong><small>{personConversation ? 'Open conversation' : 'Start a conversation'}</small></div>
                {unreadCount > 0 && <span className="person-unread-badge" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
                <span className="person-arrow"><MessageCircle size={16}/></span>
              </button>;
            })}
            {!visibleContacts.length && <div className="no-people">{search ? 'No contacts match your search.' : 'Chats and sent requests will appear here. Search for someone to start a conversation.'}</div>}
          </div>
        </> : sidebarView === 'requests' ? <div className="sidebar-list">
          <label className="search-box sidebar-search">
            <Search size={17} aria-hidden="true"/>
            <input className="search" aria-label="Search conversation requests" placeholder="Search incoming and sent…" value={requestSearch} onChange={event => setRequestSearch(event.target.value)}/>
          </label>
          <div className="contacts-heading"><span>Incoming</span><span className="contact-count">{filteredIncomingRequests.length}</span></div>
          {filteredIncomingRequests.map(request => <button className={`person ${selectedRequest?.id === request.id ? 'selected' : ''}`} key={request.id} onClick={() => void openRequest(request)}>
            <div className="avatar avatar-tone-2">{request.requester.username[0]?.toUpperCase()}</div>
            <div className="person-text"><strong>{request.requester.username}</strong><small>Wants to start a conversation</small></div>
          </button>)}
          {!filteredIncomingRequests.length && <div className="no-people">{requestQuery ? 'No incoming requests match your search.' : 'No incoming requests.'}</div>}
          <div className="contacts-heading request-heading"><span>Sent</span><span className="contact-count">{filteredOutgoingRequests.length}</span></div>
          {filteredOutgoingRequests.map(request => <button className={`person ${selectedRequest?.id === request.id ? 'selected' : ''}`} key={request.id} onClick={() => void openRequest(request)}>
            <div className="avatar avatar-tone-0">{request.recipient.username[0]?.toUpperCase()}</div>
            <div className="person-text"><strong>{request.recipient.username}</strong><small>{request.status === 'ACCEPTED' ? 'Accepted' : 'Pending'}</small></div>
          </button>)}
          {!filteredOutgoingRequests.length && <div className="no-people">{requestQuery ? 'No sent requests match your search.' : 'No sent requests.'}</div>}
        </div> : <div className="sidebar-list">
          <label className="search-box sidebar-search">
            <Search size={17} aria-hidden="true"/>
            <input className="search" aria-label="Search blocked users" placeholder="Search blocked users…" value={blockedSearch} onChange={event => setBlockedSearch(event.target.value)}/>
          </label>
          <div className="contacts-heading"><span>Blocked users</span><span className="contact-count">{filteredBlocks.length}</span></div>
          {filteredBlocks.map(block => <div className="blocked-person" key={block.blocked.id}>
            <div className="avatar avatar-tone-3">{block.blocked.username[0]?.toUpperCase()}</div>
            <strong>{block.blocked.username}</strong>
            <button type="button" onClick={() => void unblock(block.blocked)} aria-label={`Unblock ${block.blocked.username}`} title="Unblock user"><ShieldCheck size={16}/></button>
          </div>)}
          {!filteredBlocks.length && <div className="no-people">{blockedQuery ? 'No blocked users match your search.' : 'You have not blocked anyone.'}</div>}
        </div>}
        <button className="logout" onClick={onLogout}>Log out</button>
      </aside>
      <section className="chat">
        <header className="chathead">
          {active ? <>
            <button className="back" onClick={() => setActive(null)} aria-label="Back to contacts"><ArrowLeft size={20}/></button>
            <div className="avatar avatar-active">{active.username[0].toUpperCase()}</div>
            <div className="chat-contact"><strong>{active.username}</strong><small>{chatMode === 'chat' ? 'Conversation' : chatMode === 'incoming' ? 'Conversation request' : chatMode === 'outgoing' ? 'Request sent' : 'New conversation'}</small></div>
            <div className="chat-actions">
              <div className="more-wrap" ref={moreMenuRef}>
                <button ref={moreButtonRef} type="button" aria-label="More options" aria-haspopup="menu" aria-expanded={moreOpen} title="More options" onClick={() => setMoreOpen(value => !value)}><MoreVertical size={20}/></button>
                {moreOpen && <div className="chat-menu" role="menu" aria-label="Conversation options">
                  <button type="button" role="menuitem" onClick={() => void toggleBlock()} disabled={requestBusy}>{isBlockedByMe ? <ShieldCheck size={16}/> : <Ban size={16}/>} {isBlockedByMe ? 'Unblock' : 'Block'}</button>
                  {chatMode === 'chat' && conversation && <>
                    <button type="button" role="menuitem" onClick={() => void clearChat()} disabled={requestBusy}><Eraser size={16}/>Clear</button>
                    <button type="button" role="menuitem" className="chat-menu-delete" onClick={() => void deleteChat()} disabled={requestBusy}><Trash2 size={16}/>Delete</button>
                  </>}
                </div>}
              </div>
            </div>
          </> : <div className="chat-welcome"><MessageCircle size={19}/><span>Choose a contact to start chatting</span></div>}
        </header>
        {active && chatMode === 'chat' ? <>
          {isBlocked && <div className="blocked-notice"><Ban size={17}/><span>{isBlockedByMe ? 'You blocked this user. Unblock them to send messages.' : 'This user has blocked messaging. You cannot send messages.'}</span></div>}
          <div className="messages" id="messages" ref={messagesContainerRef}>
            {messages.length > 0 && <div className="date-divider"><span>Conversation</span></div>}
            {messages.map(message => <div className={`bubble ${message.senderId === user.id ? 'mine' : 'theirs'}`} key={message.id}>
              <div>{message.body}</div>
              <footer>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{status(message)}</footer>
              <div className="bubble-reactions">
                {(message.reactions || []).map(reaction => <button type="button" className={`reaction-chip ${reaction.reactedByMe ? 'selected' : ''}`} key={reaction.emoji} aria-label={`${reaction.emoji}, ${reaction.count} reactions`} title={reaction.reactedByMe ? 'Remove your reaction' : 'Add your reaction'} onClick={() => toggleReaction(message.id, reaction.emoji)}>
                  <span>{reaction.emoji}</span><small>{reaction.count}</small>
                </button>)}
                <div className="reaction-control" ref={reactionPickerFor === message.id ? reactionPickerRef : null}>
                  <button type="button" className="reaction-add" aria-label="Add reaction" aria-expanded={reactionPickerFor === message.id} onClick={() => setReactionPickerFor(current => current === message.id ? null : message.id)}><Smile size={15}/></button>
                  {reactionPickerFor === message.id && <div className="reaction-picker" role="group" aria-label="Choose a reaction">
                    {EMOJI_OPTIONS.map(emoji => <button type="button" key={emoji} aria-label={`React with ${emoji}`} onClick={() => toggleReaction(message.id, emoji)}>{emoji}</button>)}
                  </div>}
                </div>
              </div>
            </div>)}
            {!messages.length && <div className="conversation-empty"><div className="emptyicon"><MessageCircle size={34}/></div><strong>Say hello to {active.username}</strong><span>Your conversation starts here.</span></div>}
          </div>
          <form className="composer" onSubmit={send}>
            <div className="composer-emoji" ref={emojiPickerRef}>
              <button type="button" className="emoji-toggle" aria-label="Choose emoji" aria-expanded={emojiPickerOpen} onClick={() => setEmojiPickerOpen(value => !value)} disabled={isBlocked}><Smile size={19}/></button>
              {emojiPickerOpen && <div className="emoji-picker" role="group" aria-label="Choose an emoji">
                {EMOJI_OPTIONS.map(emoji => <button type="button" className="emoji-option" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
              </div>}
            </div>
            <textarea
              ref={draftTextareaRef}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder={isBlocked ? 'Messaging is disabled' : 'Type a message…'}
              maxLength={4000}
              aria-label="Type a message"
              rows={1}
              disabled={isBlocked}
            />
            <button aria-label="Send message" disabled={!draft.trim() || isBlocked}><Send size={18}/><span>Send</span></button>
          </form>
        </> : active && chatMode === 'incoming' && selectedRequest ? <div className="request-state">
          <div className="emptyicon"><MessageCircle size={38}/></div>
          <h2>Conversation request</h2>
          <p><strong>{active.username}</strong> wants to start a conversation.</p>
          <p className="request-private">Accept to view their first message and begin chatting. No conversation is created unless you accept.</p>
          <div className="request-actions">
            <button type="button" className="request-accept" onClick={() => void acceptRequest()} disabled={requestBusy}><Check size={17}/>{requestBusy ? 'Working…' : 'Accept'}</button>
            <button type="button" className="request-decline" onClick={() => void declineRequest()} disabled={requestBusy}><X size={17}/>Decline</button>
          </div>
        </div> : active && chatMode === 'outgoing' && selectedRequest ? <div className="request-state">
          <div className="emptyicon"><MessageCircle size={38}/></div>
          <h2>{selectedRequest.status === 'ACCEPTED' ? 'Request accepted' : 'Request pending'}</h2>
          <p>{selectedRequest.status === 'ACCEPTED' ? `${active.username} accepted your request.` : `Your message request to ${active.username} is pending.`}</p>
          <div className="queued-message"><strong>Your first message</strong><p>{selectedRequest.initialMessage}</p></div>
          {selectedRequest.status !== 'ACCEPTED' && <p className="request-private">You can start chatting when {active.username} accepts.</p>}
        </div> : active ? <div className="new-request-state">
          <div className="request-intro"><div className="emptyicon"><MessageCircle size={36}/></div><h2>Say hello to {active.username}</h2><p>Your first message will be sent as a conversation request. Chat starts only after they accept.</p></div>
          <form className="request-composer" onSubmit={sendRequest}>
            <div className="request-input-row">
              <div className="composer-emoji" ref={emojiPickerRef}>
                <button type="button" className="emoji-toggle" aria-label="Choose emoji" aria-expanded={emojiPickerOpen} onClick={() => setEmojiPickerOpen(value => !value)}><Smile size={19}/></button>
                {emojiPickerOpen && <div className="emoji-picker" role="group" aria-label="Choose an emoji">
                  {EMOJI_OPTIONS.map(emoji => <button type="button" className="emoji-option" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
                </div>}
              </div>
              <input ref={draftInputRef} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write your first message…" maxLength={4000} aria-label={`Message ${active.username}`} required/>
            </div>
            <button aria-label="Send conversation request" disabled={!draft.trim() || requestBusy}><Send size={18}/><span>{requestBusy ? 'Sending…' : 'Send request'}</span></button>
          </form>
        </div> : <div className="empty">
          <div className="emptyicon"><MessageCircle size={42}/></div>
          <h2>Your conversations</h2>
          <p>Search for a contact and send your first message.</p>
        </div>}
        {error && <div className="toast" onClick={() => setError('')}>{error} · dismiss</div>}
      </section>
    </main>
  );
}
