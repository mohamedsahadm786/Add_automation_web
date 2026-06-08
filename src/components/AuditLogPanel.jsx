import { Ban, Eye, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useAuditLog } from '../hooks/useAuditLog.js';
import { formatDate } from '../lib/utils.js';

const ACTIONS = {
    view_page:  { label: 'Viewed page', icon: Eye },
    suspend:    { label: 'Suspended',   icon: Ban },
    reactivate: { label: 'Reactivated', icon: Play },
    remove:     { label: 'Removed',     icon: Trash2 },
};

// Read-only timeline of every super-admin action against a tenant.
export function AuditLogPanel() {
    const { events, status, error, reload } = useAuditLog();

    return (
        <section className="panel">
            <div className="panel-head">
                <div>
                    <h2>Admin activity</h2>
                    <p className="panel-sub">
                        {status === 'ready'
                            ? events.length === 0
                                ? 'No admin actions recorded yet.'
                                : `${events.length} most recent event${events.length === 1 ? '' : 's'}`
                            : 'Every super-admin action against a tenant is logged here.'}
                    </p>
                </div>
                <div className="filters">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
                        <RefreshCw /><span>Refresh</span>
                    </button>
                </div>
            </div>

            {status === 'loading' && (
                <div className="state state-loading"><div className="spinner" /><p>Loading activity…</p></div>
            )}
            {status === 'error' && (
                <div className="state state-error">
                    <p>Couldn’t load activity.</p>
                    <p className="state-sub">{error?.message || 'Unknown error.'}</p>
                </div>
            )}
            {status === 'ready' && events.length > 0 && (
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Action</th>
                                <th>Tenant</th>
                                <th>Email</th>
                                <th>Actor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map(ev => {
                                const a = ACTIONS[ev.action] || ACTIONS.view_page;
                                const Icon = a.icon;
                                return (
                                    <tr key={ev.id}>
                                        <td>{formatDate(ev.created_at)}</td>
                                        <td>
                                            <span className="tag"><Icon size={12} /> {a.label}</span>
                                        </td>
                                        <td className="td-name">{ev.tenant_name || '—'}</td>
                                        <td>{ev.tenant_email || '—'}</td>
                                        <td>{ev.actor}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
