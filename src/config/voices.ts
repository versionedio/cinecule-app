/**
 * The narration voices offered to people making a film. Each one is a stock ElevenLabs voice, with a short recorded
 * sample (public/voices/<key>.mp3, all saying the same line so they can be compared fairly).
 *
 * The ids here must match the list in the secure_write glyph (ALLOWED_VOICES): the backend refuses any other voice.
 * A film that picks none uses the narration glyph's standard voice (Rachel).
 */
export interface Voice {
  /** The ElevenLabs voice id, saved on the film as `voice_id`. */
  id: string;
  key: string;
  name: string;
  /** What it sounds like and what it suits, in a few words. */
  tagline: string;
  /** Where the sample is served from. */
  sample: string;
}

export const VOICES: Voice[] = [
  { id: "hpp4J3VqNfWAUOO0d1Us", key: "bella", name: "Bella", tagline: "Polished, bright and warm. A brand-ad voice", sample: "/voices/bella.mp3" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", key: "alice", name: "Alice", tagline: "Clear and engaging. Made for explaining things", sample: "/voices/alice.mp3" },
  { id: "nPczCjzI2devNBz1zQrb", key: "brian", name: "Brian", tagline: "Deep, resonant and comforting. A classic narrator", sample: "/voices/brian.mp3" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", key: "liam", name: "Liam", tagline: "Energetic. Sounds like a social media creator", sample: "/voices/liam.mp3" },
  { id: "FGY2WhTYpPnrIDTdsKH5", key: "laura", name: "Laura", tagline: "Upbeat with a quirky edge. A casual, UGC feel", sample: "/voices/laura.mp3" }
];

export const voiceById = (id: string | undefined) => VOICES.find((v) => v.id === id);
