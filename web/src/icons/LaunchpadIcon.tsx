type Props = {
  size?: number;
  className?: string;
};

/**
 * 「App」启动台图标（参考截图）：
 * 白色圆角方块 + 内嵌深灰圆角面板 + 彩色小圆点网格。
 */
export function LaunchpadIcon({ size = 48, className = "" }: Props) {
  const dots = [
    ["#ff5f57", "#ffbd2e", "#28c840", "#0a84ff"],
    ["#bf5af2", "#64d2ff", "#ff375f", "#30d158"],
    ["#ff9f0a", "#5e5ce6", "#ffd60a", "#ff6482"],
  ];

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
        <linearGradient id="lp-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e9e9ee" />
        </linearGradient>
        <linearGradient id="lp-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b5b60" />
          <stop offset="1" stopColor="#3a3a3f" />
        </linearGradient>
      </defs>

      {/* 白色圆角底 */}
      <rect x="1" y="1" width="46" height="46" rx="11" fill="url(#lp-bg)" />
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="10.5"
        fill="none"
        stroke="rgba(0,0,0,0.1)"
        strokeWidth="1"
      />

      {/* 深灰内面板 */}
      <rect x="9" y="12" width="30" height="24" rx="6" fill="url(#lp-panel)" />
      <rect
        x="9.5"
        y="12.5"
        width="29"
        height="23"
        rx="5.5"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="1"
      />
      {/* 面板顶部长条（细节） */}
      <rect x="13" y="16" width="10" height="3" rx="1.5" fill="rgba(255,255,255,0.75)" />

      {/* 彩色圆点网格 */}
      {dots.map((row, r) =>
        row.map((color, c) => (
          <circle
            key={`${r}-${c}`}
            cx={15 + c * 6.2}
            cy={23 + r * 4.6}
            r="1.9"
            fill={color}
          />
        )),
      )}
    </svg>
  );
}
