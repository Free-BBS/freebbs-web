import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityContentBlock } from '@freebbs-development/contracts';
import { ActivityBlockEditor } from './ActivityBlockEditor.js';
function Editor({ onUpload }: { onUpload: Parameters<typeof ActivityBlockEditor>[0]['onUpload'] }) {
  const [blocks, setBlocks] = useState<ActivityContentBlock[]>([
    { id: 'a', kind: 'paragraph', text: '第一段', assetId: null, caption: '' },
    { id: 'b', kind: 'heading', text: '第二节', assetId: null, caption: '' },
  ]);
  return (
    <ActivityBlockEditor blocks={blocks} assets={[]} onChange={setBlocks} onUpload={onUpload} />
  );
}
describe('activity block authoring', () => {
  it('keeps written content while moving, adding and removing sections', () => {
    render(<Editor onUpload={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('段落内容 1'), { target: { value: '我的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '下移内容 1' }));
    expect(screen.getByLabelText('段落内容 2')).toHaveValue('我的草稿');
    fireEvent.click(screen.getByRole('button', { name: '＋ 视频' }));
    expect(screen.getByLabelText('上传视频 3')).toHaveAttribute('accept', '.mp4,.webm,.mov');
    fireEvent.click(screen.getByRole('button', { name: '删除内容 1' }));
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('我的草稿');
  });
  it('preserves all draft sections when an upload fails', async () => {
    render(
      <Editor
        onUpload={vi.fn(async () => {
          throw new Error('连接中断');
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '＋ 图片' }));
    fireEvent.change(screen.getByLabelText('上传图片 3'), {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    expect(screen.getByLabelText('段落内容 1')).toHaveValue('第一段');
    expect(screen.getByLabelText('上传图片 3')).toBeEnabled();
  });
});
