import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { storageService } from '../../services/storage.service.js';
import type { SendMessageInput, SendJobLinkInput, CreateContactInput, UpdateContactInput } from './whatsapp.validation.js';

// =====================================================================
// CONSTANTS
// =====================================================================

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WA_AUTH_DIR = path.resolve(process.cwd(), '.wwebjs_auth');

const CHATS_CACHE_TTL = 30;         // 30 seconds
const CONTACTS_CACHE_TTL = 300;     // 5 minutes
const PROFILE_PIC_CACHE_TTL = 86400; // 24 hours

const CHAT_FETCH_TIMEOUT_MS = 45000;
const CONTACT_FETCH_TIMEOUT_MS = 45000;
const MAX_CHATS_DISPLAY = 150;
const MAX_CONTACTS_DISPLAY = 300;

// =====================================================================
// PHONE NUMBER UTILITIES
// =====================================================================

/**
 * Normalize phone for WhatsApp chat ID lookup.
 * Adds 91 prefix for 10-digit Indian mobile numbers only.
 * Numbers with 11+ digits are assumed to already have country code.
 * NOTE: This is intentionally kept as-is to preserve backward compatibility
 * with existing WhatsAppConversation.contactPhone records.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
}

/**
 * Normalize phone for contact storage — strips all non-digits.
 * International-safe: does NOT add any country code prefix.
 * Use this for WhatsAppContact.normalizedPhone storage.
 * Examples: "+1 (415) 555-1234" → "14155551234"
 *           "9876543210" → "9876543210"
 *           "+91 98765 43210" → "919876543210"
 */
function normalizePhoneForStorage(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Check if two normalized phone numbers match, handling suffix overlap.
 * e.g. "9876543210" matches "919876543210" (one is 10-digit local, other has country code)
 */
function phonesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const digA = a.replace(/\D/g, '');
  const digB = b.replace(/\D/g, '');
  if (digA === digB) return true;
  // Handle 10-digit vs full international: compare last 10 digits
  const last10A = digA.slice(-10);
  const last10B = digB.slice(-10);
  return last10A.length === 10 && last10A === last10B;
}

/** Convert phone to WhatsApp chat ID format */
function phoneToChatId(phone: string): string {
  return `${normalizePhone(phone)}@c.us`;
}

/** Extract phone number from chat ID */
function chatIdToPhone(chatId: string): string {
  return chatId.replace('@c.us', '').replace('@g.us', '');
}

// =====================================================================
// SERVICE CLASS
// =====================================================================

export class WhatsAppService {
  private _client: any = null;
  private _ready = false;
  private _initializing = false;
  private _orgId: string | null = null;
  private _qrCode: string | null = null;
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _sessionExpiryInterval: ReturnType<typeof setInterval> | null = null;

  // ===================== CONNECTION & INITIALIZATION =====================

  async initialize(organizationId: string) {
    if (this._ready) return { isConnected: true, status: 'connected', message: 'Already connected' };
    if (this._initializing) return { isConnected: false, status: 'initializing', message: 'Already initializing... please wait' };

    try {
      this._initializing = true;

      // Destroy any existing client to prevent memory leaks
      await this._destroyClient();

      const wwebjs = await import('whatsapp-web.js');
      const Client = wwebjs.Client || (wwebjs as any).default?.Client;
      const LocalAuth = wwebjs.LocalAuth || (wwebjs as any).default?.LocalAuth;
      const qrcode = await import('qrcode');

      if (!Client || !LocalAuth) {
        throw new Error('whatsapp-web.js Client or LocalAuth not found. Run: npm install whatsapp-web.js@latest');
      }

      this._orgId = organizationId;

      // Clean up corrupted session files atomically
      const sessionDir = path.join(WA_AUTH_DIR, `session-aniston-${organizationId}`);
      const defaultDir = path.join(sessionDir, 'Default');
      try {
        if (fs.existsSync(sessionDir) && !fs.existsSync(defaultDir)) {
          logger.info('WhatsApp: removing corrupted session directory');
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        logger.warn('WhatsApp: session cleanup failed, continuing anyway:', cleanupErr);
      }

      // Find Chrome/Chromium executable
      const executablePath = this._findChromePath();
      logger.info(`WhatsApp: using Chrome at ${executablePath || 'puppeteer default'}`);

      if (!fs.existsSync(WA_AUTH_DIR)) {
        fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
      }

      this._client = new Client({
        authStrategy: new LocalAuth({
          clientId: `aniston-${organizationId}`,
          dataPath: WA_AUTH_DIR,
        }),
        puppeteer: {
          executablePath: executablePath || undefined,
          args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--disable-extensions', '--disable-default-apps', '--no-first-run',
          ],
          headless: 'new' as any,
          timeout: 120000,
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/nicehero/nicehero.github.io/main/nicehero-whatsapp-web-version-cache/',
        },
        authTimeoutMs: 120000,
      });

      this._attachEventHandlers(organizationId, qrcode);

      await this._client.initialize();

      // Start session expiry checker (every 6 hours)
      this._startSessionExpiryChecker(organizationId);

      return { isConnected: false, status: 'initializing', message: 'Initializing... Scan QR code' };
    } catch (error: any) {
      this._initializing = false;
      const msg = error.message || String(error);
      logger.error('WhatsApp init failed:', msg);
      if (msg.includes('shared libraries') || msg.includes('Failed to launch the browser') || msg.includes('ENOENT')) {
        throw new BadRequestError(
          'WhatsApp initialization failed: Chrome/Chromium not found. ' +
          'Install via: apt-get install -y chromium-browser (Ubuntu/Debian) or apk add chromium (Alpine)'
        );
      }
      throw new BadRequestError(`WhatsApp initialization failed: ${msg}`);
    }
  }

