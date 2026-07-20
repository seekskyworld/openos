import type { GenAppLaunchBundle, GenAppSummary } from "@openos/shared";
import type { GenAppRepository } from "./ports.js";

/** 已安装目录与 draft 生命周期；不依赖生成器或运行时会话。 */
export class GenAppCatalogService {
  constructor(
    private readonly repository: GenAppRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  install(draftId: string): GenAppSummary {
    return this.repository.install(draftId, this.now());
  }

  list(): GenAppSummary[] {
    this.repository.discardExpiredDrafts(this.now());
    return this.repository.listInstalled();
  }

  launch(appId: string): GenAppLaunchBundle {
    return this.repository.loadAndTouch(appId, this.now());
  }

  remove(appId: string): void {
    this.repository.remove(appId);
  }
}
