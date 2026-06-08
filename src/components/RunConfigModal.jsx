import { useEffect, useState } from 'react';
import { Clapperboard, Clock, Hash, Monitor, Target, X } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const DURATIONS = ['5', '10', '15'];           // seconds
const RESOLUTIONS = ['480p', '720p', '1080p'];

// Per-tenant run control — the settings n8n used to hardcode.
export function RunConfigModal({ open, config, onClose, onSave }) {
    const toast = useToast();
    const [form, setForm] = useState(config);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => { if (open) { setForm(config); setError(null); } }, [open, config]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const targeting = Boolean(form.tiktok_id?.trim());

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        if (Number(form.max_videos_per_run) < 1 || !form.max_videos_per_run)
            return setError('Set how many videos per persona (at least 1).');
        if (Number(form.max_qc_attempts) < 1 || !form.max_qc_attempts)
            return setError('Set the QC retry attempts (at least 1).');
        if (!form.video_duration) return setError('Choose a video duration.');
        if (!form.video_resolution) return setError('Choose a video resolution.');

        setSaving(true);
        try {
            await onSave(form);
            toast.success('Run settings saved.');
            onClose();
        } catch (err) {
            setError(err.message || 'Could not save run settings.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} labelledBy="run-config-title">
            <div className="modal-card">
                <div className="modal-head">
                    <div>
                        <p className="modal-eyebrow">Pipeline</p>
                        <h2 id="run-config-title">Run settings</h2>
                    </div>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
                </div>

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <label className="toggle-row">
                            <input
                                type="checkbox"
                                checked={Boolean(form.one_per_persona)}
                                disabled={targeting}
                                onChange={e => set('one_per_persona', e.target.checked)}
                            />
                            <span>
                                Process <strong>every</strong> persona this run (one video each).
                                Off = only personas with no video yet.
                                {targeting && <em className="hint"> Ignored while targeting specific accounts below.</em>}
                            </span>
                        </label>

                        <label className="field">
                            <span className="field-label">Target accounts <span className="field-opt">(optional)</span></span>
                            <div className="field-input">
                                <Target />
                                <input
                                    type="text"
                                    placeholder="leave empty for all · or tiktok_id, tiktok_id"
                                    value={form.tiktok_id ?? ''}
                                    onChange={e => set('tiktok_id', e.target.value)}
                                />
                            </div>
                        </label>

                        <div className="field-row">
                            <label className="field">
                                <span className="field-label">Videos per persona</span>
                                <div className="field-input">
                                    <Hash />
                                    <input
                                        type="number" min="1" step="1"
                                        placeholder="1"
                                        value={form.max_videos_per_run ?? ''}
                                        onChange={e => set('max_videos_per_run', e.target.value)}
                                    />
                                </div>
                            </label>
                            <label className="field">
                                <span className="field-label">QC retry attempts</span>
                                <div className="field-input">
                                    <Clapperboard />
                                    <input
                                        type="number" min="1" step="1"
                                        placeholder="3"
                                        value={form.max_qc_attempts ?? ''}
                                        onChange={e => set('max_qc_attempts', e.target.value)}
                                    />
                                </div>
                            </label>
                        </div>

                        <div className="field-row">
                            <label className="field">
                                <span className="field-label">Video duration</span>
                                <div className="field-input field-input--select">
                                    <Clock />
                                    <select value={form.video_duration ?? ''} onChange={e => set('video_duration', e.target.value)}>
                                        <option value="">Select…</option>
                                        {DURATIONS.map(d => <option key={d} value={d}>{d} seconds</option>)}
                                    </select>
                                </div>
                            </label>
                            <label className="field">
                                <span className="field-label">Video resolution</span>
                                <div className="field-input field-input--select">
                                    <Monitor />
                                    <select value={form.video_resolution ?? ''} onChange={e => set('video_resolution', e.target.value)}>
                                        <option value="">Select…</option>
                                        {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                            </label>
                        </div>

                        {error && <div className="auth-error">{error}</div>}
                    </div>

                    <div className="modal-foot">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save settings'}
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
}
