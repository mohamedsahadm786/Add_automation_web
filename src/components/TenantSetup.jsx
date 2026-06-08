import { useRef, useState } from 'react';
import { Building2, Eye, EyeOff, ImagePlus, KeyRound, Package, Sparkles, Upload, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext.jsx';

// Shown to a freshly signed-up member before they've completed onboarding.
// Collects API keys, reference images, and briefings — all stored per tenant.
export function TenantSetup({ user, onSave }) {
    const toast = useToast();
    const fileInputRef = useRef(null);

    const [falApiKey, setFalApiKey] = useState('');
    const [anthropicApiKey, setAnthropicApiKey] = useState('');
    const [productBriefing, setProductBriefing] = useState('');
    const [companyBriefing, setCompanyBriefing] = useState('');
    const [files, setFiles] = useState([]);          // File[]
    const [reveal, setReveal] = useState({});
    const [saving, setSaving] = useState(false);

    function addFiles(list) {
        const imgs = Array.from(list).filter(f => f.type.startsWith('image/'));
        setFiles(prev => [...prev, ...imgs]);
    }
    function removeFile(idx) {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        try {
            await onSave(
                { falApiKey, anthropicApiKey, productBriefing, companyBriefing },
                files,
            );
            toast.success('Setup complete — welcome aboard!');
        } catch (err) {
            console.error('[Alluvi] tenant setup failed', err);
            toast.error(err?.message || 'Could not save your setup.');
            setSaving(false);
        }
    }

    return (
        <section className="panel setup-panel">
            <header className="panel-head">
                <div>
                    <h2>Let’s set up your workspace</h2>
                    <p className="panel-sub">
                        Welcome{user?.name ? `, ${user.name}` : ''} — add a few things to get started.
                    </p>
                </div>
            </header>

            <form className="setup-form" onSubmit={handleSubmit}>
                <div className="setup-card">
                    <div className="setup-card-head">
                        <KeyRound />
                        <div>
                            <h3>API keys</h3>
                            <p>Used to run your automation pipeline.</p>
                        </div>
                    </div>

                    <label className="field">
                        <span className="field-label">Fal API key</span>
                        <div className="field-input">
                            <KeyRound />
                            <input
                                type={reveal.fal ? 'text' : 'password'}
                                placeholder="fal-…"
                                autoComplete="off" spellCheck="false"
                                value={falApiKey}
                                onChange={e => setFalApiKey(e.target.value)}
                            />
                            <button type="button" className="reveal" onClick={() => setReveal(r => ({ ...r, fal: !r.fal }))} aria-label="Toggle">
                                {reveal.fal ? <EyeOff /> : <Eye />}
                            </button>
                        </div>
                    </label>

                    <label className="field">
                        <span className="field-label">Anthropic Claude API key</span>
                        <div className="field-input">
                            <KeyRound />
                            <input
                                type={reveal.anthropic ? 'text' : 'password'}
                                placeholder="sk-ant-…"
                                autoComplete="off" spellCheck="false"
                                value={anthropicApiKey}
                                onChange={e => setAnthropicApiKey(e.target.value)}
                            />
                            <button type="button" className="reveal" onClick={() => setReveal(r => ({ ...r, anthropic: !r.anthropic }))} aria-label="Toggle">
                                {reveal.anthropic ? <EyeOff /> : <Eye />}
                            </button>
                        </div>
                    </label>
                </div>

                <div className="setup-card">
                    <div className="setup-card-head">
                        <ImagePlus />
                        <div>
                            <h3>Reference images</h3>
                            <p>Upload one or more images for your brand/product.</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="setup-drop"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                    >
                        <Upload />
                        <span>Click to choose images, or drop them here</span>
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                    />

                    {files.length > 0 && (
                        <ul className="setup-thumbs">
                            {files.map((f, i) => (
                                <li key={`${f.name}-${i}`} className="setup-thumb">
                                    <img src={URL.createObjectURL(f)} alt={f.name} />
                                    <button type="button" className="setup-thumb-x" onClick={() => removeFile(i)} aria-label="Remove">
                                        <X />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="setup-card">
                    <div className="setup-card-head">
                        <Package />
                        <div>
                            <h3>Product briefing</h3>
                            <p>What is the product? Key features, tone, audience.</p>
                        </div>
                    </div>
                    <textarea
                        className="field-textarea"
                        rows={5}
                        placeholder="Describe your product…"
                        value={productBriefing}
                        onChange={e => setProductBriefing(e.target.value)}
                    />
                </div>

                <div className="setup-card">
                    <div className="setup-card-head">
                        <Building2 />
                        <div>
                            <h3>Company briefing</h3>
                            <p>About the company, brand voice, do’s and don’ts.</p>
                        </div>
                    </div>
                    <textarea
                        className="field-textarea"
                        rows={5}
                        placeholder="Describe your company…"
                        value={companyBriefing}
                        onChange={e => setCompanyBriefing(e.target.value)}
                    />
                </div>

                <footer className="setup-foot">
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                        <Sparkles />
                        <span>{saving ? 'Setting up…' : 'Finish setup'}</span>
                    </button>
                </footer>
            </form>
        </section>
    );
}
