/**
 * The Guru — feature flags.
 *
 * GURU_ENABLED gates BOTH the widget UI and the /api/guru route, so while
 * false it is impossible for the CRM to spend a cent on Anthropic via the
 * Guru. Flip to true (and redeploy) to bring the chat back.
 *
 * Paused 2026-07-20: usage was adding up faster than we wanted while the
 * team hammered it. Cheaper revival options when wanted: swap the route's
 * model to Haiku, trim the bible context, or add a per-user daily cap.
 */
export const GURU_ENABLED = false;
