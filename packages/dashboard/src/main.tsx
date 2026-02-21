import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { CellTree } from './pages/CellTree';
import { SpawnRequests } from './pages/SpawnRequests';
import { Roles } from './pages/Roles';
import { AuditLog } from './pages/AuditLog';
import FormationDetail from './pages/FormationDetail';
import MissionTimeline from './pages/MissionTimeline';
import ExperimentResults from './pages/ExperimentResults';
import BlueprintCatalog from './pages/BlueprintCatalog';
import KnowledgeExplorer from './pages/KnowledgeExplorer';
import EvolutionProgress from './pages/EvolutionProgress';
import SwarmStatus from './pages/SwarmStatus';
import HumanInbox from './pages/HumanInbox';
import MarketplaceBrowser from './pages/MarketplaceBrowser';
import FederationStatus from './pages/FederationStatus';
import ChannelMessages from './pages/ChannelMessages';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="tree" element={<CellTree />} />
            <Route path="spawn-requests" element={<SpawnRequests />} />
            <Route path="roles" element={<Roles />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="formations" element={<FormationDetail />} />
            <Route path="missions" element={<MissionTimeline />} />
            <Route path="experiments" element={<ExperimentResults />} />
            <Route path="blueprints" element={<BlueprintCatalog />} />
            <Route path="knowledge" element={<KnowledgeExplorer />} />
            <Route path="evolution" element={<EvolutionProgress />} />
            <Route path="swarms" element={<SwarmStatus />} />
            <Route path="human-inbox" element={<HumanInbox />} />
            <Route path="marketplace" element={<MarketplaceBrowser />} />
            <Route path="federation" element={<FederationStatus />} />
            <Route path="channels" element={<ChannelMessages />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
