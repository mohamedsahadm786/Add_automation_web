import { useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal.jsx';

// Confirmation for the destructive-ish lifecycle actions (suspend / remove).
// Reactivate is safe and applied without confirmation.
const COPY = {
    suspend: {
        eyebrow: 'Temporary stop',
        title: 'Suspend this tenant?',
        body: 'They will be blocked from signing in until you reactivate them. Their data is kept and nothing is deleted.',
        confirm: 'Suspend',
        danger: false,
    },
    remove: {
        eyebrow: 'Remove from platform',
        title: 'Remove this tenant?',
        body: 'They will be blocked from signing in and hidden from the tenants list. Their data is retained for audit and can be restored later by reactivating — this is not a permanent delete.',
        confirm: 'Remove',
        danger: true,
    },
};

export function TenantActionModal({ open, mode, tenant, onClose, onConfirm }) {
    const [busy, setBusy] = useState(false);
    if (!mode || !tenant) return null;
    const c = COPY[mode];

    async function go() {
        setBusy(true);
        try {
            await onConfirm();
            onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} labelledBy="tenant-action-title">
            <div className="modal-card modal-card--sm">
                <div className="modal-head">
                    <div>
                        <p className={`modal-eyebrow${c.danger ? ' modal-eyebrow--danger' : ''}`}>{c.eyebrow}</p>
                        <h2 id="tenant-action-title">{c.title}</h2>
                    </div>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
                </div>
                <div className="modal-body">
                    <p className="state-sub" style={{ maxWidth: 'none' }}>
                        <strong>{tenant.name || tenant.email || 'This tenant'}</strong> — {c.body}
                    </p>
                </div>
                <div className="modal-foot">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={go}
                        disabled={busy}
                    >
                        {busy ? 'Working…' : c.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
