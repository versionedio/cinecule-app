// How background music sits under the narration. Kept apart from render.mjs so it can be tested with plain ffmpeg.

// The music tracks the app offers (public/music/<id>.mp3). The film's music_id must be one of these.
export const MUSIC_IDS = ["upbeat", "calm", "cinematic", "corporate", "playful", "chill"];

export const MUSIC = {
  GAIN: 0.4, // music level in the gaps, relative to the track (tracks are levelled to -18 LUFS)
  FADE_IN: 1.5, // seconds
  FADE_OUT: 2.5,
  // The music drops while the narrator speaks and swells back in the gaps. Thresholds are linear amplitude.
  DUCK_THRESHOLD: 0.03,
  DUCK_RATIO: 4,
  DUCK_ATTACK_MS: 20,
  DUCK_RELEASE_MS: 600
};

/** The music file for a film, or null when it has none (or an id the app does not offer). */
export function musicFileFor(musicId, dir) {
  return MUSIC_IDS.includes(musicId) ? `${dir.replace(/\/$/, "")}/${musicId}.mp3` : null;
}

/**
 * ffmpeg filters that add the music, which loops to cover the whole film.
 *   speechLabel: the label of the narration + sound-effects mix (null when the film has no other audio)
 *   musicIndex:  the ffmpeg input number of the music (opened with `-stream_loop -1`)
 *   seconds:     the film's length
 * Returns { filters, out } where `out` is the label of the final audio.
 */
export function musicFilters({ speechLabel, musicIndex, seconds }) {
  const fadeOutAt = Math.max(0, seconds - MUSIC.FADE_OUT);
  const bed = `[${musicIndex}:a]aresample=44100,atrim=duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS,volume=${MUSIC.GAIN},afade=t=in:st=0:d=${MUSIC.FADE_IN},afade=t=out:st=${fadeOutAt.toFixed(3)}:d=${MUSIC.FADE_OUT}`;
  if (!speechLabel) return { filters: [`${bed}[aout]`], out: "[aout]" };
  return {
    filters: [
      `${bed}[bg]`,
      `${speechLabel}asplit=2[speech][key]`,
      `[bg][key]sidechaincompress=threshold=${MUSIC.DUCK_THRESHOLD}:ratio=${MUSIC.DUCK_RATIO}:attack=${MUSIC.DUCK_ATTACK_MS}:release=${MUSIC.DUCK_RELEASE_MS}:makeup=1[ducked]`,
      "[speech][ducked]amix=inputs=2:normalize=0:duration=longest[aout]"
    ],
    out: "[aout]"
  };
}
