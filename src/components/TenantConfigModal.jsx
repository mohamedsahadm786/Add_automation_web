import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { supabase } from '../lib/supabase.js';

// Super-admin edit control over a tenant's configuration. Writes directly to
// tenant_profiles (super admin reads/writes via the publishable key; no RLS
// yet). The auth email itself is not editable here — that lives in Supabase Auth.
export function TenantConfigModal({ open, tenant, onClose, onSaved }) {
    const [form, setForm] = useState({});
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open && tenant) {
            setForm({
                name: tenant.name || '',
                fal_api_key: tenant.fal_api_key || '',
                anthropic_api_key: tenant.anthropic_api_key || '',
                product_briefing: tenant.product_briefing || '',
                company_briefing: tenant.company_briefing || '',
                onboarded: Boolean(tenant.onboarded),
            });
            setError(null);
        }
    }, [open, tenant]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            const { error: err } = await supabase
                .from('tenant_profiles')
                .update({
                    name: form.name?.trim() || null,
                    fal_api_key: form.fal_api_key?.trim() || null,
                    anthropic_api_key: form.anthropic_api_key?.trim() || null,
                    product_briefing: form.product_briefing?.trim() || null,
                    company_briefing: form.company_briefing?.trim() || null,
                    onboarded: form.onboarded,
                    updated_at: new Date().toISOString(),
                })
                .eq('tenant_id', tenant.tenant_id);
            if (err) throw err;
            onSaved?.();
            onClose();
        } catch (err) {
            setError(err.message || 'Could not save changes.');
        } finally {
            setSaving(false);
        }
    }

    if (!tenant) return null;

    return (
        <Modal open={open} onClose={onClose} labelledBy="tenant-config-title">
            <div className="modal-card">
                <div className="modal-head">
                    <div>
                        <p className="modal-eyebrow">{tenant.email || 'tenant'}</p>
                        <h2 id="tenant-config-title">Edit tenant configuration</h2>
                    </div>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
                </div>

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <label className="field">
                            <span className="field-label">Name</span>
                            <div className="field-input">
                                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Tenant name" />
                            </div>
                        </label>

                        <label className="field">
                            <span className="field-label">Fal API key</span>
                            <div className="field-input">
                                <input value={form.fal_api_key} onChange={e => set('fal_api_key', e.target.value)} placeholder="fal-…" />
                            </div>
                        </label>

                        <label className="field">
                            <span className="field-label">Anthropic Claude API key</span>
                            <div className="field-input">
                                <input value={form.anthropic_api_key} onChange={e => set('anthropic_api_key', e.target.value)} placeholder="sk-ant-…" />
                            </div>
                        </label>

                        <label className="field">
                            <span className="field-label">Product briefing</span>
                            <textarea
                                className="field-textarea"
                                rows={3}
                                value={form.product_briefing}
                                onChange={e => set('product_briefing', e.target.value)}
                                placeholder="What product is being marketed?"
                            />
                        </label>

                        <label className="field">
                            <span className="field-label">Company briefing</span>
                            <textarea
                                className="field-textarea"
                                rows={3}
                                value={form.company_briefing}
                                onChange={e => set('company_briefing', e.target.value)}
                                placeholder="Company context, tone, audience…"
                            />
                        </label>

                        <label className="toggle-row">
                            <input
                                type="checkbox"
                                checked={form.onboarded}
                                onChange={e => set('onboarded', e.target.checked)}
                            />
                            <span>Onboarded (unchecked = tenant sees the setup page on next login)</span>
                        </label>

                        {error && <div className="auth-error">{error}</div>}
                    </div>

                    <div className="modal-foot">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
}
