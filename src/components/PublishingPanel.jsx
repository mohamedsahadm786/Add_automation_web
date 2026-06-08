import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, Columns2, Download, ImageOff,
    Play, RefreshCw, Search, X,
} from 'lucide-react';
import { usePublishingForAccount } from '../hooks/usePublishing.js';
import { downloadAsset } from '../lib/assets.js';
import { formatDate, genderClass, genderLabel } from '../lib/utils.js';
import { Modal } from './Modal.jsx';
import { RatingWorkspace } from './RatingWorkspace.jsx';

export function PublishingPanel({ accounts, status, error, search, onReload, rater }) {
    const [selected, setSelected] = useState(null);

    const filtered = useMemo(() => {
        const q = (search || '').trim().toLowerCase();
        if (!q) return accounts;
        return accounts.filter(a =>
            (a.tiktok_id || '').toLowerCase().includes(q) ||
            (a.name || '').toLowerCase().includes(q) ||
            (a.gender || '').toLowerCase().includes(q),
        );
    }, [accounts, search]);

    if (selected) {
        return <PublishingDetail account={selected} onBack={() => setSelected(null)} rater={rater} />;
    }

    const total = accounts.length;
    const showingAll = filtered.length === total;
    let panelSub;
    if (status === 'loading')   panelSub = 'Loading…';
    else if (total === 0)       panelSub = 'No accounts onboarded yet.';
    else if (showingAll)        panelSub = `${total} ${total === 1 ? 'account' : 'accounts'}`;
    else                        panelSub = `${filtered.length} of ${total} shown`;

    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2>Publishing</h2>
                    <p className="panel-sub">{panelSub}</p>
                </div>
                <div className="filters">
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
                <div className="state state-error">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <h3>Couldn't load accounts</h3>
                    <p>{error?.raw?.message || 'Please try again.'}</p>
                    <button type="button" className="btn btn-ghost" onClick={onReload}>Try again</button>
                </div>
            )}

            {status === 'ready' && total === 0 && (
                <div className="state state-empty">
                    <Search strokeWidth={1.5} />
                    <h3>Nothing to publish yet</h3>
                    <p>Onboard accounts in the Accounts page first.</p>
                </div>
            )}

            {status === 'ready' && total > 0 && (
                <ul className="publish-list">
                    {filtered.length === 0
                        ? <li className="publish-empty">No accounts match the current search.</li>
                        : filtered.map(a => (
                            <li key={a.id}>
                                <button
                                    type="button"
                                    className="publish-item"
                                    onClick={() => setSelected(a)}
                                    aria-label={`Open published content for ${a.tiktok_id}`}
                                >
                                    <div className="publish-item-main">
                                        <p className="publish-item-id">@{a.tiktok_id}</p>
                                        <p className="publish-item-name">{a.name}</p>
                                    </div>
                                    <span className={`tag ${genderClass(a.gender)}`}>{genderLabel(a.gender)}</span>
                                    <ChevronRight className="publish-item-chev" />
                                </button>
                            </li>
                        ))}
                </ul>
            )}
        </section>
    );
}

function PublishingDetail({ account, onBack, rater }) {
    const { rows, status, error, reload, mirrorVideo, mirrorImage } = usePublishingForAccount(account.id, account.tenant_id);
    const [lightbox, setLightbox] = useState(null); // index into rows, or null
    const [ratingRow, setRatingRow] = useState(null);

    const openAt = useCallback((i) => setLightbox(i), []);
    const close = useCallback(() => setLightbox(null), []);
    // Opening the rating workspace must close the lightbox — otherwise the
    // lightbox's autoplaying <video> keeps playing behind it and you get two
    // videos (and two audio tracks) playing at once.
    const openRating = useCallback((r) => { setLightbox(null); setRatingRow(r); }, []);

    return (
        <section className="panel">
            <header className="panel-head publish-detail-head">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
                    <ArrowLeft />
                    <span>Back</span>
                </button>
                <div className="publish-detail-meta">
                    <p className="publish-item-id">@{account.tiktok_id}</p>
                    <h2>{account.name}</h2>
                </div>
                <span className={`tag ${genderClass(account.gender)}`}>{genderLabel(account.gender)}</span>
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
                    <p>Loading content…</p>
                </div>
            )}

            {status === 'error' && (
                <div className="state state-error">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <h3>Couldn't load content</h3>
                    <p>{error?.message || 'Please try again.'}</p>
                    <button type="button" className="btn btn-ghost" onClick={reload}>Try again</button>
                </div>
            )}

            {status === 'ready' && rows.length === 0 && (
                <div className="state state-empty">
                    <Search strokeWidth={1.5} />
                    <h3>Nothing published yet</h3>
                    <p>The automation hasn't generated any scene images for this account.</p>
                </div>
            )}

            {status === 'ready' && rows.length > 0 && (
                <div className="publish-grid">
                    {rows.map((r, i) => (
                        <PublishCard key={r.id} row={r} onOpen={() => openAt(i)} onMirrorImage={mirrorImage} />
                    ))}
                </div>
            )}

            {lightbox !== null && (
                <Lightbox
                    rows={rows}
                    index={lightbox}
                    onIndex={setLightbox}
                    onClose={close}
                    onMirror={mirrorVideo}
                    onMirrorImage={mirrorImage}
                    onRate={openRating}
                />
            )}

            {ratingRow && (
                <RatingWorkspace
                    row={ratingRow}
                    account={account}
                    rater={rater}
                    onMirrorImage={mirrorImage}
                    onClose={() => setRatingRow(null)}
                />
            )}
        </section>
    );
}

