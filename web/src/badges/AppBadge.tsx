type Props = {
  count: number;
  /** 超过上限显示 99+ */
  max?: number;
};

/**
 * macOS 风格红色数字角标；count<=0 时不渲染。
 * 挂在任意 position:relative 的图标容器右上角。
 */
export function AppBadge({ count, max = 99 }: Props) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const label = count > max ? `${max}+` : String(count);
  return (
    <span className="app-badge" aria-label={`${count} notifications`}>
      {label}
    </span>
  );
}
