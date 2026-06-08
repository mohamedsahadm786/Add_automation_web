export function BrandMark({ small = false, gradientId = 'brand-grad' }) {
    return (
        <div className={`brand-mark${small ? ' brand-mark--sm' : ''}`}>
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
                <path
                    d="M11 9h4v10a3 3 0 11-3-3v-3a6 6 0 106 6V13a6 6 0 006 6v-4a2 2 0 01-2-2V9h-4v10"
                    fill="white"
                />
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32">
                        <stop stopColor="#ec4899" />
                        <stop offset="1" stopColor="#8b5cf6" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
}
