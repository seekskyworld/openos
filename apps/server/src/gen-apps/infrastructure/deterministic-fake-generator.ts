import type {
  ContinuePortInput,
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";
import type { UntrustedArtifact, UntrustedSuggestion } from "../domain.js";

/**
 * Tracer 1 用确定性 fake：
 * - suggest 按 query 派生 N 个不同名字/图标的候选
 * - generate 固定产出一个安全计算器制品
 * 无网络、无模型依赖；接口与 LLM adapter 完全一致。
 */

const SUGGESTION_POOL: Array<{
  suffix: string;
  emoji: string;
  theme: string;
  desc: string;
}> = [
  { suffix: "计算器", emoji: "🧮", theme: "orange", desc: "四则运算与百分比" },
  { suffix: "记事本", emoji: "📝", theme: "blue", desc: "快速记录想法" },
  { suffix: "计时器", emoji: "⏱️", theme: "green", desc: "倒计时与秒表" },
  { suffix: "清单", emoji: "✅", theme: "teal", desc: "待办与勾选" },
  { suffix: "转换器", emoji: "🔁", theme: "purple", desc: "单位换算" },
  { suffix: "取色器", emoji: "🎨", theme: "pink", desc: "颜色预览与代码" },
  { suffix: "骰子", emoji: "🎲", theme: "red", desc: "随机决策" },
  { suffix: "白板", emoji: "🖊️", theme: "graphite", desc: "自由涂写" },
];

const CALCULATOR_HTML = `<!DOCTYPE html>
<html><body>
<style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #1c1c1e; display: grid; place-items: center; min-height: 100vh; }
  .calc { width: 240px; border-radius: 16px; overflow: hidden; background: #000; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
  .screen { color: #fff; font-size: 34px; text-align: right; padding: 20px 16px 10px; min-height: 44px; word-break: break-all; }
  .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 10px; }
  button { border: 0; border-radius: 999px; height: 48px; font-size: 19px; cursor: pointer; background: #333; color: #fff; }
  button.op { background: #ff9f0a; }
  button.fn { background: #a5a5a5; color: #000; }
  button.zero { grid-column: span 2; }
</style>
<div class="calc">
  <div class="screen" id="screen">0</div>
  <div class="keys" id="keys"></div>
</div>
<script>
  const screen = document.getElementById('screen');
  let expr = '';
  const keys = [
    ['AC','fn'],['+/-','fn'],['%','fn'],['÷','op'],
    ['7',''],['8',''],['9',''],['×','op'],
    ['4',''],['5',''],['6',''],['-','op'],
    ['1',''],['2',''],['3',''],['+','op'],
    ['0','zero'],['.',''],['=','op'],
  ];
  const holder = document.getElementById('keys');
  for (const [label, cls] of keys) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => press(label));
    holder.appendChild(b);
  }
  function evalExpr(s) {
    const tokens = s.replace(/×/g, '*').replace(/÷/g, '/');
    if (!/^[-+*/.%\\d\\s]+$/.test(tokens)) return 'Err';
    try {
      const fn = new Function('return (' + tokens + ')');
      const v = fn();
      return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : 'Err';
    } catch { return 'Err'; }
  }
  function press(k) {
    if (k === 'AC') { expr = ''; screen.textContent = '0'; return; }
    if (k === '=') { expr = evalExpr(expr); screen.textContent = expr || '0'; return; }
    if (k === '+/-') { expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr; screen.textContent = expr || '0'; return; }
    if (k === '%') { const v = evalExpr(expr); expr = v === 'Err' ? '' : String(Number(v) / 100); screen.textContent = expr || '0'; return; }
    expr += k;
    screen.textContent = expr;
  }
</script>
</body></html>`;

export class DeterministicFakeGenerator implements GenAppGenerator {
  async suggest(
    input: SuggestPortInput,
    _signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]> {
    const base = input.query.trim();
    return SUGGESTION_POOL.slice(0, input.count).map((item) => ({
      name: `${base}${item.suffix}`,
      description: item.desc,
      iconEmoji: item.emoji,
      iconTheme: item.theme,
    }));
  }

  async generate(
    input: GeneratePortInput,
    _signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
    // 模拟流式：分块吐出，前端可离线验证渐进渲染
    if (input.onDelta) {
      input.onPhase?.({ phase: "generating" });
      const CHUNK = 400;
      for (let i = 0; i < CALCULATOR_HTML.length; i += CHUNK) {
        input.onDelta(CALCULATOR_HTML.slice(i, i + CHUNK));
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    return {
      html: CALCULATOR_HTML,
      provider: "fake",
      model: "deterministic-v1",
    };
  }

  async continueContent(
    input: ContinuePortInput,
    _signal: AbortSignal,
  ): Promise<string> {
    return [
      `<div style="padding:16px;font-family:-apple-system,system-ui,sans-serif">`,
      `<h3 style="margin:0 0 8px">Fake ${input.intent}</h3>`,
      `<p>确定性 fake 片段：${input.prompt.slice(0, 80)}</p>`,
      `<a data-href="fake://next">继续跳转</a>`,
      `</div>`,
    ].join("");
  }
}
