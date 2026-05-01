import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';

// =====================================================================
// TYPES
// =====================================================================

export interface WhatsAppStatus {
  isConnected: boolean;
  isInitializing: boolean;
  isSyncing: boolean;
  phoneNumber: string | null;
  lastPing: string | null;
}

export interface WhatsAppChat {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessage: string;
  timestamp: string | null;
  unreadCount: number;
  profilePicUrl: string | null;
}

export interface WhatsAppMessage {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: string | null;
  type: string;
  hasMedia: boolean;
  ack?: number;
  mediaUrl?: string | null;
  mediaFilename?: string | null;
  mediaMimetype?: string | null;
  quotedMsg?: { body: string; fromMe: boolean; type: string } | null;
  author?: string | null;
  notifyName?: string | null;
}

/** Live WhatsApp session contact (from device — not DB) */
export interface WhatsAppContact {
  id: string;
  name: string;
  number: string;
  isMyContact: boolean;
  pushname: string | null;
}

export interface HrmsMessage {
  id: string;
  externalMessageId?: string;
  sessionId: string;
  direction: 'OUTBOUND' | 'INBOUND';
  fromNumber?: string;
  to: string;
  message: string;
  templateType?: string;
  status: string;
  sentAt?: string;
  error?: string;
  createdAt: string;
}

/** DB conversation (WhatsAppConversation model) */
export interface WhatsAppConversation {
  id: string;
  contactPhone: string;
  providerChatId: string | null;
  contactName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED';
  templateSource: string | null;
  lastMessageDirection: 'INBOUND' | 'OUTBOUND' | null;
  lastMessageStatus: string | null;
}

/** DB contact (WhatsAppContact model) — application-layer contacts */
export interface WhatsAppDbContact {
  id: string;
  organizationId: string;
  name: string;
  phone: string;           // Display form (e.g. +919876543210)
  normalizedPhone: string; // Digits only
  email: string | null;
  notes: string | null;
  source: 'MANUAL' | 'WHATSAPP_IMPORT' | 'EMPLOYEE' | 'ONBOARDING' | 'APPLICATION';
  referenceId: string | null;
  referenceType: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched fields from join with WhatsAppConversation
  providerChatId: string | null;
  hasChat: boolean;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface CreateContactPayload {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  source?: string;
}

export interface UpdateContactPayload {
  name?: string;
  email?: string;
  notes?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface SocketMessageEvent {
  chatId: string;
  messageId: string;
  body: string;
  fromMe: boolean;
  timestamp: string;
  type: string;
  hasMedia: boolean;
  quotedMsg?: { body: string; fromMe: boolean } | null;
  senderName?: string | null;
  senderPhone?: string | null;
}

interface SocketAckEvent {
  chatId: string;
  messageId: string;
  ack: number;
}

interface SocketChatReadEvent {
  chatId: string;
}

// =====================================================================
// NOTIFICATION SOUND
// =====================================================================

let lastSoundAt = 0;
const SOUND_DEBOUNCE_MS = 2000;

function playNotificationSound() {
  const now = Date.now();
  if (now - lastSoundAt < SOUND_DEBOUNCE_MS) return;
  lastSoundAt = now;

  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext not available — silent fail
  }
}

// =====================================================================
// POLLING INTERVALS
// =====================================================================

const POLLING = {
  STATUS: 15000, // 15s
  CHATS: 60000,  // 60s (socket handles real-time)
} as const;

// =====================================================================
// HELPERS
// =====================================================================

// Normalize chat IDs for comparison — strips @c.us, @g.us, @lid suffixes
function normalizeChatId(id: string): string {
  if (!id) return '';
  return id.replace(/@c\.us$/, '').replace(/@g\.us$/, '').replace(/@lid$/, '');
}

// Format a raw digit string into a human-readable phone number
// e.g. "919876543210" → "+91 98765 43210"
function formatPhoneDisplay(digits: string): string {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '');
  // Indian mobile: 91 + 10 digits
  if (d.startsWith('91') && d.length === 12) {
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  }
  // US/Canada: 1 + 10 digits
  if (d.startsWith('1') && d.length === 11) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  // Generic: just prepend +
  return `+${d}`;
}

// Match two chat IDs — handles @c.us and @lid formats
function chatIdsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizeChatId(a);
  const nb = normalizeChatId(b);
  return na === nb;
}

// =====================================================================
// API ENDPOINTS
// =====================================================================

