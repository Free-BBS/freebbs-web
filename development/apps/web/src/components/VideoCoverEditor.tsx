import { useEffect, useRef, useState } from 'react';
import { captureVideoCover } from './video-cover.js';

export function VideoCoverEditor({
  file,
  onCover,
}: {
  file: File;
  onCover?: (file: File) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [cover, setCover] = useState<File>();
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setDuration(0);
    setTime(0);
    setCover(undefined);
    setError('');
    setFrameReady(false);
    setWorking(false);
    const current = URL.createObjectURL(file);
    setUrl(current);
    return () => {
      generation.current++;
      URL.revokeObjectURL(current);
    };
  }, [file]);
  useEffect(() => {
    if (!cover) {
      setCoverUrl('');
      return;
    }
    const current = URL.createObjectURL(cover);
    setCoverUrl(current);
    return () => URL.revokeObjectURL(current);
  }, [cover]);
  async function generate() {
    if (!video.current) return;
    const attempt = generation.current;
    setWorking(true);
    setError('');
    try {
      const result = await captureVideoCover(video.current, file.name, aspect);
      if (attempt === generation.current) setCover(result);
    } catch (cause) {
      if (attempt === generation.current)
        setError(cause instanceof Error ? cause.message : '封面生成失败');
    } finally {
      if (attempt === generation.current) setWorking(false);
    }
  }
  return (
    <section className="video-cover-editor" aria-label="视频封面">
      <div>
        <strong>选择封面画面</strong>
        <small>拖动时间滑块，截取当前画面；竖屏素材会居中裁剪。</small>
      </div>
      <video
        ref={video}
        src={url}
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={() =>
          setDuration(Number.isFinite(video.current?.duration) ? video.current!.duration : 0)
        }
        onDurationChange={() =>
          setDuration(Number.isFinite(video.current?.duration) ? video.current!.duration : 0)
        }
        onLoadedData={() => setFrameReady(true)}
        onTimeUpdate={() => setTime(video.current?.currentTime ?? 0)}
        onError={() => setError('视频无法预览，可尝试MP4格式。')}
      />
      <label>
        画面位置 · {time.toFixed(1)}秒
        <input
          aria-label="封面时间"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={time}
          disabled={!duration}
          onChange={(event) => {
            const next = Number(event.target.value);
            setTime(next);
            if (video.current) video.current.currentTime = next;
          }}
        />
      </label>
      <label>
        封面比例
        <select
          value={aspect}
          onChange={(event) => {
            setAspect(Number(event.target.value));
            setCover(undefined);
          }}
        >
          <option value={16 / 9}>横版 16:9</option>
          <option value={1}>方形 1:1</option>
          <option value={3 / 4}>竖版 3:4</option>
        </select>
      </label>
      <button type="button" disabled={!frameReady || working} onClick={() => void generate()}>
        {working ? '生成中…' : '截取封面'}
      </button>
      {coverUrl && (
        <div>
          <img src={coverUrl} alt="截取的封面" />
          <a href={coverUrl} download={cover?.name}>
            下载封面
          </a>
          {onCover && cover && (
            <button type="button" onClick={() => onCover(cover)}>
              使用这张封面
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
