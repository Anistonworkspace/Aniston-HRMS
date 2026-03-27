import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import type { SendMessageInput, SendJobLinkInput } from './whatsapp.validation.js';

// WhatsApp Web client — lazily initialized
let waClient: any = null;
let isReady = false;
let currentOrgId: string | null = null;
let currentQrCode: string | null = null;

export class WhatsAppService {
  async initialize(organizationId: string) {
    if (isReady) return { isConnected: true, message: 'Already connected' };

    try {
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
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ];
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
        } catch (err) {
          logger.error('Failed to process QR:', err);
        }
      });

      waClient.on('ready', async () => {
        isReady = true;
        currentQrCode = null;
        const info = waClient.info;
        await prisma.whatsAppSession.upsert({
          where: { sessionName: `main-${organizationId}` },
          update: { isConnected: true, phoneNumber: info?.wid?.user || null, qrCode: null, lastPing: new Date() },
          create: { sessionName: `main-${organizationId}`, isConnected: true, phoneNumber: info?.wid?.user, organizationId },
        });
        logger.info(`WhatsApp connected: ${info?.wid?.user}`);
      });

      waClient.on('disconnected', async () => {
        isReady = false;
        currentQrCode = null;
        await prisma.whatsAppSession.updateMany({
          where: { sessionName: `main-${organizationId}` },
          data: { isConnected: false, qrCode: null },
        });
        logger.info('WhatsApp disconnected');
      });

      await waClient.initialize();
      return { isConnected: false, message: 'Initializing... Scan QR code' };
    } catch (error: any) {
      logger.error('WhatsApp init failed:', error.message);
      throw new BadRequestError(`WhatsApp initialization failed: ${error.message}`);
    }
  }

  async getStatus(organizationId: string) {
    const session = await prisma.whatsAppSession.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      isConnected: isReady,
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
   * Get messages for a specific chat.
   */
  async getChatMessages(chatId: string, limit = 50) {
    if (!isReady || !waClient) throw new BadRequestError('WhatsApp not connected');

    try {
      const chat = await waClient.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit });
      return messages.map((msg: any) => ({
        id: msg.id._serialized,
        body: msg.body,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
        type: msg.type,
        hasMedia: msg.hasMedia,
        ack: msg.ack, // 0=pending, 1=sent, 2=delivered, 3=read
      }));
    } catch (err: any) {
      throw new BadRequestError(`Failed to get messages: ${err.message}`);
    }
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
    currentQrCode = null;

    await prisma.whatsAppSession.updateMany({
      where: { organizationId },
      data: { isConnected: false, qrCode: null },
    });

    return { message: 'WhatsApp disconnected' };
  }
}

export const whatsAppService = new WhatsAppService();
