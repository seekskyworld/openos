import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProviderAuthCatalogItem,
  ProviderAuthInfoPublic,
  ProviderAuthMethod,
  ProviderOauthAuthorizeResponse,
} from "@openos/shared";
import {
  activateProviderAuth,
  fetchProviderAuth,
  listLlmModels,
  oauthAuthorize,
  oauthCallback,
  removeProviderAuth,
  setProviderAuth,
} from "./api";
import { useI18n } from "./i18n";

type Props = {
  onChanged?: () => void;
};

/**
 * Connect 流程（对齐 OpenCode，并补上模型选择）：
 * methods → api|oauth → select-model → done
 */
type ConnectStep =
  | { kind: "closed" }
  | { kind: "methods"; item: ProviderAuthCatalogItem }
  | { kind: "api"; item: ProviderAuthCatalogItem; method: ProviderAuthMethod }
  | {
      kind: "oauth-pending";
      item: ProviderAuthCatalogItem;
      method: ProviderAuthMethod;
      auth: ProviderOauthAuthorizeResponse;
    }
  | {
      kind: "oauth-code";
      item: ProviderAuthCatalogItem;
      method: ProviderAuthMethod;
      auth: ProviderOauthAuthorizeResponse;
    }
  | {
      kind: "select-model";
      item: ProviderAuthCatalogItem;
      /** 刚完成的鉴权类型，仅展示 */
      authType: "api" | "oauth";
    }
  | { kind: "error"; item: ProviderAuthCatalogItem; message: string };

function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function typeLabel(type: string) {
  if (type === "oauth") return "OAuth";
  if (type === "api") return "API Key";
  if (type === "env") return "Environment";
  return type;
}

function modelOptionsFor(item: ProviderAuthCatalogItem): string[] {
  const list = item.suggestedModels?.length
    ? item.suggestedModels
    : item.defaultModel
      ? [item.defaultModel]
      : [];
  return [...new Set(list.filter(Boolean))];
}

