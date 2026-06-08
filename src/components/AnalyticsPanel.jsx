import { useMemo } from 'react';
import {
    Activity, Calendar, CheckCircle2, Film, Globe, Image as ImageIcon,
    Languages, RefreshCw, Sparkles, Trophy, UserCircle, Users, XCircle, Zap,
} from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics.js';
import { formatDate, genderClass, genderLabel } from '../lib/utils.js';

const WEEK_MS  = 7  * 86_400_000;
const MONTH_MS = 30 * 86_400_000;

// ---------- helpers ----------

function countBy(items, keyFn) {
    const m = new Map();
    for (const it of items) {
        const k = keyFn(it);
        if (k == null || k === '') continue;
        m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
}

function topEntries(map, n) {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

function withinMs(items, ms) {
    const cutoff = Date.now() - ms;
    return items.filter(it => it.created_at && new Date(it.created_at).getTime() >= cutoff).length;
}

function pct(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 100);
}

function ageBucket(age) {
    if (age == null) return null;
    if (age < 18)  return '<18';
    if (age <= 24) return '18–24';
    if (age <= 34) return '25–34';
    if (age <= 44) return '35–44';
    return '45+';
}

const AGE_ORDER = ['<18', '18–24', '25–34', '35–44', '45+'];

// First token of a qc_reason string so "defect | score | resemblance | attempts"
// buckets cleanly even when the suffix varies.
function reasonKey(r) {
    if (!r) return 'unknown';
    return String(r).split(/[|,;]/)[0].trim().toLowerCase() || 'unknown';
}

// ---------- main panel ----------

export function AnalyticsPanel({ tenantId = null }) {
    const { data, status, error, reload } = useAnalytics(tenantId);
    const { accounts, personas, outputs, videos } = data;

    const m = useMemo(() => computeMetrics(accounts, personas, outputs, videos), [accounts, personas, outputs, videos]);

    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2>Analytics</h2>
                    <p className="panel-sub">
                        {status === 'loading'
                            ? 'Loading…'
                            : `${m.totalAccounts} accounts · ${m.totalPersonas} personas · ${m.totalImages} scene images · ${m.totalVideos} videos`}
                    </p>
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
                    <p>Crunching the pipeline…</p>
                </div>
            )}

            {status === 'error' && (
                <div className="state state-error">
                    <XCircle />
                    <h3>Couldn't load analytics</h3>
                    <p>{error?.message || 'Please try again.'}</p>
                    <button type="button" className="btn btn-ghost" onClick={reload}>Try again</button>
                </div>
            )}

            {status === 'ready' && (
                <div className="analytics-body">
                    <KpiHero m={m} />

                    <div className="analytics-grid analytics-grid-2">
                        <FunnelCard m={m} />
                        <QualityCard m={m} />
                    </div>

                    <div className="analytics-grid analytics-grid-4">
                        <DistributionCard
                            icon={<UserCircle />} variant="pink"
                            title="Gender"
                            entries={m.genderDist}
                            total={m.totalAccounts}
                            formatLabel={genderLabel}
                            labelClass={genderClass}
                        />
                        <DistributionCard
                            icon={<Calendar />} variant="violet"
                            title="Age groups"
                            entries={m.ageDist}
                            total={m.totalAccounts}
                        />
                        <DistributionCard
                            icon={<Globe />} variant="blue"
                            title="Top countries"
                            entries={m.topCountries}
                            total={m.totalAccounts}
                            showAllRest={m.totalAccounts > m.topCountries.reduce((s, [, v]) => s + v, 0)}
                        />
                        <DistributionCard
                            icon={<Languages />} variant="green"
                            title="Top languages"
                            entries={m.topLanguages}
                            total={m.totalAccounts}
                            showAllRest={m.totalAccounts > m.topLanguages.reduce((s, [, v]) => s + v, 0)}
                        />
                    </div>

                    <div className="analytics-grid analytics-grid-2">
                        <LeaderboardCard
                            icon={<Trophy />}
                            title="Top accounts by videos"
                            empty="No videos published yet."
                            entries={m.topAccounts.map(x => ({
                                key:   x.account.id,
                                left:  <><span className="lb-handle">@{x.account.tiktok_id}</span><span className="lb-name">{x.account.name}</span></>,
                                right: <span className="lb-count">{x.count}</span>,
                            }))}
                        />
                        <LeaderboardCard
                            icon={<Sparkles />}
                            title="Top scenarios (passed)"
                            empty="No passed scene images yet."
                            entries={m.topScenarios.map(([id, count]) => ({
                                key:   id,
                                left:  <span className="lb-scenario">{id}</span>,
                                right: <span className="lb-count">{count}</span>,
                            }))}
                        />
                    </div>

                    <div className="analytics-grid analytics-grid-2">
                        <RecentCard
                            icon={<Film />}
                            title="Recently published videos"
                            empty="No videos yet."
                            rows={m.recentVideos}
                            renderRow={(v) => {
                                const a = m.videoAccount.get(v.id);
                                return (
                                    <>
                                        <div className="recent-main">
                                            <p className="recent-title">{v.scenario_id || '—'}</p>
                                            <p className="recent-sub">{a ? `@${a.tiktok_id} · ${a.name}` : 'unknown account'}</p>
                                        </div>
                                        <span className="recent-when">{formatDate(v.created_at)}</span>
                                    </>
                                );
                            }}
                        />
                        <RecentCard
                            icon={<Users />}
                            title="Recently onboarded accounts"
                            empty="No accounts yet."
                            rows={m.recentAccounts}
                            renderRow={(a) => (
                                <>
                                    <div className="recent-main">
                                        <p className="recent-title">@{a.tiktok_id}</p>
                                        <p className="recent-sub">{a.name} · {a.country}</p>
                                    </div>
                                    <span className="recent-when">{formatDate(a.created_at)}</span>
                                </>
                            )}
                        />
                    </div>
                </div>
            )}
        </section>
    );
}