// One 9:16 phone-shaped card. Thumbnail is the generated scene image; a play
// badge marks rows that also have a video.
function PublishCard({ row, onOpen, onMirrorImage }) {
    const hasVideo = Boolean(row.video && (row.video.id || row.video.storage_url || row.video.drive_file_id || row.video.drive_url));

    return (
        <button type="button" className="publish-card" onClick={onOpen}>
            <div className="publish-card-media">
                <Thumb row={row} onMirrorImage={onMirrorImage} alt={row.scenario_title || row.scenario_id || 'Generated image'} />
                {hasVideo && (
                    <span className="publish-card-play" aria-hidden="true">
                        <Play fill="currentColor" />
                    </span>
                )}
                <span className={`publish-card-badge${hasVideo ? ' is-video' : ''}`}>
                    {hasVideo ? 'Video' : 'Image only'}
                </span>
            </div>
            <div className="publish-card-cap">
                <span className="publish-card-scn">{row.scenario_title || row.scenario_id || 'Scene'}</span>
                <span className="publish-card-date">{formatDate(row.created_at)}</span>
            </div>
        </button>
    );
}

// Card thumbnail. Serves the scene image natively from Supabase Storage
// (image_storage_url). Legacy rows created before the Drive cutover have no
// Storage URL yet — those get a one-time server-side backfill via mirror-image,
// then display from Storage. New rows always have the URL, so no backfill fires.
function Thumb({ row, onMirrorImage, alt }) {
    const [src, setSrc] = useState(row.image_storage_url || null);
    const [failed, setFailed] = useState(false);
    const tried = useRef(false);

    const backfill = useCallback(() => {
        if (tried.current || !onMirrorImage) { setFailed(true); return; }
        tried.current = true;
        onMirrorImage(row.id)
            .then((url) => { setSrc(url); setFailed(false); })
            .catch((err) => { console.error('[Alluvi] image backfill failed', err); setFailed(true); });
    }, [row.id, onMirrorImage]);

    // Legacy row without a Storage URL → backfill once from the old Drive copy.
    useEffect(() => {
        if (!row.image_storage_url && (row.image_file_id || row.image_url)) backfill();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!src || failed) {
        return (
            <div className="publish-card-fallback">
                <ImageOff strokeWidth={1.5} />
            </div>
        );
    }
    return (
        <img
            className="publish-card-img"
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
        />
    );
}

// Fullscreen player. Click a card → play its video inline (Drive /preview
// iframe), or view the image full-size when there's no video. Arrow keys and
// the on-screen chevrons step through the gallery.
function Lightbox({ rows, index, onIndex, onClose, onMirror, onMirrorImage, onRate }) {
    const row = rows[index];
    const hasVideo = Boolean(row.video && (row.video.id || row.video.drive_file_id || row.video.drive_url));
    const [compare, setCompare] = useState(false);

    const prev = useCallback(() => onIndex(i => (i > 0 ? i - 1 : i)), [onIndex]);
    const next = useCallback(() => onIndex(i => (i < rows.length - 1 ? i + 1 : i)), [onIndex, rows.length]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [prev, next]);

    // Reset compare when stepping to another scene (the next one may be image-only).
    useEffect(() => { setCompare(false); }, [index]);

    const showCompare = compare && hasVideo;

    return (
        <Modal open onClose={onClose} labelledBy="lightbox-title">
            <div className={`lightbox${showCompare ? ' is-compare' : ''}`} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="lightbox-close icon-btn" onClick={onClose} aria-label="Close">
                    <X />
                </button>

                {index > 0 && (
                    <button type="button" className="lightbox-nav lightbox-prev icon-btn" onClick={prev} aria-label="Previous">
                        <ChevronLeft />
                    </button>
                )}
                {index < rows.length - 1 && (
                    <button type="button" className="lightbox-nav lightbox-next icon-btn" onClick={next} aria-label="Next">
                        <ChevronRight />
                    </button>
                )}

                {showCompare ? (
                    <div className="lightbox-compare">
                        <div className="lightbox-cell">
                            <VideoStage key={row.id} row={row} onMirror={onMirror} />
                            <span className="lightbox-cell-tag">Video</span>
                        </div>
                        <div className="lightbox-cell">
                            <LightboxImage key={row.id} row={row} onMirrorImage={onMirrorImage} alt="Source image" />
                            <span className="lightbox-cell-tag">Source image</span>
                        </div>
                    </div>
                ) : (
                    <div className="lightbox-stage">
                        {hasVideo ? (
                            <VideoStage key={row.id} row={row} onMirror={onMirror} />
                        ) : (
                            <LightboxImage key={row.id} row={row} onMirrorImage={onMirrorImage} alt={row.scenario_title || 'Generated image'} />
                        )}
                    </div>
                )}

                <div className="lightbox-foot">
                    <div className="lightbox-actions">
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => onRate?.(row)}
                            title="Rate this image & video"
                        >
                            <ClipboardCheck /><span>Rate</span>
                        </button>
                        {hasVideo && (
                            <button
                                type="button"
                                className={`btn btn-ghost btn-sm${showCompare ? ' is-active' : ''}`}
                                onClick={() => setCompare(c => !c)}
                                title="Show the source image next to the video"
                            >
                                <Columns2 /><span>{showCompare ? 'Single' : 'Compare'}</span>
                            </button>
                        )}
                        {row.image_storage_url && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => downloadAsset(row.image_storage_url, `${row.scenario_id || row.id}-image`)}
                            >
                                <Download /><span>Image</span>
                            </button>
                        )}
                        {row.video?.storage_url && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => downloadAsset(row.video.storage_url, `${row.scenario_id || row.id}-video`)}
                            >
                                <Download /><span>Video</span>
                            </button>
                        )}
                    </div>
                    <div className="lightbox-info">
                        <p id="lightbox-title" className="lightbox-scn">
                            {row.scenario_title || row.scenario_id || 'Scene'}
                        </p>
                        <p className="lightbox-date">
                            {formatDate(row.created_at)} · {index + 1} of {rows.length}
                            {!hasVideo && ' · image only'}
                        </p>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