export function ProvidersAuthApp({ onChanged }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(() => "…");
  const [connected, setConnected] = useState<ProviderAuthInfoPublic[]>([]);
  const [catalog, setCatalog] = useState<ProviderAuthCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [step, setStep] = useState<ConnectStep>({ kind: "closed" });
  const [apiKey, setApiKey] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [formError, setFormError] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const reload = useCallback(async () => {
    const data = await fetchProviderAuth();
    setConnected(data.connected);
    setCatalog(data.catalog);
    const active = data.connected.find((c) => c.activeModel);
    setStatus(
      active
        ? t("providers.status.current", { label: active.label, model: active.activeModel ?? "" })
        : data.connected.length
          ? t("providers.status.connectedNoModel", { count: data.connected.length })
          : t("providers.status.none"),
    );
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : t("custom.status.loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const popular = useMemo(() => {
    const connectedIds = new Set(connected.map((c) => c.providerId));
    return catalog.filter((c) => c.popular && !connectedIds.has(c.providerId));
  }, [catalog, connected]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    const connectedIds = new Set(connected.map((c) => c.providerId));
    return catalog
      .filter((c) => !connectedIds.has(c.providerId))
      .filter(
        (c) =>
          !q ||
          c.providerId.includes(q) ||
          c.label.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q),
      );
  }, [catalog, connected, query]);

  function catalogItemFor(providerId: string): ProviderAuthCatalogItem | undefined {
    return catalog.find((c) => c.providerId === providerId);
  }

  function goSelectModel(item: ProviderAuthCatalogItem, authType: "api" | "oauth") {
    const options = modelOptionsFor(item);
    setSelectedModel(item.defaultModel || options[0] || "");
    setFormError("");
    setRemoteModels([]);
    setStep({ kind: "select-model", item, authType });
    setBusyId(null);
  }

  /** 选模型时从厂商端点拉取真实模型列表 */
  async function fetchRemoteModels(item: ProviderAuthCatalogItem) {
    if (fetchingModels) return;
    setFetchingModels(true);
    setFormError("");
    try {
      const result = await listLlmModels({ provider: item.providerId as never });
      if (!result.ok) {
        setFormError(
          t("connect.model.fetchFailed", { code: result.error?.code ?? "error", message: result.error?.message ?? "?" }),
        );
        return;
      }
      const ids = result.models.map((m) => m.id).filter(Boolean);
      setRemoteModels(ids);
      if (!ids.length) {
        setFormError(t("connect.model.fetchEmpty"));
      } else if (!ids.includes(selectedModel)) {
        // 默认选第一个真实模型
        setSelectedModel(ids[0]);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("connect.model.fetchFailed", { code: "error", message: "?" }));
    } finally {
      setFetchingModels(false);
    }
  }

  async function disconnect(providerId: string, name: string) {
    if (busyId) return;
    setBusyId(providerId);
    try {
      const data = await removeProviderAuth({ providerId });
      setConnected(data.connected);
      setCatalog(data.catalog);
      setStatus(t("providers.status.disconnected", { name }));
      onChanged?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("providers.status.disconnectFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function startConnect(item: ProviderAuthCatalogItem) {
    setApiKey("");
    setOauthCode("");
    setSelectedModel(item.defaultModel || modelOptionsFor(item)[0] || "");
    setFormError("");
    if (item.methods.length === 1) {
      void selectMethod(item, item.methods[0], 0);
      return;
    }
    setStep({ kind: "methods", item });
  }

  /** 已连接提供商：直接改模型 / 激活 */
  function changeModel(item: ProviderAuthCatalogItem) {
    setFormError("");
    setSelectedModel(
      item.connectedInfo?.activeModel ||
        item.defaultModel ||
        modelOptionsFor(item)[0] ||
        "",
    );
    setStep({
      kind: "select-model",
      item,
      authType: item.connectedInfo?.type === "oauth" ? "oauth" : "api",
    });
  }

  async function selectMethod(
    item: ProviderAuthCatalogItem,
    method: ProviderAuthMethod,
    index: number,
  ) {
    setFormError("");
    if (method.type === "api") {
      setStep({ kind: "api", item, method });
      return;
    }

    setBusyId(item.providerId);
    setStep({
      kind: "oauth-pending",
      item,
      method,
      auth: {
        url: "",
        method: "auto",
        instructions: t("connect.oauth.preparing"),
        state: "",
      },
    });
    try {
      const auth = await oauthAuthorize({
        providerId: item.providerId,
        method: index,
      });
      if (auth.url) openUrl(auth.url);
      if (auth.method === "code") {
        setStep({ kind: "oauth-code", item, method, auth });
        setBusyId(null);
        return;
      }

      setStep({ kind: "oauth-pending", item, method, auth });
      void (async () => {
        try {
          const result = await oauthCallback({
            providerId: item.providerId,
            method: index,
            state: auth.state,
          });
          if (!result.ok) {
            setStep({
              kind: "error",
              item,
              message: result.error?.message || t("connect.oauth.error"),
            });
            return;
          }
          // 授权成功 → 选模型
          goSelectModel(item, "oauth");
        } catch (error) {
          setStep({
            kind: "error",
            item,
            message: error instanceof Error ? error.message : t("connect.oauth.error"),
          });
        } finally {
          setBusyId(null);
        }
      })();
    } catch (error) {
      setStep({
        kind: "error",
        item,
        message: error instanceof Error ? error.message : t("connect.oauth.startFailed"),
      });
      setBusyId(null);
    }
  }

  async function submitApiKey() {
    if (step.kind !== "api") return;
    if (!apiKey.trim()) {
      setFormError(t("connect.api.required"));
      return;
    }
    setBusyId(step.item.providerId);
    setFormError("");
    try {
      // 只保存凭证，不激活；下一步选模型
      await setProviderAuth({
        providerId: step.item.providerId,
        type: "api",
        key: apiKey.trim(),
        activate: false,
      });
      await reload();
      goSelectModel(step.item, "api");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("connect.api.failed"));
      setBusyId(null);
    }
  }

  async function submitOauthCode() {
    if (step.kind !== "oauth-code") return;
    if (!oauthCode.trim()) {
      setFormError(t("connect.oauth.codeRequired"));
      return;
    }
    setBusyId(step.item.providerId);
    setFormError("");
    try {
      const result = await oauthCallback({
        providerId: step.item.providerId,
        code: oauthCode.trim(),
        state: step.auth.state,
      });
      if (!result.ok) {
        setFormError(result.error?.message || t("connect.oauth.failed"));
        setBusyId(null);
        return;
      }
      await reload();
      goSelectModel(step.item, "oauth");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("connect.oauth.failed"));
      setBusyId(null);
    }
  }

  async function submitModel() {
    if (step.kind !== "select-model") return;
    const model = selectedModel.trim();
    if (!model) {
      setFormError(t("connect.model.required"));
      return;
    }
    setBusyId(step.item.providerId);
    setFormError("");
    try {
      const data = await activateProviderAuth({
        providerId: step.item.providerId,
        model,
      });
      setConnected(data.connected);
      setCatalog(data.catalog);
      setStep({ kind: "closed" });
      setStatus(t("providers.status.current", { label: step.item.label, model }));
      onChanged?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("connect.model.activateFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const modelChoices =
    step.kind === "select-model"
      ? [...new Set([...remoteModels, ...modelOptionsFor(step.item)])]
      : [];

  return (
    <div className="providers-auth">
      <header className="providers-auth-header">
        <div>
          <h2>{t("providers.title")}</h2>
          <p className="settings-subtitle">{status}</p>
          <p className="providers-flow-hint">{t("providers.flowHint")}</p>
        </div>
      </header>

      {loading ? (
        <div className="settings-loading">{t("common.loading")}</div>
      ) : (
        <>
          <section className="providers-section">
            <h3 className="providers-section-title">{t("providers.connected")}</h3>
            <div className="providers-list">
              {connected.length === 0 ? (
                <div className="providers-empty">
                  {t("providers.empty")}
                </div>
              ) : (
                connected.map((item) => {
                  const cat = catalogItemFor(item.providerId);
                  return (
                    <div key={item.providerId} className="providers-row">
                      <div className="providers-lead">
                        <span className="providers-avatar">
                          {item.label.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="providers-copy">
                          <div className="providers-main">
                            <span className="providers-name">{item.label}</span>
                            <span className="providers-tag">
                              {typeLabel(item.type)}
                            </span>
                            {item.activeModel ? (
                              <span className="providers-tag active-model">
                                {item.activeModel}
                              </span>
                            ) : (
                              <span className="providers-tag muted">{t("providers.noModel")}</span>
                            )}
                          </div>
                          <p className="providers-desc mono">{item.preview}</p>
                        </div>
                      </div>
                      <div className="providers-row-actions">
                        {cat ? (
                          <button
                            type="button"
                            className="btn-connect"
                            disabled={busyId === item.providerId}
                            onClick={() => changeModel(cat)}
                          >
                            {item.activeModel ? t("providers.changeModel") : t("providers.selectModel")}
                          </button>
                        ) : null}
                        {item.source === "env" ? (
                          <span className="providers-env-hint">{t("providers.env")}</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busyId === item.providerId}
                            onClick={() =>
                              void disconnect(item.providerId, item.label)
                            }
                          >
                            {t("common.disconnect")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="providers-section">
            <h3 className="providers-section-title">{t("providers.popular")}</h3>
            <div className="providers-list">
              {popular.map((item) => (
                <div key={item.providerId} className="providers-row">
                  <div className="providers-lead">
                    <span className="providers-avatar">
                      {item.label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="providers-copy">
                      <div className="providers-main">
                        <span className="providers-name">{item.label}</span>
                        {item.methods.some((m) => m.type === "oauth") ? (
                          <span className="providers-tag">OAuth</span>
                        ) : null}
                      </div>
                      {item.description ? (
                        <p className="providers-desc">{item.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-connect"
                    disabled={busyId === item.providerId}
                    onClick={() => startConnect(item)}
                  >
                    + {t("common.connect")}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="providers-section">
            <div className="providers-section-head">
              <h3 className="providers-section-title">{t("providers.all")}</h3>
              <input
                className="providers-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
placeholder={t("providers.search.placeholder")}
              />
            </div>
            <div className="providers-list">
              {filteredCatalog.map((item) => (
                <div key={item.providerId} className="providers-row">
                  <div className="providers-lead">
                    <span className="providers-avatar sm">
                      {item.label.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="providers-copy">
                      <div className="providers-main">
                        <span className="providers-name">{item.label}</span>
                        <span className="providers-tag muted">{item.category}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-connect"
                    disabled={busyId === item.providerId}
                    onClick={() => startConnect(item)}
                  >
                    {t("common.connect")}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {step.kind !== "closed" ? (
        <div className="connect-modal-backdrop" role="presentation">
          <div className="connect-modal" role="dialog" aria-modal="true">
            <div className="connect-modal-header">
              <div>
                <div className="connect-modal-kicker">
                  {step.kind === "select-model"
                    ? t("connect.kicker.selectModel")
                    : t("connect.kicker")}
                </div>
                <h3>{"item" in step ? step.item.label : "Provider"}</h3>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setStep({ kind: "closed" });
                  setBusyId(null);
                }}
              >
                {t("common.close")}
              </button>
            </div>

            {step.kind === "methods" ? (
              <div className="connect-body">
                <p className="connect-help">
                  {t("connect.methods.help", { label: step.item.label })}
                </p>
                <div className="connect-methods">
                  {step.item.methods.map((method, index) => (
                    <button
                      key={`${method.type}-${method.label}`}
                      type="button"
                      className="connect-method"
                      onClick={() =>
                        void selectMethod(step.item, method, index)
                      }
                    >
                      <strong>{method.label}</strong>
                      <span>
                        {method.type === "oauth"
                          ? method.description || t("connect.method.oauthDefault")
                          : t("connect.method.api")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {step.kind === "api" ? (
              <div className="connect-body">
                <p className="connect-help">
                  {t("connect.api.help")}
                </p>
                {step.item.docsUrl ? (
                  <a
                    className="field-link"
                    href={step.item.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("connect.api.getKey", { label: step.item.label })}
                  </a>
                ) : null}
                <label className="field">
                  <span>{t("connect.api.label")}</span>
                  <input
                    type="password"
                    value={apiKey}
                    autoFocus
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t("connect.api.placeholder")}
                  />
                </label>
                {formError ? (
                  <div className="settings-test-banner error">{formError}</div>
                ) : null}
                <div className="connect-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setStep({ kind: "methods", item: step.item })
                    }
                  >
                    {t("common.back")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!!busyId}
                    onClick={() => void submitApiKey()}
                  >
                    {t("connect.api.next")}
                  </button>
                </div>
              </div>
            ) : null}

            {step.kind === "oauth-pending" ? (
              <div className="connect-body">
                <div className="connect-spinner" aria-hidden />
                <p className="connect-help">
                  {step.auth.instructions || t("connect.oauth.pendingDefault")}
                  <br />
                  {t("connect.oauth.pendingNext")}
                </p>
                {step.auth.userCode ? (
                  <div className="connect-user-code">{step.auth.userCode}</div>
                ) : null}
                {step.auth.url ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openUrl(step.auth.url)}
                  >
                    {t("connect.oauth.reopen")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {step.kind === "oauth-code" ? (
              <div className="connect-body">
                <p className="connect-help">
                  {t("connect.oauth.codeHelp", { instructions: step.auth.instructions })}{" "}
                  {step.auth.url ? (
                    <a href={step.auth.url} target="_blank" rel="noreferrer">
                      {t("connect.oauth.openPage")}
                    </a>
                  ) : null}
                </p>
                <label className="field">
                  <span>{t("connect.oauth.codeLabel")}</span>
                  <input
                    value={oauthCode}
                    autoFocus
                    onChange={(e) => setOauthCode(e.target.value)}
placeholder={t("connect.oauth.codePlaceholder")}
                  />
                </label>
                {formError ? (
                  <div className="settings-test-banner error">{formError}</div>
                ) : null}
                <div className="connect-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setStep({ kind: "methods", item: step.item })
                    }
                  >
                    {t("common.back")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!!busyId}
                    onClick={() => void submitOauthCode()}
                  >
                    {t("connect.api.next")}
                  </button>
                </div>
              </div>
            ) : null}

            {step.kind === "select-model" ? (
              <div className="connect-body">
                <p className="connect-help">
                  {t("connect.model.help")}
                </p>
                <label className="field">
                  <span className="field-label-row">
                    <span>{remoteModels.length ? t("connect.model.fetched", { count: remoteModels.length }) : t("connect.model.label")}</span>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={fetchingModels}
                      onClick={() => void fetchRemoteModels(step.item)}
                    >
                      {fetchingModels ? t("connect.model.fetching") : t("connect.model.fetch")}
                    </button>
                  </span>
                  <select
                    autoFocus
                    value={
                      modelChoices.includes(selectedModel)
                        ? selectedModel
                        : "__custom__"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setFormError("");
                      if (v === "__custom__") {
                        if (modelChoices.includes(selectedModel)) {
                          setSelectedModel("");
                        }
                        return;
                      }
                      setSelectedModel(v);
                    }}
                  >
                    {remoteModels.length ? (
                      <optgroup label={t("connect.model.groupFetched", { count: remoteModels.length })}>
                        {remoteModels.map((m) => (
                          <option key={`r-${m}`} value={m}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {modelChoices.filter((m) => !remoteModels.includes(m))
                      .length ? (
                      <optgroup label={t("connect.model.groupSuggested")}>
                        {modelChoices
                          .filter((m) => !remoteModels.includes(m))
                          .map((m) => (
                            <option key={`s-${m}`} value={m}>
                              {m}
                            </option>
                          ))}
                      </optgroup>
                    ) : null}
                    <option value="__custom__">{t("connect.model.custom")}</option>
                  </select>
                  {!modelChoices.includes(selectedModel) ? (
                    <input
                      value={selectedModel}
                      onChange={(e) => {
                        setSelectedModel(e.target.value);
                        setFormError("");
                      }}
                      placeholder={
                        step.item.defaultModel || t("connect.model.placeholder")
                      }
                    />
                  ) : null}
                </label>
                {formError ? (
                  <div className="settings-test-banner error">{formError}</div>
                ) : null}
                <div className="connect-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setStep({ kind: "closed" })}
                  >
                    {t("connect.model.later")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!!busyId || !selectedModel.trim()}
                    onClick={() => void submitModel()}
                  >
                    {t("connect.model.activate")}
                  </button>
                </div>
              </div>
            ) : null}

            {step.kind === "error" ? (
              <div className="connect-body">
                <div className="settings-test-banner error">{step.message}</div>
                <div className="connect-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => startConnect(step.item)}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
