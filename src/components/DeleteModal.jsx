import { useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal.jsx';

export function DeleteModal({ open, target, onClose, onConfirm }) {
    const [submitting, setSubmitting] = useState(false);

    async function handleConfirm() {
        if (!target) return;
        setSubmitting(true);
        try {
            await onConfirm(target);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} labelledBy="delete-modal-title">
            <div className="modal-card modal-card--sm">
                <header className="modal-head">
                    <div>
                        <p className="modal-eyebrow modal-eyebrow--danger">Delete account</p>
                        <h2 id="delete-modal-title">This can't be undone</h2>
                    </div>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                        <X />
                    </button>
                </header>
                <div className="modal-body">
                    <p>
                        Remove <strong>@{target?.tiktok_id}</strong> from the workspace?
                        Its automation history will be detached.
                    </p>
                </div>
                <footer className="modal-foot">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={submitting}>
                        {submitting ? 'Deleting…' : 'Delete account'}
                    </button>
                </footer>
            </div>
        </Modal>
    );
}
