import { Copy, Download, RefreshCw, X } from 'lucide-react';

export function RecommendationPosterModal({ poster, onClose, onRegenerate }) {
  if (!poster.open) return null;

  const copyImage = async () => {
    if (!poster.blob || !navigator.clipboard || !window.ClipboardItem) return;
    await navigator.clipboard.write([new ClipboardItem({ [poster.blob.type]: poster.blob })]);
  };

  return (
    <div className="poster-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="poster-modal"
        role="dialog"
        aria-modal="true"
        aria-label="今日推荐图片"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="poster-modal-head">
          <div>
            <span>{poster.meta?.title ?? '今日推荐'}</span>
            <strong>{poster.meta?.dayLabel ?? '推荐图片'}</strong>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="poster-preview-frame">
          {poster.status === 'generating' && <div className="poster-loading">正在生成传播图...</div>}
          {poster.error && <div className="poster-error">{poster.error}</div>}
          {poster.imageUrl && <img src={poster.imageUrl} alt="世界杯今日推荐传播图" />}
        </div>

        <div className="poster-modal-actions">
          <button type="button" className="secondary-action" onClick={onRegenerate} disabled={poster.status === 'generating'}>
            <RefreshCw size={15} />
            <span>重新生成</span>
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={copyImage}
            disabled={!poster.blob || !navigator.clipboard || !window.ClipboardItem}
          >
            <Copy size={15} />
            <span>复制图片</span>
          </button>
          <a className="primary-action" href={poster.imageUrl || undefined} download={poster.fileName || 'today-recommendation.png'}>
            <Download size={15} />
            <span>下载 PNG</span>
          </a>
        </div>
      </section>
    </div>
  );
}