  // ===================== EVENT HANDLERS =====================

  private _attachEventHandlers(organizationId: string, qrcode: any) {
    const client = this._client;

    client.on('qr', async (qr: string) => {
      try {
        const toDataURL = qrcode.toDataURL || (qrcode as any).default?.toDataURL;
        this._qrCode = toDataURL ? await toDataURL(qr) : null;
        await prisma.whatsAppSession.upsert({
          where: { sessionName: `main-${organizationId}` },
          update: { qrCode: this._qrCode, isConnected: false },
          create: { sessionName: `main-${organizationId}`, qrCode: this._qrCode, organizationId },
        });
        logger.info('WhatsApp QR code generated');
        emitToOrg(organizationId, 'whatsapp:qr', { qrCode: this._qrCode });
      } catch (err) {
        logger.error('Failed to process QR:', err);
      }
    });

    client.on('authenticated', () => {
      logger.info('WhatsApp QR scanned — authenticating...');
      this._qrCode = null;
      emitToOrg(organizationId, 'whatsapp:authenticated', { message: 'QR scanned, linking device...' });
    });

    client.on('auth_failure', async (msg: string) => {
      this._ready = false;
      this._initializing = false;
      this._qrCode = null;
      logger.error('WhatsApp auth failure:', msg);
      await prisma.whatsAppSession.updateMany({
        where: { sessionName: `main-${organizationId}` },
        data: { isConnected: false, qrCode: null },
      });
      emitToOrg(organizationId, 'whatsapp:auth_failure', { message: msg || 'Authentication failed' });
    });

    client.on('ready', async () => {
      this._ready = true;
      this._initializing = false;
      this._qrCode = null;
      const info = client.info;
      await prisma.whatsAppSession.upsert({
        where: { sessionName: `main-${organizationId}` },
        update: { isConnected: true, phoneNumber: info?.wid?.user || null, qrCode: null, lastPing: new Date() },
        create: { sessionName: `main-${organizationId}`, isConnected: true, phoneNumber: info?.wid?.user, organizationId },
      });
      logger.info(`WhatsApp connected: ${info?.wid?.user}`);
      emitToOrg(organizationId, 'whatsapp:ready', { phoneNumber: info?.wid?.user });

      // Periodic ping (every 30 minutes)
      if (this._pingInterval) clearInterval(this._pingInterval);
      this._pingInterval = setInterval(async () => {
        try {
          if (this._ready) {
            await prisma.whatsAppSession.updateMany({
              where: { sessionName: `main-${organizationId}`, isConnected: true },
              data: { lastPing: new Date() },
            });
          }
        } catch { /* ignore */ }
      }, 30 * 60 * 1000);
    });

    client.on('disconnected', async () => {
      this._ready = false;
      this._initializing = false;
      this._qrCode = null;
      await prisma.whatsAppSession.updateMany({
        where: { sessionName: `main-${organizationId}` },
        data: { isConnected: false, qrCode: null },
      });
      logger.info('WhatsApp disconnected');
      emitToOrg(organizationId, 'whatsapp:disconnected', {});
    });

    // ===== Incoming messages — save with correct direction + dedup =====
    client.on('message', async (msg: any) => {
      try {
        await redis.del(`wa:chats:${organizationId}`);

        const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
        if (!session) {
          logger.warn('WhatsApp: incoming message but no session found, skipping DB save');
          return;
        }

        const externalId = msg.id?._serialized || null;
        const fromNumber = chatIdToPhone(msg.from || '');
        const toNumber = session.phoneNumber || '';

        // Deduplicate: skip if we already have this external message
        if (externalId) {
          const existing = await prisma.whatsAppMessage.findFirst({
            where: { organizationId, externalMessageId: externalId },
          });
          if (existing) return;
        }

        await prisma.whatsAppMessage.create({
          data: {
            externalMessageId: externalId,
            sessionId: session.id,
            direction: 'INBOUND',
            fromNumber,
            to: toNumber,
            message: msg.body || '',
            templateType: 'GENERAL',
            status: 'RECEIVED',
            sentAt: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
            organizationId,
          },
        });

        // Upsert conversation and increment unread count
        const fromPhone = normalizePhone(msg.from || '');
        await this._upsertConversation(fromPhone, organizationId, msg.from, {
          lastMessagePreview: (msg.body || '').slice(0, 100),
          lastMessageAt: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
        });
        await prisma.whatsAppConversation.updateMany({
          where: { organizationId, contactPhone: fromPhone },
          data: { unreadCount: { increment: 1 } },
        }).catch(() => {});

        // Include messageId for deduplication + quoted message info
        const quotedMsg = msg.hasQuotedMsg ? await msg.getQuotedMessage().catch(() => null) : null;

        emitToOrg(organizationId, 'whatsapp:message:new', {
          chatId: msg.from,
          messageId: externalId,
          body: msg.body,
          fromMe: false,
          timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
          type: msg.type,
          hasMedia: msg.hasMedia,
          quotedMsg: quotedMsg ? { body: quotedMsg.body?.slice(0, 200), fromMe: quotedMsg.fromMe } : null,
        });
      } catch (err) {
        logger.error('Failed to save incoming WhatsApp message:', err);
      }
    });

    // ===== Message ack updates =====
    client.on('message_ack', async (msg: any, ack: number) => {
      try {
        emitToOrg(organizationId, 'whatsapp:message:status', {
          chatId: msg.from || msg.to,
          messageId: msg.id?._serialized,
          ack,
        });
      } catch (err) {
        logger.error('Failed to emit message ack:', err);
      }
    });
  }

