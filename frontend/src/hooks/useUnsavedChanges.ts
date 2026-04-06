import { useState, useEffect, useCallback } from 'react';

export function useUnsavedChanges(hasChanges: boolean) {
  const [showWarning, setShowWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Browser close/refresh warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const confirmClose = useCallback((onConfirm: () => void) => {
    if (hasChanges) {
      setPendingAction(() => onConfirm);
      setShowWarning(true);
    } else {
      onConfirm();
    }
  }, [hasChanges]);

  const handleDiscard = () => {
    setShowWarning(false);
    pendingAction?.();
    setPendingAction(null);
  };

  const handleCancel = () => {
    setShowWarning(false);
    setPendingAction(null);
  };

  return { showWarning, confirmClose, handleDiscard, handleCancel };
}
