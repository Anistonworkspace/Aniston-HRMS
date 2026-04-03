import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';

export const whatsappApi = api.injectEndpoints({
  endpoints: (builder) => ({
    initializeWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/initialize', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus'],
    }),
    getWhatsAppStatus: builder.query<any, void>({
      query: () => '/whatsapp/status',
      providesTags: ['WhatsAppStatus'],
    }),
    getWhatsAppQr: builder.query<any, void>({
      query: () => '/whatsapp/qr',
      providesTags: ['WhatsAppStatus'],
    }),
    refreshWhatsAppQr: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/refresh-qr', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus'],
    }),
    logoutWhatsApp: builder.mutation<any, void>({
      query: () => ({ url: '/whatsapp/logout', method: 'POST' }),
      invalidatesTags: ['WhatsAppStatus', 'WhatsAppChats'],
    }),

    // Chats — with Socket.io push for real-time updates
    getWhatsAppChats: builder.query<any, void>({
      query: () => '/whatsapp/chats',
      providesTags: ['WhatsAppChats'],
      keepUnusedDataFor: 120,
      async onCacheEntryAdded(_arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        try {
          await cacheDataLoaded;
          const handleNewMsg = (data: any) => {
            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const chatIdx = draft.data.findIndex((c: any) =>
                c.id === data.chatId || c.id?.replace('@c.us', '') === data.chatId?.replace('@c.us', '')
              );
              if (chatIdx >= 0) {
                // Update existing chat: bump to top, update last message
                const chat = draft.data[chatIdx];
                chat.lastMessage = data.body?.slice(0, 100) || '';
                chat.timestamp = data.timestamp;
                if (!data.fromMe) chat.unreadCount = (chat.unreadCount || 0) + 1;
                // Move to top
                draft.data.splice(chatIdx, 1);
                draft.data.unshift(chat);
              }
              // If chat not found, invalidation will refetch
            });
          };
          onSocketEvent('whatsapp:message:new', handleNewMsg);
          await cacheEntryRemoved;
          offSocketEvent('whatsapp:message:new', handleNewMsg);
        } catch { /* ignore */ }
      },
    }),

    getWhatsAppContacts: builder.query<any, void>({
      query: () => '/whatsapp/contacts',
      providesTags: ['WhatsAppContacts'],
      keepUnusedDataFor: 300,
    }),

    // Messages for a specific chat — Socket.io push (no polling)
    getWhatsAppChatMessages: builder.query<any, { chatId: string; limit?: number; before?: string }>({
      query: ({ chatId, limit, before }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/messages`,
        params: { limit, before },
      }),
      providesTags: (result, error, { chatId }) => [{ type: 'WhatsAppMessages' as const, id: chatId }],
      async onCacheEntryAdded(arg, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        try {
          await cacheDataLoaded;

          // Append new messages in real-time
          const handleNewMsg = (data: any) => {
            const normalizeId = (id: string) => id?.replace('@c.us', '').replace('@g.us', '');
            if (normalizeId(data.chatId) !== normalizeId(arg.chatId)) return;

            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              // Prevent duplicates
              const exists = draft.data.some((m: any) =>
                m.id === data.messageId || (m.body === data.body && m.fromMe === data.fromMe && Math.abs(new Date(m.timestamp).getTime() - new Date(data.timestamp).getTime()) < 3000)
              );
              if (exists) return;

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
          const handleAck = (data: any) => {
            const normalizeId = (id: string) => id?.replace('@c.us', '').replace('@g.us', '');
            if (normalizeId(data.chatId) !== normalizeId(arg.chatId)) return;

            updateCachedData((draft: any) => {
              if (!draft?.data) return;
              const msg = draft.data.find((m: any) => m.id === data.messageId);
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
    getWhatsAppMessages: builder.query<any, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/whatsapp/messages', params }),
      providesTags: ['WhatsAppHrmsMessages'],
    }),

    // Send text message
    sendWhatsAppMessage: builder.mutation<any, { to: string; message: string; quotedMessageId?: string }>({
      query: (body) => ({ url: '/whatsapp/send', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppToNumber: builder.mutation<any, { phone: string; message: string }>({
      query: (body) => ({ url: '/whatsapp/send-to-number', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),
    sendWhatsAppJobLink: builder.mutation<any, { phone: string; candidateName?: string; jobTitle: string; jobUrl?: string }>({
      query: (body) => ({ url: '/whatsapp/send-job-link', method: 'POST', body }),
      invalidatesTags: ['WhatsAppChats', 'WhatsAppHrmsMessages'],
    }),

    // NEW: Send media (image/document)
    sendWhatsAppMedia: builder.mutation<any, FormData>({
      query: (formData) => ({ url: '/whatsapp/send-media', method: 'POST', body: formData }),
      invalidatesTags: ['WhatsAppChats'],
    }),

    // NEW: Mark chat as read
    markChatAsRead: builder.mutation<any, string>({
      query: (chatId) => ({ url: `/whatsapp/chats/${encodeURIComponent(chatId)}/read`, method: 'POST' }),
      invalidatesTags: ['WhatsAppChats'],
    }),

    // NEW: Search messages in a chat
    searchWhatsAppMessages: builder.query<any, { chatId: string; query: string }>({
      query: ({ chatId, query }) => ({
        url: `/whatsapp/chats/${encodeURIComponent(chatId)}/search`,
        params: { q: query },
      }),
    }),

    // NEW: Download media on demand (lazy)
    downloadWhatsAppMedia: builder.mutation<any, { messageId: string; chatId: string }>({
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
  useDownloadWhatsAppMediaMutation,
} = whatsappApi;
