import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@/utils/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { detectServerProtocol } from "@/utils/server-protocol"
import { checkServerHealth, type ServerHealth, useCheckServerHealth } from "@/utils/server-health"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"

const DEFAULT_USERNAME = "opencode"

interface ServerFormProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: ServerHealthState | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onTest: () => void
  onBack: () => void
}

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer() {
  const language = useLanguage()
  const platform = usePlatform()
  const [defaultKey, defaultUrlActions] = createResource(
    async () => {
      try {
        const key = await platform.getDefaultServer?.()
        if (!key) return null
        return key
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const canDefault = createMemo(() => !!platform.getDefaultServer && !!platform.setDefaultServer)
  const setDefault = async (key: ServerConnection.Key | null) => {
    try {
      await platform.setDefaultServer?.(key)
      defaultUrlActions.mutate(key)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaultKey: () => defaultKey.latest, canDefault, setDefault }
}

type ServerHealthState = {
  healthy?: boolean
  requiresAuth?: boolean
  authFailed?: boolean
}

function useServerPreview() {
  const platform = usePlatform()
  let abortController: AbortController | undefined

  const looksComplete = (value: string) => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) return false
    try {
      const url = new URL(normalized)
      if (url.port) {
        const port = parseInt(url.port, 10)
        if (isNaN(port) || port <= 0 || port > 65535) return false
      }
      return true
    } catch {
      return false
    }
  }

  const previewStatus = async (
    value: string,
    username: string,
    password: string,
    setStatusState: (value: ServerHealthState | undefined) => void,
  ) => {
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()
    const signal = abortController.signal

    setStatusState(undefined)
    if (!looksComplete(value)) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) return
    const http: ServerConnection.HttpBase = { url: normalized }
    if (username) http.username = username
    if (password) http.password = password
    
    try {
      const result = await checkServerHealth(http, platform.fetch ?? globalThis.fetch, { signal })
      if (signal.aborted) return
      setStatusState({
        healthy: result.healthy,
        requiresAuth: result.requiresAuth,
        authFailed: result.authFailed,
      })
    } catch {
      if (signal.aborted) return
      setStatusState({ healthy: false })
    }
  }

  return { previewStatus }
}

function ServerForm(props: ServerFormProps) {
  const language = useLanguage()
  const [host, setHost] = createSignal("")
  const [port, setPort] = createSignal("4096")

  createEffect(() => {
    if (props.value) {
      try {
        const clean = props.value.replace(/^https?:\/\//, "")
        const parts = clean.split(":")
        if (parts[0]) setHost(parts[0])
        if (parts[1]) setPort(parts[1].split("/")[0])
      } catch {}
    }
  })

  const updateUrl = (h: string, p: string) => {
    let cleanHost = h.trim()
    if (cleanHost === "http" || cleanHost === "https" || cleanHost === "http:" || cleanHost === "https:") {
      props.onChange("")
      return
    }
    if (cleanHost.includes("://")) {
      try {
        const parsed = new URL(cleanHost)
        cleanHost = parsed.hostname
        if (parsed.port) p = parsed.port
      } catch {}
    }
    const cleanPort = p.trim() || "4096"
    const constructed = cleanHost && cleanHost.length > 1 ? `http://${cleanHost}:${cleanPort}` : ""
    props.onChange(constructed)
  }

  const handleHostChange = (val: string) => {
    setHost(val)
    updateUrl(val, port())
  }

  const handlePortChange = (val: string) => {
    setPort(val)
    updateUrl(host(), val)
  }

  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  const normalizedPreview = createMemo(() => {
    if (!props.value) return ""
    return normalizeServerUrl(props.value) ?? props.value
  })

  return (
    <div class="flex flex-col gap-4">
      <div class="bg-surface-base rounded-md p-4 sm:p-5 flex flex-col gap-4 border border-border-weak">
        <div class="text-14-medium font-semibold text-text-primary mb-0.5 flex items-center justify-between">
          <span>Server Setup Wizard</span>
          <span class="text-xs text-text-muted font-normal">Step-by-step Setup</span>
        </div>

        {/* Step 1 & 2: IP Address / Host & Port */}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
          <div class="sm:col-span-2 min-w-0">
            <TextField
              type="text"
              label="1. IP Address / Host"
              placeholder="e.g. 100.98.24.11 or localhost"
              value={host()}
              autofocus
              validationState={props.error ? "invalid" : "valid"}
              disabled={props.busy}
              onChange={handleHostChange}
              onKeyDown={keyDown}
            />
          </div>
          <div class="min-w-0">
            <TextField
              type="text"
              label="2. Port"
              placeholder="4096"
              value={port()}
              disabled={props.busy}
              onChange={handlePortChange}
              onKeyDown={keyDown}
            />
          </div>
        </div>

        {/* Step 3: Server Name (Optional) */}
        <TextField
          type="text"
          label={`3. ${language.t("dialog.server.add.name")} (Optional)`}
          placeholder="e.g. Home PC / Workstation"
          value={props.name}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />

        {/* Step 4: Authentication Credentials */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <TextField
            type="text"
            label={`4. ${language.t("dialog.server.add.username")}`}
            placeholder={language.t("dialog.server.add.usernamePlaceholder")}
            value={props.username}
            disabled={props.busy}
            onChange={props.onUsernameChange}
            onKeyDown={keyDown}
          />
          <TextField
            type="password"
            label={language.t("dialog.server.add.password")}
            placeholder={language.t("dialog.server.add.passwordPlaceholder")}
            value={props.password}
            disabled={props.busy}
            onChange={props.onPasswordChange}
            onKeyDown={keyDown}
          />
        </div>

        {/* Endpoint Health Preview */}
        <Show when={normalizedPreview()}>
          <div class="bg-surface-base-hover/60 p-3 rounded-md border border-border-weak flex flex-col gap-1.5 text-xs">
            <div class="text-text-muted flex justify-between items-center">
              <span class="font-medium">Configured Target Endpoint:</span>
              <Show when={props.status !== undefined}>
                <Show when={props.status?.healthy}>
                  <span class="text-emerald-400 font-semibold flex items-center gap-1">✓ Reachable</span>
                </Show>
                <Show when={!props.status?.healthy && props.status?.requiresAuth && !props.status?.authFailed}>
                  <span class="text-amber-400 font-semibold flex items-center gap-1">🔒 Credentials Required</span>
                </Show>
                <Show when={!props.status?.healthy && props.status?.authFailed}>
                  <span class="text-rose-400 font-semibold flex items-center gap-1">🔒 Invalid Credentials</span>
                </Show>
                <Show when={!props.status?.healthy && !props.status?.requiresAuth}>
                  <span class="text-rose-400 font-semibold flex items-center gap-1">✗ Unreachable</span>
                </Show>
              </Show>
            </div>
            <div class="font-mono text-text-primary truncate font-medium">
              {normalizedPreview()}
            </div>
          </div>
        </Show>

        <Show when={props.error}>
          <div class="text-xs text-rose-400 font-medium">{props.error}</div>
        </Show>
        
        <div class="flex justify-end pt-2">
          <Button
            variant="secondary"
            size="small"
            onClick={props.onTest}
            disabled={props.busy || !props.value}
            class="text-xs px-3"
          >
            Test Connection
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DialogSelectServer() {
  const dialog = useDialog()
  const controller = useServerManagementController({ onSelect: dialog.close })

  return (
    <Dialog title={controller.formTitle()}>
      <div class="flex flex-1 min-h-0 flex-col px-5">
        <Show when={controller.isFormMode()} fallback={<ServerConnectionList controller={controller} />}>
          <ServerConnectionForm controller={controller} />
        </Show>
      </div>
    </Dialog>
  )
}

export function useServerManagementController(options: { onSelect?: () => void; navigateOnAdd?: boolean } = {}) {
  const navigate = useNavigate()
  const server = useServer()
  const tabs = useTabs()
  const global = useGlobal()
  const platform = usePlatform()
  const language = useLanguage()
  const { defaultKey, canDefault, setDefault } = useDefaultServer()
  const { previewStatus } = useServerPreview()
  const checkServerHealth = useCheckServerHealth()
  const [store, setStore] = createStore({
    addServer: {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: false,
      status: undefined as ServerHealthState | undefined,
    },
    editServer: {
      id: undefined as string | undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined as ServerHealthState | undefined,
    },
  })

  const resetAdd = () => {
    setStore("addServer", {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: false,
      status: undefined,
    })
  }
  const resetEdit = () => {
    setStore("editServer", {
      id: undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined,
    })
  }

  const addMutation = useMutation(() => ({
    mutationFn: async (value: string) => {
      const normalized = normalizeServerUrl(value)
      if (!normalized) {
        resetAdd()
        return
      }

      const conn: ServerConnection.Http = {
        type: "http",
        http: { url: normalized },
      }
      if (store.addServer.name.trim()) conn.displayName = store.addServer.name.trim()
      if (store.addServer.username) conn.http.username = store.addServer.username
      if (store.addServer.password) conn.http.password = store.addServer.password
      let connection = conn
      let result = await checkServerHealth(conn.http)
      if (!result.healthy && typeof location === "object" && location.origin) {
        const proxyHttp = { ...conn.http, url: `${location.origin}/opencode-server` }
        const proxyResult = await checkServerHealth(proxyHttp)
        if (proxyResult.healthy) {
          result = proxyResult
          // Keep using the endpoint that passed health. Saving the original
          // direct URL makes subsequent projects/providers requests fail on
          // HTTPS deployments because of mixed-content/CORS restrictions.
          connection = { ...conn, http: { ...conn.http, url: proxyHttp.url } }
        }
      }
      if (!result.healthy) {
        if (result.requiresAuth && (!store.addServer.username || !store.addServer.password)) {
          setStore("addServer", { error: "Server requires authentication. Please enter Username & Password." })
        } else if (result.requiresAuth && result.authFailed) {
          setStore("addServer", { error: "Authentication Failed: Invalid Username or Password." })
        } else {
          setStore("addServer", { error: language.t("dialog.server.add.error") })
        }
        return
      }

      resetAdd()
      if (options.navigateOnAdd === false) {
        const added = server.add(connection)
        if (added) global.settings.server.set(ServerConnection.key(added))
        options.onSelect?.()
        return
      }
      await select(connection, true)
    },
  }))

  const editMutation = useMutation(() => ({
    mutationFn: async (input: { original: ServerConnection.Any; value: string }) => {
      if (input.original.type !== "http") return
      const normalized = normalizeServerUrl(input.value)
      if (!normalized) {
        resetEdit()
        return
      }

      const name = store.editServer.name.trim() || undefined
      const username = store.editServer.username || undefined
      const password = store.editServer.password || undefined
      const existingName = input.original.displayName
      if (
        normalized === input.original.http.url &&
        name === existingName &&
        username === input.original.http.username &&
        password === input.original.http.password
      ) {
        resetEdit()
        return
      }

      const conn: ServerConnection.Http = {
        type: "http",
        displayName: name,
        http: { url: normalized, username, password },
      }
      const result = await checkServerHealth(conn.http)
      if (!result.healthy) {
        setStore("editServer", { error: language.t("dialog.server.add.error") })
        return
      }
      if (
        !settings.general.newLayoutDesigns() &&
        (await detectServerProtocol(conn.http, platform.fetch ?? globalThis.fetch)) === "v2"
      ) {
        setStore("editServer", { error: language.t("dialog.server.add.error") })
        return
      }
      if (normalized === input.original.http.url) {
        server.add(conn)
      } else {
        replaceServer(input.original, conn)
      }

      resetEdit()
    },
  }))

  const replaceServer = (original: ServerConnection.Http, next: ServerConnection.Http) => {
    const originalKey = ServerConnection.key(original)
    const active = server.key
    tabs.removeServer(originalKey)
    const newConn = server.add(next)
    if (!newConn) return
    const nextActive = active === originalKey ? ServerConnection.key(newConn) : active
    if (nextActive) server.setActive(nextActive)
    server.remove(originalKey)
  }

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const settings = useSettings()
  const current = createMemo<ServerConnection.Any | undefined>(() =>
    settings.general.newLayoutDesigns()
      ? undefined
      : (items().find((x) => ServerConnection.key(x) === server.key) ?? items()[0]),
  )

  const sortedItems = createMemo(() => {
    const raw = items()
    const list = settings.general.newLayoutDesigns()
      ? raw
      : raw.filter((x) => global.ensureServerCtx(x).sdk.protocolKind() !== "v2")
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff =
        rank(global.servers.health[ServerConnection.key(a)]) - rank(global.servers.health[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function select(conn: ServerConnection.Any, persist?: boolean) {
    if (!persist && global.servers.health[ServerConnection.key(conn)]?.healthy === false) return
    options.onSelect?.()
    if (persist && conn.type === "http") {
      server.add(conn)
      navigate("/")
      return
    }
    navigate("/")
    queueMicrotask(() => server.setActive(ServerConnection.key(conn)))
  }

  const handleAddChange = (value: string) => {
    if (addMutation.isPending) return
    setStore("addServer", { url: value, error: "", status: undefined })
  }

  const handleAddNameChange = (value: string) => {
    if (addMutation.isPending) return
    setStore("addServer", { name: value, error: "" })
  }

  const handleAddUsernameChange = (value: string) => {
    if (addMutation.isPending) return
    setStore("addServer", { username: value, error: "", status: undefined })
  }

  const handleAddPasswordChange = (value: string) => {
    if (addMutation.isPending) return
    setStore("addServer", { password: value, error: "", status: undefined })
  }

  const handleEditChange = (value: string) => {
    if (editMutation.isPending) return
    setStore("editServer", { value, error: "", status: undefined })
  }

  const handleEditNameChange = (value: string) => {
    if (editMutation.isPending) return
    setStore("editServer", { name: value, error: "" })
  }

  const handleEditUsernameChange = (value: string) => {
    if (editMutation.isPending) return
    setStore("editServer", { username: value, error: "", status: undefined })
  }

  const handleEditPasswordChange = (value: string) => {
    if (editMutation.isPending) return
    setStore("editServer", { password: value, error: "", status: undefined })
  }

  const testConnection = () => {
    const isAdd = isAddMode()
    const value = isAdd ? store.addServer.url : store.editServer.value
    const username = isAdd ? store.addServer.username : store.editServer.username
    const password = isAdd ? store.addServer.password : store.editServer.password
    
    void previewStatus(value, username, password, (next) => {
      if (isAdd) {
        setStore("addServer", { status: next })
      } else {
        setStore("editServer", { status: next })
      }
    })
  }

  const mode = createMemo<"list" | "add" | "edit">(() => {
    if (store.editServer.id) return "edit"
    if (store.addServer.showForm) return "add"
    return "list"
  })

  const editing = createMemo(() => {
    if (!store.editServer.id) return
    return items().find((x) => x.type === "http" && x.http.url === store.editServer.id)
  })

  const resetForm = () => {
    resetAdd()
    resetEdit()
  }

  const startAdd = () => {
    resetEdit()
    setStore("addServer", {
      showForm: true,
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      status: undefined,
    })
  }

  const startEdit = (conn: ServerConnection.Http) => {
    resetAdd()
    setStore("editServer", {
      id: conn.http.url,
      value: conn.http.url,
      name: conn.displayName ?? "",
      username: conn.http.username ?? "",
      password: conn.http.password ?? "",
      error: "",
      status: global.servers.health[ServerConnection.key(conn)]?.healthy !== undefined
        ? { healthy: global.servers.health[ServerConnection.key(conn)]?.healthy }
        : undefined,
    })
  }

  const submitForm = () => {
    if (mode() === "add") {
      if (addMutation.isPending) return
      setStore("addServer", { error: "" })
      addMutation.mutate(store.addServer.url)
      return
    }
    const original = editing()
    if (!original) return
    if (editMutation.isPending) return
    setStore("editServer", { error: "" })
    editMutation.mutate({ original, value: store.editServer.value })
  }

  const isFormMode = createMemo(() => mode() !== "list")
  const isAddMode = createMemo(() => mode() === "add")
  const formBusy = createMemo(() => (isAddMode() ? addMutation.isPending : editMutation.isPending))

  const formTitle = createMemo(() => {
    if (!isFormMode()) return language.t("dialog.server.title")
    return (
      <div class="flex items-center gap-2 -ml-2">
        <IconButton icon="arrow-left" variant="ghost" onClick={resetForm} aria-label={language.t("common.goBack")} />
        <span>{isAddMode() ? language.t("dialog.server.add.title") : language.t("dialog.server.edit.title")}</span>
      </div>
    )
  })

  createEffect(() => {
    if (!store.editServer.id) return
    if (editing()) return
    resetEdit()
  })

  async function handleRemove(key: ServerConnection.Key) {
    try {
      if (key.startsWith("wsl:")) await platform.wslServers?.removeServer(key)
      tabs.removeServer(key)
      server.remove(key)
      if ((await platform.getDefaultServer?.()) === key) {
        await setDefault(null)
      }
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return {
    defaultKey,
    canDefault,
    current,
    sortedItems,
    status: () => global.servers.health,
    isFormMode,
    isAddMode,
    formTitle,
    formBusy,
    formValue: () => (isAddMode() ? store.addServer.url : store.editServer.value),
    formName: () => (isAddMode() ? store.addServer.name : store.editServer.name),
    formUsername: () => (isAddMode() ? store.addServer.username : store.editServer.username),
    formPassword: () => (isAddMode() ? store.addServer.password : store.editServer.password),
    formError: () => (isAddMode() ? store.addServer.error : store.editServer.error),
    formStatus: () => (isAddMode() ? store.addServer.status : store.editServer.status),
    select,
    setDefault,
    startAdd,
    startEdit,
    resetForm,
    submitForm,
    handleRemove,
    testConnection,
    handleFormChange: () => (isAddMode() ? handleAddChange : handleEditChange),
    handleFormNameChange: () => (isAddMode() ? handleAddNameChange : handleEditNameChange),
    handleFormUsernameChange: () => (isAddMode() ? handleAddUsernameChange : handleEditUsernameChange),
    handleFormPasswordChange: () => (isAddMode() ? handleAddPasswordChange : handleEditPasswordChange),
  }
}

export function ServerConnectionList(props: { controller: ReturnType<typeof useServerManagementController> }) {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex flex-1 min-h-0 flex-col gap-4">
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:min-h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent"
        search={{
          placeholder: language.t("dialog.server.search.placeholder"),
          autofocus: false,
        }}
        noInitialSelection
        emptyMessage={language.t("dialog.server.empty")}
        items={props.controller.sortedItems}
        key={(x) => x.http.url}
        onSelect={(x) => {
          if (x && !settings.general.newLayoutDesigns()) void props.controller.select(x)
        }}
        divider={true}
      >
        {(i) => {
          const key = ServerConnection.key(i)
          return (
            <div class="flex items-center gap-3 min-w-0 flex-1 w-full group/item">
              <div class="flex flex-col h-full items-center w-5">
                <ServerHealthIndicator health={props.controller.status()[key]} />
              </div>
              <ServerRow
                conn={i}
                dimmed={props.controller.status()[key]?.healthy === false}
                status={props.controller.status()[key]}
                class="flex items-center gap-3 min-w-0 flex-1"
                badge={
                  <Show when={props.controller.defaultKey() === ServerConnection.key(i)}>
                    <span class="text-text-base bg-surface-base text-14-regular px-1.5 rounded-xs">
                      {language.t("dialog.server.status.default")}
                    </span>
                  </Show>
                }
                showCredentials
              />
              <div class="flex items-center justify-center gap-4 pl-4">
                <Show when={props.controller.current() && ServerConnection.key(props.controller.current()!) === key}>
                  <Icon name="check" class="h-6" />
                </Show>

                <Show when={i.type === "http"}>
                  <DropdownMenu>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                      onClick={(e: MouseEvent) => e.stopPropagation()}
                      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item
                          onSelect={() => {
                            if (i.type !== "http") return
                            props.controller.startEdit(i)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() !== key}>
                          <DropdownMenu.Item onSelect={() => props.controller.setDefault(key)}>
                            <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.default")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <Show when={props.controller.canDefault() && props.controller.defaultKey() === key}>
                          <DropdownMenu.Item onSelect={() => props.controller.setDefault(null)}>
                            <DropdownMenu.ItemLabel>
                              {language.t("dialog.server.menu.defaultRemove")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          onSelect={() => props.controller.handleRemove(ServerConnection.key(i))}
                          class="text-text-on-critical-base hover:bg-surface-critical-weak"
                        >
                          <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.delete")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </Show>
              </div>
            </div>
          )
        }}
      </List>

      <div class="shrink-0 pb-5">
        <Button
          variant="secondary"
          icon="plus-small"
          size="large"
          onClick={props.controller.startAdd}
          class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
        >
          {language.t("dialog.server.add.button")}
        </Button>
      </div>
    </div>
  )
}

export function ServerConnectionForm(props: { controller: ReturnType<typeof useServerManagementController> }) {
  const language = useLanguage()

  return (
    <div class="flex flex-1 min-h-0 flex-col gap-4">
      <ServerForm
        value={props.controller.formValue()}
        name={props.controller.formName()}
        username={props.controller.formUsername()}
        password={props.controller.formPassword()}
        placeholder={language.t("dialog.server.add.placeholder")}
        busy={props.controller.formBusy()}
        error={props.controller.formError()}
        status={props.controller.formStatus()}
        onChange={props.controller.handleFormChange()}
        onNameChange={props.controller.handleFormNameChange()}
        onUsernameChange={props.controller.handleFormUsernameChange()}
        onPasswordChange={props.controller.handleFormPasswordChange()}
        onSubmit={props.controller.submitForm}
        onTest={props.controller.testConnection}
        onBack={props.controller.resetForm}
      />
      <div class="shrink-0 pb-5">
        <Button
          variant="primary"
          size="large"
          onClick={props.controller.submitForm}
          disabled={props.controller.formBusy()}
          class="px-3 py-1.5"
        >
          {props.controller.formBusy()
            ? language.t("dialog.server.add.checking")
            : props.controller.isAddMode()
              ? language.t("dialog.server.add.button")
              : language.t("common.save")}
        </Button>
      </div>
    </div>
  )
}
