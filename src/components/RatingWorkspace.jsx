import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImageOff, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { RATING_CONFIG, SCALE_5, NOTE, TRIAGE_OPTIONS, emptyRating } from '../lib/ratingConfig.js';
import { useAssetRating } from '../hooks/useAssetRating.js';
import { useToast } from '../contexts/ToastContext.jsx';

// Order-independent serialization. Gate values are objects
// ({result, auto_value, disputed}); Postgres JSONB reorders their keys on load,
// so a plain JSON.stringify compare would flag an unchanged gate as "changed"
// once it's re-clicked. Sorting keys makes the comparison value-based.
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort()
        .map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') + '}';
}

function hydrate(empty, stored) {
    if (!stored) return empty;
    return {
        gates: { ...empty.gates, ...(stored.gates || {}) },
        scores: { ...empty.scores, ...(stored.scores || {}) },
        notes: { ...(stored.notes || {}) },
    };
}

// Full-screen QA rating workspace. Video + its rubric on the left, image + its
// rubric on the right. Renders entirely from RATING_CONFIG. Image is rated
// first; the video rubric unlocks once a triage decision is made.
export function RatingWorkspace({ row, account, rater, onClose, onMirrorImage }) {
    const toast = useToast();
    const { existing, status, save } = useAssetRating(row.id);
    const [draft, setDraft] = useState(emptyRating);
    const [baseline, setBaseline] = useState(null); // the last-saved/loaded state, to detect changes
    const [saving, setSaving] = useState(false);

    const hasVideo = Boolean(row.video && (row.video.id || row.video.drive_file_id || row.video.drive_url));

    // Hydrate from an existing rating once loaded.
    useEffect(() => {
        if (status !== 'ready') return;
        const base = emptyRating();
        const next = existing ? {
            triage: existing.asset_triage ?? null,
            image: hydrate(base.image, existing.image),
            video: hydrate(base.video, existing.video),
        } : base;
        setDraft(next);
        setBaseline(next); // snapshot the loaded state — Save stays disabled until it changes
    }, [status, existing]);

    // Dirty = the draft differs from what we loaded/last saved. Save is only
    // enabled after a real change (new rating, changed value, edited note…).
    const isDirty = useMemo(
        () => baseline != null && stableStringify(draft) !== stableStringify(baseline),
        [draft, baseline],
    );

    // Lock body scroll + Escape to close.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
    }, [onClose]);

    const setTriage = useCallback((v) => setDraft(d => ({ ...d, triage: v })), []);
    const setGate = useCallback((sec, item, result) => setDraft(d => ({
        ...d,
        [sec]: {
            ...d[sec],
            gates: {
                ...d[sec].gates,
                [item.id]: {
                    result,
                    auto_value: d[sec].gates[item.id]?.auto_value ?? null,
                    disputed: item.source === 'auto', // manual override of (absent) auto metric
                },
            },
        },
    })), []);
    const setScore = useCallback((sec, id, val) => setDraft(d => ({
        ...d, [sec]: { ...d[sec], scores: { ...d[sec].scores, [id]: val } },
    })), []);
    const setNote = useCallback((sec, id, text) => setDraft(d => ({
        ...d, [sec]: { ...d[sec], notes: { ...d[sec].notes, [id]: text } },
    })), []);

    const context = useMemo(() => ({
        output_id: row.id,
        video_id: row.video?.id ?? null,
        persona_id: row.persona_id ?? null,
        tiktok_account_id: account?.id ?? null,
        scenario_id: row.scenario_id ?? null,
        scenario_title: row.scenario_title ?? null,
        image_prompt: row.image_prompt ?? null,
        video_script: row.video?.prompt_used || row.video?.dialogue || null,
        image_storage_url: row.image_storage_url || null,
        video_storage_url: row.video?.storage_url || null,
        rater_id: rater || null,
    }), [row, account, rater]);

    const submit = useCallback(async () => {
        if (!draft.triage) { toast.info('Pick a decision (Accept / Reject / Flag) first.'); return; }
        if (!isDirty) return; // nothing changed since it was loaded/saved — no-op
        setSaving(true);
        try {
            await save(draft, context);
            toast.success('Rating saved.');
            onClose();
        } catch (err) {
            toast.error(err.message || 'Could not save rating.');
        } finally {
            setSaving(false);
        }
    }, [draft, context, isDirty, save, toast, onClose]);

    // Enter submits (unless typing in a note).
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [submit]);

    return createPortal(
        <div className="rating-overlay" role="dialog" aria-modal="true" aria-label="Rate generation">
            <header className="rating-head">
                <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
                <div className="rating-title">
                    <p className="rating-eyebrow">@{account?.tiktok_id} · {row.scenario_title || row.scenario_id || 'Scene'}</p>
                    <h2>Rate generation</h2>
                </div>
                <div className="rating-triage">
                    <span className="rating-triage-label">Decision</span>
                    <div className="triage-control">
                        {TRIAGE_OPTIONS.map(o => (
                            <button
                                key={o}
                                type="button"
                                className={`triage-btn triage-${o.toLowerCase()}${draft.triage === o ? ' is-on' : ''}`}
                                onClick={() => setTriage(o)}
                            >{o}</button>
                        ))}
                    </div>
                </div>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !draft.triage || !isDirty}>
                    {saving ? 'Saving…' : 'Save rating'}
                </button>
            </header>

            <div className="rating-main">
                {/* LEFT — video rubric beside the video */}
                <RubricPanel
                    title="Video rubric"
                    config={RATING_CONFIG.video}
                    data={draft.video}
                    onGate={(item, r) => setGate('video', item, r)}
                    onScore={(id, v) => setScore('video', id, v)}
                    onNote={(id, t) => setNote('video', id, t)}
                />

                <div className="rating-media">
                    <RatingVideo row={row} hasVideo={hasVideo} />
                    <span className="rating-media-tag">Video</span>
                </div>

                <div className="rating-media">
                    <RatingImage row={row} onMirrorImage={onMirrorImage} />
                    <span className="rating-media-tag">Source image</span>
                </div>

                {/* RIGHT — image rubric beside the image */}
                <RubricPanel
                    title="Image rubric"
                    config={RATING_CONFIG.image}
                    data={draft.image}
                    onGate={(item, r) => setGate('image', item, r)}
                    onScore={(id, v) => setScore('image', id, v)}
                    onNote={(id, t) => setNote('image', id, t)}
                />
            </div>
        </div>,
        document.body,
    );
}

