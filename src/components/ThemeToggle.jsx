import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ theme, onToggle, floating = false }) {
    const Icon = theme === 'dark' ? Moon : Sun;
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`theme-toggle${floating ? ' theme-toggle--floating' : ''}`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
            <Icon />
        </button>
    );
}
