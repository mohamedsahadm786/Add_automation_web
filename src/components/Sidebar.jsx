import { BarChart3, LogOut, Settings, Users, Video, X } from 'lucide-react';
import { BrandMark } from './BrandMark.jsx';

export function Sidebar({ open, onClose, onLogout, view, onNavigate, user }) {
    const go = (v) => {
        onNavigate(v);
        onClose();
    };

    const name = user?.name || 'Admin';
    const role = user?.email || user?.role || 'Workspace owner';
    const initial = name.charAt(0).toUpperCase() || 'A';

    return (
        <>
            <aside className={`sidebar${open ? ' is-open' : ''}`}>
                <div className="sidebar-head">
                    <BrandMark small gradientId="sidebar-grad" />
                    <div className="sidebar-brand">
                        <p className="brand-eyebrow">Alluvi</p>
                        <p className="brand-title-sm">Console</p>
                    </div>
                    <button
                        type="button"
                        className="icon-btn sidebar-close"
                        onClick={onClose}
                        aria-label="Close menu"
                    >
                        <X />
                    </button>
                </div>

                <nav className="sidebar-nav">
                    <p className="nav-section">Manage</p>
                    <button
                        type="button"
                        className={`nav-item${view === 'accounts' ? ' is-active' : ''}`}
                        onClick={() => go('accounts')}
                    >
                        <Users /><span>Accounts</span>
                    </button>
                    <button
                        type="button"
                        className={`nav-item${view === 'publishing' ? ' is-active' : ''}`}
                        onClick={() => go('publishing')}
                    >
                        <Video /><span>Publishing</span>
                    </button>
                    <button
                        type="button"
                        className={`nav-item${view === 'analytics' ? ' is-active' : ''}`}
                        onClick={() => go('analytics')}
                    >
                        <BarChart3 /><span>Analytics</span>
                    </button>

                    <p className="nav-section">System</p>
                    <button
                        type="button"
                        className={`nav-item${view === 'settings' ? ' is-active' : ''}`}
                        onClick={() => go('settings')}
                    >
                        <Settings /><span>Settings</span>
                    </button>
                </nav>

                <div className="sidebar-foot">
                    <div className="user-chip">
                        <div className="avatar">{initial}</div>
                        <div className="user-meta">
                            <p className="user-name">{name}</p>
                            <p className="user-role" title={role}>{role}</p>
                        </div>
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={onLogout}
                            aria-label="Sign out"
                            title="Sign out"
                        >
                            <LogOut />
                        </button>
                    </div>
                </div>
            </aside>

            {open && <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />}
        </>
    );
}
