import { createSignal, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"

export function PreviewPanel(props: { stacked?: boolean }) {
  const { t } = useLanguage()
  const { view } = useSessionLayout()
  
  const [inputValue, setInputValue] = createSignal(view().previewPanel.url())
  
  let iframeRef: HTMLIFrameElement | undefined

  const handleRefresh = () => {
    if (iframeRef) {
      // Re-assigning src triggers a reload in most browsers even for iframes
      const current = iframeRef.src
      iframeRef.src = current
    }
  }

  const handleNavigate = (e: Event) => {
    e.preventDefault()
    let val = inputValue()
    if (!val.startsWith('http://') && !val.startsWith('https://')) {
      val = 'http://' + val
    }
    view().previewPanel.setUrl(val)
    setInputValue(val)
  }

  const panelHeight = () => (props.stacked ? `${view().previewPanel.height()}px` : "100%")

  return (
    <div 
      class="flex flex-col w-full bg-background border-l border-border-weaker-base"
      style={{ height: panelHeight() }}
    >
      <div class="flex items-center gap-2 p-2 border-b border-border-weaker-base bg-background-stronger">
        <IconButton 
          icon="reset" 
          onClick={handleRefresh} 
          title="Refresh"
          aria-label="Refresh preview"
        />
        <form class="flex-1 flex items-center" onSubmit={handleNavigate}>
          <input
            type="text"
            aria-label="Preview URL"
            class="w-full px-3 py-1.5 text-12-regular rounded bg-background border border-border focus:outline-none focus:border-border-stronger text-text"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            placeholder="http://localhost:5173"
          />
        </form>
        <IconButton
          icon="link"
          onClick={() => window.open(view().previewPanel.url(), "_blank")}
          title="Open in new tab"
          aria-label="Open preview in new tab"
        />
      </div>
      <div class="flex-1 relative bg-white">
        <iframe
          ref={iframeRef}
          src={view().previewPanel.url()}
          title="Preview"
          class="absolute inset-0 w-full h-full border-0 bg-white"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  )
}
