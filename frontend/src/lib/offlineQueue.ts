const STORAGE_KEY = 'aniston_offline_queue';
const MAX_QUEUE_SIZE = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface QueuedAction {
  id: string;
  type: 'CLOCK_IN' | 'CLOCK_OUT';
  payload: Record<string, any>;
  timestamp: number;
  retries: number;
}

function generateId(): string {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: QueuedAction[] = JSON.parse(raw);
    // Auto-prune stale items
    const now = Date.now();
    return items.filter(item => now - item.timestamp < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_QUEUE_SIZE)));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function enqueueAction(type: QueuedAction['type'], payload: Record<string, any>): QueuedAction {
  const action: QueuedAction = {
    id: generateId(),
    type,
    payload,
    timestamp: Date.now(),
    retries: 0,
  };
  const queue = readQueue();
  queue.push(action);
  writeQueue(queue);
  return action;
}

export function getQueuedActions(): QueuedAction[] {
  return readQueue();
}

export function removeAction(id: string): void {
  const queue = readQueue().filter(a => a.id !== id);
  writeQueue(queue);
}

export function incrementRetries(id: string): number {
  const queue = readQueue();
  const action = queue.find(a => a.id === id);
  if (action) {
    action.retries += 1;
    writeQueue(queue);
    return action.retries;
  }
  return 0;
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getQueueSize(): number {
  return readQueue().length;
}
