export function coverCrop(width: number, height: number, aspect: number) {
  if (![width, height, aspect].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('无法读取视频尺寸');
  const cropWidth = Math.min(width, height * aspect);
  const cropHeight = cropWidth / aspect;
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}
export async function captureVideoCover(
  video: HTMLVideoElement,
  name: string,
  aspect: number,
): Promise<File> {
  if (video.readyState < 2) throw new Error('请等待视频画面加载完成');
  const crop = coverCrop(video.videoWidth, video.videoHeight, aspect);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1280, Math.round(crop.width));
  canvas.height = Math.round(canvas.width / aspect);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持封面生成');
  context.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('封面生成失败'))),
      'image/jpeg',
      0.9,
    ),
  );
  return new File([blob], `${name.replace(/\.[^.]+$/, '').slice(0, 100)}-cover.jpg`, {
    type: 'image/jpeg',
  });
}
