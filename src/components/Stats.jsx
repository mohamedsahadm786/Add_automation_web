import { useMemo } from 'react';
import { Globe, Languages, Users, Zap } from 'lucide-react';

export function Stats({ accounts }) {
    const stats = useMemo(() => {
        const total = accounts.length;
        const countries = new Set(accounts.map(a => a.country).filter(Boolean));
        const languages = new Set(accounts.map(a => a.language).filter(Boolean));
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const week = accounts.filter(
            a => a.created_at && new Date(a.created_at).getTime() >= weekAgo,
        ).length;
        return { total, countries: countries.size, languages: languages.size, week };
    }, [accounts]);

    return (
        <section className="stats">
            <Card icon={<Users />} variant="pink"   label="Total accounts"  value={stats.total} />
            <Card icon={<Globe />} variant="violet" label="Countries"        value={stats.countries} />
            <Card icon={<Languages />} variant="blue"  label="Languages"     value={stats.languages} />
            <Card icon={<Zap />}   variant="green"  label="Added this week" value={stats.week} />
        </section>
    );
}

function Card({ icon, variant, label, value }) {
    return (
        <article className="stat-card">
            <div className={`stat-icon stat-icon--${variant}`}>{icon}</div>
            <div>
                <p className="stat-label">{label}</p>
                <p className="stat-value">{value}</p>
            </div>
        </article>
    );
}