// ---------- metrics ----------

function computeMetrics(accounts, personas, outputs, videos) {
    const totalAccounts = accounts.length;
    const totalPersonas = personas.length;
    const totalImages   = outputs.length;
    const totalVideos   = videos.length;

    const passedOutputs  = outputs.filter(o => o.qc_status === 'pass');
    const skippedOutputs = outputs.filter(o => o.qc_status === 'skipped');
    const totalPassed    = passedOutputs.length;
    const totalSkipped   = skippedOutputs.length;

    const passRate     = pct(totalPassed, totalImages);
    const skipRate     = pct(totalSkipped, totalImages);
    const totalAttempts= outputs.reduce((s, o) => s + (Number(o.attempts) || 0), 0);
    const avgAttempts  = totalImages ? (totalAttempts / totalImages) : 0;
    const videoCoverage= pct(totalVideos, totalPassed);
    const personaCov   = pct(totalPersonas, totalAccounts);

    // Backlogs
    const accountsWithPersonaIds = new Set(personas.map(p => p.tiktok_account_id));
    const accountsWithoutPersona = totalAccounts - accountsWithPersonaIds.size;
    const outputsWithVideoIds    = new Set(videos.map(v => v.output_id));
    const passedAwaitingVideo    = passedOutputs.filter(o => !outputsWithVideoIds.has(o.id)).length;

    // Weekly deltas
    const accountsThisWeek = withinMs(accounts, WEEK_MS);
    const personasThisWeek = withinMs(personas, WEEK_MS);
    const imagesThisWeek   = withinMs(outputs,  WEEK_MS);
    const videosThisWeek   = withinMs(videos,   WEEK_MS);
    const videosThisMonth  = withinMs(videos,   MONTH_MS);

    // Demographics
    const genderDist = topEntries(countBy(accounts, a => (a.gender || '').toLowerCase()), 6);
    const ageDistMap = countBy(accounts, a => ageBucket(a.age));
    const ageDist    = AGE_ORDER
        .filter(k => ageDistMap.has(k))
        .map(k => [k, ageDistMap.get(k)]);
    const topCountries  = topEntries(countBy(accounts, a => a.country),  5);
    const topLanguages  = topEntries(countBy(accounts, a => a.language), 5);

    // Skip reasons
    const skipReasons = topEntries(countBy(skippedOutputs, o => reasonKey(o.qc_reason)), 4);

    // Top scenarios (by passed output count)
    const topScenarios = topEntries(countBy(passedOutputs, o => o.scenario_id), 8);

    // Top accounts by video count — climb videos → outputs → personas → accounts
    const accountsById = new Map(accounts.map(a => [a.id, a]));
    const personaToAccount = new Map(personas.map(p => [p.id, p.tiktok_account_id]));
    const outputToPersona  = new Map(outputs.map(o  => [o.id, o.persona_id]));
    const videoToAccountId = (v) => personaToAccount.get(outputToPersona.get(v.output_id));

    const videosPerAccount = new Map();
    const videoAccount = new Map(); // videoId -> account (for recent list)
    for (const v of videos) {
        const aid = videoToAccountId(v);
        if (aid == null) continue;
        videosPerAccount.set(aid, (videosPerAccount.get(aid) || 0) + 1);
        const account = accountsById.get(aid);
        if (account) videoAccount.set(v.id, account);
    }
    const topAccounts = [...videosPerAccount.entries()]
        .map(([id, count]) => ({ account: accountsById.get(id), count }))
        .filter(x => x.account)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    // Recent activity (latest first)
    const recentVideos   = [...videos]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 6);
    const recentAccounts = [...accounts]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 6);

    return {
        totalAccounts, totalPersonas, totalImages, totalVideos,
        totalPassed, totalSkipped,
        passRate, skipRate, avgAttempts, videoCoverage, personaCov,
        accountsWithoutPersona, passedAwaitingVideo,
        accountsThisWeek, personasThisWeek, imagesThisWeek, videosThisWeek, videosThisMonth,
        genderDist, ageDist, topCountries, topLanguages,
        skipReasons,
        topScenarios, topAccounts,
        recentVideos, recentAccounts, videoAccount,
    };
}

