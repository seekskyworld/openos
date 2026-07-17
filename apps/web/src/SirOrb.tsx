import type { CSSProperties } from "react";

export type SirOrbSize = "hero" | "dock" | "avatar" | "badge" | number;

type Props = {
  size?: SirOrbSize;
  className?: string;
  /** 对话中等忙碌态：加快绽放节奏 */
  active?: boolean;
  /** 减弱动画 */
  calm?: boolean;
};

function resolveSize(size: SirOrbSize): number {
  if (typeof size === "number") return size;
  switch (size) {
    case "dock":
      return 46;
    case "avatar":
      return 22;
    case "badge":
      return 14;
    case "hero":
    default:
      return 128;
  }
}

/**
 * Siri 光球：
 * - 较小的深色玻璃球体，自身缓慢自转
 * - 表面流光（高光弧随球转动）+ 内部流光（彩色光带游走）
 * - 花瓣色块绽放 + 中央白核，同步 bloom 周期
 */
export function SirOrb({
  size = "hero",
  className = "",
  active = false,
  calm = false,
}: Props) {
  const px = resolveSize(size);
  const style = {
    "--sir-orb-size": `${px}px`,
  } as CSSProperties;

  const sizeToken =
    typeof size === "number"
      ? px <= 16
        ? "badge"
        : px <= 28
          ? "avatar"
          : px <= 56
            ? "dock"
            : "hero"
      : size;

  return (
    <span
      className={[
        "sir-glass-orb",
        `size-${sizeToken}`,
        active ? "is-active" : "",
        calm ? "is-calm" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-hidden
    >
      <span className="sir-glass-orb-glow" />
      <span className="sir-glass-orb-sphere">
        {/* 内部流光：彩色光带贴着球内壁游走 */}
        <span className="sir-inner-flow" />
        <span className="sir-inner-flow flow-b" />

        {/* 花瓣簇：bloom 绽放 */}
        <span className="sir-petal-field">
          <span className="sir-petal p-cyan" />
          <span className="sir-petal p-magenta" />
          <span className="sir-petal p-blue" />
          <span className="sir-petal p-green" />
          <span className="sir-petal p-pink" />
          <span className="sir-petal p-teal" />
        </span>

        {/* 中央白核 */}
        <span className="sir-glass-orb-core" />

        {/* 表面流光：高光弧随自转扫过球面 */}
        <span className="sir-surface-flow" />
        <span className="sir-glass-orb-specular" />
        <span className="sir-glass-orb-rim" />
      </span>
    </span>
  );
}
