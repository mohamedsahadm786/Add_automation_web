import { useState } from 'react';
import {
    ArrowLeft, Ban, Building2, CheckCircle2, DollarSign, ExternalLink, Eye, EyeOff,
    Image as ImageIcon, KeyRound, Pencil, Play, Trash2, UserSquare2, Video,
} from 'lucide-react';
import { formatCost } from '../lib/cost.js';
import { formatDate } from '../lib/utils.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { setTenantStatus } from '../lib/tenantAdmin.js';
import { logTenantAction } from '../lib/audit.js';
import { TenantConfigModal } from './TenantConfigModal.jsx';
import { TenantActionModal } from './TenantActionModal.jsx';

const STATUS_TAG = {
    active:    { label: 'Active',    cls: 'tag-on' },
    suspended: { label: 'Suspended', cls: 'tag-warn' },
    removed:   { label: 'Removed',   cls: 'tag-danger' },
};

// Everything about one tenant: counts, QC, cost, API keys, briefings, accounts.
// "Page" opens their exact interface (impersonation); "Edit" gives the super
// admin control over their configuration; the Account control panel suspends,
// reactivates, or removes the tenant.
export function TenantDetail({ tenant, onBack, onImpersonate, onSaved }) {
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [action, setAction] = useState(null); // 'suspend' | 'remove' | null
    if (!tenant) return null;

    const status = tenant.status || 'active';
    const statusTag = STATUS_TAG[status] || STATUS_TAG.active;
    const qcTotal = tenant.qcPass + tenant.qcSkip;
    const passRate = qcTotal > 0 ? Math.round((tenant.qcPass / qcTotal) * 100) : null;

    async function applyStatus(next, verb) {
        try {
            await setTenantStatus(tenant.tenant_id, next);
            logTenantAction(tenant, verb);
            toast.success(`Tenant ${verb === 'reactivate' ? 'reactivated' : verb === 'suspend' ? 'suspended' : 'removed'}.`);
            onSaved?.();
        } catch (err) {
            toast.error(err.message || 'Action failed.');
            throw err;
        }
    }

    return (
        <section className="tenant-detail">
            <div className="detail-head">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
                    <ArrowLeft /><span>All tenants</span>
                </button>
                <div className="detail-title">
                    <h2>{tenant.name || '—'}</h2>
                    <p className="panel-sub">
                        {tenant.email || 'no email'} · joined {formatDate(tenant.created_at)} ·{' '}
                        last active {tenant.lastActivity ? formatDate(tenant.lastActivity) : '—'} ·{' '}
                        <span className={`tag ${statusTag.cls}`}>{statusTag.label}</span>{' '}
                        <span className={`tag ${tenant.onboarded ? 'tag-on' : 'tag-off'}`}>
                            {tenant.onboarded ? 'Onboarded' : 'Setup pending'}
                        </span>
                    </p>
                </div>
                <div className="detail-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
                        <Pencil /><span>Edit</span>
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => onImpersonate(tenant)}>
                        <ExternalLink /><span>Page</span>
                    </button>
                </div>
            </div>

            <section className="stats stats--admin">
                <Card icon={<Building2 />}    variant="violet" label="Accounts"       value={tenant.accounts} />
                <Card icon={<UserSquare2 />}  variant="pink"   label="Personas"       value={tenant.personas} />
                <Card icon={<ImageIcon />}    variant="blue"   label="Images created" value={tenant.images} />
                <Card icon={<Video />}        variant="green"  label="Videos created" value={tenant.videos} />
                <Card icon={<CheckCircle2 />} variant="violet" label="QC pass rate"
                      value={passRate === null ? '—' : `${passRate}%`} sub={qcTotal ? `${tenant.qcPass}/${qcTotal}` : null} />
                <Card icon={<DollarSign />}   variant="pink"   label="Est. cost"      value={formatCost(tenant.cost)} />
            </section>

            <section className="panel">
                <div className="panel-head">
                    <div>
                        <h2><KeyRound size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />API keys</h2>
                        <p className="panel-sub">Keys this tenant configured. Use Edit to change them.</p>
                    </div>
                </div>
                <div className="detail-grid">
                    <KeyField label="Fal API key" value={tenant.fal_api_key} />
                    <KeyField label="Anthropic Claude API key" value={tenant.anthropic_api_key} />
                </div>
            </section>

            <section className="panel">
                <div className="panel-head">
                    <div>
                        <h2>Briefings</h2>
                        <p className="panel-sub">Product and company context for this tenant.</p>
                    </div>
                </div>
                <div className="detail-grid">
                    <BriefField label="Product briefing" value={tenant.product_briefing} />
                    <BriefField label="Company briefing" value={tenant.company_briefing} />
                </div>
            </section>

            <section className="panel">
                <div className="panel-head">
                    <div>
                        <h2>Accounts</h2>
                        <p className="panel-sub">
                            {tenant.accountList.length === 0
                                ? 'No accounts yet.'
                                : `${tenant.accountList.length} account${tenant.accountList.length === 1 ? '' : 's'}`}
                        </p>
                    </div>
                </div>
                {tenant.accountList.length > 0 && (
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>TikTok ID</th>
                                    <th>Name</th>
                                    <th>Personas</th>
                                    <th>Images</th>
                                    <th>Videos</th>
                                    <th>Last active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tenant.accountList.map(a => (
                                    <tr key={a.id}>
                                        <td className="td-handle">@{a.tiktok_id}</td>
                                        <td className="td-name">{a.name}</td>
                                        <td>{a.personas}</td>
                                        <td>{a.images}</td>
                                        <td>{a.videos}</td>
                                        <td>{a.last ? formatDate(a.last) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="panel panel--control">
                <div className="panel-head">
                    <div>
                        <h2>Account control</h2>
                        <p className="panel-sub">
                            Current status: <span className={`tag ${statusTag.cls}`}>{statusTag.label}</span>
                        </p>
                    </div>
                </div>
                <div className="control-body">
                    {status === 'active' && (
                        <div className="control-row">
                            <div>
                                <p className="control-title">Suspend access</p>
                                <p className="control-note">Temporarily block sign-in. Reversible; no data is deleted.</p>
                            </div>
                            <button type="button" className="btn btn-ghost" onClick={() => setAction('suspend')}>
                                <Ban /><span>Suspend</span>
                            </button>
                        </div>
                    )}
                    {status === 'suspended' && (
                        <div className="control-row">
                            <div>
                                <p className="control-title">Reactivate access</p>
                                <p className="control-note">Restore normal sign-in for this tenant.</p>
                            </div>
                            <button type="button" className="btn btn-primary" onClick={() => applyStatus('active', 'reactivate')}>
                                <Play /><span>Reactivate</span>
                            </button>
                        </div>
                    )}
                    {status === 'removed' && (
                        <div className="control-row">
                            <div>
                                <p className="control-title">Restore tenant</p>
                                <p className="control-note">Bring this removed tenant back. Their retained data becomes accessible again.</p>
                            </div>
                            <button type="button" className="btn btn-primary" onClick={() => applyStatus('active', 'reactivate')}>
                                <Play /><span>Reactivate</span>
                            </button>
                        </div>
                    )}
                    {status !== 'removed' && (
                        <div className="control-row control-row--danger">
                            <div>
                                <p className="control-title">Remove from platform</p>
                                <p className="control-note">Block sign-in and hide from the tenants list. Data retained for audit; reversible.</p>
                            </div>
                            <button type="button" className="btn btn-danger" onClick={() => setAction('remove')}>
                                <Trash2 /><span>Remove</span>
                            </button>
                        </div>
                    )}
                </div>
            </section>

            <TenantConfigModal
                open={editing}
                tenant={tenant}
                onClose={() => setEditing(false)}
                onSaved={onSaved}
            />

            <TenantActionModal
                open={Boolean(action)}
                mode={action}
                tenant={tenant}
                onClose={() => setAction(null)}
                onConfirm={() =>
                    action === 'suspend'
                        ? applyStatus('suspended', 'suspend')
                        : applyStatus('removed', 'remove')
                }
            />
        </section>
    );
}

function Card({ icon, variant, label, value, sub }) {
    return (
        <article className="stat-card">
            <div className={`stat-icon stat-icon--${variant}`}>{icon}</div>
            <div>
                <p className="stat-label">{label}</p>
                <p className="stat-value">{value}</p>
                {sub && <p className="stat-sub">{sub}</p>}
            </div>
        </article>
    );
}

function KeyField({ label, value }) {
    const [show, setShow] = useState(false);
    const has = Boolean(value);
    return (
        <div className="detail-field">
            <p className="field-label">{label}</p>
            <div className="key-row">
                <code className="key-value">
                    {!has ? '— not set —' : show ? value : '•'.repeat(Math.min(24, String(value).length))}
                </code>
                {has && (
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setShow(s => !s)}
                        aria-label={show ? 'Hide key' : 'Show key'}
                        title={show ? 'Hide key' : 'Show key'}
                    >
                        {show ? <EyeOff /> : <Eye />}
                    </button>
                )}
            </div>
        </div>
    );
}

function BriefField({ label, value }) {
    return (
        <div className="detail-field">
            <p className="field-label">{label}</p>
            <p className="brief-value">{value?.trim() ? value : '— not set —'}</p>
        </div>
    );
}
