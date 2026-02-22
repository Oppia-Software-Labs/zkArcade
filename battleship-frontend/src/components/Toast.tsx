import { useEffect, useState } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'error' | 'success';
  txHash?: string;
  exiting?: boolean;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (message: string, type: ToastItem['type'] = 'info', txHash?: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type, txHash }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    }, 5000);
  };

  return { toasts, addToast };
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type === 'error' ? 'toast-error' : ''} ${t.type === 'success' ? 'toast-success' : ''} ${t.exiting ? 'toast-exit' : ''}`}>
          {t.message}
          {t.txHash && (
            <>
              {' '}
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${t.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Stellar Expert
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
