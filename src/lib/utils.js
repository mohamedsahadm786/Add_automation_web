export function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const now = new Date();
    const diffMs = now - d;
    const day = 86400000;
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < day) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function genderClass(gender) {
    const g = String(gender || '').toLowerCase();
    return ['female', 'male', 'non-binary'].includes(g)
        ? `tag-gender-${g}`
        : 'tag-gender-other';
}

export function genderLabel(gender) {
    const g = String(gender || '').toLowerCase();
    if (!g) return 'Other';
    return g.charAt(0).toUpperCase() + g.slice(1);
}

export function isMissingTableError(error) {
    if (!error) return false;
    return (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /relation .* does not exist/i.test(error.message || '')
    );
}

export function friendlySupabaseError(error) {
    if (!error) return 'Unknown error.';
    const msg = error.message || String(error);
    if (/duplicate key|unique/i.test(msg)) {
        return 'A TikTok account with that ID already exists.';
    }
    return msg;
}
