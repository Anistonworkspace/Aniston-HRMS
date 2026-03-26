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
      // Dynamic import to avoid issues when whatsapp-web.js not installed
      const { Client, LocalAuth } = await import('whatsapp-web.js');
      const qrcode = await import('qrcode');

      currentOrgId = organizationId;

      waClient = new Client({
        authStrategy: new LocalAuth({ clientId: `aniston-${organizationId}` }),
        puppeteer: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          headless: true,
        },
      });

      waClient.on('qr', async (qr: string) => {
        try {
          currentQrCode = await qrcode.toDataURL(qr);
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
