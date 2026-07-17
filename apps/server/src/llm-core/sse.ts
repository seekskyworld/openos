/**
 * 极简 SSE 解析器（llm-core 内部使用）。
 * 只处理 LLM 流式响应需要的子集：event: / data: 行、多行 data 拼接、[DONE] 哨兵。
 */

export type SseEvent = {
  event?: string;
  data: string;
};

/**
 * 逐块喂入网络数据，按 SSE 规范切出事件。
 * 使用方式：const p = new SseParser(); for chunk → p.push(chunk) 返回完整事件数组。
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    // 事件以空行分隔；兼容 \r\n
    let sep: number;
    while ((sep = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
      const parsed = this.parseEvent(rawEvent);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** 流结束时冲刷残留（个别实现最后一个事件后无空行） */
  flush(): SseEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const parsed = this.parseEvent(rest);
    return parsed ? [parsed] : [];
  }

  private parseEvent(raw: string): SseEvent | null {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      // 其余字段（id:/retry:/注释行）忽略
    }
    if (dataLines.length === 0) return null;
    return { event, data: dataLines.join("\n") };
  }
}