// ---------- UI building blocks ----------

function KpiHero({ m }) {
    return (
        <div className="kpi-hero">
            <KpiCard variant="pink"   icon={<Users />}       label="TikTok accounts" value={m.totalAccounts} delta={m.accountsThisWeek} />
            <KpiCard variant="violet" icon={<UserCircle />}  label="Personas"        value={m.totalPersonas} delta={m.personasThisWeek} sub={`${m.personaCov}% coverage`} />
            <KpiCard variant="blue"   icon={<ImageIcon />}   label="Scene images"    value={m.totalImages}   delta={m.imagesThisWeek} />
            <KpiCard variant="green"  icon={<Film />}        label="Videos"          value={m.totalVideos}   delta={m.videosThisWeek} sub={`${m.videosThisMonth} this month`} />
        </div>
    );
}

function KpiCard({ variant, icon, label, value, delta, sub }) {
    return (
        <article className="stat-card kpi-card">
            <div className={`stat-icon stat-icon--${variant}`}>{icon}</div>
            <div className="kpi-meta">
                <p className="stat-label">{label}</p>
                <p className="stat-value">{value}</p>
                <p className="kpi-delta">
                    <Zap />
                    <span>+{delta} this week</span>
                    {sub && <span className="kpi-sub">· {sub}</span>}
                </p>
            </div>
        </article>
    );
}

function FunnelCard({ m }) {
    const steps = [
        { label: 'Accounts',        count: m.totalAccounts, variant: 'pink',   note: m.accountsWithoutPersona > 0 ? `${m.accountsWithoutPersona} awaiting persona` : 'all have personas' },
        { label: 'Personas',        count: m.totalPersonas, variant: 'violet', note: `${m.personaCov}% of accounts` },
        { label: 'Scene images',    count: m.totalImages,   variant: 'blue',   note: `${m.totalPassed} passed · ${m.totalSkipped} skipped` },
        { label: 'Videos',          count: m.totalVideos,   variant: 'green',  note: m.passedAwaitingVideo > 0 ? `${m.passedAwaitingVideo} passed images awaiting video` : 'all passed images have a video' },
    ];
    const max = Math.max(1, ...steps.map(s => s.count));

    return (
        <article className="ana-card">
            <header className="ana-card-head">
                <Activity />
                <div>
                    <h3>Pipeline funnel</h3>
                    <p>From input to finished video</p>
                </div>
            </header>
            <div className="funnel">
                {steps.map(s => (
                    <div key={s.label} className="funnel-step">
                        <div className="funnel-meta">
                            <span className="funnel-label">{s.label}</span>
                            <span className="funnel-count">{s.count}</span>
                        </div>
                        <div className="funnel-bar-wrap">
                            <div
                                className={`funnel-bar funnel-bar--${s.variant}`}
                                style={{ width: `${(s.count / max) * 100}%` }}
                            />
                        </div>
                        <p className="funnel-note">{s.note}</p>
                    </div>
                ))}
            </div>
        </article>
    );
}

