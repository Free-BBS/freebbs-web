// Preserve the submitted player and use its existing controls for muted playback.
export function prepareAudiovisualPlayer(source) {
  const replace = (before, after) => {
    if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) {
      throw new Error('The submitted audiovisual player changed; review its playback controls.');
    }
    source = source.replace(before, after);
  };
  replace(
    'audio.volume = Number(volumes[0].value);',
    `let lastAudibleVolume = Number(volumes[0].value) || 0.7;
  audio.volume = lastAudibleVolume;
  audio.defaultMuted = true;
  audio.muted = true;`,
  );
  replace('volume.value = audio.volume;', 'volume.value = audio.muted ? 0 : audio.volume;');
  replace(
    'volume.setAttribute("aria-valuetext", `${Math.round(audio.volume * 100)}%`);',
    'volume.setAttribute("aria-valuetext", audio.muted ? "静音" : `${Math.round(audio.volume * 100)}%`);',
  );
  replace(
    'audio.volume = Number(volume.value);\n    update();',
    `audio.volume = Number(volume.value);
    audio.muted = audio.volume === 0;
    if (audio.volume > 0) lastAudibleVolume = audio.volume;
    blocked = false;
    syncPlayback();
    update();`,
  );
  replace(
    'audio.muted = !audio.muted;\n    update();',
    `audio.muted = !audio.muted;
    if (!audio.muted && audio.volume === 0) audio.volume = lastAudibleVolume;
    blocked = false;
    syncPlayback();
    update();`,
  );
  replace(
    '!audio.paused ? "正在播放" : "已暂停";',
    '!audio.paused ? audio.muted ? "静音播放" : "正在播放" : "已暂停";',
  );
  replace(
    '// 默认尝试有声播放；受策略限制时等待交互，静音视频继续自动播放。',
    '// 音乐默认静音播放，由原播放器音量控件开启声音；静音视频按原逻辑播放。',
  );
  return source;
}

export function prepareAudiovisualMedia(source) {
  return source.replace(/<audio\b(?=[^>]*\bdata-player-audio\b)([^>]*)>/i, (tag, attributes) => {
    const muted = /\s+muted(?:\s|=|$)/i.test(attributes) ? tag : `<audio muted${attributes}>`;
    return muted.replace(/[ \t]+(?=\r?\n)/g, '');
  });
}
