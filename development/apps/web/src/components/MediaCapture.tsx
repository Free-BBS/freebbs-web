import { useEffect, useRef, useState } from 'react';

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_MS = 5 * 60 * 1000;
export function MediaCapture({
  kind,
  onFile,
  disabled = false,
}: {
  kind: 'audio' | 'video';
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'ready'>('idle');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const mounted = useRef(true);
  const generation = useRef(0);
  const stream = useRef<MediaStream>();
  const recorder = useRef<MediaRecorder>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const live = useRef<HTMLVideoElement>(null);
  const label = kind === 'audio' ? '录音' : '录像';
  const supported =
    typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  function release() {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    if (live.current) live.current.srcObject = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (live.current && state === 'recording') live.current.srcObject = stream.current ?? null;
  }, [state]);
  async function start() {
    const attempt = ++generation.current;
    setError('');
    setFile(undefined);
    setState('requesting');
    try {
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === 'video',
      });
      if (!mounted.current || generation.current !== attempt) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = captured;
      const candidates =
        kind === 'audio'
          ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
          : ['video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
      const mimeType = candidates.find((mime) => MediaRecorder.isTypeSupported(mime));
      const current = new MediaRecorder(captured, mimeType ? { mimeType } : undefined);
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      let exceeded = false;
      current.ondataavailable = ({ data }) => {
        size += data.size;
        if (size > MAX_BYTES) {
          exceeded = true;
          if (current.state === 'recording') current.stop();
          return;
        }
        if (data.size) chunks.push(data);
      };
      current.onerror = () => {
        generation.current++;
        release();
        if (current.state === 'recording') current.stop();
        if (mounted.current) {
          setError('录制失败，请重新尝试或选择文件上传。');
          setState('idle');
        }
      };
      current.onstop = () => {
        release();
        if (!mounted.current || generation.current !== attempt) return;
        if (exceeded || !chunks.length) {
          setError(exceeded ? '录制文件超过100 MiB，请缩短录制时间。' : '未录到内容，请重试。');
          setState('idle');
          return;
        }
        const mime = current.mimeType || chunks[0]?.type || mimeType || `${kind}/webm`;
        const extension = mime.includes('mp4') ? 'mp4' : 'webm';
        setFile(
          new File(
            chunks,
            `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
            { type: mime },
          ),
        );
        setState('ready');
      };
      current.start(1000);
      setState('recording');
      timer.current = setTimeout(() => {
        if (current.state === 'recording') current.stop();
      }, MAX_DURATION_MS);
    } catch (cause) {
      release();
      if (!mounted.current || generation.current !== attempt) return;
      setState('idle');
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? '未获得麦克风或摄像头许可，可在浏览器设置中允许，或直接上传文件。'
          : '无法开始录制，请检查设备或直接上传文件。',
      );
    }
  }
  function cancel() {
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
    setFile(undefined);
    setState('idle');
  }
  if (!supported)
    return <p className="media-capture-note">此浏览器不支持直接录制，可以选择已有文件上传。</p>;
  return (
    <section className="media-capture" aria-label={`直接${label}`}>
      <div className="media-capture-actions">
        {(state === 'idle' || state === 'ready') && (
          <button type="button" disabled={disabled} onClick={() => void start()}>
            {state === 'ready' ? '重新' : '开始'}
            {label}
          </button>
        )}
        {state === 'requesting' && <span role="status">正在请求设备许可…</span>}
        {state === 'recording' && (
          <>
            <span role="status">● 录制中 · 最长5分钟</span>
            <button type="button" onClick={() => recorder.current?.stop()}>
              完成录制
            </button>
          </>
        )}
        {state !== 'idle' && (
          <button type="button" onClick={cancel}>
            取消
          </button>
        )}
        {state === 'ready' && file && (
          <button type="button" disabled={disabled} onClick={() => onFile(file)}>
            使用这段{label}
          </button>
        )}
      </div>
      {kind === 'video' && state === 'recording' && (
        <video ref={live} autoPlay muted playsInline aria-label="取景预览" />
      )}
      {preview &&
        (kind === 'video' ? (
          <video src={preview} controls playsInline />
        ) : (
          <audio src={preview} controls />
        ))}
      {error && <p role="alert">{error}</p>}
      <small>录制完成后可预览，再选择使用。录制并不会自动提交。</small>
    </section>
  );
}
