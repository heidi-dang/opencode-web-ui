import { batch, createMemo, startTransition, type Accessor } from "solid-js"
import { useModels } from "@/context/models"
import type { ModelKey, ModelSelection } from "@/context/local"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/context/model-variant"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { resolveDefaultModel } from "@/hooks/provider-catalog"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { showToast } from "@/utils/toast"
import { createSessionSelectionQueue } from "./session-selection-queue"

export type PromptModelSelection = ModelSelection & {
  waitForPending: () => Promise<boolean>
  switching: () => boolean
}

export function createPromptModelSelection(input: {
  agent: () => { model?: ModelKey; variant?: string } | undefined
  base?: ModelSelection
  sessionID?: Accessor<string | undefined>
}): PromptModelSelection {
  const sdk = useSDK()
  const sync = useSync()
  const models = useModels()
  const prompt = usePrompt()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)
  const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

  const valid = (model: ModelKey) => {
    const provider = providers.all().get(model.providerID)
    return !!provider?.models[model.modelID] && connected().has(model.providerID)
  }

  const configured = () => {
    const model = resolveDefaultModel(providers.defaultModel(), sync().data.config.model)
    if (!model) return
    if (valid(model)) return model
  }

  const recent = () => models.recent.list().find(valid)
  const fallback = () => {
    const defaults = providers.default()
    return providers.connected().flatMap((provider) => {
      const modelID = defaults[provider.id] ?? Object.values(provider.models)[0]?.id
      return modelID ? [{ providerID: provider.id, modelID }] : []
    })[0]
  }

  const baseModel = () => {
    const item = input.base?.current()
    if (!item) return
    return { providerID: item.provider.id, modelID: item.id, variant: input.base?.variant.current() ?? undefined }
  }

  const current = () => {
    const key = [baseModel(), prompt.model.current(), input.agent()?.model, configured(), recent(), fallback()].find(
      (item): item is ModelKey => !!item && valid(item),
    )
    if (!key) return
    return models.find(key)
  }
  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )

  const commit = (item: ModelKey, options?: { recent?: boolean }) => {
    const next = { ...item }
    input.base?.set(next, options)
    prompt.model.set(next)
    models.setVisibility(next, true)
    if (options?.recent) models.recent.push(next)
    models.variant.set({ providerID: next.providerID, modelID: next.modelID }, next.variant)
    if (!next.variant) input.base?.variant.set(undefined)
  }

  const queue = createSessionSelectionQueue<ModelKey>({
    async apply(item) {
      const sessionID = input.sessionID?.()
      if (!sessionID) return
      await sdk().api.session.switchModel({
        sessionID,
        model: {
          providerID: item.providerID,
          id: item.modelID,
          variant: item.variant,
        },
      })
    },
    commit(item) {
      commit(item)
    },
    onError(error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    },
  })

  const selection = {
    ready: models.ready,
    current,
    recent: recentModels,
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()
      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)
      if (index === -1) return
      const next = items[(index + direction + items.length) % items.length]
      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      if (!item) {
        startTransition(() => batch(() => prompt.model.set(undefined)))
        return Promise.resolve(true)
      }

      const selectedVariant = item.variant ?? input.base?.variant.current() ?? prompt.model.current()?.variant
      const variants = models.find(item)?.variants
      const target = {
        ...item,
        variant: selectedVariant && variants && selectedVariant in variants ? selectedVariant : undefined,
      }
      return queue.set(target).then((success) => {
        if (success && options?.recent) models.recent.push(target)
        return success
      })
    },
    waitForPending: queue.wait,
    switching: queue.pending,
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured() {
        const item = input.agent()
        const model = current()
        if (!item || !model) return
        return getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      },
      selected() {
        return input.base?.variant.selected() ?? prompt.model.current()?.variant
      },
      current() {
        const resolved = resolveModelVariant({
          variants: this.list(),
          selected: this.selected(),
          configured: this.configured(),
        })
        if (resolved) return resolved
        const model = current()
        if (!model) return
        const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
        if (saved && this.list().includes(saved)) return saved
      },
      list() {
        return Object.keys(current()?.variants ?? {})
      },
      set(value: string | undefined) {
        const model = current()
        if (!model) return Promise.resolve(false)
        return queue.set({ providerID: model.provider.id, modelID: model.id, variant: value }).then((success) => {
          if (success) models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          return success
        })
      },
      cycle() {
        const variants = this.list()
        if (variants.length === 0) return
        this.set(
          cycleModelVariant({
            variants,
            selected: this.selected(),
            configured: this.configured(),
          }),
        )
      },
    },
  } satisfies PromptModelSelection

  return selection
}
