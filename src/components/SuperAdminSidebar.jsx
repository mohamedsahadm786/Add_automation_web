import { BarChart3, History, LogOut, Users, X } from 'lucide-react';
import { BrandMark } from './BrandMark.jsx';

// Dedicated nav for the Super Admin console. Kept separate from the tenant
// Sidebar so the tenant experience is never touched.
export function SuperAdminSidebar({ open, onClose, onLogout, view, onNavigate, user }) {
    const go = (v) => {
        onNavigate(v);
        onClose();
    };

    const name = user?.name || 'Super Admin';
    const role = user?.role || 'Platform owner';
    const initial = name.charAt(0).toUpperCase() || 'S';

    return (
        <>
            <aside className={`sidebar${open ? ' is-open' : ''}`}>
                <div className="sidebar-head">
                    <BrandMark small gradientId="sa-sidebar-grad" />
                    <div className="sidebar-brand">
                        <p className="brand-eyebrow">Alluvi</p>
                        <p className="brand-title-sm">Admin</p>
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
                    <p className="nav-section">Platform</p>
                    <button
                        type="button"
                        className={`nav-item${view === 'overview' ? ' is-active' : ''}`}
                        onClick={() => go('overview')}
                    >
                        <BarChart3 /><span>Overview</span>
                    </button>
                    <button
                        type="button"
                        className={`nav-item${view === 'tenants' || view === 'detail' ? ' is-active' : ''}`}
                        onClick={() => go('tenants')}
                    >
                        <Users /><span>Tenants</span>
                    </button>
                    <button
                        type="button"
                        className={`nav-item${view === 'activity' ? ' is-active' : ''}`}
                        onClick={() => go('activity')}
                    >
                        <History /><span>Activity</span>
                    </button>
                </nav>

                <div className="sidebar-foot">
                    <div className="user-chip">
                        <div className="avatar avatar--admin">{initial}</div>
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
