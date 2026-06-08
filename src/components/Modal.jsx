import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ open, onClose, children, labelledBy }) {
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
            <div className="modal-scrim" onClick={onClose} />
            {children}
        </div>,
        document.body,
    );
}
