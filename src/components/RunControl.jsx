import { AlertTriangle, CheckCircle2, Play, X } from 'lucide-react';

// Visual states:
//   idle      → green RUN button
//   active    → live progress pill ("2 personas · 5 images · 3 videos")
//   completed → green "Pipeline complete · N videos" pill
//   stalled   → amber warning + Re-run button
export function RunControl({ running, onRun, runStartedAt, counts, completed, stalled, onClear, canRun = true, disabledReason }) {
    const hasRun = !!runStartedAt;
    const blocked = !canRun;

    if (hasRun && completed) {
        const v = counts.videos;
        return (
            <div className="run-cluster">
                <div className="run-pill run-pill--done" title="The n8n pipeline finished">
                    <CheckCircle2 />
                    <span>Pipeline complete{v ? ` · ${v} video${v === 1 ? '' : 's'}` : ''}</span>
                    <button type="button" className="run-pill-clear" onClick={onClear} aria-label="Dismiss">
                        <X />
                    </button>
                </div>
                <button
                    type="button"
                    className="btn btn-run"
                    onClick={onRun}
                    disabled={running || blocked}
                    title={blocked ? (disabledReason || 'Complete run settings first') : 'Run the pipeline again'}
                >
                    {running ? <span className="btn-spinner" aria-hidden="true" /> : <Play fill="currentColor" />}
                    <span>{running ? 'Starting…' : 'Run again'}</span>
                </button>
            </div>
        );
    }

    if (hasRun && stalled) {
        return (
            <div className="run-cluster">
                <div className="run-pill run-pill--stalled" title="No new rows in the last 45 minutes — the run probably failed">
                    <AlertTriangle />
                    <span>Run stalled</span>
                    <button type="button" className="run-pill-clear" onClick={onClear} aria-label="Clear stalled run">
                        <X />
                    </button>
                </div>
                <button
                    type="button"
                    className="btn btn-run"
                    onClick={onRun}
                    disabled={running || blocked}
                    title={blocked ? (disabledReason || 'Complete run settings first') : 'Trigger the n8n pipeline again'}
                >
                    {running
                        ? <span className="btn-spinner" aria-hidden="true" />
                        : <Play fill="currentColor" />}
                    <span>{running ? 'Starting…' : 'Re-run'}</span>
                </button>
            </div>
        );
    }

    if (hasRun) {
        const parts = [];
        if (counts.personas) parts.push(`${counts.personas} persona${counts.personas === 1 ? '' : 's'}`);
        if (counts.outputs)  parts.push(`${counts.outputs} image${counts.outputs === 1 ? '' : 's'}`);
        if (counts.videos)   parts.push(`${counts.videos} video${counts.videos === 1 ? '' : 's'}`);
        const summary = parts.length ? parts.join(' · ') : 'pipeline running…';

        return (
            <div className="run-pill run-pill--active" title={`Started at ${new Date(runStartedAt).toLocaleTimeString()}`}>
                <span className="run-pill-dot" />
                <span>{summary}</span>
                <button type="button" className="run-pill-clear" onClick={onClear} aria-label="Hide run status">
                    <X />
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            className="btn btn-run"
            onClick={onRun}
            disabled={running || blocked}
            title={blocked ? (disabledReason || 'Complete run settings first') : 'Trigger the n8n pipeline now'}
        >
            {running
                ? <span className="btn-spinner" aria-hidden="true" />
                : <Play fill="currentColor" />}
            <span>{running ? 'Starting…' : 'Run'}</span>
        </button>
    );
}
