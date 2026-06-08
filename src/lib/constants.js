// Which Supabase project the app talks to is decided by environment, NOT
// hardcoded — so localhost can run on the `alluvi-dev` project while production
// points at the live project. Set these in `.env.local` (dev) and in the host's
// env settings (prod). See `.env.example`.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
        'Missing VITE_SUPABASE_URL / VITE_SUPABASE_KEY. Create a .env.local file ' +
        '(copy .env.example) and restart `npm run dev`.',
    );
}

export const TABLE = 'tiktok_accounts';

// n8n webhook is no longer called from the browser — see the
// `trigger-pipeline` Supabase Edge Function. URL + Basic-Auth credentials
// live in Supabase secrets (N8N_WEBHOOK_URL / USER / PASS).

export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'Alluvi@admin@1512';

export const SESSION_KEY = 'alluvi.session';
export const THEME_KEY = 'alluvi.theme';

// Per-asset cost estimate used by the Super Admin console. There is no real
// API-usage metering yet, so cost is approximated from how many assets a tenant
// produced. Tune these numbers (USD) to match your actual Fal/Anthropic spend.
export const COST_RATES = {
    image: 0.05,   // $ per generated scene image (an `outputs` row)
    video: 0.20,   // $ per generated video (a `videos` row)
};

export const GENDER_OPTIONS = [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
    { value: 'non-binary', label: 'Non-binary' },
    { value: 'other', label: 'Other' },
];

export const COUNTRY_SUGGESTIONS = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'India',
    'Germany', 'France', 'Spain', 'Italy', 'Brazil', 'Mexico', 'Japan',
    'South Korea', 'Indonesia', 'Philippines', 'Vietnam', 'Netherlands',
    'Sweden', 'UAE', 'Singapore',
];

export const LANGUAGE_SUGGESTIONS = [
    'English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian',
    'Hindi', 'Arabic', 'Japanese', 'Korean', 'Mandarin', 'Indonesian',
    'Vietnamese', 'Tagalog', 'Dutch', 'Swedish', 'Turkish', 'Russian',
];
