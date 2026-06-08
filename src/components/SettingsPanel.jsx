import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, RefreshCw, ShieldAlert } from 'lucide-react';
import { useSettings, SETTING_FIELDS } from '../hooks/useSettings.js';
import { useToast } from '../contexts/ToastContext.jsx';

export function SettingsPanel({ tenantId }) {
    const toast = useToast();
    const { values, status, error, reload, save } = useSettings(tenantId);

    const [form, setForm] = useState({});
    const [reveal, setReveal] = useState({});   // { KEY: bool }
    const [saving, setSaving] = useState(false);

    // Sync the form once values load (and on reload).
    useEffect(() => {
        if (status === 'ready') {
            const next = {};
            SETTING_FIELDS.forEach(f => { next[f.key] = values[f.key] ?? ''; });
            setForm(next);
        }
    }, [status, values]);

    function update(key, value) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        try {
            await save(form);
            toast.success('Settings saved.');
        } catch (err) {
            toast.error(err?.message || 'Could not save settings.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2>Settings</h2>
                    <p className="panel-sub">Your workspace API keys.</p>
                </div>
                <div className="filters">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
                        <RefreshCw />
                        <span>Refresh</span>
                    </button>
                </div>
            </header>

            {status === 'loading' && (
                <div className="state state-loading">
                    <div className="spinner" />
                    <p>Loading settings…</p>
                </div>
            )}

            {status === 'error' && (
                <div className="state state-error">
                    <ShieldAlert strokeWidth={1.5} />
                    <h3>Couldn't load settings</h3>
                    <p>{error?.raw?.message || 'Please try again.'}</p>
                    <button type="button" className="btn btn-ghost" onClick={reload}>Try again</button>
                </div>
            )}

            {status === 'ready' && (
                <form className="settings-form" onSubmit={handleSubmit}>
                    <div className="settings-warn">
                        <ShieldAlert />
                        <p>
                            These keys are scoped to your workspace. They’re stored in the database
                            and read with the public key — use only on a trusted deployment.
                        </p>
                    </div>

                    {SETTING_FIELDS.map(f => {
                        const shown = reveal[f.key];
                        return (
                            <label className="field" key={f.key}>
                                <span className="field-label">{f.label}</span>
                                <div className="field-input">
                                    <KeyRound />
                                    <input
                                        type={f.secret && !shown ? 'password' : 'text'}
                                        placeholder={f.placeholder}
                                        autoComplete="off"
                                        spellCheck="false"
                                        value={form[f.key] ?? ''}
                                        onChange={e => update(f.key, e.target.value)}
                                    />
                                    {f.secret && (
                                        <button
                                            type="button"
                                            className="reveal"
                                            onClick={() => setReveal(r => ({ ...r, [f.key]: !r[f.key] }))}
                                            aria-label={shown ? 'Hide value' : 'Show value'}
                                            title={shown ? 'Hide' : 'Show'}
                                        >
                                            {shown ? <EyeOff /> : <Eye />}
                                        </button>
                                    )}
                                </div>
                            </label>
                        );
                    })}

                    <footer className="settings-foot">
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save settings'}
                        </button>
                    </footer>
                </form>
            )}
        </section>
    );
}
