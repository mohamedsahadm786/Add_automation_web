import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Check, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext(null);

let nextId = 1;

const ICONS = {
    success: Check,
    error: AlertTriangle,
    info: Info,
};

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const timersRef = useRef(new Map());

    const dismiss = useCallback((id) => {
        const timers = timersRef.current;
        const t = timers.get(id);
        if (t) { clearTimeout(t); timers.delete(id); }
        setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)));
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 220);
    }, []);

    const push = useCallback((kind, message) => {
        const id = nextId++;
        setToasts(prev => [...prev, { id, kind, message, leaving: false }]);
        const timeout = setTimeout(() => dismiss(id), 3200);
        timersRef.current.set(id, timeout);
    }, [dismiss]);

    const api = useMemo(() => ({
        success: (m) => push('success', m),
        error:   (m) => push('error', m),
        info:    (m) => push('info', m),
    }), [push]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="toast-stack" aria-live="polite" aria-atomic="true">
                {toasts.map(t => {
                    const Icon = ICONS[t.kind] || Info;
                    return (
                        <div
                            key={t.id}
                            className={`toast toast-${t.kind}${t.leaving ? ' is-leaving' : ''}`}
                            role="status"
                        >
                            <Icon strokeWidth={2.5} />
                            <span>{t.message}</span>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
    return ctx;
}
