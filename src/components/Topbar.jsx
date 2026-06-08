import { Menu, Plus, Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle.jsx';

export function Topbar({
    theme, onToggleTheme,
    onOpenSidebar,
    title, subtitle,
    search, onSearchChange,
    searchRef,
    onOnboard,
    runControl,
}) {
    return (
        <header className="topbar">
            <button
                type="button"
                className="icon-btn topbar-menu"
                onClick={onOpenSidebar}
                aria-label="Open menu"
            >
                <Menu />
            </button>

            <div className="topbar-title">
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
            </div>

            <div className="topbar-actions">
                {onSearchChange && (
                    <div className="search">
                        <Search />
                        <input
                            ref={searchRef}
                            type="search"
                            placeholder="Search accounts…"
                            aria-label="Search accounts"
                            value={search}
                            onChange={e => onSearchChange(e.target.value)}
                        />
                        <kbd>/</kbd>
                    </div>
                )}
                <ThemeToggle theme={theme} onToggle={onToggleTheme} />
                {onOnboard && (
                    <button type="button" className="btn btn-primary" onClick={onOnboard}>
                        <Plus />
                        <span>Onboard</span>
                    </button>
                )}
                {runControl}
            </div>
        </header>
    );
}
