import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, createMemo } from "solid-js"
import { type ServerSDK, useServerSDK } from "./server-sdk"
import { withBackendProviderCredentials } from "./provider-credential-bridge"

export type DirectorySDK = ReturnType<ServerSDK["ensureDirSdkContext"]>

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  // Resolves the directory-scoped SDK reactively from the (possibly changing) server.
  init: (props: { directory: string | Accessor<string> }) => {
    const serverSDK = useServerSDK()
    return createMemo(() => {
      const directory = typeof props.directory === "function" ? props.directory() : props.directory
      const sdk = serverSDK().ensureDirSdkContext(directory)
      return withBackendProviderCredentials(sdk)
    })
  },
})
