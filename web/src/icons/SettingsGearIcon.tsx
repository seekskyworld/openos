type Props = {
  /** 图标边长（px） */
  size?: number;
  className?: string;
};

/**
 * macOS System Settings 风格图标：
 * 深灰圆角方块底 + 立体银色齿轮（渐变、内孔、轴帽）。
 * 纯 SVG 绘制，可任意缩放复用。
 */
export function SettingsGearIcon({ size = 48, className = "" }: Props) {
  // 生成齿轮外齿路径：teeth 个梯形齿均匀分布
  const teeth = 8;
  const cx = 24;
  const cy = 24;
  const rOuter = 16.5; // 齿顶
  const rRoot = 13.2; // 齿根
  const toothHalf = (Math.PI * 2) / teeth / 3.1; // 齿宽（弧度的一半）

  const points: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const center = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const a0 = center - toothHalf * 1.45;
    const a1 = center - toothHalf * 0.8;
    const a2 = center + toothHalf * 0.8;
    const a3 = center + toothHalf * 1.45;
    points.push(
      `${cx + rRoot * Math.cos(a0)},${cy + rRoot * Math.sin(a0)}`,
      `${cx + rOuter * Math.cos(a1)},${cy + rOuter * Math.sin(a1)}`,
      `${cx + rOuter * Math.cos(a2)},${cy + rOuter * Math.sin(a2)}`,
      `${cx + rRoot * Math.cos(a3)},${cy + rRoot * Math.sin(a3)}`,
    );
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="sg-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c7c82" />
          <stop offset="0.5" stopColor="#535358" />
          <stop offset="1" stopColor="#2f2f33" />
        </linearGradient>
        <linearGradient id="sg-gear" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fafafc" />
          <stop offset="0.45" stopColor="#d9d9de" />
          <stop offset="1" stopColor="#a8a8b0" />
        </linearGradient>
        <linearGradient id="sg-hub" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a8a90" />
          <stop offset="1" stopColor="#3c3c41" />
        </linearGradient>
        <radialGradient id="sg-sheen" cx="0.5" cy="0" r="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 深灰圆角方块底 */}
      <rect x="1" y="1" width="46" height="46" rx="11" fill="url(#sg-bg)" />
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="10.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />
      {/* 顶部弧光 */}
      <rect x="1" y="1" width="46" height="24" rx="11" fill="url(#sg-sheen)" />

      {/* 齿轮阴影 */}
      <polygon
        points={points.join(" ")}
        fill="rgba(0,0,0,0.35)"
        transform="translate(0 1.2)"
      />
      {/* 齿轮本体（齿 + 环，通过中孔 fill-rule 抠洞） */}
      <path
        d={`M ${points.join(" L ")} Z M ${cx} ${cy - 6.4} A 6.4 6.4 0 1 0 ${cx} ${cy + 6.4} A 6.4 6.4 0 1 0 ${cx} ${cy - 6.4} Z`}
        fill="url(#sg-gear)"
        fillRule="evenodd"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="0.5"
      />
      {/* 内孔阴影圈 */}
      <circle
        cx={cx}
        cy={cy}
        r="6.4"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="1"
      />
      {/* 中央轴帽 */}
      <circle cx={cx} cy={cy} r="4.1" fill="url(#sg-hub)" />
      <circle
        cx={cx}
        cy={cy}
        r="4.1"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.6"
      />
      <ellipse cx={cx - 1.2} cy={cy - 1.6} rx="1.8" ry="1.1" fill="rgba(255,255,255,0.28)" />
    </svg>
  );
}
