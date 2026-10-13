import React, { useEffect, useRef, useState } from 'react';
import type { FlowDataset } from '../../lib/center/centerFlowService';
import { flowParticles, fmtInt, sankeyLayout, type FlowSelection, type SankeyColors } from '../../lib/center/flowModel';

// Sơ đồ dải ba cột (SVG thuần, không thư viện): Nơi phát sinh → Nơi xử lý → Kết quả.
// Độ rộng dải = số lượt giao; màu dải cột cuối = kết quả; vạch đỏ cạnh phòng = phần việc đứng yên hôm nay.
// Chuyển động (tùy chọn, chủ SP 13/10): hạt là phần tử HTML đè lên sơ đồ, chạy bằng keyframe `transform` thuần (bộ tổng hợp GPU, không vẽ lại
// sơ đồ, không setInterval / rAF). SMIL animateMotion và lớp SVG riêng đều đo 26–39% CPU WebKit nên không dùng. Bật sẵn chỉ trên máy tính.

const W = 880;
const H = 560;

export const FlowSankey: React.FC<{
  data: FlowDataset;
  colors: SankeyColors;
  selection: FlowSelection | null;
  onSelect: (selection: FlowSelection | null) => void;
  /** Hạt chạy dọc dải. */
  motion?: boolean;
}> = ({ data, colors, selection, onSelect, motion = false }) => {
  const layout = sankeyLayout(data, W, H, colors);
  const particles = motion ? flowParticles(layout) : [];
  const wrapRef = useRef<HTMLDivElement>(null);
  // Tỷ lệ pixel / đơn vị viewBox để keyframe transform khớp sơ đồ ở mọi bề rộng.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / W));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const keyframes = particles.map((particle, index) => `@keyframes vflp${index}{${particle.points.map((pt, i) =>
    `${Math.round((i / (particle.points.length - 1)) * 1000) / 10}%{transform:translate(calc(${pt[0]} * var(--s) * 1px),calc(${pt[1]} * var(--s) * 1px))}`).join('')}}`).join('\n');
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => { setTip(null); }, [data]);
  if (layout.empty) return <p className="vfl-empty">Chưa có lượt giao nào trong khoảng đã chọn.</p>;

  const isLinkSelected = (from: string, to: string, col: 0 | 1): boolean => {
    if (!selection) return false;
    if (selection.type === 'link') return selection.from === from && selection.to === to && col === 0;
    if (selection.type === 'unit') return from === selection.id || to === selection.id;
    if (selection.type === 'outcome') return col === 1 && to === selection.id;
    return false;
  };
  const isNodeSelected = (col: number, id: string): boolean =>
    !!selection && ((selection.type === 'unit' && selection.id === id && col < 2) || (selection.type === 'outcome' && selection.id === id && col === 2));
  const dim = !!selection && selection.type !== 'project';
  const showTip = (event: React.MouseEvent, text: string) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: Math.min(event.clientX - box.left + 12, box.width - 240), y: event.clientY - box.top + 14, text });
  };

  return (
    <div className="vfl-sankey" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sơ đồ dòng chảy công việc ${data.rangeDays} ngày`}>
        <text className="vfl-colhead" x={8} y={14}>NƠI PHÁT SINH · phòng của người giao</text>
        <text className="vfl-colhead" x={W / 2} y={14} textAnchor="middle">NƠI XỬ LÝ · phòng của người nhận</text>
        <text className="vfl-colhead" x={W - 8} y={14} textAnchor="end">KẾT QUẢ · {data.rangeDays} ngày</text>
        {layout.links.map(link => {
          const selected = isLinkSelected(link.from, link.to, link.col);
          return (
            <path
              key={link.key}
              className="vfl-link"
              d={link.d}
              fill={link.color}
              opacity={selected ? Math.min(1, link.opacity + 0.3) : dim && !selected ? 0.1 : link.opacity}
              onMouseMove={event => showTip(event, link.title)}
              onMouseLeave={() => setTip(null)}
              onClick={() => onSelect(link.col === 0 ? { type: 'link', from: link.from, to: link.to } : { type: 'outcome', id: link.to })}
            >
              <title>{link.title}</title>
            </path>
          );
        })}
        {layout.nodes.map(node => {
          const selected = isNodeSelected(node.col, node.id);
          const labelX = node.col === 2 ? node.x - 6 : node.x + layout.nodeWidth + 6;
          const anchor = node.col === 2 ? 'end' : 'start';
          const waitingText = node.col === 1 && node.waiting > 0 ? `${fmtInt(node.waiting)} đang chờ` : null;
          return (
            <g
              key={node.key}
              className="vfl-node"
              data-selected={selected || undefined}
              role="button"
              tabIndex={0}
              aria-label={`${node.full}: ${node.sub}${waitingText ? `, ${waitingText}` : ''}`}
              onClick={() => onSelect(node.col === 2 ? { type: 'outcome', id: node.id } : { type: 'unit', id: node.id })}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.col === 2 ? { type: 'outcome', id: node.id } : { type: 'unit', id: node.id }); } }}
              onMouseMove={event => showTip(event, `${node.full} · ${node.sub}${waitingText ? ` · ${waitingText}` : ''}`)}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={node.x} y={node.y} width={layout.nodeWidth} height={node.h} rx={3} fill={node.color} opacity={node.col === 2 ? 0.9 : 0.85}
                strokeDasharray={node.dashed ? '3 2' : undefined} />
              {node.stuckH > 0 && <rect x={node.x - 4} y={node.y} width={3} height={node.stuckH} fill={colors.stuck} rx={1} />}
              {node.small ? (
                <text className="vfl-label" x={labelX} y={node.ly} textAnchor={anchor}>
                  {node.label} <tspan className="vfl-label-n">· {node.col === 1 ? fmtInt(node.value) : node.sub}</tspan>
                  {waitingText && <tspan className="vfl-label-wait" data-stuck={node.stuck > 0 || undefined}> · {waitingText}</tspan>}
                </text>
              ) : (
                <>
                  <text className="vfl-label" x={labelX} y={node.ly} textAnchor={anchor}>{node.label}</text>
                  <text className="vfl-label-n" x={labelX} y={node.ly + 13} textAnchor={anchor}>
                    {node.sub}
                    {waitingText && <tspan className="vfl-label-wait" data-stuck={node.stuck > 0 || undefined}> · {waitingText}</tspan>}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {particles.length > 0 && (
        <div className="vfl-particles" style={{ '--s': scale } as React.CSSProperties} aria-hidden="true">
          <style>{keyframes}</style>
          {particles.map((particle, index) => (
            <span key={`p:${particle.key}`} className="vfl-particle" style={{ background: particle.color, animation: `vflp${index} ${particle.dur}s linear -${particle.begin}s infinite` }} />
          ))}
        </div>
      )}
      {tip && <div className="vfl-tip" style={{ left: tip.x, top: tip.y }} role="presentation">{tip.text}</div>}
    </div>
  );
};

export default FlowSankey;
