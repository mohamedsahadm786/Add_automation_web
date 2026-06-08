import { Building2, DollarSign, Image as ImageIcon, Users, Video } from 'lucide-react';
import { formatCost } from '../lib/cost.js';
import { formatDate } from '../lib/utils.js';

// Platform-wide KPIs + quick breakdowns across every tenant.
export function SuperAdminOverview({ totals, tenants, status, error }) {
    if (status === 'loading') {
        return (
            <div className="state state-loading">
                <div className="spinner" />
                <p>Loading platform analytics…</p>
            </div>
        );
    }
    if (status === 'error') {
        return (
            <div className="state state-error">
                <p>Couldn’t load analytics.</p>
                <p className="state-sub">{error?.message || 'Unknown error.'}</p>
            </div>
        );
    }

    const active = tenants.filter(t => (t.status || 'active') !== 'removed');
    const topByVideos = [...active].sort((a, b) => b.videos - a.videos).slice(0, 5);
    const pending = active.filter(t => !t.onboarded);

    return (
        <>
            <section className="stats stats--admin">
                <Card icon={<Users />}      variant="pink"   label="Tenants"        value={totals.tenants}
                      sub={`${totals.onboarded} onboarded · ${totals.pending} pending`} />
                <Card icon={<Building2 />}  variant="violet" label="Accounts"       value={totals.accounts} />
                <Card icon={<ImageIcon />}  variant="blue"   label="Images created" value={totals.images} />
                <Card icon={<Video />}      variant="green"  label="Videos created" value={totals.videos} />
                <Card icon={<DollarSign />} variant="pink"   label="Est. total cost" value={formatCost(totals.cost)} />
            </section>

            <div className="overview-cols">
                <section className="panel">
                    <div className="panel-head">
                        <div>
                            <h2>Top tenants by videos</h2>
                            <p className="panel-sub">Who’s producing the most.</p>
                        </div>
                    </div>
                    <div className="mini-list">
                        {topByVideos.length === 0 && <p className="no-results">No tenants yet.</p>}
                        {topByVideos.map((t, i) => (
                            <div className="mini-row" key={t.tenant_id}>
                                <span className="mini-rank">{i + 1}</span>
                                <span className="mini-name">{t.name || t.email || '—'}</span>
                                <span className="mini-meta">{t.videos} videos · {formatCost(t.cost)}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="panel">
                    <div className="panel-head">
                        <div>
                            <h2>Setup pending</h2>
                            <p className="panel-sub">Tenants who haven’t finished onboarding.</p>
                        </div>
                    </div>
                    <div className="mini-list">
                        {pending.length === 0 && <p className="no-results">Everyone is onboarded. 🎉</p>}
                        {pending.map(t => (
                            <div className="mini-row" key={t.tenant_id}>
                                <span className="mini-name">{t.name || t.email || '—'}</span>
                                <span className="mini-meta">joined {formatDate(t.created_at)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </>
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
