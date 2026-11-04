/**
 * Shared interaction rhythm for all core components.
 *
 * Fast hover/press feedback, slightly slower selection and navigation, and
 * deliberate state-driven data changes. All run on the existing canvas clock,
 * respect reduced motion and stop requesting frames once settled.
 */
export const MOTION = {
  hover: 165,
  press: 115,
  selection: 205,
  navigation: 245,
  data: 460,
} as const;
