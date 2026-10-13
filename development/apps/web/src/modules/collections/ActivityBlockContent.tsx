import { useEffect, useState } from 'react';
import type { ActivityContentBlock, ActivityWorkspaceAsset } from '@freebbs-development/contracts';
import type { ApiClient } from '../../core/api/client.js';

function ProtectedMedia({
  block,
  asset,
  client,
}: {
  block: ActivityContentBlock;
  asset: ActivityWorkspaceAsset;
  client: Pick<ApiClient, 'download'>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    client.download(asset.url).then(
      (blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.url, client, attempt]);
  return (
    <figure className="activity-media">
      {url ? (
        block.kind === 'image' ? (
          <img src={url} alt={block.caption || asset.name} />
        ) : (
          <video src={url} controls preload="metadata" aria-label={block.caption || asset.name} />
        )
      ) : error ? (
        <div className="activity-media-placeholder">
          媒体暂时无法加载。
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            重试
          </button>
        </div>
      ) : (
        <div className="activity-media-placeholder" role="status">
          正在加载媒体…
        </div>
      )}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}
export function ActivityBlockContent({
  blocks,
  assets,
  client,
}: {
  blocks: ActivityContentBlock[];
  assets: ActivityWorkspaceAsset[];
  client: Pick<ApiClient, 'download'>;
}) {
  return (
    <div className="activity-block-content">
      {blocks.map((block) => {
        if (block.kind === 'heading') return <h3 key={block.id}>{block.text}</h3>;
        if (block.kind === 'paragraph') return <p key={block.id}>{block.text}</p>;
        const asset = assets.find((item) => item.id === block.assetId);
        return asset ? (
          <ProtectedMedia key={block.id} block={block} asset={asset} client={client} />
        ) : (
          <p key={block.id} className="activity-muted">
            媒体暂时不可用。
          </p>
        );
      })}
    </div>
  );
}
