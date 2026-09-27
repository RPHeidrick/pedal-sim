/**
 * What the visitor is listening on, and how to get the best (and safest) sound from it.
 *   short:  label for the Output panel menu; name is the full label in the sound check
 *   start:  the highest Volume (dB) to start at; choosing this profile never turns the volume *up*
 *   safety: whether the safety cap (-12 dBFS ceiling) starts on
 *   tip:    one line shown in the Output panel
 *   tips:   the fuller advice shown in the sound check
 */
export const OUTPUT_PROFILES = [
  {
    id: 'headphones', short: 'Headphones', name: 'Wired headphones', start: -24, safety: true,
    tip: 'Best detail and no delay. Start your computer volume low.',
    tips: [
      'Headphones put the sound right at your ears, so start with the computer volume at about a quarter and raise it slowly.',
      'Closed-back headphones block out the room and show the most detail; open-back ones sound more like speakers in a room.',
      'Keep the safety cap on: it stops any pedal from ever jumping above -12 dB.',
      'Wired headphones have no delay, which matters later when you play a real guitar live.',
    ],
  },
  {
    id: 'bluetooth', short: 'Bluetooth', name: 'Bluetooth headphones or speaker', start: -24, safety: true,
    tip: 'Fine for listening. Adds a short delay, so use wired for live guitar.',
    tips: [
      'Bluetooth delays the sound by about 0.15 to 0.3 seconds. That is fine for the sample sounds, but too slow for playing a guitar live. Use a cable for that.',
      'Bluetooth also compresses the audio a little, so the finest detail in the fuzz and the pick attack is softened.',
      'Start low: many Bluetooth devices remember a high volume from the last time they were used.',
    ],
  },
  {
    id: 'laptop', short: 'Laptop or phone', name: 'Laptop or phone speakers', start: -12, safety: false,
    tip: 'Small speakers lose the low end. Headphones show the full sound.',
    tips: [
      'Small built-in speakers cannot play low bass, so fuzz and heavy boards sound thinner than they really are.',
      'If it is too quiet, turn up your device volume rather than pushing the Volume slider to the top; that keeps the sound cleanest.',
      'For the full tone, try headphones or external speakers.',
    ],
  },
  {
    id: 'desktop', short: 'Computer speakers', name: 'Computer speakers', start: -18, safety: false,
    tip: 'Set the speakers at ear height, pointed at you.',
    tips: [
      'Set the speaker knob to about a quarter before you press Power on, then use the Volume slider for fine adjustment.',
      'Speakers pointed at your ears, not at the desk or wall, give a clearer, more balanced sound.',
      'A subwoofer, if you have one, fills in the low end of fuzz and heavy boards.',
    ],
  },
  {
    id: 'monitors', short: 'Studio monitors', name: 'Studio monitors', start: -24, safety: false,
    tip: 'The most accurate choice. Start the interface knob low.',
    tips: [
      'Studio monitors are the most accurate way to hear the circuits. Start your audio interface monitor knob low.',
      'Place them at ear height, with you and the two speakers in a triangle.',
      'The site plays the same signal in both speakers (mono), like a guitar amp, so it will seem to come from the middle.',
    ],
  },
  {
    id: 'hifi', short: 'Home stereo', name: 'Stereo or home speakers', start: -24, safety: false,
    tip: 'Big speakers play the full low end, so turn up slowly.',
    tips: [
      'Big home speakers play the full low end of the circuits, so turn up slowly; heavy boards have a lot of bass.',
      'The sound is mono, like a guitar amp. Sit between the speakers for the most solid image.',
      'If your stereo has bass or treble controls or a sound mode (like "rock" or "surround"), set it flat or off so you hear the pedals as they are.',
    ],
  },
];

export const DEFAULT_PROFILE = 'headphones';
export const profileById = (id) => OUTPUT_PROFILES.find((p) => p.id === id) || OUTPUT_PROFILES.find((p) => p.id === DEFAULT_PROFILE);
