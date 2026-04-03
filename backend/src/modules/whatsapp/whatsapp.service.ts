import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import type { SendMessageInput, SendJobLinkInput } from './whatsapp.validation.js';

// WhatsApp Web client — lazily initialized
let waClient: any = null;
let isReady = false;
let isInitializing = false;
let currentOrgId: string | null = null;
let currentQrCode: string | null = null;

// Session expiry: 7 days in milliseconds
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Persistent auth directory — absolute path so it survives PM2 restarts / cwd changes
const WA_AUTH_DIR = path.resolve(process.cwd(), '.wwebjs_auth');

// Cache TTLs
const CHATS_CACHE_TTL = 30;    // 30 seconds
const CONTACTS_CACHE_TTL = 300; // 5 minutes
const PROFILE_PIC_CACHE_TTL = 86400; // 24 hours

export class WhatsAppService {
  private _pingInterval: ReturnType<typeof setInterval> | null = null;

  // ===================== CONNECTION & INITIALIZATION =====================

  async initialize(organizationId: string) {
    if (isReady) return { isConnected: true, status: 'connected', message: 'Already connected' };
    if (isInitializing) return { isConnected: false, status: 'initializing', message: 'Already initializing... please wait' };

    try {
      isInitializing = true;

      const wwebjs = await import('whatsapp-web.js');
      const Client = wwebjs.Client || (wwebjs as any).default?.Client;
      const LocalAuth = wwebjs.LocalAuth || (wwebjs as any).default?.LocalAuth;
      const qrcode = await import('qrcode');

      if (!Client || !LocalAuth) {
        throw new Error('whatsapp-web.js Client or LocalAuth not found. Run: npm install whatsapp-web.js@latest');
      }

      currentOrgId = organizationId;

      // Clean up any corrupted session files
      const sessionDir = path.join(WA_AUTH_DIR, `session-aniston-${organizationId}`);
      const defaultDir = path.join(sessionDir, 'Default');
      if (fs.existsSync(sessionDir) && !fs.existsSync(defaultDir)) {
        logger.info('WhatsApp: removing corrupted session directory');
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      // Find Chrome/Chromium executable
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

      let executablePath: string | undefined;
      for (const p of chromePaths) {
        if (!p) continue;
        try { fs.accessSync(p, fs.constants.X_OK); executablePath = p; break; } catch { /* skip */ }
      }
      logger.info(`WhatsApp: using Chrome at ${executablePath || 'puppeteer default'}`);

      if (!fs.existsSync(WA_AUTH_DIR)) {
        fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
      }

      waClient = new Client({
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

      waClient.on('qr', async (qr: string) => {
        try {
          const toDataURL = qrcode.toDataURL || (qrcode as any).default?.toDataURL;
          currentQrCode = toDataURL ? await toDataURL(qr) : null;
          await prisma.whatsAppSession.upsert({
            where: { sessionName: `main-${organizationId}` },
            update: { qrCode: currentQrCode, isConnected: false },
            create: { sessionName: `main-${organizationId}`, qrCode: currentQrCode, organizationId },
          });
          logger.info('WhatsApp QR code generated');
          emitToOrg(organizationId, 'whatsapp:qr', { qrCode: currentQrCode });
        } catch (err) {
          logger.error('Failed to process QR:', err);
        }
      });

      waClient.on('authenticated', () => {
        logger.info('WhatsApp QR scanned — authenticating...');
        currentQrCode = null;
        emitToOrg(organizationId, 'whatsapp:authenticated', { message: 'QR scanned, linking device...' });
      });

      waClient.on('auth_failure', async (msg: string) => {
        isReady = false;
        isInitializing = false;
        currentQrCode = null;
        logger.error('WhatsApp auth failure:', msg);
        await prisma.whatsAppSession.updateMany({
          where: { sessionName: `main-${organizationId}` },
          data: { isConnected: false, qrCode: null },
        });
        emitToOrg(organizationId, 'whatsapp:auth_failure', { message: msg || 'Authentication failed' });
      });

      waClient.on('ready', async () => {
        isReady = true;
        isInitializing = false;
        currentQrCode = null;
        const info = waClient.info;
        await prisma.whatsAppSession.upsert({
          where: { sessionName: `main-${organizationId}` },
          update: { isConnected: true, phoneNumber: info?.wid?.user || null, qrCode: null, lastPing: new Date() },
          create: { sessionName: `main-${organizationId}`, isConnected: true, phoneNumber: info?.wid?.user, organizationId },
        });
        logger.info(`WhatsApp connected: ${info?.wid?.user}`);
        emitToOrg(organizationId, 'whatsapp:ready', { phoneNumber: info?.wid?.user });

        // Periodic ping
        if (this._pingInterval) clearInterval(this._pingInterval);
        this._pingInterval = setInterval(async () => {
          try {
            if (isReady) {
              await prisma.whatsAppSession.updateMany({
                where: { sessionName: `main-${organizationId}`, isConnected: true },
                data: { lastPing: new Date() },
              });
            }
          } catch { /* ignore */ }
        }, 30 * 60 * 1000);
      });

      waClient.on('disconnected', async () => {
        isReady = false;
        isInitializing = false;
        currentQrCode = null;
        await prisma.whatsAppSession.updateMany({
          where: { sessionName: `main-${organizationId}` },
          data: { isConnected: false, qrCode: null },
        });
        logger.info('WhatsApp disconnected');
        emitToOrg(organizationId, 'whatsapp:disconnected', {});
      });

      // ===== Incoming messages — save + emit with messageId =====
      waClient.on('message', async (msg: any) => {
        try {
          // Invalidate chat cache on new message
          await redis.del(`wa:chats:${organizationId}`);

          const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
          const fromNumber = msg.from?.replace('@c.us', '').replace('@g.us', '') || '';
          await prisma.whatsAppMessage.create({
            data: {
              sessionId: session?.id || '',
              to: fromNumber,
              message: msg.body || '',
              templateType: 'GENERAL',
              status: 'DELIVERED',
              sentAt: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
              organizationId,
            },
          });

          // Include messageId for deduplication + quoted message info
          const quotedMsg = msg.hasQuotedMsg ? await msg.getQuotedMessage().catch(() => null) : null;

          emitToOrg(organizationId, 'whatsapp:message:new', {
            chatId: msg.from,
            messageId: msg.id?._serialized,
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
      waClient.on('message_ack', async (msg: any, ack: number) => {
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

      await waClient.initialize();
      return { isConnected: false, status: 'initializing', message: 'Initializing... Scan QR code' };
    } catch (error: any) {
      isInitializing = false;
      const msg = error.message || String(error);
      logger.error('WhatsApp init failed:', msg);
      if (msg.includes('shared libraries') || msg.includes('Failed to launch the browser') || msg.includes('ENOENT')) {
        throw new BadRequestError(
          'WhatsApp initialization failed: Chrome/Chromium dependencies are missing. ' +
          'Run: sudo apt-get install -y chromium-browser libatk1.0-0 libatk-bridge2.0-0 libgbm1 libnss3 libxss1 libasound2'
        );
      }
      throw new BadRequestError(`WhatsApp initialization failed: ${msg}`);
    }
  }

  // ===================== STATUS & QR =====================

  async getStatus(organizationId: string) {
    const session = await prisma.whatsAppSession.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      isConnected: isReady,
      isInitializing,
      phoneNumber: session?.phoneNumber || null,
      lastPing: session?.lastPing || null,
    };
  }

  async getQrCode(organizationId: string) {
    if (currentQrCode) return { qrCode: currentQrCode };
    const session = await prisma.whatsAppSession.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
    return { qrCode: session?.qrCode || null };
  }

  // ===================== SEND MESSAGES =====================

  async sendMessage(data: SendMessageInput, organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected. Initialize first.');

    const phone = data.to.replace(/\D/g, '');
    const chatId = phone.startsWith('91') ? `${phone}@c.us` : `91${phone}@c.us`;

    try {
      // Support reply/quote
      const options: any = {};
      if (data.quotedMessageId) {
        options.quotedMessageId = data.quotedMessageId;
      }

      const sentMsg = await waClient.sendMessage(chatId, data.message, Object.keys(options).length > 0 ? options : undefined);

      const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
      const msg = await prisma.whatsAppMessage.create({
        data: {
          sessionId: session?.id || '',
          to: data.to,
          message: data.message,
          templateType: 'GENERAL',
          status: 'SENT',
          sentAt: new Date(),
          organizationId,
        },
      });

      // Invalidate chat cache
      await redis.del(`wa:chats:${organizationId}`);

      emitToOrg(organizationId, 'whatsapp:message:new', {
        chatId,
        messageId: sentMsg?.id?._serialized || `sent-${Date.now()}`,
        body: data.message,
        fromMe: true,
        timestamp: new Date().toISOString(),
        type: 'chat',
        hasMedia: false,
      });

      return msg;
    } catch (error: any) {
      await prisma.whatsAppMessage.create({
        data: {
          sessionId: '',
          to: data.to,
          message: data.message,
          templateType: 'GENERAL',
          status: 'FAILED',
          error: error.message,
          organizationId,
        },
      });
      throw new BadRequestError(`Failed to send: ${error.message}`);
    }
  }

  async sendJobLink(data: SendJobLinkInput, organizationId: string) {
    const jobUrl = data.jobUrl || `https://hr.anistonav.com/jobs`;
    const name = data.candidateName || 'Candidate';
    const message = `Hi ${name}! We'd like you to apply for *${data.jobTitle}* at Aniston Technologies.\n\nPlease click the link to apply: ${jobUrl}\n\nThank you!\n— HR Team, Aniston Technologies LLP`;
    return this.sendMessage({ to: data.phone, message }, organizationId);
  }

  async sendToNumber(phone: string, message: string, organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');
    const cleanPhone = phone.replace(/\D/g, '');
    const chatId = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@c.us`;

    try {
      const sentMsg = await waClient.sendMessage(chatId, message);

      const session = await prisma.whatsAppSession.findFirst({ where: { organizationId } });
      await prisma.whatsAppMessage.create({
        data: {
          sessionId: session?.id || '',
          to: phone,
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
        messageId: sentMsg?.id?._serialized || `sent-${Date.now()}`,
        body: message,
        fromMe: true,
        timestamp: new Date().toISOString(),
        type: 'chat',
        hasMedia: false,
      });

      return { success: true, chatId };
    } catch (err: any) {
      throw new BadRequestError(`Failed to send: ${err.message}`);
    }
  }

  /**
   * Send media (image/document/video) via WhatsApp
   */
  async sendMedia(chatId: string, filePath: string, caption: string | undefined, organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    const wwebjs = await import('whatsapp-web.js');
    const MessageMedia = wwebjs.MessageMedia || (wwebjs as any).default?.MessageMedia;
    if (!MessageMedia) throw new BadRequestError('MessageMedia not available');

    let normalizedChatId = chatId;
    if (!chatId.includes('@')) {
      normalizedChatId = `${chatId}@c.us`;
    }

    const media = MessageMedia.fromFilePath(filePath);
    const sentMsg = await waClient.sendMessage(normalizedChatId, media, caption ? { caption } : undefined);

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

    return { success: true, messageId: sentMsg?.id?._serialized };
  }

  // ===================== CHATS (with Redis cache) =====================

  async getChats(organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    // Check Redis cache
    const cacheKey = `wa:chats:${organizationId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore cache miss */ }

    try {
      const chatsPromise = waClient.getChats();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chat fetch timed out (30s)')), 30000)
      );
      const chats = await Promise.race([chatsPromise, timeoutPromise]) as any[];

      const sorted = chats
        .filter((c: any) => c.lastMessage || c.unreadCount > 0)
        .sort((a: any, b: any) => {
          const tA = a.lastMessage?.timestamp || 0;
          const tB = b.lastMessage?.timestamp || 0;
          return tB - tA;
        })
        .slice(0, 150);

      // Fetch profile pics in parallel (cached per contact)
      const result = await Promise.all(sorted.map(async (chat: any) => {
        const profilePicUrl = await this.getProfilePicUrl(chat.id._serialized, organizationId);
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

      // Cache for 30s
      try { await redis.set(cacheKey, JSON.stringify(result), 'EX', CHATS_CACHE_TTL); } catch { /* ignore */ }

      return result;
    } catch (err: any) {
      throw new BadRequestError(`Failed to get chats: ${err.message}`);
    }
  }

  // ===================== MESSAGES (lazy media — no eager download) =====================

  async getChatMessages(chatId: string, limit = 50, before?: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    let normalizedChatId = chatId;
    if (!chatId.includes('@')) {
      normalizedChatId = `${chatId}@c.us`;
    }

    try {
      const chat = await waClient.getChatById(normalizedChatId);
      if (!chat) throw new Error('Chat not found');

      // Fetch more messages if pagination cursor provided
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
          // Check for quoted message
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
            const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
            const sanitizedId = msg.id._serialized.replace(/[^a-zA-Z0-9]/g, '_');
            // Check if any file with this ID prefix exists
            if (fs.existsSync(uploadsDir)) {
              const files = fs.readdirSync(uploadsDir).filter(f => f.startsWith(sanitizedId));
              if (files.length > 0) {
                mediaUrl = `/uploads/whatsapp/${files[0]}`;
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
            // Contact info for received messages
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

  /**
   * Download media for a specific message on demand
   */
  async downloadMedia(messageId: string, chatId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    // Check disk cache first
    const sanitizedId = messageId.replace(/[^a-zA-Z0-9]/g, '_');
    const existingFiles = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter(f => f.startsWith(sanitizedId))
      : [];

    if (existingFiles.length > 0) {
      return {
        mediaUrl: `/uploads/whatsapp/${existingFiles[0]}`,
        mediaFilename: existingFiles[0],
      };
    }

    // Download from WhatsApp
    let normalizedChatId = chatId;
    if (!chatId.includes('@')) normalizedChatId = `${chatId}@c.us`;

    try {
      const chat = await waClient.getChatById(normalizedChatId);
      const messages = await chat.fetchMessages({ limit: 100 });
      const msg = messages.find((m: any) => m.id._serialized === messageId);

      if (!msg || !msg.hasMedia) throw new BadRequestError('Message not found or has no media');

      const media = await msg.downloadMedia();
      if (!media?.data) throw new BadRequestError('Failed to download media');

      const ext = this.getMediaExtension(media.mimetype, msg.type);
      const filename = `${sanitizedId}${ext}`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

      return {
        mediaUrl: `/uploads/whatsapp/${filename}`,
        mediaFilename: media.filename || filename,
        mediaMimetype: media.mimetype,
      };
    } catch (err: any) {
      throw new BadRequestError(`Failed to download media: ${err.message}`);
    }
  }

  // ===================== MARK AS READ =====================

  async markChatAsRead(chatId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    let normalizedChatId = chatId;
    if (!chatId.includes('@')) normalizedChatId = `${chatId}@c.us`;

    try {
      const chat = await waClient.getChatById(normalizedChatId);
      await chat.sendSeen();

      // Invalidate chat cache to update unread counts
      if (currentOrgId) {
        await redis.del(`wa:chats:${currentOrgId}`);
      }

      return { success: true };
    } catch (err: any) {
      logger.warn(`Failed to mark chat as read: ${err.message}`);
      return { success: false };
    }
  }

  // ===================== SEARCH MESSAGES =====================

  async searchMessages(chatId: string, query: string, limit = 50) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    let normalizedChatId = chatId;
    if (!chatId.includes('@')) normalizedChatId = `${chatId}@c.us`;

    try {
      const chat = await waClient.getChatById(normalizedChatId);
      const messages = await chat.fetchMessages({ limit: 200 });

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

  // ===================== CONTACTS (with Redis cache) =====================

  async getContacts(organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    // Check Redis cache
    const cacheKey = `wa:contacts:${organizationId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }

    try {
      const contactsPromise = waClient.getContacts();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Contact fetch timed out (30s)')), 30000)
      );
      const contacts = await Promise.race([contactsPromise, timeoutPromise]) as any[];

      const result = contacts
        .filter((c: any) => c.isWAContact && !c.isGroup && (c.name || c.pushname))
        .sort((a: any, b: any) => {
          const nameA = (a.name || a.pushname || '').toLowerCase();
          const nameB = (b.name || b.pushname || '').toLowerCase();
          return nameA.localeCompare(nameB);
        })
        .slice(0, 300)
        .map((c: any) => ({
          id: c.id._serialized,
          name: c.name || c.pushname || c.id.user,
          number: c.number,
          isMyContact: c.isMyContact,
          pushname: c.pushname || null,
        }));

      // Cache for 5min
      try { await redis.set(cacheKey, JSON.stringify(result), 'EX', CONTACTS_CACHE_TTL); } catch { /* ignore */ }

      return result;
    } catch (err: any) {
      throw new BadRequestError(`Failed to get contacts: ${err.message}`);
    }
  }

  // ===================== PROFILE PICTURE =====================

  private async getProfilePicUrl(contactId: string, organizationId: string): Promise<string | null> {
    const cacheKey = `wa:pfp:${contactId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached === 'null' ? null : cached;
    } catch { /* ignore */ }

    try {
      const url = await waClient.getProfilePicUrl(contactId);
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

  async refreshQr(organizationId: string) {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (waClient) {
      try { await waClient.destroy(); } catch { /* ignore */ }
      waClient = null;
    }
    isReady = false;
    isInitializing = false;
    currentQrCode = null;
    await prisma.whatsAppSession.updateMany({
      where: { organizationId },
      data: { qrCode: null, isConnected: false },
    });
    return this.initialize(organizationId);
  }

  async logout(organizationId: string) {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (waClient) {
      try { await waClient.logout(); } catch { /* ignore */ }
      try { await waClient.destroy(); } catch { /* ignore */ }
      waClient = null;
    }
    isReady = false;
    isInitializing = false;
    currentQrCode = null;
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
    return { message: 'WhatsApp disconnected' };
  }

  async destroy() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (waClient) {
      try { await waClient.destroy(); } catch { /* ignore */ }
      waClient = null;
    }
    isReady = false;
    isInitializing = false;
    logger.info('WhatsApp client destroyed gracefully (session preserved for reconnect)');
  }

  // ===================== HELPERS =====================

  private getMediaExtension(mimetype: string, msgType: string): string {
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