  // ===================== STATUS & QR =====================

  async getStatus(organizationId: string) {
    const session = await prisma.whatsAppSession.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      isConnected: this._ready,
      isInitializing: this._initializing,
      phoneNumber: session?.phoneNumber || null,
      lastPing: session?.lastPing || null,
    };
  }

  async getQrCode(organizationId: string) {
    if (this._qrCode) return { qrCode: this._qrCode };
    const session = await prisma.whatsAppSession.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
    return { qrCode: session?.qrCode || null };
  }

  // ===================== SEND MESSAGES =====================

  async sendMessage(data: SendMessageInput, organizationId: string, userId?: string, templateType: any = 'GENERAL') {
    this._ensureReady();

    const phone = normalizePhone(data.to);
    const rawChatId = phoneToChatId(data.to);

    try {
      // Resolve the correct ID (handles LID mapping for multi-device)
      const numberId = await this._client.getNumberId(rawChatId.replace('@c.us', ''));
      if (!numberId) throw new BadRequestError(`The number ${data.to} is not registered on WhatsApp`);
      const chatId = numberId._serialized;

      // Upsert conversation record
      await this._upsertConversation(phone, organizationId, chatId, {
        lastMessagePreview: data.message,
        lastMessageAt: new Date(),
        templateSource: templateType,
      });

      // Support reply/quote
      const options: any = {};
      if (data.quotedMessageId) {
        options.quotedMessageId = data.quotedMessageId;
      }

      const sentMsg = await this._client.sendMessage(chatId, data.message, Object.keys(options).length > 0 ? options : undefined);
      const externalId = sentMsg?.id?._serialized || null;

      const session = await this._getSessionOrThrow(organizationId);
      const msg = await prisma.whatsAppMessage.create({
        data: {
          externalMessageId: externalId,
          sessionId: session.id,
          direction: 'OUTBOUND',
          fromNumber: session.phoneNumber || '',
          to: phone,
          message: data.message,
          templateType,
          status: 'SENT',
          sentAt: new Date(),
          organizationId,
        },
      });

      await redis.del(`wa:chats:${organizationId}`);

      emitToOrg(organizationId, 'whatsapp:message:new', {
        chatId,
        messageId: externalId || `sent-${Date.now()}`,
        body: data.message,
        fromMe: true,
        timestamp: new Date().toISOString(),
        type: 'chat',
        hasMedia: false,
      });

      // Audit log
      if (userId) {
        await createAuditLog({
          userId,
          organizationId,
          entity: 'WhatsAppMessage',
          entityId: msg.id,
          action: 'CREATE',
          newValue: { to: phone, templateType, messageLength: data.message.length },
        });
      }

      return { ...msg, chatId };
    } catch (error: any) {
      // Log failed attempt
      const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
      await prisma.whatsAppMessage.create({
        data: {
          sessionId: session?.id || 'unknown',
          direction: 'OUTBOUND',
          fromNumber: session?.phoneNumber || '',
          to: phone,
          message: data.message,
          templateType,
          status: 'FAILED',
          error: error.message?.slice(0, 500),
          organizationId,
        },
      });
      throw new BadRequestError(`Failed to send: ${error.message}`);
    }
  }

  async sendJobLink(data: SendJobLinkInput, organizationId: string, userId?: string) {
    const jobUrl = data.jobUrl || 'https://hr.anistonav.com/jobs';
    const name = data.candidateName || 'Candidate';
    const message = `Hi ${name}! We'd like you to apply for *${data.jobTitle}* at Aniston Technologies.\n\nPlease click the link to apply: ${jobUrl}\n\nThank you!\n— HR Team, Aniston Technologies LLP`;
    return this.sendMessage({ to: data.phone, message }, organizationId, userId, 'JOB_LINK');
  }

  async sendToNumber(phone: string, message: string, organizationId: string, userId?: string) {
    this._ensureReady();
    const cleanPhone = normalizePhone(phone);

    try {
      // Resolve the correct ID (handles LID mapping for multi-device)
      const numberId = await this._client.getNumberId(cleanPhone);
      if (!numberId) throw new BadRequestError(`The number ${phone} is not registered on WhatsApp`);
      const chatId = numberId._serialized;

      // Upsert conversation record
      const conversationId = await this._upsertConversation(cleanPhone, organizationId, chatId, {
        lastMessagePreview: message,
        lastMessageAt: new Date(),
      });

      const sentMsg = await this._client.sendMessage(chatId, message);
      const externalId = sentMsg?.id?._serialized || null;

      const session = await this._getSessionOrThrow(organizationId);
      const msg = await prisma.whatsAppMessage.create({
        data: {
          externalMessageId: externalId,
          sessionId: session.id,
          direction: 'OUTBOUND',
          fromNumber: session.phoneNumber || '',
          to: cleanPhone,
          message,
          templateType: 'GENERAL',
          status: 'SENT',
          sentAt: new Date(),
          organizationId,
        },
      });

      await redis.del(`wa:chats:${organizationId}`);

      emitToOrg(organizationId, 'whatsapp:message:new', {
        chatId,
        messageId: externalId || `sent-${Date.now()}`,
        body: message,
        fromMe: true,
        timestamp: new Date().toISOString(),
        type: 'chat',
        hasMedia: false,
      });

      // Audit log
      if (userId) {
        await createAuditLog({
          userId,
          organizationId,
          entity: 'WhatsAppMessage',
          entityId: msg.id,
          action: 'CREATE',
          newValue: { to: cleanPhone, templateType: 'GENERAL', messageLength: message.length },
        });
      }

      return { success: true, chatId, conversationId };
    } catch (err: any) {
      throw new BadRequestError(`Failed to send: ${err.message}`);
    }
  }

  /**
   * Send media (image/document/video) via WhatsApp
   */
  async sendMedia(chatId: string, filePath: string, caption: string | undefined, organizationId: string, userId?: string) {
    this._ensureReady();

    const wwebjs = await import('whatsapp-web.js');
    const MessageMedia = wwebjs.MessageMedia || (wwebjs as any).default?.MessageMedia;
    if (!MessageMedia) throw new BadRequestError('MessageMedia not available');

    // Resolve the correct ID (handles LID mapping for multi-device)
    let normalizedChatId = chatId;
    if (!chatId.includes('@')) {
      const numberId = await this._client.getNumberId(chatId);
      normalizedChatId = numberId ? numberId._serialized : `${chatId}@c.us`;
    }

    const media = MessageMedia.fromFilePath(filePath);
    const sentMsg = await this._client.sendMessage(normalizedChatId, media, caption ? { caption } : undefined);

    await redis.del(`wa:chats:${organizationId}`);

    emitToOrg(organizationId, 'whatsapp:message:new', {
      chatId: normalizedChatId,
      messageId: sentMsg?.id?._serialized || `media-${Date.now()}`,
      body: caption || '',
      fromMe: true,
      timestamp: new Date().toISOString(),
      type: 'image',
      hasMedia: true,
    });

    // Audit log
    if (userId) {
      await createAuditLog({
        userId,
        organizationId,
        entity: 'WhatsAppMessage',
        entityId: sentMsg?.id?._serialized || 'media',
        action: 'CREATE',
        newValue: { to: chatIdToPhone(normalizedChatId), type: 'media', hasCaption: !!caption },
      });
    }

    return { success: true, messageId: sentMsg?.id?._serialized };
  }

  // ===================== CHATS (with Redis cache) =====================

  async getChats(organizationId: string) {
    this._ensureReady();

    // Check Redis cache
    const cacheKey = `wa:chats:${organizationId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore cache miss */ }

    try {
      const chats = await this._withTimeout(
        this._client.getChats(),
        CHAT_FETCH_TIMEOUT_MS,
        'Chat fetch timed out'
      ) as any[];

      const sorted = chats
        .filter((c: any) => c.lastMessage || c.unreadCount > 0)
        .sort((a: any, b: any) => {
          const tA = a.lastMessage?.timestamp || 0;
          const tB = b.lastMessage?.timestamp || 0;
          return tB - tA;
        })
        .slice(0, MAX_CHATS_DISPLAY);

      // Fetch profile pics in parallel (cached per contact)
      const result = await Promise.all(sorted.map(async (chat: any) => {
        const profilePicUrl = await this._getProfilePicUrl(chat.id._serialized);
        return {
          id: chat.id._serialized,
          name: chat.name || chat.id.user,
          isGroup: chat.isGroup,
          lastMessage: chat.lastMessage?.body?.slice(0, 100) || '',
          timestamp: chat.lastMessage?.timestamp ? new Date(chat.lastMessage.timestamp * 1000).toISOString() : null,
          unreadCount: chat.unreadCount || 0,
          profilePicUrl,
        };
      }));

      // Try to merge DB conversation metadata (unread counts, contact names)
      try {
        const convs = await prisma.whatsAppConversation.findMany({
          where: { organizationId },
          select: { providerChatId: true, contactPhone: true, contactName: true, unreadCount: true, lastMessagePreview: true },
        });
        const convByChat = new Map(convs.filter(c => c.providerChatId).map(c => [c.providerChatId!, c]));
        for (const chat of result) {
          const conv = convByChat.get(chat.id);
          if (conv) {
            // Use DB unread count as fallback if WhatsApp client returns 0 (stale)
            if (chat.unreadCount === 0 && conv.unreadCount > 0) {
              chat.unreadCount = conv.unreadCount;
            }
          }
        }
      } catch { /* ignore — DB merge is best-effort */ }

      // Cache
      try { await redis.set(cacheKey, JSON.stringify(result), 'EX', CHATS_CACHE_TTL); } catch { /* ignore */ }

      return result;
    } catch (err: any) {
      // On timeout, try returning cached data even if stale
      try {
        const stale = await redis.get(cacheKey);
        if (stale) {
          logger.warn('WhatsApp: returning stale cache after fetch failure');
          return JSON.parse(stale);
        }
      } catch { /* ignore */ }
      throw new BadRequestError(`Failed to get chats: ${err.message}`);
    }
  }

  // ===================== MESSAGES (lazy media — no eager download) =====================

  async getChatMessages(chatId: string, limit = 50, before?: string) {
    this._ensureReady();

    const normalizedChatId = this._normalizeChatId(chatId);

    try {
      const chat = await this._client.getChatById(normalizedChatId);
      if (!chat) throw new Error('Chat not found');

      const fetchLimit = before ? limit * 2 : limit;
      const messages = await chat.fetchMessages({ limit: fetchLimit });

      let filtered = messages;
      if (before) {
        const beforeTs = new Date(before).getTime() / 1000;
        filtered = messages.filter((m: any) => m.timestamp < beforeTs).slice(-limit);
      }

      // Map messages WITHOUT downloading media (lazy loading)
      const results = await Promise.all(
        filtered.map(async (msg: any) => {
          let quotedMsg = null;
          if (msg.hasQuotedMsg) {
            try {
              const quoted = await msg.getQuotedMessage();
              quotedMsg = {
                body: quoted?.body?.slice(0, 200) || '',
                fromMe: quoted?.fromMe || false,
                type: quoted?.type || 'chat',
              };
            } catch { /* ignore */ }
          }

          // Check if media is already cached on disk
          let mediaUrl = null;
          let mediaFilename = null;
          let mediaMimetype = null;
          if (msg.hasMedia) {
            const uploadsDir = storageService.getAbsoluteDir('whatsapp');
            const sanitizedId = msg.id._serialized.replace(/[^a-zA-Z0-9]/g, '_');
            if (fs.existsSync(uploadsDir)) {
              const files = fs.readdirSync(uploadsDir).filter((f: string) => f.startsWith(sanitizedId));
              if (files.length > 0) {
                mediaUrl = storageService.buildUrl('whatsapp', files[0]);
                mediaFilename = files[0];
              }
            }
          }

          return {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
            type: msg.type,
            hasMedia: msg.hasMedia,
            ack: msg.ack,
            mediaUrl,
            mediaFilename,
            mediaMimetype,
            quotedMsg,
            author: msg.author || null,
            notifyName: msg._data?.notifyName || null,
          };
        })
      );

      return results;
    } catch (err: any) {
      throw new BadRequestError(`Failed to get messages: ${err.message}`);
    }
  }

  // ===================== LAZY MEDIA DOWNLOAD =====================

  async downloadMedia(messageId: string, chatId: string, organizationId?: string) {
    this._ensureReady();

    const uploadsDir = storageService.getAbsoluteDir('whatsapp');

    // Check disk cache first
    const sanitizedId = messageId.replace(/[^a-zA-Z0-9]/g, '_');
    const existingFiles = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter((f: string) => f.startsWith(sanitizedId))
      : [];

    if (existingFiles.length > 0) {
      return {
        mediaUrl: storageService.buildUrl('whatsapp', existingFiles[0]),
        mediaFilename: existingFiles[0],
      };
    }

    // Download from WhatsApp
    const normalizedChatId = this._normalizeChatId(chatId);

    try {
      const chat = await this._client.getChatById(normalizedChatId);
      const messages = await chat.fetchMessages({ limit: 100 });
      const msg = messages.find((m: any) => m.id._serialized === messageId);

      if (!msg || !msg.hasMedia) throw new BadRequestError('Message not found or has no media');

      const media = await msg.downloadMedia();
      if (!media?.data) throw new BadRequestError('Failed to download media');

      const ext = this._getMediaExtension(media.mimetype, msg.type);
      const filename = `${sanitizedId}${ext}`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

      const mediaUrl = storageService.buildUrl('whatsapp', filename);

      // Update DB record with mediaUrl
      if (organizationId) {
        await prisma.whatsAppMessage.updateMany({
          where: { organizationId, externalMessageId: messageId },
          data: { mediaUrl, mediaMimetype: media.mimetype },
        }).catch(() => {});
      }

      return {
        mediaUrl,
        mediaFilename: media.filename || filename,
        mediaMimetype: media.mimetype,
      };
    } catch (err: any) {
      throw new BadRequestError(`Failed to download media: ${err.message}`);
    }
  }

  // ===================== MARK AS READ =====================

  async markChatAsRead(chatId: string, organizationId: string): Promise<{ success: boolean }> {
    this._ensureReady();

    const normalizedChatId = this._normalizeChatId(chatId);

    try {
      const chat = await this._client.getChatById(normalizedChatId);
      await chat.sendSeen();

      if (organizationId) {
        await redis.del(`wa:chats:${organizationId}`);
        emitToOrg(organizationId, 'whatsapp:chat:read', { chatId: normalizedChatId });
        await prisma.whatsAppConversation.updateMany({
          where: { organizationId, providerChatId: normalizedChatId },
          data: { unreadCount: 0 },
        }).catch(() => {});
      }

      return { success: true };
    } catch (err: any) {
      logger.warn(`Failed to mark chat as read: ${err.message}`);
      return { success: false };
    }
  }

  // ===================== SEARCH MESSAGES =====================

  async searchMessages(chatId: string, query: string, limit = 50) {
    this._ensureReady();

    const normalizedChatId = this._normalizeChatId(chatId);

    try {
      const chat = await this._client.getChatById(normalizedChatId);
      const messages = await chat.fetchMessages({ limit: 500 });

      const lowerQuery = query.toLowerCase();
      const matched = messages
        .filter((m: any) => m.body?.toLowerCase().includes(lowerQuery))
        .slice(0, limit)
        .map((msg: any) => ({
          id: msg.id._serialized,
          body: msg.body,
          fromMe: msg.fromMe,
          timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
          type: msg.type,
        }));

      return matched;
    } catch (err: any) {
      throw new BadRequestError(`Search failed: ${err.message}`);
    }
  }

  // ===================== CONVERSATIONS (DB-backed) =====================

  async getConversations(organizationId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [conversations, total] = await Promise.all([
      prisma.whatsAppConversation.findMany({
        where: { organizationId, status: { not: 'ARCHIVED' } },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { direction: true, message: true, status: true, sentAt: true, createdAt: true },
          },
        },
      }),
      prisma.whatsAppConversation.count({ where: { organizationId } }),
    ]);

    return {
      data: conversations.map(c => ({
        id: c.id,
        contactPhone: c.contactPhone,
        providerChatId: c.providerChatId,
        contactName: c.contactName,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview || c.messages[0]?.message?.slice(0, 100),
        unreadCount: c.unreadCount,
        status: c.status,
        templateSource: c.templateSource,
        lastMessageDirection: c.messages[0]?.direction,
        lastMessageStatus: c.messages[0]?.status,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOrResolveChatByPhone(phone: string, organizationId: string): Promise<{ chatId: string | null; conversationId: string | null }> {
    this._ensureReady();
    const normalized = normalizePhone(phone);

    // 1. Check DB conversation first (fastest, handles LID)
    try {
      const conv = await prisma.whatsAppConversation.findUnique({
        where: { organizationId_contactPhone: { organizationId, contactPhone: normalized } },
        select: { id: true, providerChatId: true },
      });
      if (conv?.providerChatId) {
        return { chatId: conv.providerChatId, conversationId: conv.id };
      }
    } catch { /* ignore */ }

    // 2. Try resolving via WhatsApp client (getNumberId handles LID)
    try {
      const numberId = await this._client.getNumberId(normalized);
      if (numberId) {
        const resolvedChatId = numberId._serialized;
        const convId = await this._upsertConversation(normalized, organizationId, resolvedChatId);
        return { chatId: resolvedChatId, conversationId: convId };
      }
    } catch { /* ignore */ }

    return { chatId: null, conversationId: null };
  }

  // ===================== CONTACTS (with Redis cache) =====================

  async getContacts(organizationId: string) {
    this._ensureReady();

    const cacheKey = `wa:contacts:${organizationId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }

    try {
      const contacts = await this._withTimeout(
        this._client.getContacts(),
        CONTACT_FETCH_TIMEOUT_MS,
        'Contact fetch timed out'
      ) as any[];

      const result = contacts
        .filter((c: any) => c.isWAContact && !c.isGroup && (c.name || c.pushname))
        .sort((a: any, b: any) => {
          const nameA = (a.name || a.pushname || '').toLowerCase();
          const nameB = (b.name || b.pushname || '').toLowerCase();
          return nameA.localeCompare(nameB);
        })
        .slice(0, MAX_CONTACTS_DISPLAY)
        .map((c: any) => ({
          id: c.id._serialized,
          name: c.name || c.pushname || c.id.user,
          number: c.number,
          isMyContact: c.isMyContact,
          pushname: c.pushname || null,
        }));

      try { await redis.set(cacheKey, JSON.stringify(result), 'EX', CONTACTS_CACHE_TTL); } catch { /* ignore */ }

      return result;
    } catch (err: any) {
      throw new BadRequestError(`Failed to get contacts: ${err.message}`);
    }
  }

  // ===================== PROFILE PICTURE =====================

  private async _getProfilePicUrl(contactId: string): Promise<string | null> {
    const cacheKey = `wa:pfp:${contactId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached === 'null' ? null : cached;
    } catch { /* ignore */ }

    try {
      const url = await this._client.getProfilePicUrl(contactId);
      const value = url || null;
      try { await redis.set(cacheKey, value || 'null', 'EX', PROFILE_PIC_CACHE_TTL); } catch { /* ignore */ }
      return value;
    } catch {
      try { await redis.set(cacheKey, 'null', 'EX', PROFILE_PIC_CACHE_TTL); } catch { /* ignore */ }
      return null;
    }
  }

  // ===================== HRMS MESSAGES (DB) =====================

  async getMessages(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.whatsAppMessage.count({ where: { organizationId } }),
    ]);
    return { data: messages, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ===================== SESSION LIFECYCLE =====================

  async autoReconnect() {
    try {
      const session = await prisma.whatsAppSession.findFirst({
        where: { isConnected: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (!session) {
        logger.info('WhatsApp: no previous session to reconnect');
        return;
      }

      const sessionAge = Date.now() - new Date(session.updatedAt).getTime();
      if (sessionAge > SESSION_MAX_AGE_MS) {
        logger.info(`WhatsApp session expired (${Math.round(sessionAge / 86400000)} days old). Clearing session.`);
        await prisma.whatsAppSession.updateMany({
          where: { id: session.id },
          data: { isConnected: false, qrCode: null },
        });
        const sessionDir = path.join(WA_AUTH_DIR, `session-aniston-${session.organizationId}`);
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        return;
      }

      const sessionDir = path.join(WA_AUTH_DIR, `session-aniston-${session.organizationId}`);
      if (!fs.existsSync(sessionDir)) {
        logger.warn('WhatsApp auth files missing on disk — session cannot be restored. QR scan required.');
        await prisma.whatsAppSession.updateMany({
          where: { id: session.id },
          data: { isConnected: false },
        });
        return;
      }

      logger.info(`WhatsApp auto-reconnecting for org ${session.organizationId} (phone: ${session.phoneNumber})...`);
      await this.initialize(session.organizationId);
    } catch (err: any) {
      logger.warn(`WhatsApp auto-reconnect failed: ${err.message}`);
    }
  }

  async refreshQr(organizationId: string, userId?: string) {
    await this._destroyClient();
    this._ready = false;
    this._initializing = false;
    this._qrCode = null;
    await prisma.whatsAppSession.updateMany({
      where: { organizationId },
      data: { qrCode: null, isConnected: false },
    });

    if (userId) {
      await createAuditLog({
        userId,
        organizationId,
        entity: 'WhatsAppSession',
        entityId: organizationId,
        action: 'UPDATE',
        newValue: { action: 'QR_REFRESH' },
      });
    }

    return this.initialize(organizationId);
  }

  async logout(organizationId: string, userId?: string) {
    if (this._client) {
      try { await this._client.logout(); } catch { /* ignore */ }
    }
    await this._destroyClient();
    this._ready = false;
    this._initializing = false;
    this._qrCode = null;
    await prisma.whatsAppSession.updateMany({
      where: { organizationId },
      data: { isConnected: false, qrCode: null },
    });
    const sessionDir = path.join(WA_AUTH_DIR, `session-aniston-${organizationId}`);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    // Clear all caches
    try {
      await redis.del(`wa:chats:${organizationId}`);
      await redis.del(`wa:contacts:${organizationId}`);
    } catch { /* ignore */ }

    // Audit log
    if (userId) {
      await createAuditLog({
        userId,
        organizationId,
        entity: 'WhatsAppSession',
        entityId: organizationId,
        action: 'DELETE',
        newValue: { action: 'LOGOUT' },
      });
    }

    return { message: 'WhatsApp disconnected' };
  }

  // ===================== DB CONTACTS CRUD =====================

  /**
   * Get DB-backed contacts for this org (not live WhatsApp session contacts).
   * These are contacts stored in WhatsAppContact table — manually added or imported.
   */
  async getDbContacts(organizationId: string, search?: string, page = 1, limit = 100) {
    const skip = (page - 1) * limit;
    const where: any = {
      organizationId,
      deletedAt: null,
    };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { normalizedPhone: { contains: search } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.whatsAppContact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.whatsAppContact.count({ where }),
    ]);

    // Enrich with providerChatId from WhatsAppConversation if available
    const conversations = await prisma.whatsAppConversation.findMany({
      where: { organizationId },
      select: { contactPhone: true, providerChatId: true, unreadCount: true, lastMessageAt: true },
    });

    // Build lookup: normalized phone → conversation metadata
    const convMap = new Map(conversations.map(c => [c.contactPhone, c]));

    const enriched = contacts.map(c => {
      // Try to find conversation by phone matching (handles prefix differences)
      const conv = convMap.get(c.normalizedPhone)
        || convMap.get(normalizePhone(c.normalizedPhone)) // try with India prefix
        || Array.from(convMap.entries()).find(([k]) => phonesMatch(k, c.normalizedPhone))?.[1];

      return {
        ...c,
        providerChatId: conv?.providerChatId || null,
        hasChat: !!conv?.providerChatId,
        lastMessageAt: conv?.lastMessageAt || null,
        unreadCount: conv?.unreadCount || 0,
      };
    });

    return {
      data: enriched,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async createContact(data: CreateContactInput, organizationId: string, userId?: string) {
    const normalizedPhone = normalizePhoneForStorage(data.phone);
    if (!normalizedPhone || normalizedPhone.length < 7) {
      throw new BadRequestError('Invalid phone number — must contain at least 7 digits');
    }

    // Check duplicate
    const existing = await prisma.whatsAppContact.findFirst({
      where: { organizationId, normalizedPhone, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestError(`A contact with phone ${data.phone} already exists`);
    }

    const contact = await prisma.whatsAppContact.create({
      data: {
        organizationId,
        name: data.name.trim(),
        phone: data.phone.trim(),
        normalizedPhone,
        email: data.email || null,
        notes: data.notes || null,
        source: (data.source as any) || 'MANUAL',
        referenceId: data.referenceId || null,
        referenceType: data.referenceType || null,
      },
    });

    if (userId) {
      await createAuditLog({
        userId, organizationId,
        entity: 'WhatsAppContact', entityId: contact.id,
        action: 'CREATE',
        newValue: { name: contact.name, phone: contact.phone, source: contact.source },
      });
    }

    return contact;
  }

  async updateContact(contactId: string, data: UpdateContactInput, organizationId: string, userId?: string) {
    const contact = await prisma.whatsAppContact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!contact) throw new BadRequestError('Contact not found');

    const updated = await prisma.whatsAppContact.update({
      where: { id: contactId },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.email !== undefined ? { email: data.email || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      },
    });

    if (userId) {
      await createAuditLog({
        userId, organizationId,
        entity: 'WhatsAppContact', entityId: contactId,
        action: 'UPDATE',
        newValue: data,
      });
    }

    return updated;
  }

  /**
   * Soft-delete a contact. Chat history is NOT deleted.
   * Note: whatsapp-web.js does NOT support deleting contacts from the actual WhatsApp account.
   * Deletion is application-layer only — the contact will still exist in WhatsApp on the device.
   */
  async deleteContact(contactId: string, organizationId: string, userId?: string) {
    const contact = await prisma.whatsAppContact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
    });
    if (!contact) throw new BadRequestError('Contact not found');

    await prisma.whatsAppContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });

    if (userId) {
      await createAuditLog({
        userId, organizationId,
        entity: 'WhatsAppContact', entityId: contactId,
        action: 'DELETE',
        newValue: { name: contact.name, phone: contact.phone },
      });
    }

    return { success: true };
  }

  async destroy() {
    await this._destroyClient();
    this._ready = false;
    this._initializing = false;
    logger.info('WhatsApp client destroyed gracefully (session preserved for reconnect)');
  }

  // ===================== PRIVATE HELPERS =====================

  private _ensureReady() {
    if (!this._ready || !this._client) throw new BadRequestError('WhatsApp not connected. Initialize first.');
  }

  private async _getSessionOrThrow(organizationId: string) {
    const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
    if (!session) throw new BadRequestError('WhatsApp session not found. Initialize first.');
    return session;
  }

  private _normalizeChatId(chatId: string): string {
    if (chatId.includes('@')) return chatId;
    return `${chatId}@c.us`;
  }

  private async _destroyClient() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this._sessionExpiryInterval) {
      clearInterval(this._sessionExpiryInterval);
      this._sessionExpiryInterval = null;
    }
    if (this._client) {
      try { await this._client.destroy(); } catch { /* ignore */ }
      this._client = null;
    }
  }

  private async _withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${errorMsg} (${ms}ms)`)), ms);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      clearTimeout(timer!);
      return result;
    } catch (err) {
      clearTimeout(timer!);
      throw err;
    }
  }

  private _startSessionExpiryChecker(organizationId: string) {
    if (this._sessionExpiryInterval) clearInterval(this._sessionExpiryInterval);
    this._sessionExpiryInterval = setInterval(async () => {
      try {
        const session = await prisma.whatsAppSession.findFirst({
          where: { organizationId, isConnected: true },
        });
        if (!session) return;
        const age = Date.now() - new Date(session.updatedAt).getTime();
        if (age > SESSION_MAX_AGE_MS) {
          logger.info('WhatsApp session expired via periodic check, disconnecting...');
          await this.logout(organizationId);
        }
      } catch (err) {
        logger.warn('Session expiry check failed:', err);
      }
    }, 6 * 60 * 60 * 1000); // Every 6 hours
  }

  private _findChromePath(): string | undefined {
    const chromePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_PATH,
      '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const puppeteerCacheDir = path.join(homeDir, '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(puppeteerCacheDir)) {
      try {
        const versions = fs.readdirSync(puppeteerCacheDir);
        for (const ver of versions) {
          chromePaths.push(
            path.join(puppeteerCacheDir, ver, 'chrome-linux64', 'chrome'),
            path.join(puppeteerCacheDir, ver, 'chrome-linux', 'chrome'),
            path.join(puppeteerCacheDir, ver, 'chrome-win', 'chrome.exe'),
          );
        }
      } catch { /* ignore */ }
    }

    for (const p of chromePaths) {
      if (!p) continue;
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* skip */ }
    }
    return undefined;
  }

  private async _upsertConversation(
    contactPhone: string,
    organizationId: string,
    providerChatId?: string,
    updates?: {
      lastMessagePreview?: string;
      lastMessageAt?: Date;
      templateSource?: any;
      referenceId?: string;
      referenceType?: string;
    }
  ): Promise<string> {
    const normalized = normalizePhone(contactPhone);
    try {
      const conv = await prisma.whatsAppConversation.upsert({
        where: { organizationId_contactPhone: { organizationId, contactPhone: normalized } },
        create: {
          organizationId,
          contactPhone: normalized,
          providerChatId: providerChatId || null,
          lastMessageAt: updates?.lastMessageAt || new Date(),
          lastMessagePreview: updates?.lastMessagePreview?.slice(0, 100),
          templateSource: updates?.templateSource,
          referenceId: updates?.referenceId,
          referenceType: updates?.referenceType,
        },
        update: {
          ...(providerChatId ? { providerChatId } : {}),
          ...(updates?.lastMessageAt ? { lastMessageAt: updates.lastMessageAt } : {}),
          ...(updates?.lastMessagePreview ? { lastMessagePreview: updates.lastMessagePreview.slice(0, 100) } : {}),
          updatedAt: new Date(),
        },
      });
      return conv.id;
    } catch (err) {
      logger.warn('_upsertConversation failed:', err);
      return '';
    }
  }

  private _getMediaExtension(mimetype: string, msgType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      'audio/ogg; codecs=opus': '.ogg', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf', 'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    if (mimetype && mimeMap[mimetype]) return mimeMap[mimetype];
    if (msgType === 'image') return '.jpg';
    if (msgType === 'audio' || msgType === 'ptt') return '.ogg';
    if (msgType === 'video') return '.mp4';
    if (msgType === 'document') return '.bin';
    return '.bin';
  }
}

export const whatsAppService = new WhatsAppService();
