import { COST_RATES } from './constants.js';

// Estimated spend for a tenant, derived from how many assets they produced.
// images = number of `outputs` rows (scene images), videos = `videos` rows.
// No real API metering exists yet — tune COST_RATES in constants.js.
export function computeCost({ images = 0, videos = 0 }) {
    return images * COST_RATES.image + videos * COST_RATES.video;
}

// "$1,234.56"
export function formatCost(amount) {
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    }).format(amount || 0);
}
