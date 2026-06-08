import { useCallback, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts.js';
import { useTenant } from '../hooks/useTenant.js';
import { usePipelineRun } from '../hooks/usePipelineRun.js';
import { useRunProgress } from '../hooks/useRunProgress.js';
import { useRunConfig } from '../hooks/useRunConfig.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { friendlySupabaseError } from '../lib/utils.js';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { Stats } from './Stats.jsx';
import { AccountsPanel } from './AccountsPanel.jsx';
import { PublishingPanel } from './PublishingPanel.jsx';
import { AnalyticsPanel } from './AnalyticsPanel.jsx';
import { SettingsPanel } from './SettingsPanel.jsx';
import { TenantSetup } from './TenantSetup.jsx';
import { AccountFormModal } from './AccountFormModal.jsx';
import { DeleteModal } from './DeleteModal.jsx';
import { RunControl } from './RunControl.jsx';
import { RunConfigModal } from './RunConfigModal.jsx';

const RUN_ERRORS = {
    auth_failed:           'Pipeline auth failed — check the n8n Basic-Auth credentials in Supabase secrets.',
    not_found:             'Webhook not found — is the n8n workflow published?',
    network:               "Couldn't reach n8n from the Edge Function.",
    function_unreachable:  "Couldn't reach the trigger function. Is it deployed?",
    missing_secrets:       'Edge Function is missing N8N_WEBHOOK_URL / USER / PASS secrets.',
    unknown:               'Pipeline trigger failed.',
};

const VIEWS = {
    accounts: {
        title: 'TikTok Accounts',
        subtitle: 'Manage every account your automation publishes from.',
        hasSearch: true,
    },
    publishing: {
        title: 'Publishing',
        subtitle: 'Browse generated images and videos by account.',
        hasSearch: true,
    },
    analytics: {
        title: 'Analytics',
        subtitle: 'Pipeline health, demographics, and what your automation produced.',
        hasSearch: false,
    },
    settings: {
        title: 'Settings',
        subtitle: 'API keys and connection configuration.',
        hasSearch: false,
    },
};

export function Dashboard({ theme, onToggleTheme, onLogout, user, impersonated = false }) {
    const toast = useToast();
    const { tenantId, isAdmin, onboarded, status: tenantStatus, profile, saveSetup } = useTenant(user);
    const { accounts, status, error, reload, create, update, remove } = useAccounts(tenantId);
    const { running, run, runStartedAt, clearRun } = usePipelineRun(tenantId);
    const { counts, completed, stalled } = useRunProgress(runStartedAt, tenantId);
    const { config: runConfig, isComplete: runConfigComplete, save: saveRunConfig } = useRunConfig(tenantId);

    // A fresh member must finish the setup page before the full interface shows.
    const tenantLoading = !isAdmin && tenantStatus === 'loading';
    const needsSetup = !isAdmin && tenantStatus === 'ready' && !onboarded;

    const [view, setView] = useState('accounts');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [genderFilter, setGenderFilter] = useState('');
    const [countryFilter, setCountryFilter] = useState('');

    const [formState, setFormState] = useState({ open: false, mode: 'create', target: null });
    const [deleteState, setDeleteState] = useState({ open: false, target: null });
    const [runSettingsOpen, setRunSettingsOpen] = useState(false);

    const searchRef = useRef(null);

    // '/' focuses search (only on views that show the search box)
    useEffect(() => {
        function onKey(e) {
            if (e.key !== '/') return;
            if (!VIEWS[view]?.hasSearch) return;
            const tag = (document.activeElement?.tagName) || '';
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
            if (formState.open || deleteState.open) return;
            e.preventDefault();
            searchRef.current?.focus();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [view, formState.open, deleteState.open]);

    // Reset the free-text search when switching views — the placeholder is
    // generic, but the filter scope changes (accounts list vs. publishing list).
    const navigate = useCallback((next) => {
        setView(next);
        setSearch('');
    }, []);

    const openOnboard = useCallback(() => {
        setFormState({ open: true, mode: 'create', target: null });
    }, []);

    const openEdit = useCallback((account) => {
        setFormState({ open: true, mode: 'edit', target: account });
    }, []);

    const closeForm = useCallback(() => {
        setFormState(s => ({ ...s, open: false }));
    }, []);

    const handleFormSubmit = useCallback(async (payload) => {
        try {
            if (formState.mode === 'edit') {
                const { cascaded } = await update(formState.target.id, payload);
                toast.success(
                    cascaded
                        ? 'Account updated. Persona will be regenerated on the next pipeline run.'
                        : 'Account updated.',
                );
            } else {
                await create(payload);
                toast.success('Account onboarded.');
            }
            setFormState(s => ({ ...s, open: false }));
        } catch (err) {
            // Re-throw with a friendlier message so the modal can show it
            throw new Error(friendlySupabaseError(err));
        }
    }, [formState.mode, formState.target, create, update, toast]);

    const openDelete = useCallback((account) => {
        setDeleteState({ open: true, target: account });
    }, []);

    const closeDelete = useCallback(() => {
        setDeleteState(s => ({ ...s, open: false }));
    }, []);

    const handleRun = useCallback(async () => {
        // Run requires a complete config; if not, open the settings modal instead.
        if (!runConfigComplete) {
            setRunSettingsOpen(true);
            toast.info('Complete the run settings first.');
            return;
        }
        // Persist the tenant's config to the DB before triggering — n8n reads it.
        try {
            await saveRunConfig(runConfig);
        } catch (err) {
            toast.error('Could not save run settings.');
            return;
        }
        const result = await run();
        if (result.alreadyRunning) return;
        if (result.ok) {
            toast.success('Pipeline started. Progress will appear next to the Run button.');
            return;
        }
        // Surface the upstream cause if the function bubbled one up
        const upstreamCode = result.body?.error || result.error;
        toast.error(RUN_ERRORS[upstreamCode] || RUN_ERRORS.unknown);
    }, [run, toast, runConfigComplete, runConfig, saveRunConfig]);

    const handleDeleteConfirm = useCallback(async (target) => {
        try {
            await remove(target.id);
            toast.success('Account deleted.');
            setDeleteState({ open: false, target: null });
        } catch (err) {
            toast.error(friendlySupabaseError(err));
        }
    }, [remove, toast]);

    const meta = VIEWS[view];

    // A suspended / removed tenant is blocked from their own workspace. The super
    // admin impersonating them bypasses this (impersonated=true).
    const accountStatus = profile?.status || 'active';
    if (!impersonated && !isAdmin && (accountStatus === 'suspended' || accountStatus === 'removed')) {
        return (
            <section className="auth-shell">
                <div className="auth-card auth-card--blocked">
                    <h2>{accountStatus === 'removed' ? 'Account removed' : 'Account suspended'}</h2>
                    <p>
                        Your access has been {accountStatus === 'removed' ? 'removed' : 'temporarily suspended'} by
                        an administrator. Please contact your platform administrator.
                    </p>
                    <button type="button" className="btn btn-ghost btn-block" onClick={onLogout}>Sign out</button>
                </div>
            </section>
        );
    }

    return (
        <section className="app-shell">
            <Sidebar
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                onLogout={onLogout}
                view={view}
                onNavigate={navigate}
                user={user}
            />

            <main className="main">
                <Topbar
                    theme={theme}
                    onToggleTheme={onToggleTheme}
                    onOpenSidebar={() => setSidebarOpen(true)}
                    title={meta.title}
                    subtitle={meta.subtitle}
                    search={search}
                    onSearchChange={meta.hasSearch ? setSearch : undefined}
                    searchRef={searchRef}
                    onOnboard={view === 'accounts' && onboarded ? openOnboard : undefined}
                    runControl={view === 'accounts' && onboarded ? (
                        <div className="run-cluster-wrap">
                            <button
                                type="button"
                                className={`btn btn-ghost run-settings-btn${runConfigComplete ? '' : ' is-incomplete'}`}
                                onClick={() => setRunSettingsOpen(true)}
                                title={runConfigComplete ? 'Run settings' : 'Run settings — setup required'}
                            >
                                <SlidersHorizontal />
                                <span>Run settings</span>
                            </button>
                            <RunControl
                                running={running}
                                onRun={handleRun}
                                runStartedAt={runStartedAt}
                                counts={counts}
                                completed={completed}
                                stalled={stalled}
                                onClear={clearRun}
                                canRun={runConfigComplete}
                                disabledReason="Complete run settings to enable Run"
                            />
                        </div>
                    ) : null}
                />

                {view === 'accounts' && tenantLoading && (
                    <div className="state state-loading">
                        <div className="spinner" />
                        <p>Loading your workspace…</p>
                    </div>
                )}

                {view === 'accounts' && needsSetup && (
                    <TenantSetup user={user} onSave={saveSetup} />
                )}

                {view === 'accounts' && !tenantLoading && !needsSetup && (
                    <>
                        <Stats accounts={accounts} />
                        <AccountsPanel
                            accounts={accounts}
                            status={status}
                            error={error}
                            search={search}
                            genderFilter={genderFilter}
                            onGenderFilter={setGenderFilter}
                            countryFilter={countryFilter}
                            onCountryFilter={setCountryFilter}
                            onReload={reload}
                            onOnboard={openOnboard}
                            onEdit={openEdit}
                            onDelete={openDelete}
                        />
                    </>
                )}

                {view === 'publishing' && (
                    <PublishingPanel
                        accounts={accounts}
                        status={status}
                        error={error}
                        search={search}
                        onReload={reload}
                        rater={user?.email || user?.id || 'unknown'}
                    />
                )}

                {view === 'analytics' && <AnalyticsPanel tenantId={tenantId} />}

                {view === 'settings' && <SettingsPanel tenantId={tenantId} />}

                <footer className="page-foot">
                    <p>Alluvi Onboarding Console · MVP build</p>
                </footer>
            </main>

            <AccountFormModal
                open={formState.open}
                mode={formState.mode}
                initial={formState.target}
                onClose={closeForm}
                onSubmit={handleFormSubmit}
            />

            <DeleteModal
                open={deleteState.open}
                target={deleteState.target}
                onClose={closeDelete}
                onConfirm={handleDeleteConfirm}
            />

            <RunConfigModal
                open={runSettingsOpen}
                config={runConfig}
                onClose={() => setRunSettingsOpen(false)}
                onSave={saveRunConfig}
            />
        </section>
    );
}
