/**
 * Samples that need the experimental device frame: the playground offers
 * them only with ?device=1, where deviceComponents are registered. Each is a
 * plain spec, written with the same language a model is given.
 */
import type { Sample } from "./samples";

/** A weather app's home screen on a phone, at three quarters of its real size. */
export const WEATHER_HOME = `state unit='C' views=0
device "Weather app home screen" kind=iphone scale=0.75 status=true
  text "Phoenix" style=title
  text "Sunny, light wind" tone=muted
  stat label="Now" value="31°"
  segmented options="C,F" bind=unit
  card
    row
      stat label="High" value="34°"
      stat label="Low" value="19°"
  button "See the week" variant=primary on=inc:views`;

/** A sign-up page on a laptop screen. */
export const LAPTOP_SIGNUP = `state email=''
device "Sign-up page" kind=laptop scale=0.5
  text "Create your account" style=title
  text "Email" style=caption
  input bind=email placeholder="you@example.com"
  button "Continue" variant=primary`;

export const deviceSamples: Record<string, Sample> = {
  weatherPhone: {
    label: "Weather app on a phone (device)",
    prompt: "Show me a mockup of a weather app's home screen on a phone.",
    spec: WEATHER_HOME,
  },
  signupLaptop: {
    label: "Sign-up page on a laptop (device)",
    prompt: "Mock up a simple sign-up page as it looks on a laptop.",
    spec: LAPTOP_SIGNUP,
  },
};
