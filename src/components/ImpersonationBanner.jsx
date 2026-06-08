import { Eye, LogOut } from 'lucide-react';

// Fixed banner shown above the tenant Dashboard while the super admin is
// "viewing as" a tenant, with a clear way back to the console.
export function ImpersonationBanner({ name, email, onExit }) {
    return (
        <div className="impersonation-banner" role="status">
            <span className="imp-icon"><Eye size={16} /></span>
            <span className="imp-text">
                Viewing as <strong>{name || 'tenant'}</strong>
                {email ? <span className="imp-email"> · {email}</span> : null}
            </span>
            <button type="button" className="btn btn-sm imp-exit" onClick={onExit}>
                <LogOut size={15} /><span>Exit view</span>
            </button>
        </div>
    );
}
