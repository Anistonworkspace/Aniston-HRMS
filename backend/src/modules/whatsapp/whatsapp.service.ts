import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
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

export class WhatsAppService {
  async initialize(organizationId: string) {
    if (isReady) return { isConnected: true, status: 'connected', message: 'Already connected' };
    if (isInitializing) return { isConnected: false, status: 'initializing', message: 'Already initializing... please wait' };

    try {
      isInitializing = true;

      // Dynamic import — whatsapp-web.js uses default export in some versions
      const wwebjs = await import('whatsapp-web.js');
      const Client = wwebjs.Client || (wwebjs as any).default?.Client;
      const LocalAuth = wwebjs.LocalAuth || (wwebjs as any).default?.LocalAuth;
      const qrcode = await import('qrcode');

      if (!Client || !LocalAuth) {
        throw new Error('whatsapp-web.js Client or LocalAuth not found. Run: npm install whatsapp-web.js@latest');
      }

      currentOrgId = organizationId;

      // Find Chrome/Chromium executable — MUST set for Puppeteer v24+
      const chromePaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_PATH,
        // Linux system Chrome/Chromium (production servers)
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        // Windows local dev
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];

      // Also search Puppeteer cache for downloaded Chrome
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const puppeteerCacheDir = path.join(homeDir, '.cache', 'puppeteer', 'chrome');
      if (fs.existsSync(puppeteerCacheDir)) {
        try {
          const versions = fs.readdirSync(puppeteerCacheDir);
          for (const ver of versions) {
            const candidates = [
              path.join(puppeteerCacheDir, ver, 'chrome-linux64', 'chrome'),
              path.join(puppeteerCacheDir, ver, 'chrome-linux', 'chrome'),
              path.join(puppeteerCacheDir, ver, 'chrome-win', 'chrome.exe'),
            ];
            chromePaths.push(...candidates);
          }
        } catch { /* ignore */ }
      }

      let executablePath: string | undefined;
      for (const p of chromePaths) {
        if (!p) continue;
        try { fs.accessSync(p, fs.constants.X_OK); executablePath = p; break; } catch { /* skip */ }
      }
      logger.info(`WhatsApp: using Chrome at ${executablePath || 'puppeteer default'}`);

      waClient = new Client({
        authStrategy: new LocalAuth({ clientId: `aniston-${organizationId}` }),
        puppeteer: {
          executablePath: executablePath || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--no-first-run',
          ],
          headless: 'new' as any,
          timeout: 60000,
        },
        webVersionCache: {
          type: 'none',
        },
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

      // Handle incoming messages — save to DB + emit Socket.io event
      waClient.on('message', async (msg: any) => {
        try {
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
          emitToOrg(organizationId, 'whatsapp:message:new', {
            chatId: msg.from,
            body: msg.body,
            fromMe: false,
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
            type: msg.type,
            hasMedia: msg.hasMedia,
          });
        } catch (err) {
          logger.error('Failed to save incoming WhatsApp message:', err);
        }
      });

      // Handle message acknowledgement updates (sent/delivered/read)
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

      // Provide actionable error for missing Chrome dependencies
      if (msg.includes('shared libraries') || msg.includes('Failed to launch the browser') || msg.includes('ENOENT')) {
        throw new BadRequestError(
          'WhatsApp initialization failed: Chrome/Chromium dependencies are missing on this server. ' +
          'Run: sudo apt-get install -y chromium-browser libatk1.0-0 libatk-bridge2.0-0 libgbm1 libnss3 libxss1 libasound2'
        );
      }
      throw new BadRequestError(`WhatsApp initialization failed: ${msg}`);
    }
  }

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

