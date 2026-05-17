import { Request, Response, NextFunction } from 'express';
import { savedLocationService } from './saved-location.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await savedLocationService.list(req.user!.organizationId);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await savedLocationService.create(req.user!.organizationId, req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await savedLocationService.update(
      req.params.id,
      req.user!.organizationId,
      req.user!.id,
      req.body
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await savedLocationService.remove(req.params.id, req.user!.organizationId, req.user!.id);
    res.json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
}

export async function promoteFromVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body;
    const data = await savedLocationService.promoteFromVisit(
      req.params.visitId,
      req.user!.organizationId,
      req.user!.id,
      name || 'Saved Location'
    );
    res.status(201).json({ success: true, data });
  } catch (e) {
    next(e);
  }
}
