import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { formatCost } from '../lib/cost.js';
import { formatDate } from '../lib/utils.js';

// All tenants, with their headline counts. Row click opens the detail page.
export function TenantsList({ tenants, status, error, onSelect }) {
    const [q, setQ] = useState('');
    const [showRemoved, setShowRemoved] = useState(false);

    const removedCount = useMemo(
        () => tenants.filter(t => (t.status || 'active') === 'removed').length,
        [tenants],
    );

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return tenants.filter(t => {
            if (!showRemoved && (t.status || 'active') === 'removed') return false;
            if (!needle) return true;
            return (t.name || '').toLowerCase().includes(needle) ||
                (t.email || '').toLowerCase().includes(needle);
        });
    }, [tenants, q, showRemoved]);

    if (status === 'loading') {
        return (
            <div className="state state-loading">
                <div className="spinner" />
                <p>Loading tenants…</p>
            </div>
        );
    }
    if (status === 'error') {
        return (
            <div className="state state-error">
                <p>Couldn’t load tenants.</p>
                <p className="state-sub">{error?.message || 'Unknown error.'}</p>
            </div>
        );
    }

    return (
        <section className="panel">
            <div className="panel-head">
                <div>
                    <h2>Tenants</h2>
                    <p className="panel-sub">
                        {tenants.length === 0
                            ? 'No tenants yet.'
                            : q.trim()
                                ? `${filtered.length} of ${tenants.length} shown`
                                : `${tenants.length} tenant${tenants.length === 1 ? '' : 's'} total`}
                    </p>
                </div>
                <div className="filters">
                    {removedCount > 0 && (
                        <label className="toggle-inline">
                            <input
                                type="checkbox"
                                checked={showRemoved}
                                onChange={e => setShowRemoved(e.target.checked)}
                            />
                            <span>Show removed ({removedCount})</span>
                        </label>
                    )}
                    <div className="search">
                        <Search />
                        <input
                            type="search"
                            placeholder="Search name or email…"
                            aria-label="Search tenants"
                            value={q}
                            onChange={e => setQ(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {filtered.length === 0 ? (
                <div className="state state-empty"><p>No tenants match your search.</p></div>
            ) : (
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Tenant</th>
                                <th>Email</th>
                                <th>Status</th>
                                <th>Accounts</th>
                                <th>Images</th>
                                <th>Videos</th>
                                <th>Est. cost</th>
                                <th>Last active</th>
                                <th aria-label="Open" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(t => (
                                <tr
                                    key={t.tenant_id}
                                    className={`row-clickable${(t.status || 'active') === 'removed' ? ' row-removed' : ''}`}
                                    onClick={() => onSelect(t)}
                                >
                                    <td className="td-name">{t.name || '—'}</td>
                                    <td>{t.email || '—'}</td>
                                    <td>
                                        {(t.status || 'active') !== 'active' && (
                                            <span className={`tag ${t.status === 'removed' ? 'tag-danger' : 'tag-warn'}`}>
                                                {t.status === 'removed' ? 'Removed' : 'Suspended'}
                                            </span>
                                        )}{' '}
                                        <span className={`tag ${t.onboarded ? 'tag-on' : 'tag-off'}`}>
                                            {t.onboarded ? 'Onboarded' : 'Setup pending'}
                                        </span>
                                    </td>
                                    <td>{t.accounts}</td>
                                    <td>{t.images}</td>
                                    <td>{t.videos}</td>
                                    <td>{formatCost(t.cost)}</td>
                                    <td>{t.lastActivity ? formatDate(t.lastActivity) : '—'}</td>
                                    <td className="td-actions"><ChevronRight /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