// The video player. Plays natively from Supabase Storage (video.storage_url).
// Legacy rows without a Storage URL get a one-time server-side backfill via
// mirror-video ("Preparing video…"), then play native. If a legacy row has no
// recoverable source, it shows an "unavailable" state. New rows always have a
// Storage URL and play instantly.
function VideoStage({ row, onMirror }) {
    const video = row.video || {};
    const [url, setUrl] = useState(video.storage_url || null);
    // 'ready' | 'preparing' | 'unavailable'
    const [phase, setPhase] = useState(video.storage_url ? 'ready' : 'preparing');

    useEffect(() => {
        if (video.storage_url) { setUrl(video.storage_url); setPhase('ready'); return; }
        if (!video.id) { setPhase('unavailable'); return; }

        let cancelled = false;
        setPhase('preparing');
        onMirror(row.id, video.id)
            .then((storageUrl) => {
                if (cancelled) return;
                setUrl(storageUrl);
                setPhase('ready');
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('[Alluvi] video backfill failed', err);
                setPhase('unavailable');
            });
        return () => { cancelled = true; };
    }, [row.id, video.id, video.storage_url, onMirror]);

    if (phase === 'preparing') {
        return (
            <div className="lightbox-loading">
                <div className="spinner" />
                <p>Preparing video…</p>
                <span>One-time migration of an older clip into Storage.</span>
            </div>
        );
    }

    if (phase === 'unavailable') {
        return (
            <div className="lightbox-frame lightbox-fallback">
                <ImageOff strokeWidth={1.5} />
                <span>Video unavailable</span>
            </div>
        );
    }

    return (
        <video
            className="lightbox-frame"
            src={url}
            controls
            autoPlay
            playsInline
        />
    );
}

// Full-size scene image for the lightbox (image-only view + compare pane).
// Serves natively from Supabase Storage; legacy rows without a Storage URL get
// a one-time server-side backfill via mirror-image — same strategy as the grid
// thumbnail.
function LightboxImage({ row, onMirrorImage, alt }) {
    const [src, setSrc] = useState(row.image_storage_url || null);
    const [failed, setFailed] = useState(false);
    const tried = useRef(false);

    const backfill = useCallback(() => {
        if (tried.current || !onMirrorImage) { setFailed(true); return; }
        tried.current = true;
        onMirrorImage(row.id)
            .then((url) => { setSrc(url); setFailed(false); })
            .catch((err) => { console.error('[Alluvi] lightbox image backfill failed', err); setFailed(true); });
    }, [row.id, onMirrorImage]);

    // Legacy row without a Storage URL → backfill once from the old Drive copy.
    useEffect(() => {
        if (!row.image_storage_url && (row.image_file_id || row.image_url)) backfill();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!src || failed) {
        return (
            <div className="lightbox-frame lightbox-fallback">
                <ImageOff strokeWidth={1.5} />
                <span>Image unavailable</span>
            </div>
        );
    }
    return <img className="lightbox-frame" src={src} alt={alt} onError={() => setFailed(true)} />;
}
