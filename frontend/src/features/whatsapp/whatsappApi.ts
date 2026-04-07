import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';

// =====================================================================
// TYPES
// =====================================================================

export interface WhatsAppStatus {
  isConnected: boolean;
  isInitializing: boolean;
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
}

interface SocketAckEvent {
  chatId: string;
  messageId: string;
  ack: number;
}

// =====================================================================
// POLLING INTERVALS
// =====================================================================

const POLLING = {
  STATUS: 15000,       // 15s (was 5s — reduce server load)
  CHATS: 60000,        // 60s (socket handles real-time)
} as const;

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

    // Chats — with Socket.io push for real-time updates
    getWhatsAppChats: builder.query<ApiResponse<WhatsAppChat[]>, void>({
      query: () => '/whatsapp/chats',
      providesTags: ['WhatsAppChats'],
      keepUnusedDataFor: 120,
      async onCacheEntryAdded(_arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        try {
          await cacheDataLoaded;
          const handleNewMsg = (data: SocketMessageEvent) => {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const normalizeId = (id: string) => id?.replace('@c.us', '').replace('@g.us', '');
              const chatIdx = draft.data.findIndex((c: WhatsAppChat) =>
                normalizeId(c.id) === normalizeId(data.chatId)
              );
              if (chatIdx >= 0) {
                const chat = draft.data[chatIdx];
                chat.lastMessage = data.body?.slice(0, 100) || '';
                chat.timestamp = data.timestamp;
                if (!data.fromMe) chat.unreadCount = (chat.unreadCount || 0) + 1;
                draft.data.splice(chatIdx, 1);
                draft.data.unshift(chat);
              }
            });
          };
          onSocketEvent('whatsapp:message:new', handleNewMsg);
          await cacheEntryRemoved;
          offSocketEvent('whatsapp:message:new', handleNewMsg);
        } catch { /* ignore */ }
      },
    }),

    getWhatsAppContacts: builder.query<ApiResponse<WhatsAppContact[]>, void>({
      query: () => '/whatsapp/contacts',
      providesTags: ['WhatsAppContacts'],
      keepUnusedDataFor: 300,
    }),

    // Messages for a specific chat — Socket.io push (no polling needed)
    getWhatsAppChatMessages: builder.query<ApiResponse<WhatsAppMessage[]>, { chatId: string; limit?: number; before?: string }>({
      query: ({ chatId, limit, before }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/messages`,
        params: { limit, before },
      }),
      providesTags: (_result, _error, { chatId }) => [{ type: 'WhatsAppMessages' as const, id: chatId }],
      async onCacheEntryAdded(arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        try {
          await cacheDataLoaded;

          const normalizeId = (id: string) => id?.replace('@c.us', '').replace('@g.us', '');

          // Append new messages in real-time
          const handleNewMsg = (data: SocketMessageEvent) => {
            if (normalizeId(data.chatId) !== normalizeId(arg.chatId)) return;

            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              // Deduplicate by messageId only (reliable)
              if (data.messageId && draft.data.some((m: WhatsAppMessage) => m.id === data.messageId)) return;

              draft.data.push({
                id: data.messageId || `temp-${Date.now()}`,
                body: data.body || '',
                fromMe: data.fromMe,
                timestamp: data.timestamp,
                type: data.type || 'chat',
                hasMedia: data.hasMedia || false,
                ack: data.fromMe ? 1 : undefined,
                quotedMsg: data.quotedMsg || null,
              });
            });
          };

          // Update message ack status in real-time
          const handleAck = (data: SocketAckEvent) => {
            if (normalizeId(data.chatId) !== normalizeId(arg.chatId)) return;

            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const msg = draft.data.find((m: WhatsAppMessage) => m.id === data.messageId);
              if (msg) msg.ack = data.ack;
            });
          };

          onSocketEvent('whatsapp:message:new', handleNewMsg);
          onSocketEvent('whatsapp:message:status', handleAck);
          await cacheEntryRemoved;
          offSocketEvent('whatsapp:message:new', handleNewMsg);
          offSocketEvent('whatsapp:message:status', handleAck);
        } catch { /* ignore */ }
      },
    }),

    // HRMS DB messages
    getWhatsAppMessages: builder.query<PaginatedResponse<HrmsMessage>, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/whatsapp/messages', params }),
      providesTags: ['WhatsAppHrmsMessages'],
    }),

    // Send text message
    sendWhatsAppMessage: builder.mutation<ApiResponse<any>, { to: string; message: string; quotedMessageId?: string }>({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppToNumber: builder.mutation<ApiResponse<{ chatId: string }>, { phone: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send-to-number', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppJobLink: builder.mutation<ApiResponse<any>, { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }>({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),

    // Send media (image/document)
    sendWhatsAppMedia: builder.mutation<ApiResponse<{ messageId: string }>, FormData>({
      query: (formData) => ({ url: '/whatsapp/send-media', method: 'POST', body: formData }),
      invalidatesTags: ['WhatsAppChats'],
    }),

    // Mark chat as read
    markChatAsRead: builder.mutation<ApiResponse<{ success: boolean }>, string>({
      query: (chatId) => ({ url: `/whatsapp/chats/${encodeURIComponent(chatId)}/read`, method: 'POST' }),
      invalidatesTags: ['WhatsAppChats'],
    }),

    // Search messages in a chat
    searchWhatsAppMessages: builder.query<ApiResponse<WhatsAppMessage[]>, { chatId: string; query: string }>({
      query: ({ chatId, query }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/search`,
        params: { q: query },
      }),
    }),

    // Download media on demand (lazy)
    downloadWhatsAppMedia: builder.mutation<ApiResponse<{ mediaUrl: string; mediaFilename: string; mediaMimetype?: string }>, { messageId: string; chatId: string }>({
      query: ({ messageId, chatId }) => ({
        url: `/whatsapp/media/${encodeURIComponent(messageId)}`,
        params: { chatId },
      }),
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
  useGetWhatsAppMessagesQuery,
  useSendWhatsAppMessageMutation,
  useSendWhatsAppToNumberMutation,
  useSendWhatsAppJobLinkMutation,
  useSendWhatsAppMediaMutation,
  useMarkChatAsReadMutation,
  useSearchWhatsAppMessagesQuery,
  useLazySearchWhatsAppMessagesQuery,
  useDownloadWhatsAppMediaMutation,
} = whatsappApi;