export const whatsappApi = api.injectEndpoints({
  endpoints: (builder) => ({
    initializeWhatsApp: builder.mutation<ApiResponse<any>, void>({
      query: () => ({ url: '/whatsapp/initialize', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus', 'WhatsAppChats'],
    }),

    getWhatsAppStatus: builder.query<ApiResponse<WhatsAppStatus>, void>({
      query: () => '/whatsapp/status',
      providesTags: ['WhatsAppStatus'],
    }),

    getWhatsAppQr: builder.query<ApiResponse<{ qrCode: string | null }>, void>({
      query: () => '/whatsapp/qr',
      providesTags: ['WhatsAppStatus'],
    }),

    refreshWhatsAppQr: builder.mutation<ApiResponse<any>, void>({
      query: () => ({ url: '/whatsapp/refresh-qr', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus'],
    }),

    logoutWhatsApp: builder.mutation<ApiResponse<any>, void>({
      query: () => ({ url: '/whatsapp/logout', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus', 'WhatsAppChats'],
    }),

    // ============================================================
    // CHATS — live WhatsApp client list
    // Socket events:
    //   whatsapp:message:new → update lastMessage, unreadCount, reorder, show toast
    //   whatsapp:chat:read  → immediately zero out unreadCount
    // ============================================================
    getWhatsAppChats: builder.query<ApiResponse<WhatsAppChat[]>, void>({
      query: () => '/whatsapp/chats',
      providesTags: ['WhatsAppChats'],
      keepUnusedDataFor: 30,
      async onCacheEntryAdded(_arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved, dispatch }) {
        // Track which chatId is currently open so we don't show toast for it
        let activeChatId: string | null = null;
        const setActive = (e: CustomEvent) => { activeChatId = e.detail || null; };
        window.addEventListener('wa:active-chat', setActive as EventListener);

        // After backend sync completes (post-connect preload), force a fresh fetch
        const handleSyncComplete = () => {
          dispatch(whatsappApi.util.invalidateTags(['WhatsAppChats']));
        };
        onSocketEvent('whatsapp:sync:complete', handleSyncComplete);

        const handleNewMsg = (data: SocketMessageEvent) => {
          try {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;

              const chatIdx = draft.data.findIndex((c: WhatsAppChat) =>
                chatIdsMatch(c.id, data.chatId)
              );

              if (chatIdx >= 0) {
                const chat = draft.data[chatIdx];
                chat.lastMessage = data.body?.slice(0, 100) || '';
                chat.timestamp = data.timestamp;
                // Only increment unread for incoming msgs NOT in the active chat
                if (!data.fromMe && !chatIdsMatch(data.chatId, activeChatId || '')) {
                  chat.unreadCount = (chat.unreadCount || 0) + 1;
                }
                // Move to top
                draft.data.splice(chatIdx, 1);
                draft.data.unshift(chat);
              } else if (!data.fromMe) {
                // Unknown chat — inject placeholder + trigger refetch
                const rawDigits = normalizeChatId(data.chatId);
                const chatName = data.senderName
                  || (data.senderPhone ? formatPhoneDisplay(data.senderPhone.replace(/^\+/, '')) : null)
                  || formatPhoneDisplay(rawDigits);
                draft.data.unshift({
                  id: data.chatId,
                  name: chatName,
                  isGroup: data.chatId.includes('@g.us'),
                  lastMessage: data.body?.slice(0, 100) || '',
                  timestamp: data.timestamp,
                  unreadCount: 1,
                  profilePicUrl: null,
                });
                setTimeout(() => {
                  dispatch(whatsappApi.util.invalidateTags(['WhatsAppChats']));
                }, 3000);
              }
            });
          } catch { /* cache not yet populated — update skipped */ }

          // Toast + sound for incoming messages not in active chat
          if (!data.fromMe && !chatIdsMatch(data.chatId, activeChatId || '')) {
            playNotificationSound();
            const preview = data.body?.slice(0, 60) || 'New WhatsApp message';
            const rawDigits = normalizeChatId(data.chatId);
            const formattedPhone = data.senderPhone ? formatPhoneDisplay(data.senderPhone.replace(/^\+/, '')) : formatPhoneDisplay(rawDigits);
            const displayLabel = data.senderName ? `${data.senderName} (${formattedPhone})` : formattedPhone;
            toast(
              `📩 ${displayLabel}: ${preview}`,
              {
                duration: 4000,
                style: { background: '#25D366', color: '#fff', fontSize: '13px', maxWidth: '360px' },
                icon: '💬',
              }
            );

            if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
              try {
                new Notification(`WhatsApp: ${data.senderName || formattedPhone}`, {
                  body: `${data.senderName ? formattedPhone + ' — ' : ''}${preview}`,
                  icon: '/icons/icon-192.png',
                  tag: `wa-${data.chatId}`,
                });
              } catch { /* ignore */ }
            }
          }
        };

        // Real-time unread clear — fires when any client marks a chat read
        const handleChatRead = (data: SocketChatReadEvent) => {
          try {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const chat = draft.data.find((c: WhatsAppChat) => chatIdsMatch(c.id, data.chatId));
              if (chat) chat.unreadCount = 0;
            });
          } catch { /* ignore */ }
        };

        // D2: alert HR when an incoming message was displayed but failed to persist to DB
        const handlePersistFailed = (data: { chatId: string; warning: string }) => {
          toast.error(`⚠️ WhatsApp: ${data.warning}`, {
            duration: 8000,
            style: { fontSize: '12px', maxWidth: '380px' },
          });
        };

        onSocketEvent('whatsapp:message:new', handleNewMsg);
        onSocketEvent('whatsapp:chat:read', handleChatRead);
        onSocketEvent('whatsapp:persist:failed', handlePersistFailed);

        try {
          await cacheDataLoaded;
        } catch { /* query failed — keep listeners, will clean up on cacheEntryRemoved */ }

        await cacheEntryRemoved;

        offSocketEvent('whatsapp:message:new', handleNewMsg);
        offSocketEvent('whatsapp:chat:read', handleChatRead);
        offSocketEvent('whatsapp:persist:failed', handlePersistFailed);
        offSocketEvent('whatsapp:sync:complete', handleSyncComplete);
        window.removeEventListener('wa:active-chat', setActive as EventListener);
      },
    }),

    // Live WhatsApp session contacts (from device)
    getWhatsAppContacts: builder.query<ApiResponse<WhatsAppContact[]>, void>({
      query: () => '/whatsapp/contacts',
      providesTags: ['WhatsAppContacts'],
      keepUnusedDataFor: 300,
    }),

    // ============================================================
    // MESSAGES for a specific chat — Socket.io real-time push
    // ============================================================
    getWhatsAppChatMessages: builder.query<
      ApiResponse<WhatsAppMessage[]>,
      { chatId: string; limit?: number; before?: string }
    >({
      query: ({ chatId, limit, before }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/messages`,
        params: { limit, before },
      }),
      providesTags: (_result, _error, { chatId }) => [
        { type: 'WhatsAppMessages' as const, id: chatId },
      ],
      async onCacheEntryAdded(arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        // Attach listeners BEFORE awaiting cache load to avoid missing events during the gap
        const handleNewMsg = (data: SocketMessageEvent) => {
          if (!chatIdsMatch(data.chatId, arg.chatId)) return;
          try {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              // Dedup by messageId (primary) — always check, even when ID is present
              if (data.messageId && draft.data.some((m: WhatsAppMessage) => m.id === data.messageId)) return;
              // Dedup by content (secondary) — catches cases where temp ID was stored first
              // or when the same message fires twice without an ID
              if (data.timestamp && data.body !== undefined && draft.data.some((m: WhatsAppMessage) =>
                m.timestamp === data.timestamp && m.body === data.body && m.fromMe === data.fromMe
              )) return;

              draft.data.push({
                id: data.messageId || `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                body: data.body || '',
                fromMe: data.fromMe,
                timestamp: data.timestamp,
                type: data.type || 'chat',
                hasMedia: data.hasMedia || false,
                ack: data.fromMe ? 1 : undefined,
                quotedMsg: data.quotedMsg || null,
              });
            });
          } catch { /* updateCachedData failed — cache not yet populated */ }
        };

        const handleAck = (data: SocketAckEvent) => {
          if (!chatIdsMatch(data.chatId, arg.chatId)) return;
          try {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const msg = draft.data.find((m: WhatsAppMessage) => m.id === data.messageId);
              if (msg) msg.ack = data.ack;
            });
          } catch { /* ignore */ }
        };

        onSocketEvent('whatsapp:message:new', handleNewMsg);
        onSocketEvent('whatsapp:message:status', handleAck);

        try {
          await cacheDataLoaded;
        } catch { /* query failed — listeners still clean up below */ }

        await cacheEntryRemoved;
        offSocketEvent('whatsapp:message:new', handleNewMsg);
        offSocketEvent('whatsapp:message:status', handleAck);
      },
    }),

    // ============================================================
    // CONVERSATIONS — DB-backed (used for backfill / linking)
    // ============================================================
    getWhatsAppConversations: builder.query<
      PaginatedResponse<WhatsAppConversation>,
      { page?: number; limit?: number }
    >({
      query: (params) => ({ url: '/whatsapp/conversations', params }),
      providesTags: ['WhatsAppConversations'],
      keepUnusedDataFor: 120,
    }),

    // Resolve live chatId for a phone number (LID-safe)
    resolveWhatsAppChat: builder.query<
      ApiResponse<{ chatId: string | null; conversationId: string | null }>,
      string
    >({
      query: (phone) => `/whatsapp/resolve/${encodeURIComponent(phone)}`,
    }),

    // HRMS DB messages (flat list)
    getWhatsAppMessages: builder.query<
      PaginatedResponse<HrmsMessage>,
      { page?: number; limit?: number }
    >({
      query: (params) => ({ url: '/whatsapp/messages', params }),
      providesTags: ['WhatsAppHrmsMessages'],
    }),

    // Send text message to existing chat
    sendWhatsAppMessage: builder.mutation<
      ApiResponse<any>,
      { to: string; message: string; quotedMessageId?: string }
    >({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages', 'WhatsAppConversations'],
    }),

    // Send message to any phone number (creates new chat)
    sendWhatsAppToNumber: builder.mutation<
      ApiResponse<{ chatId: string; conversationId?: string }>,
      { phone: string; message: string }
    >({
      query: (body) => ({ url: '/whatsapp/send-to-number', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages', 'WhatsAppConversations', 'WhatsAppDbContacts'],
    }),

    sendWhatsAppJobLink: builder.mutation<
      ApiResponse<any>,
      { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }
    >({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages', 'WhatsAppConversations'],
    }),

    sendWhatsAppMedia: builder.mutation<ApiResponse<{ messageId: string }>, FormData>({
      query: (formData) => ({
        url: '/whatsapp/send-media',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: ['WhatsAppChats'],
    }),

    markChatAsRead: builder.mutation<ApiResponse<{ success: boolean }>, string>({
      query: (chatId) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/read`,
        method: 'POST',
      }),
      // Socket event handles real-time update — no cache invalidation needed
    }),

    searchWhatsAppMessages: builder.query<
      ApiResponse<WhatsAppMessage[]>,
      { chatId: string; query: string }
    >({
      query: ({ chatId, query }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/search`,
        params: { q: query },
      }),
    }),

    downloadWhatsAppMedia: builder.mutation<
      ApiResponse<{ mediaUrl: string; mediaFilename: string; mediaMimetype?: string }>,
      { messageId: string; chatId: string }
    >({
      query: ({ messageId, chatId }) => ({
        url: `/whatsapp/media/${encodeURIComponent(messageId)}`,
        params: { chatId },
      }),
    }),

    // ============================================================
    // DB CONTACTS CRUD — application-layer contacts
    // These are stored in WhatsAppContact table, not from WhatsApp device
    // ============================================================

    getWhatsAppDbContacts: builder.query<
      PaginatedResponse<WhatsAppDbContact>,
      { page?: number; limit?: number; search?: string }
    >({
      query: (params) => ({ url: '/whatsapp/db-contacts', params }),
      providesTags: ['WhatsAppDbContacts'],
      keepUnusedDataFor: 120,
    }),

    createWhatsAppContact: builder.mutation<ApiResponse<WhatsAppDbContact>, CreateContactPayload>({
      query: (body) => ({ url: '/whatsapp/db-contacts', method: 'POST', body }),
      invalidatesTags: ['WhatsAppDbContacts'],
    }),

    updateWhatsAppContact: builder.mutation<
      ApiResponse<WhatsAppDbContact>,
      { contactId: string } & UpdateContactPayload
    >({
      query: ({ contactId, ...body }) => ({
        url: `/whatsapp/db-contacts/${contactId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['WhatsAppDbContacts'],
    }),

    deleteWhatsAppContact: builder.mutation<ApiResponse<{ success: boolean }>, string>({
      query: (contactId) => ({
        url: `/whatsapp/db-contacts/${contactId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['WhatsAppDbContacts'],
    }),
  }),
});

export const {
  useInitializeWhatsAppMutation,
  useGetWhatsAppStatusQuery,
  useGetWhatsAppQrQuery,
  useRefreshWhatsAppQrMutation,
  useLogoutWhatsAppMutation,
  useGetWhatsAppChatsQuery,
  useGetWhatsAppContactsQuery,
  useGetWhatsAppChatMessagesQuery,
  useGetWhatsAppConversationsQuery,
  useLazyResolveWhatsAppChatQuery,
  useGetWhatsAppMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useSendWhatsAppJobLinkMutation,
  useSendWhatsAppMediaMutation,
  useMarkChatAsReadMutation,
  useSearchWhatsAppMessagesQuery,
  useLazySearchWhatsAppMessagesQuery,
  useDownloadWhatsAppMediaMutation,
  // DB contacts
  useGetWhatsAppDbContactsQuery,
  useCreateWhatsAppContactMutation,
  useUpdateWhatsAppContactMutation,
  useDeleteWhatsAppContactMutation,
} = whatsappApi;
