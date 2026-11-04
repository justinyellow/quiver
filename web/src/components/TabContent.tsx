import type { Tab } from '@/lib/types'
import RequestEditor from '@/components/request/RequestEditor'
import CollectionEditor from '@/components/CollectionEditor'
import FolderEditor from '@/components/FolderEditor'
import EnvironmentEditor from '@/components/EnvironmentEditor'
import Runner from '@/components/Runner'
import RunView from '@/components/RunView'
import PerfView from '@/components/PerfView'
import MockEditor from '@/components/MockEditor'
import MonitorEditor from '@/components/MonitorEditor'
import WsClient from '@/components/WsClient'
import ExampleEditor from '@/components/ExampleEditor'
import HistoryView from '@/components/HistoryView'
import CookiesView from '@/components/CookiesView'
import SettingsPage from '@/pages/Settings'
import HelpView from '@/components/HelpView'

export default function TabContent({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'request': return <RequestEditor tab={tab} />
    case 'collection': return <CollectionEditor tab={tab} />
    case 'folder': return <FolderEditor tab={tab} />
    case 'environment': return <EnvironmentEditor tab={tab} />
    case 'runner': return <Runner tab={tab} />
    case 'run': return <RunView tab={tab} />
    case 'perf': return <PerfView tab={tab} />
    case 'mock': return <MockEditor tab={tab} />
    case 'monitor': return <MonitorEditor tab={tab} />
    case 'ws': return <WsClient tab={tab} />
    case 'example': return <ExampleEditor tab={tab} />
    case 'history': return <HistoryView tab={tab} />
    case 'cookies': return <CookiesView />
    case 'settings': return <SettingsPage tab={tab} />
    case 'help': return <HelpView tab={tab} />
    default: return <div className="p-4 text-xs faint">Unknown tab</div>
  }
}
