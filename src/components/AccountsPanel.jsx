import { useMemo } from 'react';
import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { formatDate, genderClass, genderLabel } from '../lib/utils.js';
import { GENDER_OPTIONS } from '../lib/constants.js';

export function AccountsPanel({
    accounts,
    status, error,
    search,
    genderFilter, onGenderFilter,
    countryFilter, onCountryFilter,
    onReload,
    onOnboard,
    onEdit, onDelete,
}) {
    const countryOptions = useMemo(() => {
        return Array.from(new Set(accounts.map(a => a.country).filter(Boolean))).sort();
    }, [accounts]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return accounts.filter(a => {
            if (genderFilter && a.gender !== genderFilter) return false;
            if (countryFilter && a.country !== countryFilter) return false;
            if (!q) return true;
            return (
                (a.tiktok_id || '').toLowerCase().includes(q) ||
                (a.name || '').toLowerCase().includes(q) ||
                (a.country || '').toLowerCase().includes(q) ||
                (a.language || '').toLowerCase().includes(q)
            );
        });
    }, [accounts, search, genderFilter, countryFilter]);

    const total = accounts.length;
    const showingAll = filtered.length === total;

    let panelSub;
    if (status === 'loading')      panelSub = 'Loading…';
    else if (total === 0)          panelSub = 'No accounts onboarded yet.';
    else if (showingAll)           panelSub = `${total} ${total === 1 ? 'account' : 'accounts'} total`;
    else                           panelSub = `${filtered.length} of ${total} shown`;

    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2>All accounts</h2>
                    <p className="panel-sub">{panelSub}</p>
                </div>
                <div className="filters">
                    <select
                        className="select-sm"
                        value={genderFilter}
                        onChange={e => onGenderFilter(e.target.value)}
                        aria-label="Filter by gender"
                    >
                        <option value="">All genders</option>
                        {GENDER_OPTIONS.map(g => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                    </select>
                    <select
                        className="select-sm"
                        value={countryFilter}
                        onChange={e => onCountryFilter(e.target.value)}
                        aria-label="Filter by country"
                    >
                        <option value="">All countries</option>
                        {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>
                        <RefreshCw />
                        <span>Refresh</span>
                    </button>
                </div>
            </header>

            {status === 'loading' && (
                <div className="state state-loading">
                    <div className="spinner" />
                    <p>Loading accounts…</p>
                </div>
            )}

            {status === 'error' && (
                <ErrorState error={error} onRetry={onReload} />
            )}

            {status === 'ready' && total === 0 && (
                <EmptyState onOnboard={onOnboard} />
            )}

            {status === 'ready' && total > 0 && (
                <>
                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>TikTok ID</th>
                                    <th>Name</th>
                                    <th>Gender</th>
                                    <th>Age</th>
                                    <th>Country</th>
                                    <th>Language</th>
                                    <th>Added</th>
                                    <th className="th-actions">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0
                                    ? (
                                        <tr className="no-results-row">
                                            <td colSpan="8">No accounts match the current filters.</td>
                                        </tr>
                                    )
                                    : filtered.map(a => (
                                        <tr key={a.id}>
                                            <td className="td-handle">@{a.tiktok_id}</td>
                                            <td className="td-name">{a.name}</td>
                                            <td><span className={`tag ${genderClass(a.gender)}`}>{genderLabel(a.gender)}</span></td>
                                            <td>{a.age}</td>
                                            <td><span className="tag"><span className="tag-dot" />{a.country}</span></td>
                                            <td>{a.language}</td>
                                            <td><span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{formatDate(a.created_at)}</span></td>
                                            <td className="td-actions">
                                                <button
                                                    type="button"
                                                    className="icon-btn"
                                                    onClick={() => onEdit(a)}
                                                    aria-label={`Edit ${a.tiktok_id}`}
                                                    title="Edit"
                                                >
                                                    <Pencil />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-btn icon-btn--danger"
                                                    style={{ color: 'var(--danger)' }}
                                                    onClick={() => onDelete(a)}
                                                    aria-label={`Delete ${a.tiktok_id}`}
                                                    title="Delete"
                                                >
                                                    <Trash2 />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="card-list">
                        {filtered.length === 0
                            ? <div className="no-results">No accounts match the current filters.</div>
                            : filtered.map(a => (
                                <article key={a.id} className="account-card">
                                    <header className="account-card-head">
                                        <div>
                                            <p className="account-card-id">@{a.tiktok_id}</p>
                                            <h3 className="account-card-name">{a.name}</h3>
                                        </div>
                                        <span className={`tag ${genderClass(a.gender)}`}>{genderLabel(a.gender)}</span>
                                    </header>
                                    <div className="account-card-meta">
                                        <span className="tag"><span className="tag-dot" />{a.country}</span>
                                        <span className="tag">{a.language}</span>
                                        <span className="tag">Age {a.age}</span>
                                    </div>
                                    <footer className="account-card-foot">
                                        <span>Added {formatDate(a.created_at)}</span>
                                        <div className="account-card-actions">
                                            <button
                                                type="button"
                                                className="icon-btn"
                                                onClick={() => onEdit(a)}
                                                aria-label={`Edit ${a.tiktok_id}`}
                                            >
                                                <Pencil />
                                            </button>
                                            <button
                                                type="button"
                                                className="icon-btn"
                                                style={{ color: 'var(--danger)' }}
                                                onClick={() => onDelete(a)}
                                                aria-label={`Delete ${a.tiktok_id}`}
                                            >
                                                <Trash2 />
                                            </button>
                                        </div>
                                    </footer>
                                </article>
                            ))}
                    </div>
                </>
            )}
        </section>
    );
}

function EmptyState({ onOnboard }) {
    return (
        <div className="state state-empty">
            <Search strokeWidth={1.5} />
            <h3>No accounts yet</h3>
            <p>Onboard the first TikTok account to get started.</p>
            <button type="button" className="btn btn-primary" onClick={onOnboard}>
                <Plus />
                <span>Onboard account</span>
            </button>
        </div>
    );
}

function ErrorState({ error, onRetry }) {
    return (
        <div className="state state-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3>Couldn't load accounts</h3>
            <p>
                {error?.missingTable
                    ? <>The <code>tiktok_accounts</code> table is missing. Run <code>tiktok_accounts_migration.sql</code> in the Supabase SQL editor first.</>
                    : (error?.raw?.message || 'Check that the API key is valid and try again.')}
            </p>
            <button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>
        </div>
    );
}
