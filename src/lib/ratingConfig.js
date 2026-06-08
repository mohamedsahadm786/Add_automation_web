// Single source of truth for the QA rating rubric. The RatingWorkspace renders
// entirely from this — add/remove a dimension by editing here, not the component.
//
// control: 'pass_fail' (human gate) | 'auto_badge' (auto gate) | 'scale_5' (score)
// source:  'human' | 'auto'
// Auto metrics aren't produced by the pipeline yet, so auto gates currently have
// no value and are set manually (stored with auto_value:null, disputed:true).

export const RUBRIC_VERSION = 'v1';

// Replace with the real strings/thresholds once auto metrics exist.
export const BRAND_STRING = '<BRAND_STRING>';
export const PRODUCT_NAME_STRING = '<PRODUCT_NAME_STRING>';

export const SCALE_5 = {
    values: [1, 2, 3, 4, 5],
    anchors: ['Bad', 'Poor', 'Fair', 'Good', 'Excellent'],
};

export const NOTE = {
    maxChars: 200,
    label: 'Why? (optional, helps tuning)',
    // shown when a gate is Fail or a score is <= 2
    scoreTrigger: 2,
};

export const TRIAGE_OPTIONS = ['Accept', 'Reject', 'Flag'];

export const RATING_CONFIG = {
    image: {
        gates: [
            { id: 'img_product_present',  label: 'Product present & correctly placed', source: 'auto',  metric: 'object_detection', control: 'auto_badge' },
            { id: 'img_color_fidelity',   label: 'Product colour fidelity',            source: 'auto',  metric: 'delta_e', thresholdMax: 5.0, control: 'auto_badge' },
            { id: 'img_shape_dimensions', label: 'Product shape & dimensions',         source: 'human', control: 'pass_fail' },
            { id: 'img_brand_text',       label: 'Brand text legible & correct',       source: 'auto',  metric: 'ocr_cer', groundTruth: BRAND_STRING, thresholdMax: 0.10, control: 'auto_badge' },
            { id: 'img_productname_text', label: 'Product-name text legible & correct', source: 'auto', metric: 'ocr_cer', groundTruth: PRODUCT_NAME_STRING, thresholdMax: 0.10, control: 'auto_badge' },
            { id: 'img_grip_logic',       label: 'Grip / placement logic',             source: 'human', control: 'pass_fail' },
            { id: 'img_persona_identity', label: 'Persona identity match',             source: 'auto',  metric: 'face_cosine', thresholdMin: 0.70, control: 'auto_badge' },
            { id: 'img_scene_logic',      label: 'Scene logic & reflections',          source: 'human', control: 'pass_fail' },
        ],
        scores: [
            { id: 'img_scene_adherence', label: 'Scene / prompt adherence' },
            { id: 'img_aesthetic',       label: 'Aesthetic quality' },
            { id: 'img_detail_realism',  label: 'Detail & realism' },
            { id: 'img_lighting',        label: 'Lighting execution' },
            { id: 'img_ad_worthiness',   label: 'Ad-worthiness / scroll-stop' },
        ],
    },
    video: {
        gates: [
            { id: 'vid_product_identity',  label: 'Product identity preserved through motion', source: 'human', control: 'pass_fail' },
            { id: 'vid_persona_identity',  label: 'Persona identity preserved through motion', source: 'human', control: 'pass_fail' },
            { id: 'vid_no_artifacts',      label: 'No catastrophic artifacts',                 source: 'human', control: 'pass_fail' },
            { id: 'vid_grip_maintained',   label: 'Grip maintained through motion',            source: 'human', control: 'pass_fail' },
            { id: 'vid_brand_text_motion', label: 'Brand & product text legible through motion', source: 'human', control: 'pass_fail' },
        ],
        scores: [
            { id: 'vid_motion_smoothness',     label: 'Motion smoothness' },
            { id: 'vid_temporal_stability',    label: 'Temporal stability' },
            { id: 'vid_dynamic_degree',        label: 'Dynamic degree' },
            { id: 'vid_camera_motion',         label: 'Camera motion quality' },
            { id: 'vid_physical_plausibility', label: 'Physical plausibility' },
            { id: 'vid_imaging_quality',       label: 'Imaging quality' },
            { id: 'vid_hook_strength',         label: 'Hook strength / ad-worthiness' },
        ],
    },
};

// Build an empty rating draft from the config.
export function emptyRating() {
    const section = (s) => ({
        gates: Object.fromEntries(s.gates.map(g => [g.id, { result: null, auto_value: null, disputed: false }])),
        scores: Object.fromEntries(s.scores.map(s2 => [s2.id, null])),
        notes: {},
    });
    return {
        triage: null,
        image: section(RATING_CONFIG.image),
        video: section(RATING_CONFIG.video),
    };
}