function QualityCard({ m }) {
    return (
        <article className="ana-card">
            <header className="ana-card-head">
                <CheckCircle2 />
                <div>
                    <h3>QC quality</h3>
                    <p>Scene-image QC retry loop outcomes</p>
                </div>
            </header>

            <div className="quality-row">
                <div className="quality-stat">
                    <p className="quality-label">Pass rate</p>
                    <p className="quality-value">{m.passRate}%</p>
                </div>
                <div className="quality-stat">
                    <p className="quality-label">Avg attempts</p>
                    <p className="quality-value">{m.avgAttempts.toFixed(2)}</p>
                </div>
                <div className="quality-stat">
                    <p className="quality-label">Skipped</p>
                    <p className="quality-value">{m.totalSkipped}</p>
                </div>
                <div className="quality-stat">
                    <p className="quality-label">Video conversion</p>
                    <p className="quality-value">{m.videoCoverage}%</p>
                </div>
            </div>

            <div className="quality-reasons">
                <p className="ana-subhead">Top skip reasons</p>
                {m.skipReasons.length === 0
                    ? <p className="ana-empty">No skipped images yet — every QC retry has eventually passed.</p>
                    : (
                        <ul className="dist-list">
                            {m.skipReasons.map(([reason, count]) => {
                                const w = pct(count, m.totalSkipped);
                                return (
                                    <li key={reason} className="dist-row">
                                        <div className="dist-row-head">
                                            <span className="dist-label">{reason}</span>
                                            <span className="dist-count">{count} · {w}%</span>
                                        </div>
                                        <div className="dist-bar-wrap">
                                            <div className="dist-bar dist-bar--danger" style={{ width: `${w}%` }} />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
            </div>
        </article>
    );
}

function DistributionCard({ icon, variant, title, entries, total, formatLabel, labelClass, showAllRest }) {
    return (
        <article className="ana-card">
            <header className="ana-card-head">
                <span className={`ana-card-icon ana-card-icon--${variant}`}>{icon}</span>
                <div>
                    <h3>{title}</h3>
                    <p>{total} total</p>
                </div>
            </header>
            {entries.length === 0
                ? <p className="ana-empty">No data yet.</p>
                : (
                    <ul className="dist-list">
                        {entries.map(([key, count]) => {
                            const w = pct(count, total);
                            const display = formatLabel ? formatLabel(key) : key;
                            const cls = labelClass ? labelClass(key) : '';
                            return (
                                <li key={key} className="dist-row">
                                    <div className="dist-row-head">
                                        <span className={`dist-label ${cls}`}>{display}</span>
                                        <span className="dist-count">{count} · {w}%</span>
                                    </div>
                                    <div className="dist-bar-wrap">
                                        <div className={`dist-bar dist-bar--${variant}`} style={{ width: `${w}%` }} />
                                    </div>
                                </li>
                            );
                        })}
                        {showAllRest && (
                            <li className="dist-rest">+ {total - entries.reduce((s, [, v]) => s + v, 0)} more</li>
                        )}
                    </ul>
                )}
        </article>
    );
}

function LeaderboardCard({ icon, title, entries, empty }) {
    return (
        <article className="ana-card">
            <header className="ana-card-head">
                {icon}
                <div>
                    <h3>{title}</h3>
                    <p>{entries.length === 0 ? 'No data yet' : `Top ${entries.length}`}</p>
                </div>
            </header>
            {entries.length === 0
                ? <p className="ana-empty">{empty}</p>
                : (
                    <ol className="lb-list">
                        {entries.map((e, i) => (
                            <li key={e.key} className="lb-row">
                                <span className="lb-rank">{i + 1}</span>
                                <div className="lb-main">{e.left}</div>
                                {e.right}
                            </li>
                        ))}
                    </ol>
                )}
        </article>
    );
}

function RecentCard({ icon, title, rows, renderRow, empty }) {
    return (
        <article className="ana-card">
            <header className="ana-card-head">
                {icon}
                <div>
                    <h3>{title}</h3>
                    <p>Last {Math.min(rows.length, 6) || 0}</p>
                </div>
            </header>
            {rows.length === 0
                ? <p className="ana-empty">{empty}</p>
                : (
                    <ul className="recent-list">
                        {rows.map(r => <li key={r.id} className="recent-row">{renderRow(r)}</li>)}
                    </ul>
                )}
        </article>
    );
}