  async sendMessage(data: SendMessageInput, organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected. Initialize first.');

    const phone = data.to.replace(/\D/g, '');
    const chatId = phone.startsWith('91') ? `${phone}@c.us` : `91${phone}@c.us`;

    try {
      await waClient.sendMessage(chatId, data.message);

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

      emitToOrg(organizationId, 'whatsapp:message:new', {
        chatId,
        body: data.message,
        fromMe: true,
        timestamp: new Date().toISOString(),
        type: 'chat',
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
    const frontendUrl = process.env.FRONTEND_URL || 'https://hr.anistonav.com';
    const jobUrl = data.jobUrl || `${frontendUrl}/jobs`;
    const name = data.candidateName || 'Candidate';

    const message = `Hi ${name}! We'd like you to apply for *${data.jobTitle}* at Aniston Technologies.\n\nPlease click the link to apply: ${jobUrl}\n\nThank you!\n— HR Team, Aniston Technologies LLP`;

    return this.sendMessage({ to: data.phone, message }, organizationId);
  }

  /**
   * Get all chats from connected WhatsApp.
   */
  async getChats(organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    try {
      const chats = await waClient.getChats();
      return chats.slice(0, 50).map((chat: any) => ({
        id: chat.id._serialized,
        name: chat.name || chat.id.user,
        isGroup: chat.isGroup,
        lastMessage: chat.lastMessage?.body?.slice(0, 100) || '',
        timestamp: chat.lastMessage?.timestamp ? new Date(chat.lastMessage.timestamp * 1000).toISOString() : null,
        unreadCount: chat.unreadCount || 0,
      }));
    } catch (err: any) {
      throw new BadRequestError(`Failed to get chats: ${err.message}`);
    }
  }

  /**
   * Get messages for a specific chat. Downloads media when available.
   */
  async getChatMessages(chatId: string, limit = 50) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    // Ensure chatId has proper suffix — WhatsApp Web.js requires @c.us or @g.us
    let normalizedChatId = chatId;
    if (!chatId.includes('@')) {
      normalizedChatId = `${chatId}@c.us`;
    }

    try {
      const chat = await waClient.getChatById(normalizedChatId);
      if (!chat) throw new Error('Chat not found');
      const messages = await chat.fetchMessages({ limit });

      // Ensure whatsapp uploads directory exists
      const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const results = await Promise.all(
        messages.map(async (msg: any) => {
          const base: any = {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
            type: msg.type,
            hasMedia: msg.hasMedia,
            ack: msg.ack, // 0=pending, 1=sent, 2=delivered, 3=read
          };

          // Attempt to download media if present
          if (msg.hasMedia) {
            try {
              const media = await msg.downloadMedia();
              if (media && media.data) {
                const ext = this.getMediaExtension(media.mimetype, msg.type);
                const filename = `${msg.id._serialized.replace(/[^a-zA-Z0-9]/g, '_')}${ext}`;
                const filePath = path.join(uploadsDir, filename);

                // Only download if not already cached
                if (!fs.existsSync(filePath)) {
                  fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                }

                base.mediaUrl = `/uploads/whatsapp/${filename}`;
                base.mediaFilename = media.filename || filename;
                base.mediaMimetype = media.mimetype;
              }
            } catch (mediaErr) {
              // If media download fails, just return hasMedia: true without mediaUrl
              logger.warn(`Failed to download media for message ${msg.id._serialized}:`, mediaErr);
            }
          }

          return base;
        })
      );

      return results;
    } catch (err: any) {
      throw new BadRequestError(`Failed to get messages: ${err.message}`);
    }
  }

  /**
   * Get file extension from MIME type.
   */
  private getMediaExtension(mimetype: string, msgType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/ogg; codecs=opus': '.ogg',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
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

  /**
   * Send message to a new number (creates chat if needed).
   */
  async sendToNumber(phone: string, message: string, organizationId: string) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');
    const cleanPhone = phone.replace(/\D/g, '');
    const chatId = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@c.us`;

    try {
      await waClient.sendMessage(chatId, message);

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

      return { success: true, chatId };
    } catch (err: any) {
      throw new BadRequestError(`Failed to send: ${err.message}`);
    }
  }

  /**
   * Get contacts from connected WhatsApp.
   */
  async getContacts() {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');
    try {
      const contacts = await waClient.getContacts();
      return contacts
        .filter((c: any) => c.isWAContact && !c.isGroup)
        .slice(0, 100)
        .map((c: any) => ({
          id: c.id._serialized,
          name: c.name || c.pushname || c.id.user,
          number: c.number,
          isMyContact: c.isMyContact,
        }));
    } catch (err: any) {
      throw new BadRequestError(`Failed to get contacts: ${err.message}`);
    }
  }

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

  /**
   * Auto-reconnect on server startup: find any previously-connected session and re-initialize.
   */
  async autoReconnect() {
    try {
      const session = await prisma.whatsAppSession.findFirst({
        where: { isConnected: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (session) {
        logger.info(`WhatsApp auto-reconnecting for org ${session.organizationId} (phone: ${session.phoneNumber})...`);
        await this.initialize(session.organizationId);
      } else {
        logger.info('WhatsApp: no previous session to reconnect');
      }
    } catch (err: any) {
      logger.warn(`WhatsApp auto-reconnect failed: ${err.message}`);
    }
  }

  async logout(organizationId: string) {
    if (waClient) {
      try {
        await waClient.logout();
      } catch {
        // Ignore logout errors
      }
      waClient = null;
    }
    isReady = false;
    isInitializing = false;
    currentQrCode = null;

    await prisma.whatsAppSession.updateMany({
      where: { organizationId },
      data: { isConnected: false, qrCode: null },
    });

    return { message: 'WhatsApp disconnected' };
  }
}

export const whatsAppService = new WhatsAppService();