// Wraps any media (img/video) in a fixed-size frame. Zoom (buttons + scroll
// wheel) scales the content, and dragging pans it — but everything is clipped to
// the frame (overflow:hidden) and the pan offset is clamped so the content always
// fills the box and can never overflow its rectangle. Double-click resets.
function ZoomableMedia({ className = '', children }) {
    const frameRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const stateRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
    stateRef.current = { scale, offset };
    const dragRef = useRef(null);

    const MIN = 1, MAX = 4, STEP = 0.25;

    // Clamp the pan so the scaled content keeps covering the frame: at scale s the
    // content extends (s-1)*size/2 past each edge, so that's the max travel.
    const clampOffset = (s, o) => {
        const el = frameRef.current;
        if (!el) return o;
        const maxX = (el.clientWidth * (s - 1)) / 2;
        const maxY = (el.clientHeight * (s - 1)) / 2;
        return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
    };

    const setZoom = (nextScale, nextOffset) => {
        const s = Math.max(MIN, Math.min(MAX, Number(nextScale.toFixed(2))));
        const o = s === 1 ? { x: 0, y: 0 } : clampOffset(s, nextOffset ?? stateRef.current.offset);
        setScale(s);
        setOffset(o);
    };
    const zoomBy = (d) => setZoom(stateRef.current.scale + d);
    const reset = () => setZoom(1);

    // Scroll-to-zoom — native non-passive listener so preventDefault stops the
    // page/panel from scrolling while zooming over the frame.
    useEffect(() => {
        const el = frameRef.current;
        if (!el) return;
        const onWheel = (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? STEP : -STEP); };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Drag-to-pan (only meaningful when zoomed in).
    useEffect(() => {
        const onMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            setOffset(clampOffset(stateRef.current.scale, {
                x: d.ox + (e.clientX - d.sx),
                y: d.oy + (e.clientY - d.sy),
            }));
        };
        const onUp = () => { if (dragRef.current) { dragRef.current = null; setDragging(false); } };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const onMouseDown = (e) => {
        if (stateRef.current.scale <= 1) return; // let native controls / clicks work at 1x
        e.preventDefault();
        dragRef.current = { sx: e.clientX, sy: e.clientY, ox: stateRef.current.offset.x, oy: stateRef.current.offset.y };
        setDragging(true);
    };

    return (
        <div
            ref={frameRef}
            className={`zoom-frame${scale > 1 ? ' is-zoomed' : ''}${dragging ? ' is-grabbing' : ''}${className ? ' ' + className : ''}`}
            onMouseDown={onMouseDown}
            onDoubleClick={reset}
        >
            <div className="zoom-inner" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
                {children}
            </div>
            <div className="zoom-controls" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                <button type="button" className="zoom-btn" onClick={() => zoomBy(-STEP)} disabled={scale <= MIN} aria-label="Zoom out" title="Zoom out"><ZoomOut /></button>
                <button type="button" className="zoom-btn" onClick={reset} disabled={scale === 1} aria-label="Reset zoom" title="Reset zoom"><Maximize2 /></button>
                <button type="button" className="zoom-btn" onClick={() => zoomBy(STEP)} disabled={scale >= MAX} aria-label="Zoom in" title="Zoom in"><ZoomIn /></button>
            </div>
        </div>
    );
}

function RatingVideo({ row, hasVideo }) {
    const v = row.video || {};
    if (!hasVideo) return <div className="rating-frame rating-frame--empty">No video</div>;
    if (v.storage_url) return (
        <ZoomableMedia>
            <video className="zoom-media" src={v.storage_url} controls playsInline />
        </ZoomableMedia>
    );
    // No Storage URL (legacy clip not yet backfilled). Rating happens from
    // Publishing, which backfills on view, so this is rarely hit.
    return (
        <div className="rating-frame rating-frame--empty">
            <ImageOff strokeWidth={1.5} />
            <span>Video unavailable</span>
        </div>
    );
}

// Source image, served natively from Supabase Storage. Legacy rows without a
// Storage URL get a one-time server-side backfill via mirror-image.
function RatingImage({ row, onMirrorImage }) {
    const [src, setSrc] = useState(row.image_storage_url || null);
    const [failed, setFailed] = useState(false);
    const tried = useRef(false);

    const backfill = useCallback(() => {
        if (tried.current || !onMirrorImage) { setFailed(true); return; }
        tried.current = true;
        onMirrorImage(row.id)
            .then((url) => { setSrc(url); setFailed(false); })
            .catch(() => setFailed(true));
    }, [row.id, onMirrorImage]);

    useEffect(() => {
        if (!row.image_storage_url && (row.image_file_id || row.image_url)) backfill();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!src || failed) {
        return (
            <div className="rating-frame rating-frame--empty">
                <ImageOff strokeWidth={1.5} />
                <span>Image unavailable</span>
            </div>
        );
    }
    return (
        <ZoomableMedia>
            <img className="zoom-media" src={src} alt="Source image" onError={() => setFailed(true)} />
        </ZoomableMedia>
    );
}

function RubricPanel({ title, config, data, onGate, onScore, onNote }) {
    return (
        <section className="rubric-panel">
            <h3 className="rubric-panel-title">{title}</h3>

            <p className="rubric-group-label">Gates · pass / fail</p>
            <div className="rubric-grid">
                {config.gates.map(g => (
                    <GateItem
                        key={g.id}
                        item={g}
                        value={data.gates[g.id]}
                        note={data.notes[g.id]}
                        onResult={(r) => onGate(g, r)}
                        onNote={(t) => onNote(g.id, t)}
                    />
                ))}
            </div>

            <p className="rubric-group-label">Scores · 1–5</p>
            <div className="rubric-grid">
                {config.scores.map(s => (
                    <ScoreItem
                        key={s.id}
                        item={s}
                        value={data.scores[s.id]}
                        note={data.notes[s.id]}
                        onScore={(v) => onScore(s.id, v)}
                        onNote={(t) => onNote(s.id, t)}
                    />
                ))}
            </div>
        </section>
    );
}

function GateItem({ item, value, note, onResult, onNote }) {
    const isAuto = item.control === 'auto_badge';
    const result = value?.result ?? null;
    return (
        <div className="rubric-item">
            <div className="rubric-item-head">
                <span className="rubric-item-label">{item.label}</span>
                {isAuto && <span className="auto-badge" title="Auto metric not available yet — set manually">Auto · pending</span>}
            </div>
            <div
                className="gate-toggle"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'p' || e.key === 'P') onResult('Pass');
                    else if (e.key === 'f' || e.key === 'F') onResult('Fail');
                }}
            >
                <button type="button" className={`gate-btn gate-pass${result === 'Pass' ? ' is-on' : ''}`} onClick={() => onResult('Pass')}>
                    <Check /><span>Pass</span>
                </button>
                <button type="button" className={`gate-btn gate-fail${result === 'Fail' ? ' is-on' : ''}`} onClick={() => onResult('Fail')}>
                    <X /><span>Fail</span>
                </button>
            </div>
            {result === 'Fail' && <NoteBox value={note} onChange={onNote} />}
        </div>
    );
}

function ScoreItem({ item, value, note, onScore, onNote }) {
    const low = value != null && value <= NOTE.scoreTrigger;
    return (
        <div className="rubric-item">
            <div className="rubric-item-head">
                <span className="rubric-item-label">{item.label}</span>
            </div>
            <div
                className="score-scale"
                tabIndex={0}
                onKeyDown={(e) => { const n = Number(e.key); if (n >= 1 && n <= 5) onScore(n); }}
            >
                {SCALE_5.values.map((v, i) => (
                    <button
                        key={v}
                        type="button"
                        className={`score-btn${value === v ? ' is-on' : ''}`}
                        title={SCALE_5.anchors[i]}
                        onClick={() => onScore(v)}
                    >{v}</button>
                ))}
            </div>
            <div className="score-anchor">{value ? SCALE_5.anchors[value - 1] : 'Not rated'}</div>
            {low && <NoteBox value={note} onChange={onNote} />}
        </div>
    );
}

function NoteBox({ value, onChange }) {
    return (
        <textarea
            className="rubric-note"
            rows={2}
            maxLength={NOTE.maxChars}
            placeholder={NOTE.label}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}
