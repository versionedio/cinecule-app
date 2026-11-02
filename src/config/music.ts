/**
 * The background music offered to people making a film. Each track is an instrumental piece made for this app and levelled
 * to the same loudness (public/music/<id>.mp3). The render loops the chosen track under the narration and lowers it
 * whenever the narrator speaks.
 *
 * The ids here must match ALLOWED_MUSIC in the secure_write glyph and MUSIC_IDS in scripts/render/mix.mjs: the backend
 * refuses any other track, and the render only plays tracks from this list. A film that picks none has no music.
 */
export interface MusicTrack {
  /** Saved on the film as `music_id`, and the name of the file in public/music. */
  id: string;
  name: string;
  /** What it sounds like and what it suits, in a few words. */
  tagline: string;
  /** Where the preview is served from. */
  sample: string;
}

export const MUSIC: MusicTrack[] = [
  { id: "upbeat", name: "Upbeat", tagline: "Bright and positive. Good for ads and promos", sample: "/music/upbeat.mp3" },
  { id: "calm", name: "Calm", tagline: "Soft piano and pads. Good for explainers", sample: "/music/calm.mp3" },
  { id: "cinematic", name: "Cinematic", tagline: "Building strings. Good for brand films", sample: "/music/cinematic.mp3" },
  { id: "corporate", name: "Corporate", tagline: "Clean and confident. Good for business and product", sample: "/music/corporate.mp3" },
  { id: "playful", name: "Playful", tagline: "Marimba and pizzicato. Light and fun", sample: "/music/playful.mp3" },
  { id: "chill", name: "Chill", tagline: "Lo-fi and laid-back. Good for casual videos", sample: "/music/chill.mp3" }
];

export const musicById = (id: string | undefined) => MUSIC.find((m) => m.id === id);
